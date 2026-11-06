import type { Satang } from '@my-shop/contracts';

export const VAT_RATE_PERCENT = 7;

/** Baht to satang, rounding to the nearest satang. */
export function baht(amount: number): Satang {
  return Math.round(amount * 100);
}

const nf0 = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Short display form for screens: ฿159 or ฿8.50. */
export function formatBaht(value: Satang): string {
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  return sign + '฿' + (abs % 100 === 0 ? nf0.format(abs / 100) : nf2.format(abs / 100));
}

/** Full form for receipts and reports: ฿159.00. */
export function formatBahtFull(value: Satang): string {
  const sign = value < 0 ? '−' : '';
  return sign + '฿' + nf2.format(Math.abs(value) / 100);
}

/** VAT contained in a VAT-inclusive amount. */
export function vatIncluded(gross: Satang): Satang {
  return Math.round((gross * VAT_RATE_PERCENT) / (100 + VAT_RATE_PERCENT));
}

/** Parse what the cashier typed on the keypad (whole baht) into satang. */
export function keypadToSatang(digits: string): Satang {
  const n = parseInt(digits || '0', 10);
  return Number.isFinite(n) ? n * 100 : 0;
}
