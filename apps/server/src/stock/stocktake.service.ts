import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { ProductsService } from '../products/products.service';
import { StockService } from './stock.service';
import { countDifference } from './stock-rules';

interface CountLine {
  product_id: string;
  snapshot_qty: number;
  counted_qty: number | null;
  now_qty: number;
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
      if ((await tx.query(`SELECT 1 FROM stock_counts WHERE status='open'`)).length) throw new DomainError('conflict', 'มีรอบตรวจนับที่ยังไม่ปิดอยู่ ปิดหรืออนุมัติรอบนั้นก่อน');
      const ids = (await this.products.directory(tx)).filter((p) => p.active && (!scope.categoryId || p.categoryId === scope.categoryId)).map((p) => p.id);
      await tx.query(`INSERT INTO stock_counts (id, scope, category_id, started_at, started_by) VALUES ($1,$2,$3,$4,$5)`, [id, scope.categoryId ? 'category' : 'all', scope.categoryId ?? null, now, actor.id]);
      // The snapshot of system stock at the moment counting starts (spec step 2).
      if (ids.length) {
        await tx.query(
          `INSERT INTO stock_count_lines (count_id, product_id, snapshot_qty)
             SELECT $1, p, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=p),0)::int FROM unnest($2::text[]) AS p`,
          [id, ids],
        );
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
        await tx.query(`UPDATE stock_count_lines SET counted_qty=$3 WHERE count_id=$1 AND product_id=$2`, [countId, l.productId, l.qty]);
      }
    });
  }

  async get(countId: string) {
    const [header] = await this.db.query<{ id: string; scope: string; category_id: string | null; started_at: Date; status: string }>(`SELECT id, scope, category_id, started_at, status FROM stock_counts WHERE id=$1`, [countId]);
    if (!header) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    const names = new Map((await this.products.directory()).map((p) => [p.id, p]));
    const lines = (await this.lines(this.db, countId, false))
      .map((l) => ({ l, p: names.get(l.product_id) }))
      .sort((a, b) => (a.p?.sku ?? '').localeCompare(b.p?.sku ?? ''))
      .map(({ l, p }) => ({
        productId: l.product_id, sku: p?.sku ?? '', name: p?.name ?? l.product_id, snapshot: l.snapshot_qty, soldSince: l.now_qty - l.snapshot_qty, counted: l.counted_qty,
        diff: l.counted_qty == null ? null : countDifference(l.counted_qty, l.now_qty),
      }));
    return { id: header.id, scope: header.scope, categoryId: header.category_id, startedAt: iso(header.started_at), status: header.status, lines };
  }

  async open() {
    const [c] = await this.db.query<{ id: string }>(`SELECT id FROM stock_counts WHERE status='open'`);
    return c ? this.get(c.id) : null;
  }

  async approve(countId: string, actor: Employee): Promise<{ adjusted: number }> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.assertOpen(tx, countId, true);
      let adjusted = 0;
      for (const l of await this.lines(tx, countId, true)) {
        const diff = countDifference(l.counted_qty as number, l.now_qty);
        if (diff === 0) continue;
        await this.stock.record(tx, [{ productId: l.product_id, qty: diff, kind: 'count', docNo: `COUNT-${countId.slice(0, 8)}`, at: now }]);
        adjusted += 1;
      }
      await tx.query(`UPDATE stock_counts SET status='approved', approved_at=$2, approved_by=$3 WHERE id=$1`, [countId, now, actor.id]);
      await this.audit.record(tx, now, { actor: actor.id, action: 'count.approve', entity: 'stock_count', entityId: countId, after: { adjusted } });
      return { adjusted };
    });
  }

  async cancel(countId: string, actor: Employee): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.assertOpen(tx, countId, true);
      await tx.query(`UPDATE stock_counts SET status='cancelled' WHERE id=$1`, [countId]);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'count.cancel', entity: 'stock_count', entityId: countId });
    });
  }

  private lines(tx: Tx, countId: string, countedOnly: boolean) {
    return tx.query<CountLine>(
      `SELECT l.product_id, l.snapshot_qty, l.counted_qty, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=l.product_id),0)::int AS now_qty
         FROM stock_count_lines l WHERE l.count_id=$1 ${countedOnly ? 'AND l.counted_qty IS NOT NULL' : ''}`,
      [countId],
    );
  }

  private async assertOpen(tx: Tx, id: string, lock: boolean) {
    const [c] = await tx.query<{ status: string }>(`SELECT status FROM stock_counts WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    if (!c) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    if (c.status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
  }
}
