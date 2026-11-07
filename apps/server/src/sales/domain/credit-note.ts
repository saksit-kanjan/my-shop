import type { PaymentMethod, Satang } from '@my-shop/contracts';
import { manualDiscountOf, priceCart } from '@my-shop/domain';
import { DomainError } from '../../common/domain-error';
import { allocateOverLines, allocateOverPayments, moneyShare } from '../refund-rules';
import type { PricingSnapshot } from '../sales.types';
import type { Sale } from './sale';

export type CreditKind = 'void' | 'refund';

export interface CreditLine {
  productId: string;
  name: string;
  qty: number;
  amount: Satang;
  cost: Satang;
}

export interface CreditNoteState {
  docNo: string;
  saleDocNo: string;
  shiftId: string;
  kind: CreditKind;
  at: Date;
  businessDate: string;
  amount: Satang;
  reason: string;
  /** True: goods go back on the shelf. False: written off (spec: "ตัดเป็นของเสีย"). */
  restock: boolean;
  employeeId: string;
  approvedBy: string;
  lines: CreditLine[];
  payments: { method: PaymentMethod; amount: Satang }[];
}

/** What a void or refund comes to, worked out before anything is written (the till shows it as a preview first). */
export interface CreditPlan {
  kind: CreditKind;
  saleDocNo: string;
  amount: Satang;
  /** Share of the bill refunded so far, this credit note included; drives the points adjustment. */
  refundedAfter: Satang;
  lines: CreditLine[];
  payments: { method: PaymentMethod; amount: Satang }[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Aggregate root: a void or a refund, a NEW document that points at the original bill (CLAUDE.md rule 3). The bill is never
 * touched. `plan` holds the rules (what may come back, what it is worth, how the money goes back); `issue` makes the document.
 */
export class CreditNote {
  private constructor(private readonly state: CreditNoteState) {}

  /**
   * @param wanted what comes back, by product; ignored for a void (the whole bill)
   * @param pricing the rules the bill was priced under, to re-price what is left
   */
  static plan(args: { kind: CreditKind; sale: Sale; pricing: PricingSnapshot; shiftId: string; prior: CreditNote[]; wanted?: { productId: string; qty: number }[] }): CreditPlan {
    const { kind, sale, pricing, shiftId, prior } = args;
    const s = sale.snapshot();
    if (kind === 'void' && s.shiftId !== shiftId) throw new DomainError('conflict', 'ยกเลิกบิลได้เฉพาะบิลที่ขายในกะนี้ บิลของกะอื่นให้ใช้คืนสินค้า');
    if (prior.some((c) => c.state.kind === 'void')) throw new DomainError('conflict', 'บิลนี้ถูกยกเลิกแล้ว');
    if (kind === 'void' && prior.length > 0) throw new DomainError('conflict', 'บิลนี้มีการคืนสินค้าแล้ว ยกเลิกทั้งบิลไม่ได้');

    const returned = new Map<string, number>();
    for (const c of prior) for (const l of c.state.lines) returned.set(l.productId, (returned.get(l.productId) ?? 0) + l.qty);
    const wanted = new Map<string, number>();
    if (kind === 'void') for (const l of s.lines) wanted.set(l.productId, l.qty);
    else {
      if (!args.wanted?.length) throw new DomainError('invalid', 'เลือกสินค้าที่คืนอย่างน้อย 1 รายการ');
      for (const l of args.wanted) {
        if (!Number.isInteger(l.qty) || l.qty <= 0) throw new DomainError('invalid', 'จำนวนที่คืนต้องมากกว่า 0');
        wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.qty);
      }
    }
    for (const [pid, qty] of wanted) {
      const sold = s.lines.find((l) => l.productId === pid)?.qty ?? 0;
      if (qty > sold - (returned.get(pid) ?? 0)) throw new DomainError('invalid', 'คืนได้ไม่เกินจำนวนที่ขาย (หักที่คืนไปแล้ว)', { productId: pid, available: sold - (returned.get(pid) ?? 0) });
    }

    // Re-price what is left under the promotions of the day the bill was sold (including which were in their dates): this is how a lost "buy 2 get 1" takes the gift's value out of the refund.
    const remaining = s.lines.map((l) => ({ productId: l.productId, qty: l.qty - (returned.get(l.productId) ?? 0) - (wanted.get(l.productId) ?? 0) })).filter((l) => l.qty > 0);
    const catalog = { categories: [], products: pricing.products, premiums: pricing.premiums.map((p) => ({ ...p, stock: 1_000_000 })), promotions: pricing.promotions };
    const priceAt = (ls: { productId: string; qty: number }[], manual?: typeof pricing.manual) => priceCart(ls, catalog, { isMember: !!s.memberId, at: s.at, manual }).net;
    let remainingNet = 0;
    if (remaining.length && pricing.manual?.type === 'amount') {
      // A fixed discount belongs to the whole bill: what is kept carries its share of it, not all of it.
      // The discount actually given is on the stored bill, so gift rows in the lines cannot skew it.
      const given = manualDiscountOf(s.cart);
      const full = s.cart.net + given;
      const kept = priceAt(remaining);
      remainingNet = full > 0 ? kept - Math.round((given * kept) / full) : kept;
    } else if (remaining.length) remainingNet = priceAt(remaining, pricing.manual);
    const refundedAfter = s.cart.net - remainingNet;
    const amount = Math.max(0, refundedAfter - sum(prior.map((c) => c.state.amount)));

    const returning = [...wanted].map(([productId, qty]) => ({ productId, qty, line: s.lines.find((l) => l.productId === productId)! }));
    const amounts = allocateOverLines(amount, returning.map((r) => r.qty * r.line.unitPrice));

    // Money back follows how the customer paid; points the customer spent come back as points.
    const paid = s.payments.map((p) => ({ method: p.method, amount: p.amount }));
    const priorMoney = sum(prior.flatMap((c) => c.state.payments.map((p) => p.amount)));
    const payments = allocateOverPayments(paid, moneyShare(amount, s.cart.net, sum(paid.map((p) => p.amount)), priorMoney));
    return {
      kind, saleDocNo: s.docNo, amount, refundedAfter, payments,
      lines: returning.map((r, i) => ({ productId: r.productId, name: r.line.name, qty: r.qty, amount: amounts[i], cost: r.line.cost })),
    };
  }

  static issue(plan: CreditPlan, meta: { docNo: string; shiftId: string; now: Date; businessDate: string; reason: string; restock: boolean; employeeId: string; approvedBy: string }): CreditNote {
    return new CreditNote({
      docNo: meta.docNo, saleDocNo: plan.saleDocNo, shiftId: meta.shiftId, kind: plan.kind, at: meta.now, businessDate: meta.businessDate, amount: plan.amount, reason: meta.reason.trim(),
      restock: meta.restock, employeeId: meta.employeeId, approvedBy: meta.approvedBy, lines: plan.lines, payments: plan.payments,
    });
  }

  static restore(state: CreditNoteState): CreditNote {
    return new CreditNote(state);
  }

  get docNo() { return this.state.docNo; }

  snapshot(): Readonly<CreditNoteState> {
    return this.state;
  }
}
