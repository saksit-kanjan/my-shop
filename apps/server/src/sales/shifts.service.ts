import { Inject, Injectable } from '@nestjs/common';
import type { CashMove, CashMoveType, Employee, Satang, SaleRecord, Shift } from '@my-shop/contracts';
import { summarizeShift } from '@my-shop/domain';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { CLOCK, type Clock } from '../common/clock';
import { businessDate, iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { MembersService } from '../members/members.service';
import { SettingsService } from '../settings/settings.service';
import { CreditNotesService } from './credit-notes.service';
import { SALE_COLUMNS, toSaleRow, type PaymentRow, type SaleDbRow } from './sale-queries';

const MOVE_TYPES: CashMoveType[] = ['drop', 'out', 'in'];

interface ShiftRow {
  id: string;
  terminal_id: string;
  employee_id: string;
  opened_at: Date;
  float: number;
  closed_at: Date | null;
  counted: number | null;
  note: string | null;
}

const SHIFT_COLUMNS = `id, terminal_id, employee_id, opened_at, float, closed_at, counted, note`;

/** A shift: one cashier, one drawer, one terminal at a time. Open, record cash moves, close with a blind count. */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly creditNotes: CreditNotesService,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalsService,
    private readonly members: MembersService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getOpenShift(terminalId: string): Promise<Shift | null> {
    const [row] = await this.db.query<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shifts WHERE terminal_id=$1 AND closed_at IS NULL`, [terminalId]);
    return row ? this.hydrate(this.db, row) : null;
  }

  async getShift(id: string): Promise<Shift | null> {
    const [row] = await this.db.query<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shifts WHERE id=$1`, [id]);
    return row ? this.hydrate(this.db, row) : null;
  }

  async openShift(terminalId: string, employeeId: string, float: Satang): Promise<Shift> {
    if (!Number.isInteger(float) || float < 0) throw new DomainError('invalid', 'เงินตั้งต้นต้องเป็นจำนวนเงินที่ไม่ติดลบ');
    const now = this.clock();
    const date = businessDate(now, (await this.settings.getAll()).cutoffHour);
    return this.db.transaction(async (tx) => {
      if ((await tx.query(`SELECT 1 FROM shifts WHERE terminal_id=$1 AND closed_at IS NULL`, [terminalId])).length) throw new DomainError('conflict', 'เครื่องนี้มีกะเปิดอยู่แล้ว');
      if ((await tx.query(`SELECT 1 FROM day_closes WHERE business_date=$1::date`, [date])).length) throw new DomainError('conflict', 'ปิดวันนี้ไปแล้ว เปิดกะใหม่ไม่ได้ ให้ผู้จัดการตรวจสอบ');
      const id = crypto.randomUUID();
      await tx.query(`INSERT INTO shifts (id, terminal_id, employee_id, business_date, opened_at, float) VALUES ($1,$2,$3,$4,$5,$6)`, [id, terminalId, employeeId, date, now, float]);
      await this.audit.record(tx, now, { actor: employeeId, terminalId, action: 'shift.open', entity: 'shift', entityId: id, after: { float } });
      return this.must(tx, id);
    });
  }

  async addCashMove(shiftId: string, move: Omit<CashMove, 'at'>): Promise<Shift> {
    if (!MOVE_TYPES.includes(move.type)) throw new DomainError('invalid', 'ประเภทรายการไม่ถูกต้อง');
    if (!Number.isInteger(move.amount) || move.amount <= 0) throw new DomainError('invalid', 'ใส่จำนวนเงินมากกว่า 0');
    if (!move.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลของรายการนี้');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const shift = await this.openOrThrow(tx, shiftId);
      await tx.query(`INSERT INTO cash_moves (shift_id, at, type, amount, reason, employee_id, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shiftId, now, move.type, move.amount, move.reason.trim(), move.employeeId, move.approvedBy ?? null]);
      await this.audit.record(tx, now, { actor: move.employeeId, approver: move.approvedBy, terminalId: shift.terminal_id, action: `cash.${move.type}`, entity: 'shift', entityId: shiftId, after: { amount: move.amount, reason: move.reason } });
      return this.must(tx, shiftId);
    });
  }

  /**
   * Close with the cashier's blind count. A difference over the store limit needs a supervisor's code and a note
   * (spec: "ผลต่างเกินเกณฑ์").
   */
  async closeShift(shiftId: string, counted: Satang, note?: string, actor?: Employee, approverCode?: string): Promise<Shift> {
    if (!Number.isInteger(counted) || counted < 0) throw new DomainError('invalid', 'ใส่ยอดเงินที่นับได้');
    const now = this.clock();
    const current = await this.getShift(shiftId);
    if (!current) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (current.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    const variance = counted - summarizeShift(current).expectedCash;
    let approver: Employee | null = null;
    if (Math.abs(variance) > (await this.settings.getAll()).cashVarianceLimit) {
      if (!note?.trim()) throw new DomainError('invalid', 'เงินขาดหรือเกินเกินเกณฑ์ ใส่หมายเหตุก่อนปิดกะ', { variance });
      if (!actor) throw new DomainError('unauthorized', 'ต้องเข้าสู่ระบบ');
      approver = await this.approvals.resolve({ actor, permission: 'shift.expected', approverCode, terminalId: current.terminalId });
    }
    return this.db.transaction(async (tx) => {
      const shift = await this.openOrThrow(tx, shiftId);
      await tx.query(`UPDATE shifts SET closed_at=$2, counted=$3, note=$4 WHERE id=$1`, [shiftId, now, counted, note ?? null]);
      await this.audit.record(tx, now, { actor: actor?.id ?? shift.employee_id, approver: approver && approver.id !== actor?.id ? approver.id : undefined, terminalId: shift.terminal_id, action: 'shift.close', entity: 'shift', entityId: shiftId, after: { counted, variance, note } });
      return this.must(tx, shiftId);
    });
  }

  /** "เปิดลิ้นชักโดยไม่มีการขาย": allowed for supervisors and up, a cashier needs one's code. The reason is logged. */
  async openDrawer(shiftId: string, reason: string, actor: Employee, approverCode?: string): Promise<void> {
    if (!reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลที่เปิดลิ้นชัก');
    const [shift] = await this.db.query<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shifts WHERE id=$1`, [shiftId]);
    if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (shift.closed_at) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    const approver = await this.approvals.resolve({ actor, permission: 'drawer.nosale', approverCode, terminalId: shift.terminal_id });
    await this.db.transaction((tx) => this.audit.record(tx, this.clock(), { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId: shift.terminal_id, action: 'drawer.nosale', entity: 'shift', entityId: shiftId, after: { reason } }));
  }

  private async openOrThrow(tx: Tx, id: string): Promise<ShiftRow> {
    const [shift] = await tx.query<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shifts WHERE id=$1`, [id]);
    if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (shift.closed_at) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    return shift;
  }

  private async must(tx: Tx, id: string): Promise<Shift> {
    const [row] = await tx.query<ShiftRow>(`SELECT ${SHIFT_COLUMNS} FROM shifts WHERE id=$1`, [id]);
    if (!row) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return this.hydrate(tx, row);
  }

  /** The shift as the till and the Z report read it: the shift, its bills with payments, drawer moves and credit notes. */
  private async hydrate(tx: Tx, r: ShiftRow): Promise<Shift> {
    const [sales, payments, moves, notes] = await Promise.all([
      tx.query<SaleDbRow & { voided: boolean }>(
        `SELECT ${SALE_COLUMNS}, EXISTS (SELECT 1 FROM credit_notes c WHERE c.sale_doc_no=s.doc_no AND c.type='void') AS voided FROM sales s WHERE s.shift_id=$1 ORDER BY s.at, s.doc_no`,
        [r.id],
      ),
      tx.query<PaymentRow>(`SELECT p.doc_no AS "docNo", p.method, p.amount, p.tendered, p.reference FROM payments p JOIN sales s ON s.doc_no=p.doc_no WHERE s.shift_id=$1 ORDER BY p.id`, [r.id]),
      tx.query<{ at: Date; type: CashMoveType; amount: number; reason: string; employee_id: string; approved_by: string | null }>(`SELECT at, type, amount, reason, employee_id, approved_by FROM cash_moves WHERE shift_id=$1 ORDER BY id`, [r.id]),
      this.creditNotes.ofShift(tx, r.id),
    ]);
    const phones = new Map<string, string | null>();
    for (const id of new Set(sales.map((s) => s.member_id).filter((x): x is string => !!x))) phones.set(id, await this.members.phoneOf(id, tx));
    const records: SaleRecord[] = sales.map((row) => {
      const s = toSaleRow(row);
      const phone = s.memberId ? phones.get(s.memberId) : null;
      return {
        docNo: s.docNo, at: iso(s.at), employeeId: s.employeeId, cart: s.cart, change: s.change,
        ...(phone ? { memberPhone: phone, pointsEarned: s.pointsEarned } : {}),
        ...(s.pointsRedeemed > 0 ? { pointsRedeemed: s.pointsRedeemed, pointsValue: s.pointsValue } : {}),
        ...(row.voided ? { voided: true } : {}),
        payments: payments.filter((p) => p.docNo === s.docNo).map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered != null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
      };
    });
    return {
      id: r.id, terminalId: r.terminal_id, employeeId: r.employee_id, openedAt: iso(r.opened_at), float: r.float,
      ...(r.closed_at ? { closedAt: iso(r.closed_at) } : {}),
      ...(r.counted != null ? { counted: r.counted } : {}),
      ...(r.note ? { note: r.note } : {}),
      sales: records,
      cashMoves: moves.map((m) => ({ at: iso(m.at), type: m.type, amount: m.amount, reason: m.reason, employeeId: m.employee_id, ...(m.approved_by ? { approvedBy: m.approved_by } : {}) })),
      creditNotes: notes,
    };
  }
}
