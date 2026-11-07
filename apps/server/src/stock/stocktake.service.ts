import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import { ProductsService } from '../products/products.service';
import { StockCount } from './domain/stock-count';
import { StockCountRepository } from './domain/stock-count.repository';
import { StockService } from './stock.service';

/** Application service for stock counts: loads the aggregate, lets it decide, saves it and writes the ledger adjustments it asks for. */
@Injectable()
export class StocktakeService {
  constructor(
    private readonly db: DatabaseService,
    private readonly counts: StockCountRepository,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(scope: { categoryId?: string }, actor: Employee): Promise<{ id: string; lines: number }> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      if (await this.counts.findOpen()) throw new DomainError('conflict', 'มีรอบตรวจนับที่ยังไม่ปิดอยู่ ปิดหรืออนุมัติรอบนั้นก่อน');
      const wanted = (await this.products.directory(tx)).filter((p) => p.active && (!scope.categoryId || p.categoryId === scope.categoryId));
      const balances = await this.stock.balances(tx);
      const count = StockCount.start({ id: crypto.randomUUID(), categoryId: scope.categoryId, startedBy: actor.id, now, snapshot: wanted.map((p) => ({ productId: p.id, qty: balances.get(p.id) ?? 0 })) });
      await this.counts.add(count);
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.start', entity: 'stock_count', entityId: count.id });
      return { id: count.id, lines: wanted.length };
    });
  }

  async saveCounted(countId: string, counted: { productId: string; qty: number }[]): Promise<void> {
    await this.db.transaction(async () => {
      const count = await this.must(countId, false);
      count.record(counted);
      await this.counts.save(count);
    });
  }

  async get(countId: string) {
    const header = (await this.counts.findById(countId))?.snapshot();
    if (!header) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    const [names, balances] = await Promise.all([this.products.directory(), this.stock.balances()]);
    const byId = new Map(names.map((p) => [p.id, p]));
    const lines = header.lines
      .map((l) => ({ l, p: byId.get(l.productId), now: balances.get(l.productId) ?? 0 }))
      .sort((a, b) => (a.p?.sku ?? '').localeCompare(b.p?.sku ?? ''))
      .map(({ l, p, now }) => ({
        productId: l.productId, sku: p?.sku ?? '', name: p?.name ?? l.productId, snapshot: l.snapshotQty, soldSince: now - l.snapshotQty, counted: l.countedQty,
        diff: l.countedQty == null ? null : l.countedQty - now,
      }));
    return { id: header.id, scope: header.scope, categoryId: header.categoryId, startedAt: iso(header.startedAt), status: header.status, lines };
  }

  async open() {
    const c = await this.counts.findOpen();
    return c ? this.get(c.id) : null;
  }

  async approve(countId: string, actor: Employee): Promise<{ adjusted: number }> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const count = await this.must(countId, true);
      const balances = await this.stock.balances(tx);
      const adjustments = count.approve(actor.id, now, (productId) => balances.get(productId) ?? 0);
      await this.counts.save(count);
      await this.stock.record(tx, adjustments.map((a) => ({ productId: a.productId, qty: a.qty, kind: 'count' as const, docNo: `COUNT-${countId.slice(0, 8)}`, at: now })));
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.approve', entity: 'stock_count', entityId: countId, after: { adjusted: adjustments.length } });
      return { adjusted: adjustments.length };
    });
  }

  async cancel(countId: string, actor: Employee): Promise<void> {
    await this.db.transaction(async (tx) => {
      const count = await this.must(countId, true);
      count.cancel();
      await this.counts.save(count);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'count.cancel', entity: 'stock_count', entityId: countId });
    });
  }

  private async must(id: string, lock: boolean): Promise<StockCount> {
    const count = await (lock ? this.counts.lockById(id) : this.counts.findById(id));
    if (!count) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    return count;
  }
}
