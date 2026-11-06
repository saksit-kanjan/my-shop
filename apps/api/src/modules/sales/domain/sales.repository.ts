import type { PaymentMethod, PricedCart } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import type { PricingSnapshot } from './sales.types';

export interface SaleRow {
  docNo: string;
  shiftId: string;
  employeeId: string;
  at: Date;
  memberId: string | null;
  net: number;
  vat: number;
  change: number;
  cart: PricedCart;
  pricing: PricingSnapshot | null;
  pointsEarned: number;
  pointsRedeemed: number;
  pointsValue: number;
}

export interface NewSale extends Omit<SaleRow, 'cart' | 'pricing'> {
  businessDate: string;
  gross: number;
  discount: number;
  cart: PricedCart;
  pricing: PricingSnapshot;
  exchangeFor: string | null;
}

export interface SaleLineRow {
  productId: string;
  name: string;
  qty: number;
  unitPrice: number;
  net: number;
  cost: number;
  giftOfProductId: string | null;
}

export interface PaymentRow {
  docNo: string;
  method: PaymentMethod;
  amount: number;
  tendered: number | null;
  reference: string | null;
}

export interface SaleSummaryRow {
  docNo: string;
  at: Date;
  net: number;
  employeeId: string;
  voided: boolean;
  refunded: number;
}

/** Port: closed bills, their lines and payments, tax invoices and reprints. All of it is append-only. */
export abstract class SalesRepository {
  abstract insert(tx: Tx, s: NewSale): Promise<void>;
  abstract insertLine(tx: Tx, docNo: string, l: { productId: string; name: string; qty: number; unitPrice: number; gross: number; discount: number; net: number; applied: unknown; giftOfProductId: string | null; cost: number }): Promise<void>;
  abstract insertPayment(tx: Tx, docNo: string, p: { method: PaymentMethod; amount: number; tendered: number | null; reference: string | null }): Promise<void>;

  abstract find(tx: Tx, docNo: string): Promise<SaleRow | null>;
  abstract lines(tx: Tx, docNo: string): Promise<SaleLineRow[]>;
  abstract payments(tx: Tx, docNo: string): Promise<PaymentRow[]>;
  abstract ofShift(tx: Tx, shiftId: string): Promise<(SaleRow & { voided: boolean })[]>;
  abstract paymentsOfShift(tx: Tx, shiftId: string): Promise<PaymentRow[]>;
  abstract search(tx: Tx, q: { term: string | null; memberId: string | null; date: string | null; limit: number }): Promise<SaleSummaryRow[]>;

  abstract addReprint(tx: Tx, docNo: string, at: Date, employeeId: string): Promise<number>;
  abstract reprintCount(tx: Tx, docNo: string): Promise<number>;
  abstract taxInvoice(tx: Tx, docNo: string): Promise<{ docNo: string; buyerName: string; at: Date } | null>;
  abstract insertTaxInvoice(tx: Tx, t: { docNo: string; saleDocNo: string; at: Date; buyerName: string; buyerAddress: string; buyerTaxId: string; buyerBranch: string; issuedBy: string }): Promise<void>;
}
