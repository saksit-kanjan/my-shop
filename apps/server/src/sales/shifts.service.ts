import { Inject, Injectable } from '@nestjs/common';
import { In, IsNull } from 'typeorm';
import type { CashMove, Employee, Satang, SaleRecord, Shift } from '@my-shop/contracts';
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
import { CashMoveEntity, CreditNoteEntity, DayClose, PaymentEntity, SaleEntity, ShiftEntity } from './entities/sales.entities';
import { Shift as ShiftAggregate } from './domain/shift';
import { ShiftRepository } from './domain/shift.repository';
import { toSaleRow } from './sale-queries';

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
    private readonly shiftRepo: ShiftRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getOpenShift(terminalId: string): Promise<Shift | null> {
    const row = await this.db.manager.findOneBy(ShiftEntity, { terminalId, closedAt: IsNull() });
    return row ? this.hydrate(this.db.manager, row) : null;
  }

  async getShift(id: string): Promise<Shift | null> {
    const row = await this.db.manager.findOneBy(ShiftEntity, { id });
    return row ? this.hydrate(this.db.manager, row) : null;
  }

  async openShift(terminalId: string, employeeId: string, float: Satang): Promise<Shift> {
    const now = this.clock();
    const date = businessDate(now, (await this.settings.getAll()).cutoffHour);
    return this.db.transaction(async (tx) => {
      if (await this.shiftRepo.findOpenByTerminal(terminalId)) throw new DomainError('conflict', 'เครื่องนี้มีกะเปิดอยู่แล้ว');
      if (await tx.existsBy(DayClose, { businessDate: date })) throw new DomainError('conflict', 'ปิดวันนี้ไปแล้ว เปิดกะใหม่ไม่ได้ ให้ผู้จัดการตรวจสอบ');
      const id = crypto.randomUUID();
      await this.shiftRepo.add(ShiftAggregate.open({ id, terminalId, employeeId, businessDate: date, float, now }));
      await this.audit.record(tx, now, { actor: employeeId, terminalId, action: 'shift.open', entity: 'shift', entityId: id, after: { float } });
      return this.must(tx, id);
    });
  }

  async addCashMove(shiftId: string, move: Omit<CashMove, 'at'>): Promise<Shift> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const shift = await this.shiftRepo.lockById(shiftId);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      shift.addCashMove(move, now);
      await this.shiftRepo.save(shift);
      await this.audit.record(tx, now, { actor: move.employeeId, approver: move.approvedBy, terminalId: shift.terminalId, action: `cash.${move.type}`, entity: 'shift', entityId: shiftId, after: { amount: move.amount, reason: move.reason } });
      return this.must(tx, shiftId);
    });
  }

  /**
   * Close with the cashier's blind count. A difference over the store limit needs a supervisor's code and a note
   * (spec: "ผลต่างเกินเกณฑ์").
   */
  async closeShift(shiftId: string, counted: Satang, note?: string, actor?: Employee, approverCode?: string): Promise<Shift> {
    const now = this.clock();
    const current = await this.getShift(shiftId);
    if (!current) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (current.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    const variance = ShiftAggregate.variance(counted, summarizeShift(current).expectedCash);
    let approver: Employee | null = null;
    if (ShiftAggregate.needsApproval(variance, (await this.settings.getAll()).cashVarianceLimit)) {
      if (!note?.trim()) throw new DomainError('invalid', 'เงินขาดหรือเกินเกินเกณฑ์ ใส่หมายเหตุก่อนปิดกะ', { variance });
      if (!actor) throw new DomainError('unauthorized', 'ต้องเข้าสู่ระบบ');
      approver = await this.approvals.resolve({ actor, permission: 'shift.expected', approverCode, terminalId: current.terminalId });
    }
    return this.db.transaction(async (tx) => {
      const shift = await this.shiftRepo.lockById(shiftId);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      shift.close(counted, note, now);
      await this.shiftRepo.save(shift);
      await this.audit.record(tx, now, { actor: actor?.id ?? shift.employeeId, approver: approver && approver.id !== actor?.id ? approver.id : undefined, terminalId: shift.terminalId, action: 'shift.close', entity: 'shift', entityId: shiftId, after: { counted, variance, note } });
      return this.must(tx, shiftId);
    });
  }

  /** "เปิดลิ้นชักโดยไม่มีการขาย": allowed for supervisors and up, a cashier needs one's code. The reason is logged. */
  async openDrawer(shiftId: string, reason: string, actor: Employee, approverCode?: string): Promise<void> {
    if (!reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลที่เปิดลิ้นชัก');
    const shift = await this.shiftRepo.findById(shiftId);
    if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
    if (shift.isClosed) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
    const approver = await this.approvals.resolve({ actor, permission: 'drawer.nosale', approverCode, terminalId: shift.terminalId });
    await this.db.transaction((tx) => this.audit.record(tx, this.clock(), { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId: shift.terminalId, action: 'drawer.nosale', entity: 'shift', entityId: shiftId, after: { reason } }));
  }

  private async must(tx: Tx, id: string): Promise<Shift> {
    const row = await tx.findOneBy(ShiftEntity, { id });
    if (!row) throw new DomainError('not_found', 'ไม่พบกะนี้');
    return this.hydrate(tx, row);
  }

  /** The shift as the till and the Z report read it: the shift, its bills with payments, drawer moves and credit notes. */
  private async hydrate(tx: Tx, r: ShiftEntity): Promise<Shift> {
    const sales = await tx.find(SaleEntity, { where: { shiftId: r.id }, order: { at: 'ASC', docNo: 'ASC' } });
    const docNos = sales.map((s) => s.docNo);
    const [payments, voids, moves, notes] = await Promise.all([
      docNos.length ? tx.find(PaymentEntity, { where: { docNo: In(docNos) }, order: { id: 'ASC' } }) : [],
      docNos.length ? tx.find(CreditNoteEntity, { where: { saleDocNo: In(docNos), type: 'void' }, select: { saleDocNo: true } }) : [],
      tx.find(CashMoveEntity, { where: { shiftId: r.id }, order: { id: 'ASC' } }),
      this.creditNotes.ofShift(tx, r.id),
    ]);
    const voided = new Set(voids.map((v) => v.saleDocNo));
    const phones = new Map<string, string | null>();
    for (const id of new Set(sales.map((s) => s.memberId).filter((x): x is string => !!x))) phones.set(id, await this.members.phoneOf(id, tx));
    const records: SaleRecord[] = sales.map((row) => {
      const s = toSaleRow(row);
      const phone = s.memberId ? phones.get(s.memberId) : null;
      return {
        docNo: s.docNo, at: iso(s.at), employeeId: s.employeeId, cart: s.cart, change: s.change,
        ...(phone ? { memberPhone: phone, pointsEarned: s.pointsEarned } : {}),
        ...(s.pointsRedeemed > 0 ? { pointsRedeemed: s.pointsRedeemed, pointsValue: s.pointsValue } : {}),
        ...(voided.has(s.docNo) ? { voided: true } : {}),
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
