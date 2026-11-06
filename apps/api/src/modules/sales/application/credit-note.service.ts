import { Inject, Injectable } from '@nestjs/common';
import type { CreditNote, Employee } from '@my-shop/contracts';
import { priceCart } from '@my-shop/domain';
import { AuditLog } from '../../../shared/audit/audit-log';
import { UnitOfWork } from '../../../shared/database/unit-of-work';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { businessDate, docPeriod } from '../../../shared/kernel/dates';
import { DomainError } from '../../../shared/kernel/domain-error';
import { DocumentNumbers } from '../../../shared/numbering/document-numbers';
import { SettingsService } from '../../administration/application/settings.service';
import { CatalogService } from '../../catalog/application/catalog.service';
import { ApprovalService } from '../../identity/application/approval.service';
import { StockLedgerService } from '../../inventory/application/stock-ledger.service';
import { MembershipService } from '../../membership/application/membership.service';
import { CreditNoteRepository } from '../domain/credit-note.repository';
import { allocateOverLines, allocateOverPayments, isLateReturn, moneyShare } from '../domain/refund-calculator';
import { SalesRepository } from '../domain/sales.repository';
import type { PricingSnapshot } from '../domain/sales.types';
import { ShiftRepository } from '../domain/shift.repository';

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

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Voids and refunds. The original bill is never touched (rule 3): a credit note is a new document that points at it,
 * puts goods back, returns money to the original payment methods and adjusts points, all in one transaction.
 */
