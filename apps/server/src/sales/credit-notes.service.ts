import { Inject, Injectable } from '@nestjs/common';
import type { CreditNote as CreditNoteView, Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { CLOCK, type Clock } from '../common/clock';
import { businessDate, docPeriod, iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { NumberingService } from '../database/numbering.service';
import { MembersService } from '../members/members.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { CreditNote } from './domain/credit-note';
import { CreditNoteRepository } from './domain/credit-note.repository';
import { SaleRepository } from './domain/sale.repository';
import { ShiftRepository } from './domain/shift.repository';
import { isLateReturn } from './refund-rules';
import type { PricingSnapshot } from './sales.types';

export interface RefundInput {
  saleDocNo: string;
  /** Omit for a full void. For a refund: what comes back, by product. */
  lines?: { productId: string; qty: number }[];
  reason: string;
  /** True: goods go back on the shelf. False: written off (spec: "ตัดเป็นของเสีย"). */
  restock?: boolean;
  approverCode?: string;
  /** Work out the amount and the split but write nothing, so the till can show "ยอดคืนเงิน" before anyone approves. */
  preview?: boolean;
}

const toView = (note: CreditNote): CreditNoteView => {
  const c = note.snapshot();
  return {
    docNo: c.docNo, at: iso(c.at), type: c.kind, saleDocNo: c.saleDocNo, amount: c.amount, reason: c.reason, employeeId: c.employeeId, approvedBy: c.approvedBy, restock: c.restock,
    payments: c.payments, lines: c.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, amount: l.amount })),
  };
};

/**
 * Application service for voids and refunds. The rules are in the `CreditNote` aggregate; this checks approvals, then in one
 * transaction writes the document, puts goods back, adjusts points and audits. The original bill is never touched (CLAUDE.md rule 3).
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notes: CreditNoteRepository,
    private readonly sales: SaleRepository,
    private readonly shifts: ShiftRepository,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly members: MembersService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Credit notes for one bill, or for every bill of a shift, as the API shows them. */
  async forSale(_tx: Tx, saleDocNo: string): Promise<CreditNoteView[]> {
    return (await this.notes.findBySale(saleDocNo)).map(toView);
  }

  async ofShift(_tx: Tx, shiftId: string): Promise<CreditNoteView[]> {
    return (await this.notes.findByShift(shiftId)).map(toView);
  }

  /** Void: whole bill, same shift, shift still open. A refund: any time, part or all, back through the current shift's drawer. */
  async credit(shiftId: string, kind: 'void' | 'refund', input: RefundInput, actor: Employee, terminalId: string): Promise<CreditNoteView> {
    if (!input.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลก่อนทำรายการ');
    const now = this.clock();
    const cfg = await this.settings.getAll();
    // Approval first, in its own transaction, so a wrong code is counted even when the rest aborts.
    const approver = input.preview ? actor : await this.approvals.resolve({ actor, permission: kind === 'void' ? 'void' : 'refund', approverCode: input.approverCode, terminalId });
    const soldAt = (await this.sales.findByDocNo(input.saleDocNo))?.at;
    if (!soldAt) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
    const late = kind === 'refund' && isLateReturn(soldAt, now, cfg.refundDays);
    const finalApprover = late && !input.preview ? await this.approvals.resolve({ actor: approver, permission: 'refund.late', approverCode: input.approverCode, terminalId }) : approver;

    return this.db.transaction(async (tx) => {
      const shift = await this.shifts.findById(shiftId);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.isClosed) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const sale = await this.sales.findByDocNo(input.saleDocNo);
      if (!sale) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
      const prior = await this.notes.findBySale(sale.docNo);

      const sold = sale.snapshot();
      const pricing = sold.pricing ?? (await this.fallbackSnapshot(tx, sold.lines.map((l) => l.productId)));
      const plan = CreditNote.plan({ kind, sale, pricing, shiftId, prior, wanted: input.lines });
      const restock = input.restock !== false;
      const issued = (docNo: string, approvedBy: string, at = now) => CreditNote.issue(plan, { docNo, shiftId, now: at, businessDate: businessDate(at, cfg.cutoffHour), reason: input.reason, restock, employeeId: actor.id, approvedBy });
      if (input.preview) return toView(issued('(preview)', actor.id));

      const docNo = kind === 'void' ? `${sale.docNo}-V` : await this.numbering.next(tx, `CN-${docPeriod(now)}`);
      await this.notes.add(issued(docNo, finalApprover.id));

      await this.stock.record(tx, [
        // Goods that come back; written off = it came back, then left again as waste, so the ledger shows both.
        ...plan.lines.map((l) => ({ productId: l.productId, qty: l.qty, kind, docNo, at: now })),
        ...(restock ? [] : plan.lines.map((l) => ({ productId: l.productId, qty: -l.qty, kind: 'waste' as const, docNo, at: now }))),
        ...(kind === 'void' ? sold.cart.premiums.filter((p) => !p.outOfStock).map((p) => ({ premiumId: p.premiumId, qty: p.qty, kind: 'void' as const, docNo, at: now })) : []),
      ]);
      if (sale.memberId && sale.net > 0) {
        await this.members.adjustForCredit(tx, { memberId: sale.memberId, kind, creditDocNo: docNo, priorCreditDocNos: prior.map((c) => c.docNo), earned: sold.pointsEarned, redeemed: sold.pointsRedeemed, saleNet: sale.net, refundedAfter: plan.refundedAfter, now });
      }
      await this.audit.record(tx, now, { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId, action: `sale.${kind}`, entity: 'credit_note', entityId: docNo, after: { saleDocNo: sale.docNo, amount: plan.amount, reason: input.reason, lateApprover: late ? finalApprover.id : undefined } });
      return toView(issued(docNo, finalApprover.id));
    });
  }

  /** Bills closed before snapshots existed: price against today's shelf prices. */
  private async fallbackSnapshot(tx: Tx, productIds: string[]): Promise<PricingSnapshot> {
    const snap = await this.products.snapshot(tx);
    const wanted = new Set(productIds);
    return { products: snap.products.filter((p) => wanted.has(p.id)), promotions: snap.promotions, premiums: [] };
  }
}
