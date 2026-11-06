import { Inject, Injectable } from '@nestjs/common';
import type { CreditNote, Employee, SaleRecord } from '@my-shop/contracts';
import { AuditLog } from '../../../shared/audit/audit-log';
import { UnitOfWork, type Tx } from '../../../shared/database/unit-of-work';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { docPeriod, iso } from '../../../shared/kernel/dates';
import { DomainError } from '../../../shared/kernel/domain-error';
import { DocumentNumbers } from '../../../shared/numbering/document-numbers';
import { MembershipService } from '../../membership/application/membership.service';
import { CreditNoteRepository } from '../domain/credit-note.repository';
import { SalesRepository, type SaleRow } from '../domain/sales.repository';
import { ShiftRepository } from '../domain/shift.repository';

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
export class SalesDocumentService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(SalesRepository) private readonly sales: SalesRepository,
    @Inject(CreditNoteRepository) private readonly creditNotes: CreditNoteRepository,
    @Inject(ShiftRepository) private readonly shifts: ShiftRepository,
    @Inject(MembershipService) private readonly members: MembershipService,
    @Inject(DocumentNumbers) private readonly numbers: DocumentNumbers,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A closed bill as it was printed, with what happened to it since. */
  async getSale(docNo: string): Promise<SaleDetail> {
    const read = this.uow.read;
    const row = await this.must(read, docNo);
    const [payments, notes, tax, reprints, shift] = await Promise.all([this.sales.payments(read, docNo), this.creditNotes.forSale(read, docNo), this.sales.taxInvoice(read, docNo), this.sales.reprintCount(read, docNo), this.shifts.find(read, row.shiftId)]);
    const phone = row.memberId ? await this.members.phoneOf(row.memberId, read) : null;
    return {
      sale: {
        docNo, at: iso(row.at), employeeId: row.employeeId, cart: row.cart, change: row.change,
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered != null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
        ...(phone ? { memberPhone: phone, pointsEarned: row.pointsEarned } : {}),
        ...(row.pointsRedeemed > 0 ? { pointsRedeemed: row.pointsRedeemed, pointsValue: row.pointsValue } : {}),
        ...(notes.some((c) => c.type === 'void') ? { voided: true } : {}),
      },
      creditNotes: notes,
      taxInvoice: tax ? { docNo: tax.docNo, buyerName: tax.buyerName, at: iso(tax.at) } : null,
      reprints,
      shiftId: row.shiftId,
      terminalId: shift?.terminalId ?? '',
    };
  }

  /** Reprint counter (spec: copies say "สำเนา" and are counted). Returns the number of this copy. */
  async reprint(docNo: string, actor: Employee, terminalId: string): Promise<number> {
    const now = this.clock();
    return this.uow.run(async (tx) => {
      await this.must(tx, docNo);
      const copy = await this.sales.addReprint(tx, docNo, now, actor.id);
      await this.audit.record(tx, now, { actor: actor.id, terminalId, action: 'sale.reprint', entity: 'sale', entityId: docNo });
      return copy;
    });
  }

  async search(q: { term?: string; date?: string; limit?: number }) {
    const read = this.uow.read;
    const term = q.term?.trim() || null;
    // A phone number finds that member's bills; anything else matches the bill number.
    const member = term ? await this.members.findByPhone(term, read) : null;
    const rows = await this.sales.search(read, { term: term ? `%${term}%` : null, memberId: member?.id ?? null, date: q.date ?? null, limit: Math.min(q.limit ?? 50, 200) });
    return rows.map((r) => ({ docNo: r.docNo, at: iso(r.at), net: r.net, employeeId: r.employeeId, voided: r.voided, refunded: r.refunded }));
  }

  /** Full tax invoice on request, referencing the bill. One per bill; numbered per branch (spec). */
  async taxInvoice(saleDocNo: string, buyer: TaxInvoiceInput, actor: Employee, terminalId: string): Promise<{ docNo: string }> {
    if (!buyer.buyerName?.trim() || !buyer.buyerAddress?.trim()) throw new DomainError('invalid', 'ใส่ชื่อและที่อยู่ผู้ซื้อ');
    if (!/^\d{13}$/.test(buyer.buyerTaxId ?? '')) throw new DomainError('invalid', 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
    const now = this.clock();
    return this.uow.run(async (tx) => {
      await this.must(tx, saleDocNo);
      if (await this.sales.taxInvoice(tx, saleDocNo)) throw new DomainError('conflict', 'บิลนี้ออกใบกำกับภาษีเต็มรูปแล้ว');
      const docNo = await this.numbers.format(tx, `TI-${docPeriod(now)}`);
      await this.sales.insertTaxInvoice(tx, { docNo, saleDocNo, at: now, buyerName: buyer.buyerName.trim(), buyerAddress: buyer.buyerAddress.trim(), buyerTaxId: buyer.buyerTaxId, buyerBranch: buyer.buyerBranch?.trim() || 'สำนักงานใหญ่', issuedBy: actor.id });
      await this.audit.record(tx, now, { actor: actor.id, terminalId, action: 'sale.tax_invoice', entity: 'tax_invoice', entityId: docNo, after: { saleDocNo } });
      return { docNo };
    });
  }

  private async must(tx: Tx, docNo: string): Promise<SaleRow> {
    const row = await this.sales.find(tx, docNo);
    if (!row) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
    return row;
  }
}
