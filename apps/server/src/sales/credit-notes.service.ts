import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { CreditNote, Employee, PaymentMethod } from '@my-shop/contracts';
import { manualDiscountOf, priceCart } from '@my-shop/domain';
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
import { CreditNoteEntity, CreditNoteLine, CreditNotePayment, ShiftEntity } from './entities/sales.entities';
import { findSale, saleLines, salePayments } from './sale-queries';
import { allocateOverLines, allocateOverPayments, isLateReturn, moneyShare } from './refund-rules';
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

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Voids and refunds. The original bill is never touched (CLAUDE.md rule 3): a credit note is a new document that points at it,
 * puts goods back, returns money to the original payment methods and adjusts points, all in one transaction.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly members: MembersService,
    private readonly approvals: ApprovalsService,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Credit notes for one bill, or for every bill of a shift. */
  forSale(tx: Tx, saleDocNo: string): Promise<CreditNote[]> {
    return this.load(tx, { saleDocNo });
  }

  ofShift(tx: Tx, shiftId: string): Promise<CreditNote[]> {
    return this.load(tx, { shiftId });
  }

  /** Void: whole bill, same shift, shift still open. A refund: any time, part or all, back through the current shift's drawer. */
  async credit(shiftId: string, kind: 'void' | 'refund', input: RefundInput, actor: Employee, terminalId: string): Promise<CreditNote> {
    if (!input.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลก่อนทำรายการ');
    const now = this.clock();
    const cfg = await this.settings.getAll();
    // Approval first, in its own transaction, so a wrong code is counted even when the rest aborts.
    const approver = input.preview ? actor : await this.approvals.resolve({ actor, permission: kind === 'void' ? 'void' : 'refund', approverCode: input.approverCode, terminalId });
    const soldAt = (await findSale(this.db.manager, input.saleDocNo))?.at;
    if (!soldAt) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
    const late = kind === 'refund' && isLateReturn(soldAt, now, cfg.refundDays);
    const finalApprover = late && !input.preview ? await this.approvals.resolve({ actor: approver, permission: 'refund.late', approverCode: input.approverCode, terminalId }) : approver;

    return this.db.transaction(async (tx) => {
      const shift = await tx.findOneBy(ShiftEntity, { id: shiftId });
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const sale = await findSale(tx, input.saleDocNo);
      if (!sale) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
      if (kind === 'void' && sale.shiftId !== shiftId) throw new DomainError('conflict', 'ยกเลิกบิลได้เฉพาะบิลที่ขายในกะนี้ บิลของกะอื่นให้ใช้คืนสินค้า');

      const lines = await saleLines(tx, sale.docNo);
      const prior = await this.forSale(tx, sale.docNo);
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

      // Re-price what is left under the promotions of the day the bill was sold (including which were in their dates): this is how a lost "buy 2 get 1" takes the gift's value out of the refund.
      const remaining = lines.map((l) => ({ productId: l.productId, qty: l.qty - (returned.get(l.productId) ?? 0) - (wanted.get(l.productId) ?? 0) })).filter((l) => l.qty > 0);
      const snap = sale.pricing ?? (await this.fallbackSnapshot(tx, lines.map((l) => l.productId)));
      const catalog = { categories: [], products: snap.products, premiums: snap.premiums.map((p) => ({ ...p, stock: 1_000_000 })), promotions: snap.promotions };
      const priceAt = (ls: { productId: string; qty: number }[], manual?: typeof snap.manual) => priceCart(ls, catalog, { isMember: !!sale.memberId, at: sale.at, manual }).net;
      let remainingNet = 0;
      if (remaining.length && snap.manual?.type === 'amount') {
        // A fixed discount belongs to the whole bill: what is kept carries its share of it, not all of it.
        // The discount actually given is on the stored bill, so gift rows in sale_lines cannot skew it.
        const given = manualDiscountOf(sale.cart);
        const full = sale.net + given;
        const kept = priceAt(remaining);
        remainingNet = full > 0 ? kept - Math.round((given * kept) / full) : kept;
      } else if (remaining.length) remainingNet = priceAt(remaining, snap.manual);
      const refundedAfter = sale.net - remainingNet;
      const amount = Math.max(0, refundedAfter - sum(prior.map((c) => c.amount)));

      const returning = [...wanted].map(([pid, qty]) => ({ pid, qty, line: lines.find((l) => l.productId === pid)! }));
      const amounts = allocateOverLines(amount, returning.map((r) => r.qty * r.line.unitPrice));

      // Money back follows how the customer paid; points the customer spent come back as points.
      const paid = await salePayments(tx, sale.docNo);
      const paidTotal = sum(paid.map((p) => p.amount));
      const priorMoney = sum(prior.flatMap((c) => c.payments.map((p) => p.amount)));
      const payments = allocateOverPayments(paid, moneyShare(amount, sale.net, paidTotal, priorMoney));
      const restock = input.restock !== false;
      const view = (docNo: string, approvedBy: string): CreditNote => ({
        docNo, at: now.toISOString(), type: kind, saleDocNo: sale.docNo, amount, reason: input.reason.trim(), employeeId: actor.id, approvedBy, restock, payments,
        lines: returning.map((r, i) => ({ productId: r.pid, name: r.line.name, qty: r.qty, amount: amounts[i] })),
      });
      if (input.preview) return view('(preview)', actor.id);

      const docNo = kind === 'void' ? `${sale.docNo}-V` : await this.numbering.next(tx, `CN-${docPeriod(now)}`);
      await tx.insert(CreditNoteEntity, { docNo, saleDocNo: sale.docNo, shiftId, type: kind, at: now, businessDate: businessDate(now, cfg.cutoffHour), amount, reason: input.reason.trim(), restock, employeeId: actor.id, approvedBy: finalApprover.id });
      if (returning.length) await tx.insert(CreditNoteLine, returning.map((r, i) => ({ docNo, productId: r.pid, name: r.line.name, qty: r.qty, amount: amounts[i], cost: r.line.cost })));
      if (payments.length) await tx.insert(CreditNotePayment, payments.map((p) => ({ docNo, method: p.method, amount: p.amount })));

      await this.stock.record(tx, [
        // Goods that come back; written off = it came back, then left again as waste, so the ledger shows both.
        ...returning.map((r) => ({ productId: r.pid, qty: r.qty, kind: kind as 'void' | 'refund', docNo, at: now })),
        ...(restock ? [] : returning.map((r) => ({ productId: r.pid, qty: -r.qty, kind: 'waste' as const, docNo, at: now }))),
        ...(kind === 'void' ? sale.cart.premiums.filter((p) => !p.outOfStock).map((p) => ({ premiumId: p.premiumId, qty: p.qty, kind: 'void' as const, docNo, at: now })) : []),
      ]);
      if (sale.memberId && sale.net > 0) {
        await this.members.adjustForCredit(tx, { memberId: sale.memberId, kind, creditDocNo: docNo, priorCreditDocNos: prior.map((c) => c.docNo), earned: sale.pointsEarned, redeemed: sale.pointsRedeemed, saleNet: sale.net, refundedAfter, now });
      }
      await this.audit.record(tx, now, { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId, action: `sale.${kind}`, entity: 'credit_note', entityId: docNo, after: { saleDocNo: sale.docNo, amount, reason: input.reason, lateApprover: late ? finalApprover.id : undefined } });
      return view(docNo, finalApprover.id);
    });
  }

  /** Bills closed before snapshots existed: price against today's shelf prices. */
  private async fallbackSnapshot(tx: Tx, productIds: string[]): Promise<PricingSnapshot> {
    const snap = await this.products.snapshot(tx);
    const wanted = new Set(productIds);
    return { products: snap.products.filter((p) => wanted.has(p.id)), promotions: snap.promotions, premiums: [] };
  }

  private async load(tx: Tx, where: { saleDocNo: string } | { shiftId: string }): Promise<CreditNote[]> {
    const heads = await tx.find(CreditNoteEntity, { where, order: { at: 'ASC', docNo: 'ASC' } });
    if (heads.length === 0) return [];
    const docs = heads.map((h) => h.docNo);
    const [lines, pays] = await Promise.all([
      tx.find(CreditNoteLine, { where: { docNo: In(docs) }, order: { id: 'ASC' } }),
      tx.find(CreditNotePayment, { where: { docNo: In(docs) }, order: { id: 'ASC' } }),
    ]);
    return heads.map((h) => ({
      docNo: h.docNo, at: iso(h.at), type: h.type, saleDocNo: h.saleDocNo, amount: h.amount, reason: h.reason, employeeId: h.employeeId, approvedBy: h.approvedBy, restock: h.restock,
      payments: pays.filter((p) => p.docNo === h.docNo).map((p) => ({ method: p.method as PaymentMethod, amount: p.amount })),
      lines: lines.filter((l) => l.docNo === h.docNo).map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, amount: l.amount })),
    }));
  }
}
