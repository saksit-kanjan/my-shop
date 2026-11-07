import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { PaymentMethod } from '@my-shop/contracts';
import { DatabaseService } from '../../database/database.service';
import { CreditNote } from '../domain/credit-note';
import { CreditNoteRepository } from '../domain/credit-note.repository';
import { CreditNoteEntity, CreditNoteLine, CreditNotePayment } from '../entities/sales.entities';

@Injectable()
export class TypeOrmCreditNoteRepository extends CreditNoteRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async add(note: CreditNote): Promise<void> {
    const s = note.snapshot();
    const m = this.db.manager;
    await m.insert(CreditNoteEntity, { docNo: s.docNo, saleDocNo: s.saleDocNo, shiftId: s.shiftId, type: s.kind, at: s.at, businessDate: s.businessDate, amount: s.amount, reason: s.reason, restock: s.restock, employeeId: s.employeeId, approvedBy: s.approvedBy });
    if (s.lines.length) await m.insert(CreditNoteLine, s.lines.map((l) => ({ docNo: s.docNo, productId: l.productId, name: l.name, qty: l.qty, amount: l.amount, cost: l.cost })));
    if (s.payments.length) await m.insert(CreditNotePayment, s.payments.map((p) => ({ docNo: s.docNo, method: p.method, amount: p.amount })));
  }

  exists(docNo: string) {
    return this.db.manager.existsBy(CreditNoteEntity, { docNo });
  }

  findBySale(saleDocNo: string) {
    return this.load({ saleDocNo });
  }

  findByShift(shiftId: string) {
    return this.load({ shiftId });
  }

  private async load(where: { saleDocNo: string } | { shiftId: string }): Promise<CreditNote[]> {
    const m = this.db.manager;
    const heads = await m.find(CreditNoteEntity, { where, order: { at: 'ASC', docNo: 'ASC' } });
    if (heads.length === 0) return [];
    const docs = heads.map((h) => h.docNo);
    const [lines, pays] = await Promise.all([m.find(CreditNoteLine, { where: { docNo: In(docs) }, order: { id: 'ASC' } }), m.find(CreditNotePayment, { where: { docNo: In(docs) }, order: { id: 'ASC' } })]);
    return heads.map((h) =>
      CreditNote.restore({
        docNo: h.docNo, saleDocNo: h.saleDocNo, shiftId: h.shiftId, kind: h.type, at: h.at, businessDate: h.businessDate, amount: h.amount, reason: h.reason, restock: h.restock, employeeId: h.employeeId, approvedBy: h.approvedBy,
        lines: lines.filter((l) => l.docNo === h.docNo).map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, amount: l.amount, cost: l.cost })),
        payments: pays.filter((p) => p.docNo === h.docNo).map((p) => ({ method: p.method as PaymentMethod, amount: p.amount })),
      }),
    );
  }
}
