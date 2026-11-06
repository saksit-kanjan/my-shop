import { Inject, Injectable } from '@nestjs/common';
import type { Catalog, Product, SaleRecord } from '@my-shop/contracts';
import { manualDiscountOf, normalizeLines, priceCart } from '@my-shop/domain';
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
import { changeFor, checkPayments } from './payment-rules';
import type { PricingSnapshot, SaleInput } from './sales.types';

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
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** The catalog as the till sees it: products and promotions, plus the stock left of each free gift. */
  async catalog(tx: Tx = this.db): Promise<Catalog> {
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
    if (manual && (!manual.reason?.trim() || !Number.isInteger(manual.value) || manual.value < 1 || (manual.type === 'percent' && manual.value > 100))) {
      throw new DomainError('invalid', 'ส่วนลดพิเศษต้องมีจำนวนที่ถูกต้องและเหตุผล');
    }
    // Who stands behind a discount above the cap. Checked before the transaction so a wrong code is counted even when the bill fails.
    const approver = manual ? await this.manualDiscountApprover(shiftId, input) : null;
    return this.db.transaction(async (tx) => {
      const [shift] = await tx.query<{ terminal_id: string; closed_at: Date | null }>(`SELECT terminal_id, closed_at FROM shifts WHERE id=$1`, [shiftId]);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.closed_at) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
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

      const manualAmount = manualDiscountOf(cart);
      const overCap = manualAmount > Math.floor(((cart.net + manualAmount) * cfg.manualDiscountCapPercent) / 100);
      if (overCap && !approver) {
        throw new DomainError('forbidden', 'ส่วนลดเกินเพดาน ต้องให้หัวหน้ากะใส่รหัสอนุมัติ', { needsApproval: 'discount.over_cap', capPercent: cfg.manualDiscountCapPercent });
      }

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
      if (input.exchangeFor && !(await tx.query(`SELECT 1 FROM credit_notes WHERE doc_no=$1`, [input.exchangeFor])).length) throw new DomainError('invalid', 'ไม่พบใบลดหนี้ที่อ้างอิง');

      const docNo = await this.numbering.next(tx, `${shift.terminal_id}-${docPeriod(now)}`);
      const snapshot: PricingSnapshot = { products: keyed.map((l) => byId.get(l.productId) as Product), promotions: catalog.promotions, premiums: catalog.premiums.map((p) => ({ id: p.id, name: p.name })), ...(manual ? { manual } : {}) };
      const pointsEarned = member ? await this.members.earn(tx, member.id, due, docNo, now) : 0;

      await tx.query(
        `INSERT INTO sales (doc_no, shift_id, employee_id, at, business_date, member_id, gross, discount, net, vat, change, cart, pricing, points_earned, points_redeemed, points_value, exchange_for, manual_discount, manual_reason, manual_approved_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [docNo, shiftId, input.employeeId, now, businessDate(now, cfg.cutoffHour), member?.id ?? null, cart.gross, cart.discount, cart.net, cart.vat, change, JSON.stringify(cart), JSON.stringify(snapshot), pointsEarned, pointsRedeemed, pointsValue, input.exchangeFor ?? null, manualAmount, manualAmount > 0 ? manual?.reason.trim() ?? null : null, manualAmount > 0 ? approver?.id ?? null : null],
      );
      if (member && pointsRedeemed > 0) await this.members.redeem(tx, member.id, pointsRedeemed, cart.net, docNo, now);

      const costs = await this.products.costs(tx, cart.lines.map((l) => l.productId));
      for (const l of cart.lines) {
        await tx.query(`INSERT INTO sale_lines (doc_no, product_id, name, qty, unit_price, gross, discount, net, applied, gift_of_product_id, cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          docNo, l.productId, l.name, l.qty, l.unitPrice, l.gross, l.discount, l.net, JSON.stringify(l.applied), l.giftOfProductId ?? null, costs.get(l.productId) ?? 0,
        ]);
      }
      // Gift products leave the shelf too, and so do the free gifts the promotions handed out (unless they ran out).
      await this.stock.record(tx, [
        ...cart.lines.map((l) => ({ productId: l.productId, qty: -l.qty, kind: 'sale' as const, docNo, at: now })),
        ...cart.premiums.filter((p) => !p.outOfStock).map((p) => ({ premiumId: p.premiumId, qty: -p.qty, kind: 'premium' as const, docNo, at: now })),
      ]);
      for (const p of payments) await tx.query(`INSERT INTO payments (doc_no, method, amount, tendered, reference) VALUES ($1,$2,$3,$4,$5)`, [docNo, p.method, p.amount, p.tendered ?? null, p.reference ?? null]);
      if (manualAmount > 0) {
        await this.audit.record(tx, now, { actor: input.employeeId, approver: approver && approver.id !== input.employeeId ? approver.id : undefined, terminalId: shift.terminal_id, action: 'sale.manual_discount', entity: 'sale', entityId: docNo, after: { amount: manualAmount, type: manual?.type, value: manual?.value, reason: manual?.reason, overCap } });
      }
      await this.audit.record(tx, now, { actor: input.employeeId, terminalId: shift.terminal_id, action: 'sale.close', entity: 'sale', entityId: docNo, after: { net: cart.net, clientNet: input.cart.net } });

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
    const [shift] = await this.db.query<{ terminal_id: string }>(`SELECT terminal_id FROM shifts WHERE id=$1`, [shiftId]);
    return this.approvals.resolve({ actor, permission: 'discount.over_cap', approverCode: input.approverCode, terminalId: shift?.terminal_id ?? '' });
  }
}