@Injectable()
export class CreditNoteService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(ShiftRepository) private readonly shifts: ShiftRepository,
    @Inject(SalesRepository) private readonly sales: SalesRepository,
    @Inject(CreditNoteRepository) private readonly creditNotes: CreditNoteRepository,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(StockLedgerService) private readonly stock: StockLedgerService,
    @Inject(MembershipService) private readonly members: MembershipService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(DocumentNumbers) private readonly numbers: DocumentNumbers,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Void: whole bill, same shift, shift still open. A refund: any time, part or all, back through the current shift's drawer. */
  async credit(shiftId: string, kind: 'void' | 'refund', input: RefundInput, actor: Employee, terminalId: string): Promise<CreditNote> {
    if (!input.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลก่อนทำรายการ');
    const now = this.clock();
    const cfg = await this.settings.getAll();
    // Approval first, in its own transaction, so a wrong code is counted even when the rest aborts.
    const approver = input.preview ? actor : await this.approvals.resolve({ actor, permission: kind === 'void' ? 'void' : 'refund', approverCode: input.approverCode, terminalId });
    const soldAt = (await this.sales.find(this.uow.read, input.saleDocNo))?.at;
    if (!soldAt) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
    const late = kind === 'refund' && isLateReturn(soldAt, now, cfg.refundDays);
    const finalApprover = late && !input.preview ? await this.approvals.resolve({ actor: approver, permission: 'refund.late', approverCode: input.approverCode, terminalId }) : approver;

    return this.uow.run(async (tx) => {
      const shift = await this.shifts.find(tx, shiftId);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const sale = await this.sales.find(tx, input.saleDocNo);
      if (!sale) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
      if (kind === 'void' && sale.shiftId !== shiftId) throw new DomainError('conflict', 'ยกเลิกบิลได้เฉพาะบิลที่ขายในกะนี้ บิลของกะอื่นให้ใช้คืนสินค้า');

      const lines = await this.sales.lines(tx, sale.docNo);
      const prior = await this.creditNotes.forSale(tx, sale.docNo);
      if (prior.some((c) => c.type === 'void')) throw new DomainError('conflict', 'บิลนี้ถูกยกเลิกแล้ว');
      if (kind === 'void' && prior.length > 0) throw new DomainError('conflict', 'บิลนี้มีการคืนสินค้าแล้ว ยกเลิกทั้งบิลไม่ได้');

      const returned = new Map<string, number>();
      for (const c of prior) for (const l of c.lines) returned.set(l.productId, (returned.get(l.productId) ?? 0) + l.qty);
      const wanted = new Map<string, number>();
      if (kind === 'void') for (const l of lines) wanted.set(l.productId, l.qty);
      else {
        if (!input.lines?.length) throw new DomainError('invalid', 'เลือกสินค้าที่คืนอย่างน้อย 1 รายการ');
        for (const l of input.lines) {
          if (!Number.isInteger(l.qty) || l.qty <= 0) throw new DomainError('invalid', 'จำนวนที่คืนต้องมากกว่า 0');
          wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.qty);
        }
      }
      for (const [pid, qty] of wanted) {
        const sold = lines.find((l) => l.productId === pid)?.qty ?? 0;
        if (qty > sold - (returned.get(pid) ?? 0)) throw new DomainError('invalid', 'คืนได้ไม่เกินจำนวนที่ขาย (หักที่คืนไปแล้ว)', { productId: pid, available: sold - (returned.get(pid) ?? 0) });
      }

      // Re-price what is left under the promotions of the day: this is how a lost "buy 2 get 1" takes the gift's value out of the refund.
      const remaining = lines.map((l) => ({ productId: l.productId, qty: l.qty - (returned.get(l.productId) ?? 0) - (wanted.get(l.productId) ?? 0) })).filter((l) => l.qty > 0);
      const snap = sale.pricing ?? (await this.fallbackSnapshot(tx, lines.map((l) => l.productId)));
      const catalog = { categories: [], products: snap.products, premiums: snap.premiums.map((p) => ({ ...p, stock: 1_000_000 })), promotions: snap.promotions };
      const remainingNet = remaining.length ? priceCart(remaining, catalog, { isMember: !!sale.memberId }).net : 0;
      const refundedAfter = sale.net - remainingNet;
      const amount = Math.max(0, refundedAfter - sum(prior.map((c) => c.amount)));

      const returning = [...wanted].map(([pid, qty]) => ({ pid, qty, line: lines.find((l) => l.productId === pid)! }));
      const amounts = allocateOverLines(amount, returning.map((r) => r.qty * r.line.unitPrice));

      // Money back follows how the customer paid; points the customer spent come back as points.
      const paid = await this.sales.payments(tx, sale.docNo);
      const paidTotal = sum(paid.map((p) => p.amount));
      const priorMoney = sum(prior.flatMap((c) => c.payments.map((p) => p.amount)));
      const payments = allocateOverPayments(paid, moneyShare(amount, sale.net, paidTotal, priorMoney));
      const restock = input.restock !== false;
      const view = (docNo: string, approvedBy: string): CreditNote => ({
        docNo, at: now.toISOString(), type: kind, saleDocNo: sale.docNo, amount, reason: input.reason.trim(), employeeId: actor.id, approvedBy, restock, payments,
        lines: returning.map((r, i) => ({ productId: r.pid, name: r.line.name, qty: r.qty, amount: amounts[i] })),
      });
      if (input.preview) return view('(preview)', actor.id);

      const period = docPeriod(now);
      const docNo = kind === 'void' ? `${sale.docNo}-V` : await this.numbers.format(tx, `CN-${period}`);
      await this.creditNotes.insert(tx, {
        docNo, saleDocNo: sale.docNo, shiftId, type: kind, at: now, businessDate: businessDate(now, cfg.cutoffHour), amount, reason: input.reason.trim(), restock,
        employeeId: actor.id, approvedBy: finalApprover.id,
        lines: returning.map((r, i) => ({ productId: r.pid, name: r.line.name, qty: r.qty, amount: amounts[i], cost: r.line.cost })),
        payments,
      });
      await this.stock.record(tx, [
        // Goods that come back; written off = it came back, then left again as waste, so the ledger shows both.
        ...returning.map((r) => ({ productId: r.pid, qty: r.qty, kind: kind as 'void' | 'refund', docNo, at: now })),
        ...(restock ? [] : returning.map((r) => ({ productId: r.pid, qty: -r.qty, kind: 'waste' as const, docNo, at: now }))),
        ...(kind === 'void' ? sale.cart.premiums.filter((p) => !p.outOfStock).map((p) => ({ premiumId: p.premiumId, qty: p.qty, kind: 'void' as const, docNo, at: now })) : []),
      ]);
      if (sale.memberId && sale.net > 0) {
        await this.members.adjustForCredit(tx, {
          memberId: sale.memberId, kind, creditDocNo: docNo, priorCreditDocNos: prior.map((c) => c.docNo),
          earned: sale.pointsEarned, redeemed: sale.pointsRedeemed, saleNet: sale.net, refundedAfter, now,
        });
      }
      await this.audit.record(tx, now, { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId, action: `sale.${kind}`, entity: 'credit_note', entityId: docNo, after: { saleDocNo: sale.docNo, amount, reason: input.reason, lateApprover: late ? finalApprover.id : undefined } });
      return view(docNo, finalApprover.id);
    });
  }

  /** Bills closed before snapshots existed: price against today's shelf prices. */
  private async fallbackSnapshot(tx: Parameters<CatalogService['snapshot']>[0], productIds: string[]): Promise<PricingSnapshot> {
    const snap = await this.catalog.snapshot(tx);
    const wanted = new Set(productIds);
    return { products: snap.products.filter((p) => wanted.has(p.id)), promotions: snap.promotions, premiums: [] };
  }
}
