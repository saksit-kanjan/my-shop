import { Injectable } from '@nestjs/common';
import type { CashMoveType } from '@my-shop/contracts';
import type { Tx } from '../../database/unit-of-work';
import { ShiftRepository, type CashMoveRow, type ShiftRow } from './shift.repository';

interface Row {
  id: string;
  terminal_id: string;
  employee_id: string;
  opened_at: Date;
  float: number;
  closed_at: Date | null;
  counted: number | null;
  note: string | null;
  business_date: string;
}

const COLS = `id, terminal_id, employee_id, opened_at, float, closed_at, counted, note, business_date::text AS business_date`;
const toShift = (r: Row): ShiftRow => ({ id: r.id, terminalId: r.terminal_id, employeeId: r.employee_id, openedAt: r.opened_at, float: r.float, closedAt: r.closed_at, counted: r.counted, note: r.note, businessDate: r.business_date });

@Injectable()
export class PgShiftRepository extends ShiftRepository {
  async find(tx: Tx, id: string) {
    const [r] = await tx.query<Row>(`SELECT ${COLS} FROM shifts WHERE id=$1`, [id]);
    return r ? toShift(r) : null;
  }

  async openOf(tx: Tx, terminalId: string) {
    const [r] = await tx.query<Row>(`SELECT ${COLS} FROM shifts WHERE terminal_id=$1 AND closed_at IS NULL`, [terminalId]);
    return r ? toShift(r) : null;
  }

  async insert(tx: Tx, s: { id: string; terminalId: string; employeeId: string; businessDate: string; openedAt: Date; float: number }) {
    await tx.query(`INSERT INTO shifts (id, terminal_id, employee_id, business_date, opened_at, float) VALUES ($1,$2,$3,$4,$5,$6)`, [s.id, s.terminalId, s.employeeId, s.businessDate, s.openedAt, s.float]);
  }

  async close(tx: Tx, id: string, at: Date, counted: number, note: string | null) {
    await tx.query(`UPDATE shifts SET closed_at=$2, counted=$3, note=$4 WHERE id=$1`, [id, at, counted, note]);
  }

  async insertCashMove(tx: Tx, shiftId: string, at: Date, m: { type: CashMoveType; amount: number; reason: string; employeeId: string; approvedBy: string | null }) {
    await tx.query(`INSERT INTO cash_moves (shift_id, at, type, amount, reason, employee_id, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shiftId, at, m.type, m.amount, m.reason, m.employeeId, m.approvedBy]);
  }

  async cashMoves(tx: Tx, shiftId: string): Promise<CashMoveRow[]> {
    const rows = await tx.query<{ at: Date; type: CashMoveType; amount: number; reason: string; employee_id: string; approved_by: string | null }>(`SELECT at, type, amount, reason, employee_id, approved_by FROM cash_moves WHERE shift_id=$1 ORDER BY id`, [shiftId]);
    return rows.map((r) => ({ at: r.at, type: r.type, amount: r.amount, reason: r.reason, employeeId: r.employee_id, approvedBy: r.approved_by }));
  }

  async idsOfDay(tx: Tx, date: string) {
    return (await tx.query<{ id: string }>(`SELECT id FROM shifts WHERE business_date=$1::date ORDER BY opened_at`, [date])).map((r) => r.id);
  }

  async isDayClosed(tx: Tx, date: string) {
    return (await tx.query(`SELECT 1 FROM day_closes WHERE business_date=$1::date`, [date])).length > 0;
  }

  async dayClose(tx: Tx, date: string) {
    const [r] = await tx.query<{ closed_at: Date; closed_by: string }>(`SELECT closed_at, closed_by FROM day_closes WHERE business_date=$1::date`, [date]);
    return r ? { at: r.closed_at, by: r.closed_by } : null;
  }

  async insertDayClose(tx: Tx, date: string, at: Date, by: string, summary: unknown) {
    await tx.query(`INSERT INTO day_closes (business_date, closed_at, closed_by, summary) VALUES ($1,$2,$3,$4)`, [date, at, by, JSON.stringify(summary)]);
  }
}
