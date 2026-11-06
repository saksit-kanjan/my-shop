import { Injectable } from '@nestjs/common';
import type { CreditNote, PaymentMethod } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import { iso } from '../../../shared/kernel/dates';
import { CreditNoteRepository, type NewCreditNote } from '../domain/credit-note.repository';

interface Head {
  doc_no: string;
  sale_doc_no: string;
  at: Date;
  type: 'void' | 'refund';
  amount: number;
  reason: string;
  restock: boolean;
  employee_id: string;
  approved_by: string;
}

@Injectable()
export class PgCreditNoteRepository extends CreditNoteRepository {
  async insert(tx: Tx, n: NewCreditNote) {
    await tx.query(`INSERT INTO credit_notes (doc_no, sale_doc_no, shift_id, type, at, business_date, amount, reason, restock, employee_id, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      n.docNo, n.saleDocNo, n.shiftId, n.type, n.at, n.businessDate, n.amount, n.reason, n.restock, n.employeeId, n.approvedBy,
    ]);
    for (const l of n.lines) await tx.query(`INSERT INTO credit_note_lines (doc_no, product_id, name, qty, amount, cost) VALUES ($1,$2,$3,$4,$5,$6)`, [n.docNo, l.productId, l.name, l.qty, l.amount, l.cost]);
    for (const p of n.payments) await tx.query(`INSERT INTO credit_note_payments (doc_no, method, amount) VALUES ($1,$2,$3)`, [n.docNo, p.method, p.amount]);
  }

  forSale(tx: Tx, saleDocNo: string) {
    return this.load(tx, `WHERE sale_doc_no=$1`, saleDocNo);
  }

  ofShift(tx: Tx, shiftId: string) {
    return this.load(tx, `WHERE shift_id=$1`, shiftId);
  }

  async exists(tx: Tx, docNo: string) {
    return (await tx.query(`SELECT 1 FROM credit_notes WHERE doc_no=$1`, [docNo])).length > 0;
  }

  private async load(tx: Tx, where: string, param: string): Promise<CreditNote[]> {
    const heads = await tx.query<Head>(`SELECT doc_no, sale_doc_no, at, type, amount, reason, restock, employee_id, approved_by FROM credit_notes ${where} ORDER BY at, doc_no`, [param]);
    if (heads.length === 0) return [];
    const docs = heads.map((h) => h.doc_no);
    const [lines, pays] = await Promise.all([
      tx.query<{ doc_no: string; product_id: string; name: string; qty: number; amount: number }>(`SELECT doc_no, product_id, name, qty, amount FROM credit_note_lines WHERE doc_no = ANY($1) ORDER BY id`, [docs]),
      tx.query<{ doc_no: string; method: PaymentMethod; amount: number }>(`SELECT doc_no, method, amount FROM credit_note_payments WHERE doc_no = ANY($1) ORDER BY id`, [docs]),
    ]);
    return heads.map((h) => ({
      docNo: h.doc_no, at: iso(h.at), type: h.type, saleDocNo: h.sale_doc_no, amount: h.amount, reason: h.reason, employeeId: h.employee_id, approvedBy: h.approved_by, restock: h.restock,
      payments: pays.filter((p) => p.doc_no === h.doc_no).map((p) => ({ method: p.method, amount: p.amount })),
      lines: lines.filter((l) => l.doc_no === h.doc_no).map((l) => ({ productId: l.product_id, name: l.name, qty: l.qty, amount: l.amount })),
    }));
  }
}
