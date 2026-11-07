import type { CashMoveType, Satang } from '@my-shop/contracts';
import { DomainError } from '../../common/domain-error';

const MOVE_TYPES: CashMoveType[] = ['drop', 'out', 'in'];

export interface CashMove {
  at: Date;
  type: CashMoveType;
  amount: Satang;
  reason: string;
  employeeId: string;
  approvedBy: string | null;
}

export interface ShiftState {
  id: string;
  terminalId: string;
  employeeId: string;
  businessDate: string;
  openedAt: Date;
  float: Satang;
  closedAt: Date | null;
  counted: Satang | null;
  note: string | null;
  cashMoves: CashMove[];
}

/**
 * Aggregate root: one cashier, one drawer, one terminal. Every cash move and the closing count go through here, so a closed
 * shift cannot take another move and a move cannot be recorded without an amount and a reason.
 */
export class Shift {
  private pendingMoves: CashMove[] = [];

  private constructor(private readonly state: ShiftState) {}

  static open(input: { id: string; terminalId: string; employeeId: string; businessDate: string; float: Satang; now: Date }): Shift {
    if (!Number.isInteger(input.float) || input.float < 0) throw new DomainError('invalid', 'เงินตั้งต้นต้องเป็นจำนวนเงินที่ไม่ติดลบ');
    return new Shift({ id: input.id, terminalId: input.terminalId, employeeId: input.employeeId, businessDate: input.businessDate, openedAt: input.now, float: input.float, closedAt: null, counted: null, note: null, cashMoves: [] });
  }

  /** Rebuilds a stored shift; used by the repository only. */
  static restore(state: ShiftState): Shift {
    return new Shift({ ...state, cashMoves: [...state.cashMoves] });
  }

  get id() { return this.state.id; }
  get terminalId() { return this.state.terminalId; }
  get employeeId() { return this.state.employeeId; }
  get businessDate() { return this.state.businessDate; }
  get isClosed() { return this.state.closedAt !== null; }

  snapshot(): Readonly<ShiftState> {
    return this.state;
  }

  /** Moves added since the shift was loaded; the repository writes them and then forgets them. */
  takeNewCashMoves(): CashMove[] {
    const moves = this.pendingMoves;
    this.pendingMoves = [];
    return moves;
  }

  private assertOpen() {
    if (this.isClosed) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
  }

  addCashMove(input: { type: CashMoveType; amount: Satang; reason: string; employeeId: string; approvedBy?: string }, now: Date): void {
    if (!MOVE_TYPES.includes(input.type)) throw new DomainError('invalid', 'ประเภทรายการไม่ถูกต้อง');
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new DomainError('invalid', 'ใส่จำนวนเงินมากกว่า 0');
    if (!input.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลของรายการนี้');
    this.assertOpen();
    const move: CashMove = { at: now, type: input.type, amount: input.amount, reason: input.reason.trim(), employeeId: input.employeeId, approvedBy: input.approvedBy ?? null };
    this.state.cashMoves.push(move);
    this.pendingMoves.push(move);
  }

  /** The cashier's blind count against what the drawer should hold. A difference over the limit needs a note and a supervisor. */
  static variance(counted: Satang, expectedCash: Satang): Satang {
    if (!Number.isInteger(counted) || counted < 0) throw new DomainError('invalid', 'ใส่ยอดเงินที่นับได้');
    return counted - expectedCash;
  }

  static needsApproval(variance: Satang, limit: Satang): boolean {
    return Math.abs(variance) > limit;
  }

  close(counted: Satang, note: string | undefined, now: Date): void {
    if (!Number.isInteger(counted) || counted < 0) throw new DomainError('invalid', 'ใส่ยอดเงินที่นับได้');
    this.assertOpen();
    this.state.closedAt = now;
    this.state.counted = counted;
    this.state.note = note ?? null;
  }
}
