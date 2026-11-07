import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import { StockCount } from '../domain/stock-count';
import { StockCountRepository } from '../domain/stock-count.repository';
import { StockCount as StockCountEntity, StockCountLine } from '../entities/stock.entities';

@Injectable()
export class TypeOrmStockCountRepository extends StockCountRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  private async restore(row: StockCountEntity | null): Promise<StockCount | null> {
    if (!row) return null;
    const lines = await this.db.manager.find(StockCountLine, { where: { countId: row.id }, order: { productId: 'ASC' } });
    return StockCount.restore({
      id: row.id, scope: row.scope as 'all' | 'category', categoryId: row.categoryId, startedAt: row.startedAt, startedBy: row.startedBy, status: row.status,
      approvedAt: row.approvedAt, approvedBy: row.approvedBy, lines: lines.map((l) => ({ productId: l.productId, snapshotQty: l.snapshotQty, countedQty: l.countedQty })),
    });
  }

  findById(id: string) {
    return this.db.manager.findOneBy(StockCountEntity, { id }).then((r) => this.restore(r));
  }

  lockById(id: string) {
    return this.db.manager.findOne(StockCountEntity, { where: { id }, lock: { mode: 'pessimistic_write' } }).then((r) => this.restore(r));
  }

  findOpen() {
    return this.db.manager.findOneBy(StockCountEntity, { status: 'open' }).then((r) => this.restore(r));
  }

  async add(count: StockCount): Promise<void> {
    const s = count.snapshot();
    await this.db.manager.insert(StockCountEntity, { id: s.id, scope: s.scope, categoryId: s.categoryId, startedAt: s.startedAt, startedBy: s.startedBy });
    if (s.lines.length) await this.db.manager.insert(StockCountLine, s.lines.map((l) => ({ countId: s.id, ...l })));
  }

  async save(count: StockCount): Promise<void> {
    const s = count.snapshot();
    await this.db.manager.update(StockCountEntity, { id: s.id }, { status: s.status, approvedAt: s.approvedAt, approvedBy: s.approvedBy });
    for (const l of s.lines) if (l.countedQty !== null) await this.db.manager.update(StockCountLine, { countId: s.id, productId: l.productId }, { countedQty: l.countedQty });
  }
}
