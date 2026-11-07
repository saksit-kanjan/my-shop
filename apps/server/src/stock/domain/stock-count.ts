import { DomainError } from '../../common/domain-error';
import { countDifference } from '../stock-rules';

export type CountStatus = 'open' | 'approved' | 'cancelled';

export interface CountLineState {
  productId: string;
  snapshotQty: number;
  countedQty: number | null;
}

export interface StockCountState {
  id: string;
  scope: 'all' | 'category';
  categoryId: string | null;
  startedAt: Date;
  startedBy: string;
  status: CountStatus;
  approvedAt: Date | null;
  approvedBy: string | null;
  lines: CountLineState[];
}

/** A stock adjustment the count asks the ledger to make. */
export interface CountAdjustment {
  productId: string;
  qty: number;
}

/**
 * Aggregate root: a stock count is a snapshot of system stock taken when counting starts, the counted figures, and one
 * decision (approve into ledger adjustments, or cancel). Once decided it cannot change.
 */
export class StockCount {
  private constructor(private readonly state: StockCountState) {}

  /** `snapshot` is system stock per product at this moment (spec step 2). */
  static start(input: { id: string; categoryId?: string; startedBy: string; now: Date; snapshot: { productId: string; qty: number }[] }): StockCount {
    return new StockCount({
      id: input.id, scope: input.categoryId ? 'category' : 'all', categoryId: input.categoryId ?? null, startedAt: input.now, startedBy: input.startedBy, status: 'open', approvedAt: null, approvedBy: null,
      lines: input.snapshot.map((l) => ({ productId: l.productId, snapshotQty: l.qty, countedQty: null })),
    });
  }

  static restore(state: StockCountState): StockCount {
    return new StockCount({ ...state, lines: state.lines.map((l) => ({ ...l })) });
  }

  get id() { return this.state.id; }
  get status() { return this.state.status; }

  snapshot(): Readonly<StockCountState> {
    return this.state;
  }

  private assertOpen() {
    if (this.state.status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
  }

  record(counted: { productId: string; qty: number }[]): void {
    this.assertOpen();
    for (const c of counted) {
      if (!Number.isInteger(c.qty) || c.qty < 0) throw new DomainError('invalid', 'จำนวนที่นับต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป');
      const line = this.state.lines.find((l) => l.productId === c.productId);
      if (line) line.countedQty = c.qty;
    }
  }

  /** The difference between what was counted and what the system holds NOW, so sales made while counting are not counted twice. */
  differenceFor(productId: string, nowQty: number): number | null {
    const line = this.state.lines.find((l) => l.productId === productId);
    return !line || line.countedQty === null ? null : countDifference(line.countedQty, nowQty);
  }

  approve(by: string, now: Date, nowQtyOf: (productId: string) => number): CountAdjustment[] {
    this.assertOpen();
    const adjustments = this.state.lines
      .filter((l) => l.countedQty !== null)
      .map((l) => ({ productId: l.productId, qty: countDifference(l.countedQty as number, nowQtyOf(l.productId)) }))
      .filter((a) => a.qty !== 0);
    this.state.status = 'approved';
    this.state.approvedAt = now;
    this.state.approvedBy = by;
    return adjustments;
  }

  cancel(): void {
    this.assertOpen();
    this.state.status = 'cancelled';
  }
}
