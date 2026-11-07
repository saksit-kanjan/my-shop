import type { AppliedPromo, ManualDiscount, Payment, PricedCart, Satang } from '@my-shop/contracts';
import { manualDiscountOf, overManualCap } from '@my-shop/domain';
import { DomainError } from '../../common/domain-error';
import { changeFor, checkPayments } from '../payment-rules';
import type { PricingSnapshot } from '../sales.types';

export interface SaleLine {
  productId: string;
  name: string;
  qty: number;
  unitPrice: Satang;
  gross: Satang;
  discount: Satang;
  net: Satang;
  applied: AppliedPromo[];
  giftOfProductId: string | null;
  /** Average cost when the bill closed, for the gross-profit report. */
  cost: Satang;
}

export interface ManualDiscountRecord {
  amount: Satang;
  reason: string;
  /** Who stood behind a discount over the cap; null when it was within the cap. */
  approvedBy: string | null;
}

export interface SaleState {
  docNo: string;
  shiftId: string;
  employeeId: string;
  at: Date;
  businessDate: string;
  memberId: string | null;
  cart: PricedCart;
  pricing: PricingSnapshot;
  lines: SaleLine[];
  payments: Payment[];
  change: Satang;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsValue: Satang;
  exchangeFor: string | null;
  manual: ManualDiscountRecord | null;
}

export interface CloseSaleInput {
  docNo: string;
  shiftId: string;
  employeeId: string;
  now: Date;
  businessDate: string;
  memberId: string | null;
  /** The cart as the SERVER priced it: its numbers win over the till's (CLAUDE.md rule 2). */
  cart: PricedCart;
  pricing: PricingSnapshot;
  costs: ReadonlyMap<string, Satang>;
  payments: Payment[];
  pointsRedeemed: number;
  pointsValue: Satang;
  pointsEarned: number;
  exchangeFor?: string;
  manual?: ManualDiscount;
  capPercent: number;
  /** Someone who may discount over the cap (the cashier's own role, or a supervisor whose code came with the bill). */
  discountApprover: string | null;
}

/**
 * Aggregate root: a CLOSED bill. It exists only already complete and is never changed afterwards (CLAUDE.md rule 3): a void
 * or refund is a new document that points at it. Closing checks that the payments cover what is due exactly and that a
 * discount over the cap has someone's approval.
 */
export class Sale {
  private constructor(private readonly state: SaleState) {}

  /** A hand-given discount must say how much and why. Checked first, before any work is done for the bill. */
  static assertManualDiscountValid(manual: ManualDiscount | undefined): void {
    if (manual && (!manual.reason?.trim() || !Number.isInteger(manual.value) || manual.value < 1 || (manual.type === 'percent' && manual.value > 100))) {
      throw new DomainError('invalid', 'ส่วนลดพิเศษต้องมีจำนวนที่ถูกต้องและเหตุผล');
    }
  }

  /** Over the store's cap a discount needs someone with `discount.over_cap`. */
  static assertManualDiscountApproved(cart: PricedCart, capPercent: number, approved: boolean): boolean {
    const over = overManualCap(cart, capPercent);
    if (over && !approved) throw new DomainError('forbidden', 'ส่วนลดเกินเพดาน ต้องให้หัวหน้ากะใส่รหัสอนุมัติ', { needsApproval: 'discount.over_cap', capPercent });
    return over;
  }

  static close(input: CloseSaleInput): Sale {
    if (input.cart.lines.length === 0) throw new DomainError('invalid', 'บิลนี้ยังไม่มีสินค้า');
    const overCap = Sale.assertManualDiscountApproved(input.cart, input.capPercent, input.discountApprover !== null);
    const due = input.cart.net - input.pointsValue;
    const payments = checkPayments(input.payments, due);
    const amount = manualDiscountOf(input.cart);
    return new Sale({
      docNo: input.docNo, shiftId: input.shiftId, employeeId: input.employeeId, at: input.now, businessDate: input.businessDate, memberId: input.memberId,
      cart: input.cart, pricing: input.pricing,
      lines: input.cart.lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, gross: l.gross, discount: l.discount, net: l.net, applied: l.applied, giftOfProductId: l.giftOfProductId ?? null, cost: input.costs.get(l.productId) ?? 0 })),
      payments, change: changeFor(payments), pointsEarned: input.pointsEarned, pointsRedeemed: input.pointsRedeemed, pointsValue: input.pointsValue, exchangeFor: input.exchangeFor ?? null,
      manual: amount > 0 ? { amount, reason: (input.manual?.reason ?? '').trim(), approvedBy: overCap ? input.discountApprover : null } : null,
    });
  }

  static restore(state: SaleState): Sale {
    return new Sale(state);
  }

  get docNo() { return this.state.docNo; }
  get net() { return this.state.cart.net; }
  get memberId() { return this.state.memberId; }
  get at() { return this.state.at; }
  get shiftId() { return this.state.shiftId; }
  get manualDiscount() { return this.state.manual?.amount ?? 0; }

  snapshot(): Readonly<SaleState> {
    return this.state;
  }
}
