import type { PaymentMethod } from '@my-shop/contracts';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** Spreads `amount` over lines in proportion to `weights` (shelf price x quantity); the remainder goes to the first line. */
export function allocateOverLines(amount: number, weights: number[]): number[] {
  const total = sum(weights) || 1;
  const parts = weights.map((w) => Math.floor((amount * w) / total));
  if (parts.length) parts[0] += amount - sum(parts);
  return parts;
}

/** Splits money back over the original payment methods in proportion; the remainder goes to the first. Zero parts are dropped. */
export function allocateOverPayments(paid: { method: PaymentMethod; amount: number }[], total: number): { method: PaymentMethod; amount: number }[] {
  const all = sum(paid.map((p) => p.amount)) || 1;
  const parts = paid.map((p) => ({ method: p.method, amount: Math.floor((total * p.amount) / all) }));
  if (parts.length) parts[0].amount += total - sum(parts.map((p) => p.amount));
  return parts.filter((p) => p.amount > 0);
}

/**
 * The part of a refund paid back in money: the customer paid `paidTotal` of a bill worth `saleNet` (the rest was points),
 * and never gets back more money than they paid across all credit notes.
 */
export function moneyShare(amount: number, saleNet: number, paidTotal: number, alreadyRefundedMoney: number): number {
  return Math.min(saleNet === 0 ? 0 : Math.round((amount * paidTotal) / saleNet), paidTotal - alreadyRefundedMoney);
}

/** Past the refund window the return needs a manager (spec: "เกินกำหนดต้องให้ผู้จัดการอนุมัติ"). */
export const isLateReturn = (soldAt: Date, now: Date, refundDays: number): boolean => refundDays > 0 && (now.getTime() - soldAt.getTime()) / 86_400_000 > refundDays;
