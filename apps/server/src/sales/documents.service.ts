import { Inject, Injectable } from '@nestjs/common';
import { Brackets, In } from 'typeorm';
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
import { CreditNoteEntity, Reprint, SaleEntity, ShiftEntity, TaxInvoiceEntity } from './entities/sales.entities';
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
    const row = await this.must(this.db.manager, docNo);
    const [payments, notes, tax, reprints, shift] = await Promise.all([
      salePayments(this.db.manager, docNo),
      this.creditNotes.forSale(this.db.manager, docNo),
      this.db.manager.findOneBy(TaxInvoiceEntity, { saleDocNo: docNo }),
      this.db.manager.countBy(Reprint, { docNo }),
      this.db.manager.findOneBy(ShiftEntity, { id: row.shiftId }),
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
      taxInvoice: tax ? { docNo: tax.docNo, buyerName: tax.buyerName, at: iso(tax.at) } : null,
      reprints,
      shiftId: row.shiftId,
      terminalId: shift?.terminalId ?? '',
    };
  }

  /** Reprint counter (spec: copies say "สำเนา" and are counted). Returns the number of this copy. */
  async reprint(docNo: string, actor: Employee, terminalId: string): Promise<number> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.must(tx, docNo);
      await tx.insert(Reprint, { docNo, at: now, employeeId: actor.id });
      const copies = await tx.countBy(Reprint, { docNo });
      await this.audit.record(tx, now, { actor: actor.id, terminalId, action: 'sale.reprint', entity: 'sale', entityId: docNo });
      return copies;
    });
  }

  /** A phone number finds that member's bills; anything else matches the bill number. */
  async search(q: { term?: string; date?: string; limit?: number }) {
    const term = q.term?.trim() || null;
    const member = term ? await this.members.findByPhone(term) : null;
    const qb = this.db.manager.createQueryBuilder(SaleEntity, 's').orderBy('s.at', 'DESC').limit(Math.min(q.limit ?? 50, 200));
    if (term) qb.andWhere(new Brackets((w) => { w.where('s.doc_no ILIKE :like', { like: `%${term}%` }); if (member) w.orWhere('s.member_id = :memberId', { memberId: member.id }); }));
    if (q.date) qb.andWhere('s.business_date = :date', { date: q.date });
    const sales = await qb.getMany();
    const notes = sales.length ? await this.db.manager.find(CreditNoteEntity, { where: { saleDocNo: In(sales.map((x) => x.docNo)) }, select: { saleDocNo: true, type: true, amount: true } }) : [];
    return sales.map((r) => {
      const mine = notes.filter((c) => c.saleDocNo === r.docNo);
      return { docNo: r.docNo, at: iso(r.at), net: r.net, employeeId: r.employeeId, voided: mine.some((c) => c.type === 'void'), refunded: mine.reduce((n, c) => n + c.amount, 0) };
    });
  }

  /** Full tax invoice on request, referencing the bill. One per bill; numbered per branch (spec). */
  async taxInvoice(saleDocNo: string, buyer: TaxInvoiceInput, actor: Employee, terminalId: string): Promise<{ docNo: string }> {
    if (!buyer.buyerName?.trim() || !buyer.buyerAddress?.trim()) throw new DomainError('invalid', 'ใส่ชื่อและที่อยู่ผู้ซื้อ');
    if (!/^\d{13}$/.test(buyer.buyerTaxId ?? '')) throw new DomainError('invalid', 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.must(tx, saleDocNo);
      if (await tx.existsBy(TaxInvoiceEntity, { saleDocNo })) throw new DomainError('conflict', 'บิลนี้ออกใบกำกับภาษีเต็มรูปแล้ว');
      const docNo = await this.numbering.next(tx, `TI-${docPeriod(now)}`);
      await tx.insert(TaxInvoiceEntity, { docNo, saleDocNo, at: now, buyerName: buyer.buyerName.trim(), buyerAddress: buyer.buyerAddress.trim(), buyerTaxId: buyer.buyerTaxId, buyerBranch: buyer.buyerBranch?.trim() || 'สำนักงานใหญ่', issuedBy: actor.id });
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
