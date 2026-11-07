import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { docPeriod, iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import { StockMovement } from './entities/stock.entities';
import type { Tx } from '../database/database.types';
import { NumberingService } from '../database/numbering.service';
import { ProductsService } from '../products/products.service';
import { ADJUST_REASONS, isLow, type AdjustReason, type MovementKind } from './stock-rules';

export interface Movement {
  /** Exactly one of productId and premiumId. */
  productId?: string;
  premiumId?: string;
  qty: number;
  kind: MovementKind;
  docNo?: string;
  unitCost?: number;
  at: Date;
}

export interface StockRow {
  productId: string;
  sku: string;
  name: string;
  categoryId: string;
  stock: number;
  reorderPoint: number;
  low: boolean;
  /** Value at average cost; only for those allowed to see cost. */
  value?: number;
}

/**
 * The stock ledger: stock is only ever the sum of its rows, nobody edits a balance (spec).
 * Sales writes through `record`; the back office reads levels and makes adjustments here.
 */
@Injectable()
export class StockService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /* ---------- ledger, used by sales and receiving ---------- */

  async record(tx: Tx, movements: Movement[]): Promise<void> {
    for (const m of movements) {
      await tx.insert(StockMovement, { productId: m.productId ?? null, premiumId: m.premiumId ?? null, qty: m.qty, kind: m.kind, docNo: m.docNo ?? null, unitCost: m.unitCost ?? null, at: m.at });
    }
  }

  async balanceOf(tx: Tx, productId: string): Promise<number> {
    const r = await tx.createQueryBuilder(StockMovement, 'm').select('COALESCE(SUM(m.qty), 0)', 'q').where('m.product_id = :productId', { productId }).getRawOne<{ q: number }>();
    return Number(r?.q ?? 0);
  }

  async balances(tx: Tx = this.db.manager): Promise<Map<string, number>> {
    const rows = await tx.createQueryBuilder(StockMovement, 'm').select('m.product_id', 'productId').addSelect('SUM(m.qty)', 'q').where('m.product_id IS NOT NULL').groupBy('m.product_id').getRawMany<{ productId: string; q: number }>();
    return new Map(rows.map((r) => [r.productId, Number(r.q)]));
  }

  /** How many of each free gift (premium) is left. */
  async premiumBalances(tx: Tx = this.db.manager): Promise<Map<string, number>> {
    const rows = await tx.createQueryBuilder(StockMovement, 'm').select('m.premium_id', 'premiumId').addSelect('SUM(m.qty)', 'q').where('m.premium_id IS NOT NULL').groupBy('m.premium_id').getRawMany<{ premiumId: string; q: number }>();
    return new Map(rows.map((r) => [r.premiumId, Number(r.q)]));
  }

  /* ---------- back office ---------- */

  async levels(q: { categoryId?: string; lowOnly?: boolean } = {}, canSeeCost = false): Promise<StockRow[]> {
    const [products, balances] = await Promise.all([this.products.directory(), this.balances()]);
    return products
      .filter((p) => p.active && (!q.categoryId || p.categoryId === q.categoryId))
      .map((p) => ({ p, stock: balances.get(p.id) ?? 0 }))
      .filter(({ p, stock }) => !q.lowOnly || stock <= p.reorderPoint)
      .map(({ p, stock }) => ({
        productId: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, stock, reorderPoint: p.reorderPoint, low: isLow(stock, p.reorderPoint),
        ...(canSeeCost ? { value: Math.max(0, stock) * p.cost } : {}),
      }));
  }

  async movements(productId: string, limit = 200) {
    const rows = await this.db.manager.find(StockMovement, { where: { productId }, order: { id: 'DESC' }, take: limit });
    return rows.map((r) => ({ at: iso(r.at), qty: r.qty, kind: r.kind, docNo: r.docNo }));
  }

  /** Waste, loss, expiry: each needs a reason and leaves a ledger row (spec: "ตัดของเสีย หาย หมดอายุ"). */
  async adjust(input: { productId: string; qty: number; reason: AdjustReason; note?: string }, actor: Employee): Promise<void> {
    if (!Number.isInteger(input.qty) || input.qty === 0) throw new DomainError('invalid', 'ใส่จำนวนที่ปรับ');
    if (!ADJUST_REASONS.includes(input.reason)) throw new DomainError('invalid', 'เลือกเหตุผลการปรับสต็อก');
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      if (!(await this.products.productsExist(tx, [input.productId])).has(input.productId)) throw new DomainError('not_found', 'ไม่พบสินค้า');
      const docNo = await this.numbering.next(tx, `ADJ-${docPeriod(now)}`);
      await this.record(tx, [{ productId: input.productId, qty: input.qty, kind: `adjust_${input.reason}`, docNo, at: now }]);
      await this.audit.record(tx, now, { actor: actor.id, action: 'stock.adjust', entity: 'product', entityId: input.productId, after: { qty: input.qty, reason: input.reason, note: input.note, docNo } });
    });
  }

  /** Free gifts have their own stock; this adds to it (or removes with a negative number) through the ledger. */
  async premiumStock(id: string, qty: number, actor: Employee): Promise<void> {
    if (!Number.isInteger(qty) || qty === 0) throw new DomainError('invalid', 'ใส่จำนวนที่เติมหรือตัดออก');
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      if (!(await this.products.premiumsExist(tx, [id])).has(id)) throw new DomainError('not_found', 'ไม่พบของแถมนี้');
      await this.record(tx, [{ premiumId: id, qty, kind: qty > 0 ? 'receive' : 'adjust_other', docNo: 'PREMIUM', at: now }]);
      await this.audit.record(tx, now, { actor: actor.id, action: 'stock.premium', entity: 'premium', entityId: id, after: { qty } });
    });
  }
}
