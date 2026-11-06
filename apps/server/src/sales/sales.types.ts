import type { ManualDiscount, Product, Promotion, SaleRecord } from '@my-shop/contracts';

export interface SaleInput extends Omit<SaleRecord, 'docNo' | 'at'> {
  /** Credit-note number of the goods being exchanged, when this bill pays for a replacement (spec: เปลี่ยนสินค้า). */
  exchangeFor?: string;
  /** A discount given by hand. Over the store's cap it needs a supervisor's code in `approverCode`. */
  manualDiscount?: ManualDiscount;
  approverCode?: string;
}

/** Prices and promotions as they were when the bill closed, kept so a refund re-prices against the same rules. */
export interface PricingSnapshot {
  products: Product[];
  promotions: Promotion[];
  premiums: { id: string; name: string }[];
  /** The manual discount of the bill, so a refund re-prices with it. */
  manual?: ManualDiscount;
}
