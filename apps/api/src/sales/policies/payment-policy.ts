import type { Payment, PaymentMethod } from '@my-shop/contracts';
import { DomainError } from '../../common/errors/domain-error';

const METHODS: PaymentMethod[] = ['cash', 'promptpay', 'card', 'transfer'];

/** Checks the payments of a bill against what is due (net less any points spent). Exact, or the bill does not close. */
export function checkPayments(payments: Payment[], due: number): Payment[] {
  if (due === 0 && payments.length === 0) return [];
  if (!Array.isArray(payments) || payments.length === 0) throw new DomainError('invalid', 'ยังไม่ได้เลือกวิธีชำระเงิน');
  for (const p of payments) {
    if (!METHODS.includes(p.method) || !Number.isInteger(p.amount) || p.amount <= 0) throw new DomainError('invalid', 'ข้อมูลการชำระเงินไม่ถูกต้อง');
    if (p.tendered !== undefined && (p.method !== 'cash' || !Number.isInteger(p.tendered) || p.tendered < p.amount)) throw new DomainError('invalid', 'เงินที่รับมาน้อยกว่ายอดที่ต้องชำระ');
    if (p.method === 'card' && !(p.reference && p.reference.trim().length >= 4)) throw new DomainError('invalid', 'ใส่เลขอนุมัติบัตร (approval code)');
  }
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  if (paid !== due) throw new DomainError('invalid', paid < due ? 'ยอดที่ชำระยังไม่ครบ' : 'ยอดที่ชำระเกินยอดบิล', { net: due, paid });
  return payments;
}

/** Change handed back: what cash was tendered beyond what it paid. */
export const changeFor = (payments: Payment[]): number => payments.reduce((s, p) => s + (p.method === 'cash' && p.tendered ? Math.max(0, p.tendered - p.amount) : 0), 0);
