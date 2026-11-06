import type { PaymentMethod, PricedCart } from '@my-shop/contracts';
import type { Tx } from '../database/database.types';
import type { PricingSnapshot } from './sales.types';

/** A closed bill as stored. Bills are append-only, so this is also what a refund re-prices from. */
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

interface Row {
  doc_no: string;
  shift_id: string;
  employee_id: string;
  at: Date;
  member_id: string | null;
  net: number;
  vat: number;
  change: number;
  cart: PricedCart;
  pricing: PricingSnapshot | null;
  points_earned: number;
  points_redeemed: number;
  points_value: number;
}

export const SALE_COLUMNS = `s.doc_no, s.shift_id, s.employee_id, s.at, s.member_id, s.net, s.vat, s.change, s.cart, s.pricing, s.points_earned, s.points_redeemed, s.points_value`;

export const toSaleRow = (r: Row): SaleRow => ({
  docNo: r.doc_no, shiftId: r.shift_id, employeeId: r.employee_id, at: r.at, memberId: r.member_id, net: r.net, vat: r.vat, change: r.change, cart: r.cart, pricing: r.pricing,
  pointsEarned: r.points_earned, pointsRedeemed: r.points_redeemed, pointsValue: r.points_value,
});

export type { Row as SaleDbRow };

export async function findSale(tx: Tx, docNo: string): Promise<SaleRow | null> {
  const [r] = await tx.query<Row>(`SELECT ${SALE_COLUMNS} FROM sales s WHERE s.doc_no=$1`, [docNo]);
  return r ? toSaleRow(r) : null;
}

export async function saleLines(tx: Tx, docNo: string): Promise<SaleLineRow[]> {
  const rows = await tx.query<{ product_id: string; name: string; qty: number; unit_price: number; net: number; cost: number; gift_of_product_id: string | null }>(
    `SELECT product_id, name, qty, unit_price, net, cost, gift_of_product_id FROM sale_lines WHERE doc_no=$1 ORDER BY id`,
    [docNo],
  );
  return rows.map((r) => ({ productId: r.product_id, name: r.name, qty: r.qty, unitPrice: r.unit_price, net: r.net, cost: r.cost, giftOfProductId: r.gift_of_product_id }));
}

export function salePayments(tx: Tx, docNo: string): Promise<PaymentRow[]> {
  return tx.query<PaymentRow>(`SELECT doc_no AS "docNo", method, amount, tendered, reference FROM payments WHERE doc_no=$1 ORDER BY id`, [docNo]);
}
