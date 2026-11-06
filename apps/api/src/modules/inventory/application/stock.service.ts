import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditLog } from '../../../shared/audit/audit-log';
import { UnitOfWork } from '../../../shared/database/unit-of-work';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { docPeriod, iso } from '../../../shared/kernel/dates';
import { DomainError } from '../../../shared/kernel/domain-error';
import { DocumentNumbers } from '../../../shared/numbering/document-numbers';
import { ProductDirectory } from '../domain/product-directory';
import { StockRepository } from '../domain/stock.repository';
import { ADJUST_REASONS, isLow, type AdjustReason } from '../domain/stock-rules';

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

/** What is on the shelf now, its history, and the adjustments (waste, loss, expiry) that change it. */
@Injectable()
export class StockService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(StockRepository) private readonly repo: StockRepository,
    @Inject(ProductDirectory) private readonly products: ProductDirectory,
    @Inject(DocumentNumbers) private readonly numbers: DocumentNumbers,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async levels(q: { categoryId?: string; lowOnly?: boolean } = {}, canSeeCost = false): Promise<StockRow[]> {
    const read = this.uow.read;
    const [products, balances] = await Promise.all([this.products.all(read), this.repo.balances(read)]);
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
    return (await this.repo.movementsOf(this.uow.read, productId, limit)).map((r) => ({ at: iso(r.at), qty: r.qty, kind: r.kind, docNo: r.docNo }));
  }

  /** Waste, loss, expiry: each needs a reason and leaves a ledger row (spec: "ตัดของเสีย หาย หมดอายุ"). */
  async adjust(input: { productId: string; qty: number; reason: AdjustReason; note?: string }, actor: Employee): Promise<void> {
    if (!Number.isInteger(input.qty) || input.qty === 0) throw new DomainError('invalid', 'ใส่จำนวนที่ปรับ');
    if (!ADJUST_REASONS.includes(input.reason)) throw new DomainError('invalid', 'เลือกเหตุผลการปรับสต็อก');
    const now = this.clock();
    await this.uow.run(async (tx) => {
      if (!(await this.products.exist(tx, [input.productId])).has(input.productId)) throw new DomainError('not_found', 'ไม่พบสินค้า');
      const docNo = await this.numbers.format(tx, `ADJ-${docPeriod(now)}`);
      await this.repo.append(tx, { productId: input.productId, qty: input.qty, kind: `adjust_${input.reason}`, docNo, at: now });
      await this.audit.record(tx, now, { actor: actor.id, action: 'stock.adjust', entity: 'product', entityId: input.productId, after: { qty: input.qty, reason: input.reason, note: input.note, docNo } });
    });
  }

  /** Premiums (free gifts) have their own stock; this adds to it (or removes with a negative number) through the ledger. */
  async premiumStock(id: string, qty: number, actor: Employee): Promise<void> {
    if (!Number.isInteger(qty) || qty === 0) throw new DomainError('invalid', 'ใส่จำนวนที่เติมหรือตัดออก');
    const now = this.clock();
    await this.uow.run(async (tx) => {
      if (!(await this.products.premiumsExist(tx, [id])).has(id)) throw new DomainError('not_found', 'ไม่พบของแถมนี้');
      await this.repo.append(tx, { premiumId: id, qty, kind: qty > 0 ? 'receive' : 'adjust_other', docNo: 'PREMIUM', at: now });
      await this.audit.record(tx, now, { actor: actor.id, action: 'stock.premium', entity: 'premium', entityId: id, after: { qty } });
    });
  }
}
