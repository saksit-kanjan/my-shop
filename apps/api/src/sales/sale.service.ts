import { Inject, Injectable } from '@nestjs/common';
import type { Product, SaleRecord } from '@my-shop/contracts';
import { normalizeLines, priceCart } from '@my-shop/domain';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { businessDate, docPeriod } from '../common/utils/dates';
import { DomainError } from '../common/errors/domain-error';
import { DocumentNumbersService } from '../numbering/document-numbers.service';
import { SettingsService } from '../administration/settings.service';
import { CatalogService } from '../catalog/catalog.service';
import { StockLedgerService } from '../inventory/stock-ledger.service';
import { MembershipService } from '../membership/membership.service';
import { CreditNoteRepository } from './repositories/credit-note.repository';
import { changeFor, checkPayments } from './policies/payment-policy';
import { SalesRepository } from './repositories/sales.repository';
import type { PricingSnapshot, SaleInput } from './entities/sales.types';
import { ShiftRepository } from './repositories/shift.repository';
import { PosCatalogService } from './pos-catalog.service';

/** Closing a bill: the one use case that touches sales, stock, points and numbering together, in one transaction (rule 3). */
@Injectable()
export class SaleService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly shifts: ShiftRepository,
    private readonly sales: SalesRepository,
    private readonly creditNotes: CreditNoteRepository,
    private readonly posCatalog: PosCatalogService,
    private readonly catalog: CatalogService,
    private readonly stock: StockLedgerService,
    private readonly members: MembershipService,
    private readonly settings: SettingsService,
    private readonly numbers: DocumentNumbersService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * The server re-prices the lines and its numbers win (rule 2). Closing the bill, issuing the document number, cutting stock,
   * moving points and the audit row happen in ONE transaction: all of it, or none.
   */
  async closeSale(shiftId: string, input: SaleInput): Promise<SaleRecord> {
    const now = this.clock();
    return this.uow.run(async (tx) => {
      const shift = await this.shifts.find(tx, shiftId);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.closedAt) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const cfg = await this.settings.getAll(tx);

      // priceCart only marks an existing line as a gift (it never invents one), so every line is something the cashier keyed.
      const keyed = normalizeLines(input.cart.lines.map((l) => ({ productId: l.productId, qty: l.qty })));
      if (keyed.length === 0) throw new DomainError('invalid', 'บิลนี้ยังไม่มีสินค้า');

      const catalog = await this.posCatalog.get(tx);
      const byId = new Map(catalog.products.map((p) => [p.id, p]));
      const unknown = keyed.find((l) => !byId.has(l.productId));
      if (unknown) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ โหลดรายการสินค้าใหม่แล้วลองอีกครั้ง', { productId: unknown.productId });

      const member = input.memberPhone ? await this.members.findByPhone(input.memberPhone, tx) : null;
      if (input.memberPhone && !member) throw new DomainError('invalid', 'เบอร์นี้ยังไม่ได้สมัครสมาชิก สมัครก่อนแล้วผูกกับบิล', { needsMember: input.memberPhone });

      const cart = priceCart(keyed, catalog, { isMember: !!member });

      const pointsRedeemed = input.pointsRedeemed ?? 0;
      if (pointsRedeemed > 0 && !member) throw new DomainError('invalid', 'ต้องผูกสมาชิกก่อนใช้แต้ม');
      const pointsValue = member ? await this.members.quoteRedemption(tx, member.id, pointsRedeemed, cart.net) : 0;
      const due = cart.net - pointsValue;
      const payments = checkPayments(input.payments ?? [], due);
      const change = changeFor(payments);

      if (!cfg.allowNegativeStock) {
        for (const l of cart.lines) {
          if ((await this.stock.balanceOf(tx, l.productId)) < l.qty) throw new DomainError('conflict', `${l.name} ในระบบเหลือไม่พอ ตรวจสต็อกก่อนขาย`, { productId: l.productId });
        }
      }
      if (input.exchangeFor && !(await this.creditNotes.exists(tx, input.exchangeFor))) throw new DomainError('invalid', 'ไม่พบใบลดหนี้ที่อ้างอิง');

      const docNo = await this.numbers.format(tx, `${shift.terminalId}-${docPeriod(now)}`);
      const snapshot: PricingSnapshot = { products: keyed.map((l) => byId.get(l.productId) as Product), promotions: catalog.promotions, premiums: catalog.premiums.map((p) => ({ id: p.id, name: p.name })) };
      const pointsEarned = member ? await this.members.earn(tx, member.id, due, docNo, now) : 0;

      await this.sales.insert(tx, {
        docNo, shiftId, employeeId: input.employeeId, at: now, businessDate: businessDate(now, cfg.cutoffHour), memberId: member?.id ?? null,
        gross: cart.gross, discount: cart.discount, net: cart.net, vat: cart.vat, change, cart, pricing: snapshot, pointsEarned, pointsRedeemed, pointsValue, exchangeFor: input.exchangeFor ?? null,
      });
      if (member && pointsRedeemed > 0) await this.members.redeem(tx, member.id, pointsRedeemed, cart.net, docNo, now);

      const costs = await this.catalog.costs(tx, cart.lines.map((l) => l.productId));
      for (const l of cart.lines) {
        await this.sales.insertLine(tx, docNo, { productId: l.productId, name: l.name, qty: l.qty, unitPrice: l.unitPrice, gross: l.gross, discount: l.discount, net: l.net, applied: l.applied, giftOfProductId: l.giftOfProductId ?? null, cost: costs.get(l.productId) ?? 0 });
      }
      // Gift products leave the shelf too, and so do the free gifts the promotions handed out (unless they ran out).
      await this.stock.record(tx, [
        ...cart.lines.map((l) => ({ productId: l.productId, qty: -l.qty, kind: 'sale' as const, docNo, at: now })),
        ...cart.premiums.filter((p) => !p.outOfStock).map((p) => ({ premiumId: p.premiumId, qty: -p.qty, kind: 'premium' as const, docNo, at: now })),
      ]);
      for (const p of payments) await this.sales.insertPayment(tx, docNo, { method: p.method, amount: p.amount, tendered: p.tendered ?? null, reference: p.reference ?? null });
      await this.audit.record(tx, now, { actor: input.employeeId, terminalId: shift.terminalId, action: 'sale.close', entity: 'sale', entityId: docNo, after: { net: cart.net, clientNet: input.cart.net } });

      return {
        docNo, at: now.toISOString(), employeeId: input.employeeId, cart, payments, change,
        ...(member ? { memberPhone: member.phone, pointsEarned } : {}),
        ...(pointsRedeemed > 0 ? { pointsRedeemed, pointsValue } : {}),
      };
    });
  }
}
