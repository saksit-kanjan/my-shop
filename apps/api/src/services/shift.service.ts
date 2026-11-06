import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { CashMove, CashMoveType, CreditNote, Employee, Payment, PaymentMethod, PricedCart, SaleRecord, Satang, Shift } from '@my-shop/contracts';
import { summarizeShift } from '@my-shop/domain';
import { DB, type Db, type Queryable } from '../db/db';
import { DomainError } from '../errors';
import { ApprovalService } from './approval.service';
import { audit } from './audit';
import { SettingsService } from './settings.service';
import { businessDate, iso, type Clock } from './util';

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

const MOVE_TYPES: CashMoveType[] = ['drop', 'out', 'in'];

@Injectable()
export class ShiftService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getOpenShift(terminalId: string): Promise<Shift | null> {
    const [row] = await this.db.query<ShiftRow>(`SELECT * FROM shifts WHERE terminal_id=$1 AND closed_at IS NULL`, [terminalId]);
    return row ? this.hydrate(this.db, row) : null;
  }

  async getShift(id: string): Promise<Shift | null> {
    const [row] = await this.db.query<ShiftRow>(`SELECT * FROM shifts WHERE id=$1`, [id]);
    return row ? this.hydrate(this.db, row) : null;
  }

  async openShift(terminalId: string, employeeId: string, float: Satang): Promise<Shift> {
    if (!Number.isInteger(float) || float < 0) throw new DomainError('invalid', 'เงินตั้งต้นต้องเป็นจำนวนเงินที่ไม่ติดลบ');
    const now = this.clock();
    const cutoffHour = (await this.settings.getAll()).cutoffHour;
    return this.db.transaction(async (tx) => {
      const [open] = await tx.query(`SELECT 1 FROM shifts WHERE terminal_id=$1 AND closed_at IS NULL`, [terminalId]);
      if (open) throw new DomainError('conflict', 'เครื่องนี้มีกะเปิดอยู่แล้ว');
      const [dayClosed] = await tx.query(`SELECT 1 FROM day_closes WHERE business_date=$1::date`, [businessDate(now, cutoffHour)]);
      if (dayClosed) throw new DomainError('conflict', 'ปิดวันนี้ไปแล้ว เปิดกะใหม่ไม่ได้ ให้ผู้จัดการตรวจสอบ');
      const id = crypto.randomUUID();
      await tx.query(`INSERT INTO shifts (id, terminal_id, employee_id, business_date, opened_at, float) VALUES ($1,$2,$3,$4,$5,$6)`, [id, terminalId, employeeId, businessDate(now, cutoffHour), now, float]);
      await audit(tx, now, { actor: employeeId, terminalId, action: 'shift.open', entity: 'shift', entityId: id, after: { float } });
      return this.must(tx, id);
    });
  }

  async addCashMove(shiftId: string, move: Omit<CashMove, 'at'>): Promise<Shift> {
    if (!MOVE_TYPES.includes(move.type)) throw new DomainError('invalid', 'ประเภทรายการไม่ถูกต้อง');
    if (!Number.isInteger(move.amount) || move.amount <= 0) throw new DomainError('invalid', 'ใส่จำนวนเงินมากกว่า 0');
    if (!move.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลของรายการนี้');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const shift = await this.must(tx, shiftId);
      if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      await tx.query(`INSERT INTO cash_moves (shift_id, at, type, amount, reason, employee_id, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [shiftId, now, move.type, move.amount, move.reason.trim(), move.employeeId, move.approvedBy ?? null]);
      await audit(tx, now, { actor: move.employeeId, approver: move.approvedBy, terminalId: shift.terminalId, action: `cash.${move.type}`, entity: 'shift', entityId: shiftId, after: { amount: move.amount, reason: move.reason } });
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
    const limit = (await this.settings.getAll()).cashVarianceLimit;
    let approver: Employee | null = null;
    if (Math.abs(variance) > limit) {
      if (!note?.trim()) throw new DomainError('invalid', 'เงินขาดหรือเกินเกินเกณฑ์ ใส่หมายเหตุก่อนปิดกะ', { variance });
      if (!actor) throw new DomainError('unauthorized', 'ต้องเข้าสู่ระบบ');
      approver = await this.approvals.resolve({ actor, permission: 'shift.expected', approverCode, terminalId: current.terminalId });
    }
    return this.db.transaction(async (tx) => {
      const shift = await this.must(tx, shiftId);
      if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      await tx.query(`UPDATE shifts SET closed_at=$2, counted=$3, note=$4 WHERE id=$1`, [shiftId, now, counted, note ?? null]);
      await audit(tx, now, { actor: actor?.id ?? shift.employeeId, approver: approver && approver.id !== actor?.id ? approver.id : undefined, terminalId: shift.terminalId, action: 'shift.close', entity: 'shift', entityId: shiftId, after: { counted, variance, note } });
      return this.must(tx, shiftId);
    });
  }

  /** "เปิดลิ้นชักโดยไม่มีการขาย": allowed for supervisors and up, a cashier needs one's code. The reason is logged. */
  async openDrawer(shiftId: string, reason: string, actor: Employee, approverCode?: string): Promise<void> {
    if (!reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลที่เปิดลิ้นชัก');
    const shift = await this.getShift(shiftId);
    if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    const approver = await this.approvals.resolve({ actor, permission: 'drawer.nosale', approverCode, terminalId: shift.terminalId });
    await this.db.transaction((tx) => audit(tx, this.clock(), { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId: shift.terminalId, action: 'drawer.nosale', entity: 'shift', entityId: shiftId, after: { reason } }));
  }

  private async must(q: Queryable, id: string): Promise<Shift> {
    const [row] = await q.query<ShiftRow>(`SELECT * FROM shifts WHERE id=$1`, [id]);
    if (!row) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return this.hydrate(q, row);
  }

  private async hydrate(q: Queryable, r: ShiftRow): Promise<Shift> {
    const [sales, payments, moves, notes] = await Promise.all([
      q.query<{ doc_no: string; at: Date; employee_id: string; cart: PricedCart; change: number; phone: string | null; points_earned: number; points_redeemed: number; points_value: number; voided: boolean }>(
        `SELECT s.doc_no, s.at, s.employee_id, s.cart, s.change, m.phone, s.points_earned, s.points_redeemed, s.points_value,
                EXISTS (SELECT 1 FROM credit_notes c WHERE c.sale_doc_no=s.doc_no AND c.type='void') AS voided
           FROM sales s LEFT JOIN members m ON m.id=s.member_id WHERE s.shift_id=$1 ORDER BY s.at, s.doc_no`,
        [r.id],
      ),
      q.query<{ doc_no: string; method: Payment['method']; amount: number; tendered: number | null; reference: string | null }>(
        `SELECT p.doc_no, p.method, p.amount, p.tendered, p.reference FROM payments p JOIN sales s ON s.doc_no=p.doc_no WHERE s.shift_id=$1 ORDER BY p.id`,
        [r.id],
      ),
      q.query<{ at: Date; type: CashMoveType; amount: number; reason: string; employee_id: string; approved_by: string | null }>(`SELECT at, type, amount, reason, employee_id, approved_by FROM cash_moves WHERE shift_id=$1 ORDER BY id`, [r.id]),
      q.query<{ doc_no: string; at: Date; type: 'void' | 'refund'; sale_doc_no: string; amount: number; reason: string; restock: boolean; employee_id: string; approved_by: string }>(
        `SELECT doc_no, at, type, sale_doc_no, amount, reason, restock, employee_id, approved_by FROM credit_notes WHERE shift_id=$1 ORDER BY at, doc_no`,
        [r.id],
      ),
    ]);
    const cnPays = notes.length
      ? await q.query<{ doc_no: string; method: PaymentMethod; amount: number }>(`SELECT doc_no, method, amount FROM credit_note_payments WHERE doc_no = ANY($1) ORDER BY id`, [notes.map((n) => n.doc_no)])
      : [];
    const cnLines = notes.length
      ? await q.query<{ doc_no: string; product_id: string; name: string; qty: number; amount: number }>(`SELECT doc_no, product_id, name, qty, amount FROM credit_note_lines WHERE doc_no = ANY($1) ORDER BY id`, [notes.map((n) => n.doc_no)])
      : [];
    const records: SaleRecord[] = sales.map((s) => ({
      docNo: s.doc_no,
      at: iso(s.at),
      employeeId: s.employee_id,
      cart: s.cart,
      change: s.change,
      ...(s.phone ? { memberPhone: s.phone, pointsEarned: s.points_earned } : {}),
      ...(s.points_redeemed > 0 ? { pointsRedeemed: s.points_redeemed, pointsValue: s.points_value } : {}),
      ...(s.voided ? { voided: true } : {}),
      payments: payments.filter((p) => p.doc_no === s.doc_no).map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered != null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
    }));
    const creditNotes: CreditNote[] = notes.map((n) => ({
      docNo: n.doc_no, at: iso(n.at), type: n.type, saleDocNo: n.sale_doc_no, amount: n.amount, reason: n.reason, employeeId: n.employee_id, approvedBy: n.approved_by, restock: n.restock,
      payments: cnPays.filter((p) => p.doc_no === n.doc_no).map((p) => ({ method: p.method, amount: p.amount })),
      lines: cnLines.filter((l) => l.doc_no === n.doc_no).map((l) => ({ productId: l.product_id, name: l.name, qty: l.qty, amount: l.amount })),
    }));
    return {
      id: r.id,
      terminalId: r.terminal_id,
      employeeId: r.employee_id,
      openedAt: iso(r.opened_at),
      float: r.float,
      ...(r.closed_at ? { closedAt: iso(r.closed_at) } : {}),
      ...(r.counted != null ? { counted: r.counted } : {}),
      ...(r.note ? { note: r.note } : {}),
      sales: records,
      cashMoves: moves.map((m) => ({ at: iso(m.at), type: m.type, amount: m.amount, reason: m.reason, employeeId: m.employee_id, ...(m.approved_by ? { approvedBy: m.approved_by } : {}) })),
      creditNotes,
    };
  }
}
