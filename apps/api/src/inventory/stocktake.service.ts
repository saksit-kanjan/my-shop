import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { iso } from '../common/utils/dates';
import { DomainError } from '../common/errors/domain-error';
import { ProductDirectory } from './providers/product-directory';
import { StockRepository } from './repositories/stock.repository';
import { countDifference } from './policies/stock-rules';

/** Stock counts (spec): snapshot, count, show the difference including sales made meanwhile, approve into ledger adjustments. */
@Injectable()
export class StocktakeService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: StockRepository,
    private readonly products: ProductDirectory,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async start(scope: { categoryId?: string }, actor: Employee): Promise<{ id: string; lines: number }> {
    const now = this.clock();
    const id = crypto.randomUUID();
    return this.uow.run(async (tx) => {
      if (await this.repo.openCountId(tx)) throw new DomainError('conflict', 'มีรอบตรวจนับที่ยังไม่ปิดอยู่ ปิดหรืออนุมัติรอบนั้นก่อน');
      const ids = (await this.products.all(tx)).filter((p) => p.active && (!scope.categoryId || p.categoryId === scope.categoryId)).map((p) => p.id);
      await this.repo.insertCount(tx, { id, scope: scope.categoryId ? 'category' : 'all', categoryId: scope.categoryId ?? null, at: now, by: actor.id });
      if (ids.length) await this.repo.snapshotLines(tx, id, ids);
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.start', entity: 'stock_count', entityId: id });
      return { id, lines: ids.length };
    });
  }

  async saveCounted(countId: string, counted: { productId: string; qty: number }[]): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.assertOpen(tx, countId, false);
      for (const l of counted) {
        if (!Number.isInteger(l.qty) || l.qty < 0) throw new DomainError('invalid', 'จำนวนที่นับต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป');
        await this.repo.setCounted(tx, countId, l.productId, l.qty);
      }
    });
  }

  async get(countId: string) {
    const read = this.uow.read;
    const header = await this.repo.countHeader(read, countId);
    if (!header) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    const names = new Map((await this.products.all(read)).map((p) => [p.id, p]));
    const lines = (await this.repo.countLines(read, countId, false))
      .map((l) => ({ l, p: names.get(l.productId) }))
      .sort((a, b) => (a.p?.sku ?? '').localeCompare(b.p?.sku ?? ''))
      .map(({ l, p }) => ({
        productId: l.productId, sku: p?.sku ?? '', name: p?.name ?? l.productId, snapshot: l.snapshot, soldSince: l.balanceNow - l.snapshot, counted: l.counted,
        diff: l.counted == null ? null : countDifference(l.counted, l.balanceNow),
      }));
    return { id: header.id, scope: header.scope, categoryId: header.categoryId, startedAt: iso(header.startedAt), status: header.status, lines };
  }

  async open() {
    const id = await this.repo.openCountId(this.uow.read);
    return id ? this.get(id) : null;
  }

  async approve(countId: string, actor: Employee): Promise<{ adjusted: number }> {
    const now = this.clock();
    return this.uow.run(async (tx) => {
      await this.assertOpen(tx, countId, true);
      let adjusted = 0;
      for (const l of await this.repo.countLines(tx, countId, true)) {
        const diff = countDifference(l.counted as number, l.balanceNow);
        if (diff === 0) continue;
        await this.repo.append(tx, { productId: l.productId, qty: diff, kind: 'count', docNo: `COUNT-${countId.slice(0, 8)}`, at: now });
        adjusted += 1;
      }
      await this.repo.closeCount(tx, countId, 'approved', now, actor.id);
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.approve', entity: 'stock_count', entityId: countId, after: { adjusted } });
      return { adjusted };
    });
  }

  async cancel(countId: string, actor: Employee): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.assertOpen(tx, countId, true);
      await this.repo.closeCount(tx, countId, 'cancelled', this.clock(), null);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'count.cancel', entity: 'stock_count', entityId: countId });
    });
  }

  private async assertOpen(tx: Parameters<StockRepository['countStatus']>[0], id: string, lock: boolean) {
    const status = await this.repo.countStatus(tx, id, lock);
    if (!status) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    if (status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
  }
}
