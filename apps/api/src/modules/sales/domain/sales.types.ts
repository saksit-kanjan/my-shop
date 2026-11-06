import type { Product, Promotion, SaleRecord } from '@my-shop/contracts';

export interface SaleInput extends Omit<SaleRecord, 'docNo' | 'at'> {
  /** Credit-note number of the goods being exchanged, when this bill pays for a replacement (spec: เปลี่ยนสินค้า). */
  exchangeFor?: string;
}

/** Prices and promotions as they were when the bill closed, kept so a refund re-prices against the same rules. */
export interface PricingSnapshot {
  products: Product[];
  promotions: Promotion[];
  premiums: { id: string; name: string }[];
}
