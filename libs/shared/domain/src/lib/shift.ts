import type { CashMoveType, Shift, ShiftSummary } from '@my-shop/contracts';
import { vatIncluded } from './money';

export function summarizeShift(shift: Shift): ShiftSummary {
  const byMethod: ShiftSummary['byMethod'] = { cash: 0, promptpay: 0, card: 0, transfer: 0 };
  let gross = 0;
  let discount = 0;
  let net = 0;
  let vat = 0;
  for (const s of shift.sales) {
    gross += s.cart.gross;
    discount += s.cart.discount;
    net += s.cart.net;
    vat += s.cart.vat;
    for (const p of s.payments) byMethod[p.method] += p.amount;
  }
  // Voids and refunds are new documents; the day's figures are net of them (spec: "หักยกเลิกและคืนสินค้า").
  let refunds = 0;
  let cashRefunds = 0;
  let voids = 0;
  for (const cn of shift.creditNotes ?? []) {
    refunds += cn.amount;
    net -= cn.amount;
    vat -= vatIncluded(cn.amount);
    if (cn.type === 'void') voids += 1;
    for (const p of cn.payments) {
      byMethod[p.method] -= p.amount;
      if (p.method === 'cash') cashRefunds += p.amount;
    }
  }
  const sum = (t: CashMoveType) => shift.cashMoves.filter((m) => m.type === t).reduce((a, m) => a + m.amount, 0);
  const cashIn = sum('in');
  const cashOut = sum('out');
  const cashDrop = sum('drop');
  return {
    bills: shift.sales.length - voids,
    gross,
    discount,
    net,
    vat,
    byMethod,
    cashSales: byMethod.cash + cashRefunds,
    cashIn,
    cashOut,
    cashDrop,
    refunds,
    cashRefunds,
    // byMethod.cash is already net of cash refunds.
    expectedCash: shift.float + byMethod.cash + cashIn - cashOut - cashDrop,
  };
}
