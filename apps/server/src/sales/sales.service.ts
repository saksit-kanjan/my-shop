import { Inject, Injectable } from '@nestjs/common';
import type { Catalog, Product, SaleRecord } from '@my-shop/contracts';
import { normalizeLines, priceCart } from '@my-shop/domain';
import { AuditService } from '../audit/audit.service';
import { ApprovalsService } from '../auth/approvals.service';
import { AuthService } from '../auth/auth.service';
import { PermissionsService } from '../auth/permissions.service';
import { CLOCK, type Clock } from '../common/clock';
import { businessDate, docPeriod } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { NumberingService } from '../database/numbering.service';
import { MembersService } from '../members/members.service';
import { ProductsService } from '../products/products.service';
import { SettingsService } from '../settings/settings.service';
import { StockService } from '../stock/stock.service';
import { CreditNoteEntity, ShiftEntity } from './entities/sales.entities';
import { Sale } from './domain/sale';
import { SaleRepository } from './domain/sale.repository';
import { ShiftRepository } from './domain/shift.repository';
import type { SaleInput } from './sales.types';

/** Closing a bill: the one use case that touches sales, stock, points and numbering together, in one transaction (CLAUDE.md rule 3). */
@Injectable()
export class SalesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly members: MembersService,
    private readonly settings: SettingsService,
    private readonly numbering: NumberingService,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
    private readonly approvals: ApprovalsService,
    private readonly audit: AuditService,
    private readonly shifts: ShiftRepository,
    private readonly sales: SaleRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The catalog as the till sees it: products and promotions, plus the stock left of each free gift. */
  async catalog(tx: Tx = this.db.manager): Promise<Catalog> {
    const [snap, left] = await Promise.all([this.products.snapshot(tx), this.stock.premiumBalances(tx)]);
    return { categories: snap.categories, products: snap.products, promotions: snap.promotions, premiums: snap.premiums.map((p) => ({ id: p.id, name: p.name, stock: left.get(p.id) ?? 0 })) };
  }

  /**
   * The server re-prices the lines and its numbers win (CLAUDE.md rule 2). Closing the bill, issuing the document number,
   * cutting stock, moving points and the audit row happen in ONE transaction: all of it, or none.
   */
  async closeSale(shiftId: string, input: SaleInput): Promise<SaleRecord> {
    const now = this.clock();
    const manual = input.manualDiscount;
    Sale.assertManualDiscountValid(manual);
    // Who stands behind a discount above the cap. Checked before the transaction so a wrong code is counted even when the bill fails.
    const approver = manual ? await this.manualDiscountApprover(shiftId, input) : null;
    return this.db.transaction(async (tx) => {
      const shift = await this.shifts.findById(shiftId);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.isClosed) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const cfg = await this.settings.getAll(tx);

      // priceCart only marks an existing line as a gift (it never invents one), so every line is something the cashier keyed.
      const keyed = normalizeLines(input.cart.lines.map((l) => ({ productId: l.productId, qty: l.qty })));
      if (keyed.length === 0) throw new DomainError('invalid', 'บิลนี้ยังไม่มีสินค้า');

      const catalog = await this.catalog(tx);
      const byId = new Map(catalog.products.map((p) => [p.id, p]));
      const unknown = keyed.find((l) => !byId.has(l.productId));
      if (unknown) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ โหลดรายการสินค้าใหม่แล้วลองอีกครั้ง', { productId: unknown.productId });

      const member = input.memberPhone ? await this.members.findByPhone(input.memberPhone, tx) : null;
      if (input.memberPhone && !member) throw new DomainError('invalid', 'เบอร์นี้ยังไม่ได้สมัครสมาชิก สมัครก่อนแล้วผูกกับบิล', { needsMember: input.memberPhone });

      const cart = priceCart(keyed, catalog, { isMember: !!member, at: now, manual });
      const overCap = Sale.assertManualDiscountApproved(cart, cfg.manualDiscountCapPercent, !!approver);

      const pointsRedeemed = input.pointsRedeemed ?? 0;
      if (pointsRedeemed > 0 && !member) throw new DomainError('invalid', 'ต้องผูกสมาชิกก่อนใช้แต้ม');
      const pointsValue = member ? await this.members.quoteRedemption(tx, member.id, pointsRedeemed, cart.net) : 0;

      if (!cfg.allowNegativeStock) {
        for (const l of cart.lines) {
          if ((await this.stock.balanceOf(tx, l.productId)) < l.qty) throw new DomainError('conflict', `${l.name} ในระบบเหลือไม่พอ ตรวจสต็อกก่อนขาย`, { productId: l.productId });
        }
      }
      if (input.exchangeFor && !(await tx.existsBy(CreditNoteEntity, { docNo: input.exchangeFor }))) throw new DomainError('invalid', 'ไม่พบใบลดหนี้ที่อ้างอิง');

      const docNo = await this.numbering.next(tx, `${shift.terminalId}-${docPeriod(now)}`);
      const pointsEarned = member ? await this.members.earn(tx, member.id, cart.net - pointsValue, docNo, now) : 0;
      const costs = await this.products.costs(tx, cart.lines.map((l) => l.productId));
      const sale = Sale.close({
        docNo, shiftId, employeeId: input.employeeId, now, businessDate: businessDate(now, cfg.cutoffHour), memberId: member?.id ?? null, cart,
        pricing: { products: keyed.map((l) => byId.get(l.productId) as Product), promotions: catalog.promotions, premiums: catalog.premiums.map((p) => ({ id: p.id, name: p.name })), ...(manual ? { manual } : {}) },
        costs, payments: input.payments ?? [], pointsRedeemed, pointsValue, pointsEarned, exchangeFor: input.exchangeFor, manual, capPercent: cfg.manualDiscountCapPercent, discountApprover: approver?.id ?? null,
      });
      await this.sales.add(sale);
      if (member && pointsRedeemed > 0) await this.members.redeem(tx, member.id, pointsRedeemed, cart.net, docNo, now);

      // Gift products leave the shelf too, and so do the free gifts the promotions handed out (unless they ran out).
      await this.stock.record(tx, [
        ...cart.lines.map((l) => ({ productId: l.productId, qty: -l.qty, kind: 'sale' as const, docNo, at: now })),
        ...cart.premiums.filter((p) => !p.outOfStock).map((p) => ({ premiumId: p.premiumId, qty: -p.qty, kind: 'premium' as const, docNo, at: now })),
      ]);
      const { payments, change } = sale.snapshot();
      if (sale.manualDiscount > 0) {
        await this.audit.record(tx, now, { actor: input.employeeId, approver: overCap && approver && approver.id !== input.employeeId ? approver.id : undefined, terminalId: shift.terminalId, action: 'sale.manual_discount', entity: 'sale', entityId: docNo, after: { amount: sale.manualDiscount, type: manual?.type, value: manual?.value, reason: manual?.reason, overCap } });
      }
      await this.audit.record(tx, now, { actor: input.employeeId, terminalId: shift.terminalId, action: 'sale.close', entity: 'sale', entityId: docNo, after: { net: cart.net, clientNet: input.cart.net } });

      return {
        docNo, at: now.toISOString(), employeeId: input.employeeId, cart, payments, change,
        ...(member ? { memberPhone: member.phone, pointsEarned } : {}),
        ...(pointsRedeemed > 0 ? { pointsRedeemed, pointsValue } : {}),
      };
    });
  }

  /**
   * Someone who may give a discount above the cap: the cashier themself when their role allows it, otherwise the supervisor whose
   * code came with the bill. Null when neither (the bill then fails only if the discount really is over the cap).
   */
  private async manualDiscountApprover(shiftId: string, input: SaleInput) {
    const actor = await this.auth.findEmployee(input.employeeId);
    if (!actor) return null;
    if (await this.permissions.can(actor.role, 'discount.over_cap')) return actor;
    if (!input.approverCode) return null;
    const shift = await this.db.manager.findOneBy(ShiftEntity, { id: shiftId });
    return this.approvals.resolve({ actor, permission: 'discount.over_cap', approverCode: input.approverCode, terminalId: shift?.terminalId ?? '' });
  }
}
