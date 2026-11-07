import type { PaymentMethod, PricedCart } from '@my-shop/contracts';
import type { Tx } from '../database/database.types';
import { PaymentEntity, SaleEntity, SaleLineEntity } from './entities/sales.entities';
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

export const toSaleRow = (r: SaleEntity): SaleRow => ({
  docNo: r.docNo, shiftId: r.shiftId, employeeId: r.employeeId, at: r.at, memberId: r.memberId, net: r.net, vat: r.vat, change: r.change, cart: r.cart as PricedCart, pricing: r.pricing as PricingSnapshot | null,
  pointsEarned: r.pointsEarned, pointsRedeemed: r.pointsRedeemed, pointsValue: r.pointsValue,
});

export async function findSale(tx: Tx, docNo: string): Promise<SaleRow | null> {
  const r = await tx.findOneBy(SaleEntity, { docNo });
  return r ? toSaleRow(r) : null;
}

export async function saleLines(tx: Tx, docNo: string): Promise<SaleLineRow[]> {
  const rows = await tx.find(SaleLineEntity, { where: { docNo }, order: { id: 'ASC' } });
  return rows.map((r) => ({ productId: r.productId, name: r.name, qty: r.qty, unitPrice: r.unitPrice, net: r.net, cost: r.cost, giftOfProductId: r.giftOfProductId }));
}

export async function salePayments(tx: Tx, docNo: string): Promise<PaymentRow[]> {
  return (await tx.find(PaymentEntity, { where: { docNo }, order: { id: 'ASC' } })).map(toPaymentRow);
}

export const toPaymentRow = (p: PaymentEntity): PaymentRow => ({ docNo: p.docNo, method: p.method, amount: p.amount, tendered: p.tendered, reference: p.reference });
