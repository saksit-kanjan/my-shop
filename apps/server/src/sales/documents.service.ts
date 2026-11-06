import { Inject, Injectable } from '@nestjs/common';
import type { CreditNote, Employee, SaleRecord } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { docPeriod, iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { NumberingService } from '../database/numbering.service';
import { MembersService } from '../members/members.service';
import { CreditNotesService } from './credit-notes.service';
import { findSale, salePayments, type SaleRow } from './sale-queries';

export interface TaxInvoiceInput {
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
}

export interface SaleDetail {
  sale: SaleRecord;
  creditNotes: CreditNote[];
  taxInvoice: { docNo: string; buyerName: string; at: string } | null;
  reprints: number;
  shiftId: string;
  terminalId: string;
}

/** Closed bills as documents: look them up, print copies, issue the full tax invoice. */
@Injectable()
export class DocumentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly creditNotes: CreditNotesService,
    private readonly members: MembersService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A closed bill as it was printed, with what happened to it since. */
  async getSale(docNo: string): Promise<SaleDetail> {
    const row = await this.must(this.db, docNo);
    const [payments, notes, [tax], [reprints], [shift]] = await Promise.all([
      salePayments(this.db, docNo),
      this.creditNotes.forSale(this.db, docNo),
      this.db.query<{ doc_no: string; buyer_name: string; at: Date }>(`SELECT doc_no, buyer_name, at FROM tax_invoices WHERE sale_doc_no=$1`, [docNo]),
      this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reprints WHERE doc_no=$1`, [docNo]),
      this.db.query<{ terminal_id: string }>(`SELECT terminal_id FROM shifts WHERE id=$1`, [row.shiftId]),
    ]);
    const phone = row.memberId ? await this.members.phoneOf(row.memberId) : null;
    return {
      sale: {
        docNo, at: iso(row.at), employeeId: row.employeeId, cart: row.cart, change: row.change,
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered != null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
        ...(phone ? { memberPhone: phone, pointsEarned: row.pointsEarned } : {}),
        ...(row.pointsRedeemed > 0 ? { pointsRedeemed: row.pointsRedeemed, pointsValue: row.pointsValue } : {}),
        ...(notes.some((c) => c.type === 'void') ? { voided: true } : {}),
      },
      creditNotes: notes,
      taxInvoice: tax ? { docNo: tax.doc_no, buyerName: tax.buyer_name, at: iso(tax.at) } : null,
      reprints: reprints?.n ?? 0,
      shiftId: row.shiftId,
      terminalId: shift?.terminal_id ?? '',
    };
  }

  /** Reprint counter (spec: copies say "สำเนา" and are counted). Returns the number of this copy. */
  async reprint(docNo: string, actor: Employee, terminalId: string): Promise<number> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.must(tx, docNo);
      await tx.query(`INSERT INTO reprints (doc_no, at, employee_id) VALUES ($1,$2,$3)`, [docNo, now, actor.id]);
      const [r] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM reprints WHERE doc_no=$1`, [docNo]);
      await this.audit.record(tx, now, { actor: actor.id, terminalId, action: 'sale.reprint', entity: 'sale', entityId: docNo });
      return r.n;
    });
  }

  /** A phone number finds that member's bills; anything else matches the bill number. */
  async search(q: { term?: string; date?: string; limit?: number }) {
    const term = q.term?.trim() || null;
    const member = term ? await this.members.findByPhone(term) : null;
    const rows = await this.db.query<{ doc_no: string; at: Date; net: number; employee_id: string; voided: boolean; refunded: number }>(
      `SELECT s.doc_no, s.at, s.net, s.employee_id,
              EXISTS (SELECT 1 FROM credit_notes c WHERE c.sale_doc_no=s.doc_no AND c.type='void') AS voided,
              COALESCE((SELECT SUM(amount) FROM credit_notes c WHERE c.sale_doc_no=s.doc_no),0)::int AS refunded
         FROM sales s WHERE (($1::text IS NULL AND $2::text IS NULL) OR s.doc_no ILIKE $1 OR s.member_id = $2) AND ($3::text IS NULL OR s.business_date = $3::date)
        ORDER BY s.at DESC LIMIT $4`,
      [term ? `%${term}%` : null, member?.id ?? null, q.date ?? null, Math.min(q.limit ?? 50, 200)],
    );
    return rows.map((r) => ({ docNo: r.doc_no, at: iso(r.at), net: r.net, employeeId: r.employee_id, voided: r.voided, refunded: r.refunded }));
  }

  /** Full tax invoice on request, referencing the bill. One per bill; numbered per branch (spec). */
  async taxInvoice(saleDocNo: string, buyer: TaxInvoiceInput, actor: Employee, terminalId: string): Promise<{ docNo: string }> {
    if (!buyer.buyerName?.trim() || !buyer.buyerAddress?.trim()) throw new DomainError('invalid', 'ใส่ชื่อและที่อยู่ผู้ซื้อ');
    if (!/^\d{13}$/.test(buyer.buyerTaxId ?? '')) throw new DomainError('invalid', 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.must(tx, saleDocNo);
      if ((await tx.query(`SELECT 1 FROM tax_invoices WHERE sale_doc_no=$1`, [saleDocNo])).length) throw new DomainError('conflict', 'บิลนี้ออกใบกำกับภาษีเต็มรูปแล้ว');
      const docNo = await this.numbering.next(tx, `TI-${docPeriod(now)}`);
      await tx.query(`INSERT INTO tax_invoices (doc_no, sale_doc_no, at, buyer_name, buyer_address, buyer_tax_id, buyer_branch, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        docNo, saleDocNo, now, buyer.buyerName.trim(), buyer.buyerAddress.trim(), buyer.buyerTaxId, buyer.buyerBranch?.trim() || 'สำนักงานใหญ่', actor.id,
      ]);
      await this.audit.record(tx, now, { actor: actor.id, terminalId, action: 'sale.tax_invoice', entity: 'tax_invoice', entityId: docNo, after: { saleDocNo } });
      return { docNo };
    });
  }

  private async must(tx: Tx, docNo: string): Promise<SaleRow> {
    const row = await findSale(tx, docNo);
    if (!row) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
    return row;
  }
}
