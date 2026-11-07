import { Inject, Injectable } from '@nestjs/common';
import { IsNull, Not } from 'typeorm';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import { StockCount, StockCountLine } from './entities/stock.entities';
import type { Tx } from '../database/database.types';
import { ProductsService } from '../products/products.service';
import { StockService } from './stock.service';
import { countDifference } from './stock-rules';

interface CountLine {
  productId: string;
  snapshotQty: number;
  countedQty: number | null;
  nowQty: number;
}

/** Stock counts (spec): snapshot, count, show the difference including sales made meanwhile, approve into ledger adjustments. */
@Injectable()
export class StocktakeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(scope: { categoryId?: string }, actor: Employee): Promise<{ id: string; lines: number }> {
    const now = this.clock();
    const id = crypto.randomUUID();
    return this.db.transaction(async (tx) => {
      if (await tx.existsBy(StockCount, { status: 'open' })) throw new DomainError('conflict', 'มีรอบตรวจนับที่ยังไม่ปิดอยู่ ปิดหรืออนุมัติรอบนั้นก่อน');
      const ids = (await this.products.directory(tx)).filter((p) => p.active && (!scope.categoryId || p.categoryId === scope.categoryId)).map((p) => p.id);
      await tx.insert(StockCount, { id, scope: scope.categoryId ? 'category' : 'all', categoryId: scope.categoryId ?? null, startedAt: now, startedBy: actor.id });
      // The snapshot of system stock at the moment counting starts (spec step 2).
      if (ids.length) {
        const balances = await this.stock.balances(tx);
        await tx.insert(StockCountLine, ids.map((productId) => ({ countId: id, productId, snapshotQty: balances.get(productId) ?? 0 })));
      }
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.start', entity: 'stock_count', entityId: id });
      return { id, lines: ids.length };
    });
  }

  async saveCounted(countId: string, counted: { productId: string; qty: number }[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.assertOpen(tx, countId, false);
      for (const l of counted) {
        if (!Number.isInteger(l.qty) || l.qty < 0) throw new DomainError('invalid', 'จำนวนที่นับต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป');
        await tx.update(StockCountLine, { countId, productId: l.productId }, { countedQty: l.qty });
      }
    });
  }

  async get(countId: string) {
    const header = await this.db.manager.findOneBy(StockCount, { id: countId });
    if (!header) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    const names = new Map((await this.products.directory()).map((p) => [p.id, p]));
    const lines = (await this.lines(this.db.manager, countId, false))
      .map((l) => ({ l, p: names.get(l.productId) }))
      .sort((a, b) => (a.p?.sku ?? '').localeCompare(b.p?.sku ?? ''))
      .map(({ l, p }) => ({
        productId: l.productId, sku: p?.sku ?? '', name: p?.name ?? l.productId, snapshot: l.snapshotQty, soldSince: l.nowQty - l.snapshotQty, counted: l.countedQty,
        diff: l.countedQty == null ? null : countDifference(l.countedQty, l.nowQty),
      }));
    return { id: header.id, scope: header.scope, categoryId: header.categoryId, startedAt: iso(header.startedAt), status: header.status, lines };
  }

  async open() {
    const c = await this.db.manager.findOneBy(StockCount, { status: 'open' });
    return c ? this.get(c.id) : null;
  }

  async approve(countId: string, actor: Employee): Promise<{ adjusted: number }> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.assertOpen(tx, countId, true);
      let adjusted = 0;
      for (const l of await this.lines(tx, countId, true)) {
        const diff = countDifference(l.countedQty as number, l.nowQty);
        if (diff === 0) continue;
        await this.stock.record(tx, [{ productId: l.productId, qty: diff, kind: 'count', docNo: `COUNT-${countId.slice(0, 8)}`, at: now }]);
        adjusted += 1;
      }
      await tx.update(StockCount, { id: countId }, { status: 'approved', approvedAt: now, approvedBy: actor.id });
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.approve', entity: 'stock_count', entityId: countId, after: { adjusted } });
      return { adjusted };
    });
  }

  async cancel(countId: string, actor: Employee): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.assertOpen(tx, countId, true);
      await tx.update(StockCount, { id: countId }, { status: 'cancelled' });
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'count.cancel', entity: 'stock_count', entityId: countId });
    });
  }

  private async lines(tx: Tx, countId: string, countedOnly: boolean): Promise<CountLine[]> {
    const rows = await tx.find(StockCountLine, { where: countedOnly ? { countId, countedQty: Not(IsNull()) } : { countId } });
    const balances = await this.stock.balances(tx);
    return rows.map((l) => ({ productId: l.productId, snapshotQty: l.snapshotQty, countedQty: l.countedQty, nowQty: balances.get(l.productId) ?? 0 }));
  }

  private async assertOpen(tx: Tx, id: string, lock: boolean) {
    const c = await tx.findOne(StockCount, { where: { id }, ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}) });
    if (!c) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    if (c.status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
  }
}
