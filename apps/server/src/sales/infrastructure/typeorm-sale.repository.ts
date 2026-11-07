import { Injectable } from '@nestjs/common';
import type { PricedCart } from '@my-shop/contracts';
import { DatabaseService } from '../../database/database.service';
import { Sale } from '../domain/sale';
import { SaleRepository } from '../domain/sale.repository';
import { PaymentEntity, SaleEntity, SaleLineEntity } from '../entities/sales.entities';
import type { PricingSnapshot } from '../sales.types';

@Injectable()
export class TypeOrmSaleRepository extends SaleRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  async add(sale: Sale): Promise<void> {
    const s = sale.snapshot();
    const m = this.db.manager;
    await m.insert(SaleEntity, {
      docNo: s.docNo, shiftId: s.shiftId, employeeId: s.employeeId, at: s.at, businessDate: s.businessDate, memberId: s.memberId,
      gross: s.cart.gross, discount: s.cart.discount, net: s.cart.net, vat: s.cart.vat, change: s.change, cart: s.cart, pricing: s.pricing as object,
      pointsEarned: s.pointsEarned, pointsRedeemed: s.pointsRedeemed, pointsValue: s.pointsValue, exchangeFor: s.exchangeFor,
      manualDiscount: s.manual?.amount ?? 0, manualReason: s.manual?.reason ?? null, manualApprovedBy: s.manual?.approvedBy ?? null,
    });
    if (s.lines.length) await m.insert(SaleLineEntity, s.lines.map((l) => ({ docNo: s.docNo, ...l })));
    if (s.payments.length) await m.insert(PaymentEntity, s.payments.map((p) => ({ docNo: s.docNo, method: p.method, amount: p.amount, tendered: p.tendered ?? null, reference: p.reference ?? null })));
  }

  async findByDocNo(docNo: string): Promise<Sale | null> {
    const m = this.db.manager;
    const row = await m.findOneBy(SaleEntity, { docNo });
    if (!row) return null;
    const [lines, payments] = await Promise.all([m.find(SaleLineEntity, { where: { docNo }, order: { id: 'ASC' } }), m.find(PaymentEntity, { where: { docNo }, order: { id: 'ASC' } })]);
    return Sale.restore({
      docNo: row.docNo, shiftId: row.shiftId, employeeId: row.employeeId, at: row.at, businessDate: row.businessDate, memberId: row.memberId,
      cart: row.cart as PricedCart, pricing: row.pricing as PricingSnapshot, change: row.change,
      lines: lines.map((l) => ({ productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, gross: l.gross, discount: l.discount, net: l.net, applied: l.applied as never, giftOfProductId: l.giftOfProductId, cost: l.cost })),
      payments: payments.map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered !== null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
      pointsEarned: row.pointsEarned, pointsRedeemed: row.pointsRedeemed, pointsValue: row.pointsValue, exchangeFor: row.exchangeFor,
      manual: row.manualDiscount > 0 ? { amount: row.manualDiscount, reason: row.manualReason ?? '', approvedBy: row.manualApprovedBy } : null,
    });
  }
}
