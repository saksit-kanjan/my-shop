import { DomainError } from '../common/domain-error';

export interface PointsRules {
  /** Satang of net sales that earn one point. */
  earnSatang: number;
  /** Satang one point is worth when redeemed. */
  valueSatang: number;
  /** Months until earned points expire; 0 = never. */
  expiryMonths: number;
}

/** Points earned on a bill: net after discounts and points, rounded down (spec: "ปัดเศษลง"). */
export const pointsEarned = (net: number, r: PointsRules): number => (r.earnSatang > 0 ? Math.floor(net / r.earnSatang) : 0);

export function expiryDate(now: Date, r: PointsRules): Date | null {
  return r.expiryMonths > 0 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + r.expiryMonths, now.getUTCDate())) : null;
}

/** Baht value (satang) of spending `points` against a bill of `net`. Checks the balance and that it does not exceed the bill. */
export function redemptionValue(points: number, balance: number, net: number, r: PointsRules): number {
  if (!Number.isInteger(points) || points < 0) throw new DomainError('invalid', 'จำนวนแต้มที่ใช้ไม่ถูกต้อง');
  if (points > balance) throw new DomainError('invalid', 'แต้มไม่พอ');
  const value = points * r.valueSatang;
  if (value > net) throw new DomainError('invalid', 'ใช้แต้มเกินยอดบิล', { maxPoints: Math.floor(net / Math.max(1, r.valueSatang)) });
  return value;
}

export interface PriorAdjustments {
  /** Points already taken back (negative sum) and given back (positive sum) by earlier credit notes of the same bill. */
  clawed: number;
  returned: number;
}

/**
 * What a credit note does to points (spec): points earned on the bill are taken back in proportion to the share refunded,
 * points the customer spent come back in proportion. Cumulative, so several part refunds add up to the same total.
 */
export function refundAdjustment(args: { earned: number; redeemed: number; saleNet: number; refundedAfter: number }, prior: PriorAdjustments): { claw: number; back: number } {
  const { earned, redeemed, saleNet, refundedAfter } = args;
  if (saleNet <= 0) return { claw: 0, back: 0 };
  const targetClaw = Math.min(earned, Math.round((earned * refundedAfter) / saleNet));
  const targetBack = Math.min(redeemed, Math.round((redeemed * refundedAfter) / saleNet));
  return { claw: Math.max(0, targetClaw - Math.abs(prior.clawed)), back: Math.max(0, targetBack - prior.returned) };
}
