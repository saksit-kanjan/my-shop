import type { CashMoveType } from '@my-shop/contracts';
import type { Tx } from '../../database/unit-of-work';

export interface ShiftRow {
  id: string;
  terminalId: string;
  employeeId: string;
  openedAt: Date;
  float: number;
  closedAt: Date | null;
  counted: number | null;
  note: string | null;
  businessDate: string;
}

export interface CashMoveRow {
  at: Date;
  type: CashMoveType;
  amount: number;
  reason: string;
  employeeId: string;
  approvedBy: string | null;
}

/** Port: shifts, drawer movements and the day close. */
export abstract class ShiftRepository {
  abstract find(tx: Tx, id: string): Promise<ShiftRow | null>;
  abstract openOf(tx: Tx, terminalId: string): Promise<ShiftRow | null>;
  abstract insert(tx: Tx, s: { id: string; terminalId: string; employeeId: string; businessDate: string; openedAt: Date; float: number }): Promise<void>;
  abstract close(tx: Tx, id: string, at: Date, counted: number, note: string | null): Promise<void>;
  abstract insertCashMove(tx: Tx, shiftId: string, at: Date, m: { type: CashMoveType; amount: number; reason: string; employeeId: string; approvedBy: string | null }): Promise<void>;
  abstract cashMoves(tx: Tx, shiftId: string): Promise<CashMoveRow[]>;
  abstract idsOfDay(tx: Tx, date: string): Promise<string[]>;
  abstract isDayClosed(tx: Tx, date: string): Promise<boolean>;
  abstract dayClose(tx: Tx, date: string): Promise<{ at: Date; by: string } | null>;
  abstract insertDayClose(tx: Tx, date: string, at: Date, by: string, summary: unknown): Promise<void>;
}
