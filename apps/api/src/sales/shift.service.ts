import { Inject, Injectable } from '@nestjs/common';
import type { CashMove, CashMoveType, Employee, Satang, SaleRecord, Shift } from '@my-shop/contracts';
import { summarizeShift } from '@my-shop/domain';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork, type Tx } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { businessDate, iso } from '../common/utils/dates';
import { DomainError } from '../common/errors/domain-error';
import { SettingsService } from '../administration/settings.service';
import { ApprovalService } from '../identity/approval.service';
import { MembershipService } from '../membership/membership.service';
import { CreditNoteRepository } from './repositories/credit-note.repository';
import { SalesRepository } from './repositories/sales.repository';
import { ShiftRepository, type ShiftRow } from './repositories/shift.repository';
import { needsVarianceApproval } from './policies/shift-rules';

const MOVE_TYPES: CashMoveType[] = ['drop', 'out', 'in'];

/** A shift: one cashier, one drawer, one terminal at a time. Open, record cash moves, close with a blind count. */
@Injectable()
export class ShiftService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly shifts: ShiftRepository,
    private readonly sales: SalesRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly settings: SettingsService,
    private readonly approvals: ApprovalService,
    private readonly members: MembershipService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getOpenShift(terminalId: string): Promise<Shift | null> {
    const row = await this.shifts.openOf(this.uow.read, terminalId);
    return row ? this.hydrate(this.uow.read, row) : null;
  }

  async getShift(id: string): Promise<Shift | null> {
    const row = await this.shifts.find(this.uow.read, id);
    return row ? this.hydrate(this.uow.read, row) : null;
  }

  async openShift(terminalId: string, employeeId: string, float: Satang): Promise<Shift> {
    if (!Number.isInteger(float) || float < 0) throw new DomainError('invalid', 'เงินตั้งต้นต้องเป็นจำนวนเงินที่ไม่ติดลบ');
    const now = this.clock();
    const cutoffHour = (await this.settings.getAll()).cutoffHour;
    return this.uow.run(async (tx) => {
      if (await this.shifts.openOf(tx, terminalId)) throw new DomainError('conflict', 'เครื่องนี้มีกะเปิดอยู่แล้ว');
      const date = businessDate(now, cutoffHour);
      if (await this.shifts.isDayClosed(tx, date)) throw new DomainError('conflict', 'ปิดวันนี้ไปแล้ว เปิดกะใหม่ไม่ได้ ให้ผู้จัดการตรวจสอบ');
      const id = crypto.randomUUID();
      await this.shifts.insert(tx, { id, terminalId, employeeId, businessDate: date, openedAt: now, float });
      await this.audit.record(tx, now, { actor: employeeId, terminalId, action: 'shift.open', entity: 'shift', entityId: id, after: { float } });
      return this.must(tx, id);
    });
  }

  async addCashMove(shiftId: string, move: Omit<CashMove, 'at'>): Promise<Shift> {
    if (!MOVE_TYPES.includes(move.type)) throw new DomainError('invalid', 'ประเภทรายการไม่ถูกต้อง');
    if (!Number.isInteger(move.amount) || move.amount <= 0) throw new DomainError('invalid', 'ใส่จำนวนเงินมากกว่า 0');
    if (!move.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลของรายการนี้');
    const now = this.clock();
    return this.uow.run(async (tx) => {
      const shift = await this.openOrThrow(tx, shiftId);
      await this.shifts.insertCashMove(tx, shiftId, now, { type: move.type, amount: move.amount, reason: move.reason.trim(), employeeId: move.employeeId, approvedBy: move.approvedBy ?? null });
      await this.audit.record(tx, now, { actor: move.employeeId, approver: move.approvedBy, terminalId: shift.terminalId, action: `cash.${move.type}`, entity: 'shift', entityId: shiftId, after: { amount: move.amount, reason: move.reason } });
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
    if (needsVarianceApproval(variance, (await this.settings.getAll()).cashVarianceLimit)) {
      if (!note?.trim()) throw new DomainError('invalid', 'เงินขาดหรือเกินเกินเกณฑ์ ใส่หมายเหตุก่อนปิดกะ', { variance });
      if (!actor) throw new DomainError('unauthorized', 'ต้องเข้าสู่ระบบ');
      approver = await this.approvals.resolve({ actor, permission: 'shift.expected', approverCode, terminalId: current.terminalId });
    }
    return this.uow.run(async (tx) => {
      const shift = await this.openOrThrow(tx, shiftId);
      await this.shifts.close(tx, shiftId, now, counted, note ?? null);
      await this.audit.record(tx, now, { actor: actor?.id ?? shift.employeeId, approver: approver && approver.id !== actor?.id ? approver.id : undefined, terminalId: shift.terminalId, action: 'shift.close', entity: 'shift', entityId: shiftId, after: { counted, variance, note } });
      return this.must(tx, shiftId);
    });
  }

  /** "เปิดลิ้นชักโดยไม่มีการขาย": allowed for supervisors and up, a cashier needs one's code. The reason is logged. */
  async openDrawer(shiftId: string, reason: string, actor: Employee, approverCode?: string): Promise<void> {
    if (!reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลที่เปิดลิ้นชัก');
    const shift = await this.shifts.find(this.uow.read, shiftId);
    if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    const approver = await this.approvals.resolve({ actor, permission: 'drawer.nosale', approverCode, terminalId: shift.terminalId });
    await this.uow.run((tx) => this.audit.record(tx, this.clock(), { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId: shift.terminalId, action: 'drawer.nosale', entity: 'shift', entityId: shiftId, after: { reason } }));
  }

  private async openOrThrow(tx: Tx, id: string): Promise<ShiftRow> {
    const shift = await this.shifts.find(tx, id);
    if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    return shift;
  }

  private async must(tx: Tx, id: string): Promise<Shift> {
    const row = await this.shifts.find(tx, id);
    if (!row) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return this.hydrate(tx, row);
  }

  /** The shift as the till and the Z report read it: the shift, its bills with payments, drawer moves and credit notes. */
  private async hydrate(tx: Tx, r: ShiftRow): Promise<Shift> {
    const [sales, payments, moves, notes] = await Promise.all([this.sales.ofShift(tx, r.id), this.sales.paymentsOfShift(tx, r.id), this.shifts.cashMoves(tx, r.id), this.creditNotes.ofShift(tx, r.id)]);
    const phones = new Map<string, string | null>();
    for (const id of new Set(sales.map((s) => s.memberId).filter((x): x is string => !!x))) phones.set(id, await this.members.phoneOf(id, tx));
    const records: SaleRecord[] = sales.map((s) => {
      const phone = s.memberId ? phones.get(s.memberId) : null;
      return {
        docNo: s.docNo, at: iso(s.at), employeeId: s.employeeId, cart: s.cart, change: s.change,
        ...(phone ? { memberPhone: phone, pointsEarned: s.pointsEarned } : {}),
        ...(s.pointsRedeemed > 0 ? { pointsRedeemed: s.pointsRedeemed, pointsValue: s.pointsValue } : {}),
        ...(s.voided ? { voided: true } : {}),
        payments: payments.filter((p) => p.docNo === s.docNo).map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered != null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
      };
    });
    return {
      id: r.id, terminalId: r.terminalId, employeeId: r.employeeId, openedAt: iso(r.openedAt), float: r.float,
      ...(r.closedAt ? { closedAt: iso(r.closedAt) } : {}),
      ...(r.counted != null ? { counted: r.counted } : {}),
      ...(r.note ? { note: r.note } : {}),
      sales: records,
      cashMoves: moves.map((m) => ({ at: iso(m.at), type: m.type, amount: m.amount, reason: m.reason, employeeId: m.employeeId, ...(m.approvedBy ? { approvedBy: m.approvedBy } : {}) })),
      creditNotes: notes,
    };
  }
}
