import { Injectable } from '@nestjs/common';
import type { PaymentMethod, PricedCart } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import { SalesRepository, type NewSale, type PaymentRow, type SaleLineRow, type SaleRow, type SaleSummaryRow } from '../domain/sales.repository';
import type { PricingSnapshot } from '../domain/sales.types';

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

const COLS = `s.doc_no, s.shift_id, s.employee_id, s.at, s.member_id, s.net, s.vat, s.change, s.cart, s.pricing, s.points_earned, s.points_redeemed, s.points_value`;
const toSale = (r: Row): SaleRow => ({ docNo: r.doc_no, shiftId: r.shift_id, employeeId: r.employee_id, at: r.at, memberId: r.member_id, net: r.net, vat: r.vat, change: r.change, cart: r.cart, pricing: r.pricing, pointsEarned: r.points_earned, pointsRedeemed: r.points_redeemed, pointsValue: r.points_value });
const VOIDED = `EXISTS (SELECT 1 FROM credit_notes c WHERE c.sale_doc_no=s.doc_no AND c.type='void')`;

@Injectable()
export class PgSalesRepository extends SalesRepository {
  async insert(tx: Tx, s: NewSale) {
    await tx.query(
      `INSERT INTO sales (doc_no, shift_id, employee_id, at, business_date, member_id, gross, discount, net, vat, change, cart, pricing, points_earned, points_redeemed, points_value, exchange_for)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [s.docNo, s.shiftId, s.employeeId, s.at, s.businessDate, s.memberId, s.gross, s.discount, s.net, s.vat, s.change, JSON.stringify(s.cart), JSON.stringify(s.pricing), s.pointsEarned, s.pointsRedeemed, s.pointsValue, s.exchangeFor],
    );
  }

  async insertLine(tx: Tx, docNo: string, l: { productId: string; name: string; qty: number; unitPrice: number; gross: number; discount: number; net: number; applied: unknown; giftOfProductId: string | null; cost: number }) {
    await tx.query(`INSERT INTO sale_lines (doc_no, product_id, name, qty, unit_price, gross, discount, net, applied, gift_of_product_id, cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      docNo, l.productId, l.name, l.qty, l.unitPrice, l.gross, l.discount, l.net, JSON.stringify(l.applied), l.giftOfProductId, l.cost,
    ]);
  }

  async insertPayment(tx: Tx, docNo: string, p: { method: PaymentMethod; amount: number; tendered: number | null; reference: string | null }) {
    await tx.query(`INSERT INTO payments (doc_no, method, amount, tendered, reference) VALUES ($1,$2,$3,$4,$5)`, [docNo, p.method, p.amount, p.tendered, p.reference]);
  }

  async find(tx: Tx, docNo: string) {
    const [r] = await tx.query<Row>(`SELECT ${COLS} FROM sales s WHERE s.doc_no=$1`, [docNo]);
    return r ? toSale(r) : null;
  }

  async lines(tx: Tx, docNo: string): Promise<SaleLineRow[]> {
    const rows = await tx.query<{ product_id: string; name: string; qty: number; unit_price: number; net: number; cost: number; gift_of_product_id: string | null }>(`SELECT product_id, name, qty, unit_price, net, cost, gift_of_product_id FROM sale_lines WHERE doc_no=$1 ORDER BY id`, [docNo]);
    return rows.map((r) => ({ productId: r.product_id, name: r.name, qty: r.qty, unitPrice: r.unit_price, net: r.net, cost: r.cost, giftOfProductId: r.gift_of_product_id }));
  }

  payments(tx: Tx, docNo: string): Promise<PaymentRow[]> {
    return tx.query<PaymentRow>(`SELECT doc_no AS "docNo", method, amount, tendered, reference FROM payments WHERE doc_no=$1 ORDER BY id`, [docNo]);
  }

  async ofShift(tx: Tx, shiftId: string) {
    const rows = await tx.query<Row & { voided: boolean }>(`SELECT ${COLS}, ${VOIDED} AS voided FROM sales s WHERE s.shift_id=$1 ORDER BY s.at, s.doc_no`, [shiftId]);
    return rows.map((r) => ({ ...toSale(r), voided: r.voided }));
  }

  paymentsOfShift(tx: Tx, shiftId: string): Promise<PaymentRow[]> {
    return tx.query<PaymentRow>(`SELECT p.doc_no AS "docNo", p.method, p.amount, p.tendered, p.reference FROM payments p JOIN sales s ON s.doc_no=p.doc_no WHERE s.shift_id=$1 ORDER BY p.id`, [shiftId]);
  }

  async search(tx: Tx, q: { term: string | null; memberId: string | null; date: string | null; limit: number }): Promise<SaleSummaryRow[]> {
    const rows = await tx.query<{ doc_no: string; at: Date; net: number; employee_id: string; voided: boolean; refunded: number }>(
      `SELECT s.doc_no, s.at, s.net, s.employee_id, ${VOIDED} AS voided, COALESCE((SELECT SUM(amount) FROM credit_notes c WHERE c.sale_doc_no=s.doc_no),0)::int AS refunded
         FROM sales s WHERE (($1::text IS NULL AND $2::text IS NULL) OR s.doc_no ILIKE $1 OR s.member_id = $2) AND ($3::text IS NULL OR s.business_date = $3::date) ORDER BY s.at DESC LIMIT $4`,
      [q.term, q.memberId, q.date, q.limit],
    );
    return rows.map((r) => ({ docNo: r.doc_no, at: r.at, net: r.net, employeeId: r.employee_id, voided: r.voided, refunded: r.refunded }));
  }

  async addReprint(tx: Tx, docNo: string, at: Date, employeeId: string) {
    await tx.query(`INSERT INTO reprints (doc_no, at, employee_id) VALUES ($1,$2,$3)`, [docNo, at, employeeId]);
    return this.reprintCount(tx, docNo);
  }

  async reprintCount(tx: Tx, docNo: string) {
    const [r] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM reprints WHERE doc_no=$1`, [docNo]);
    return r?.n ?? 0;
  }

  async taxInvoice(tx: Tx, docNo: string) {
    const [r] = await tx.query<{ doc_no: string; buyer_name: string; at: Date }>(`SELECT doc_no, buyer_name, at FROM tax_invoices WHERE sale_doc_no=$1`, [docNo]);
    return r ? { docNo: r.doc_no, buyerName: r.buyer_name, at: r.at } : null;
  }

  async insertTaxInvoice(tx: Tx, t: { docNo: string; saleDocNo: string; at: Date; buyerName: string; buyerAddress: string; buyerTaxId: string; buyerBranch: string; issuedBy: string }) {
    await tx.query(`INSERT INTO tax_invoices (doc_no, sale_doc_no, at, buyer_name, buyer_address, buyer_tax_id, buyer_branch, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [t.docNo, t.saleDocNo, t.at, t.buyerName, t.buyerAddress, t.buyerTaxId, t.buyerBranch, t.issuedBy]);
  }
}
