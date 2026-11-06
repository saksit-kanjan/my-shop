import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { Catalog, Payment, PaymentMethod, Product, Promotion, SaleRecord } from '@my-shop/contracts';
import { normalizeLines, priceCart } from '@my-shop/domain';
import { DB, type Db, type Queryable } from '../db/db';
import { DomainError } from '../errors';
import { audit } from './audit';
import { CatalogService } from './catalog.service';
import { MemberService } from './member.service';
import { SettingsService } from './settings.service';
import { businessDate, docPeriod, type Clock } from './util';

export interface SaleInput extends Omit<SaleRecord, 'docNo' | 'at'> {
  /** Credit-note number of the goods being exchanged, when this bill pays for a replacement (spec: เปลี่ยนสินค้า). */
  exchangeFor?: string;
}

/** Prices and promotions as they were at close, kept so a refund re-prices against the same rules. */
export interface PricingSnapshot {
  products: Product[];
  promotions: Promotion[];
  premiums: { id: string; name: string }[];
}

const METHODS: PaymentMethod[] = ['cash', 'promptpay', 'card', 'transfer'];

/** Next number in a gapless series. Runs inside the caller's transaction so a rollback gives the number back. */
export async function nextNumber(tx: Queryable, key: string): Promise<number> {
  const [row] = await tx.query<{ last: number }>(`INSERT INTO doc_counters (key, last) VALUES ($1, 1) ON CONFLICT (key) DO UPDATE SET last = doc_counters.last + 1 RETURNING last`, [key]);
  return row.last;
}

@Injectable()
export class SaleService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CatalogService) private readonly catalogs: CatalogService,
    @Inject(MemberService) private readonly members: MemberService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Closes a bill. The server re-prices the lines and its numbers win (rule 2). Closing the bill,
   * issuing the document number, cutting stock, moving points and the audit row happen in ONE transaction (rule 3).
   */
  async closeSale(shiftId: string, input: SaleInput): Promise<SaleRecord> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [shift] = await tx.query<{ terminal_id: string; closed_at: Date | null }>(`SELECT terminal_id, closed_at FROM shifts WHERE id=$1`, [shiftId]);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.closed_at) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const cfg = await this.settings.getAll(tx);

      // priceCart only marks an existing line as a gift (it never invents one), so every line is something the cashier keyed.
      const keyed = normalizeLines(input.cart.lines.map((l) => ({ productId: l.productId, qty: l.qty })));
      if (keyed.length === 0) throw new DomainError('invalid', 'บิลนี้ยังไม่มีสินค้า');

      const catalog = await this.catalogs.getCatalog(tx);
      const byId = new Map(catalog.products.map((p) => [p.id, p]));
      const unknown = keyed.find((l) => !byId.has(l.productId));
      if (unknown) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ โหลดรายการสินค้าใหม่แล้วลองอีกครั้ง', { productId: unknown.productId });

      const member = input.memberPhone ? await this.members.findByPhone(input.memberPhone, tx) : null;
      if (input.memberPhone && !member) throw new DomainError('invalid', 'เบอร์นี้ยังไม่ได้สมัครสมาชิก สมัครก่อนแล้วผูกกับบิล', { needsMember: input.memberPhone });

      const cart = priceCart(keyed, catalog, { isMember: !!member });

      let pointsRedeemed = input.pointsRedeemed ?? 0;
      if (!Number.isInteger(pointsRedeemed) || pointsRedeemed < 0) throw new DomainError('invalid', 'จำนวนแต้มที่ใช้ไม่ถูกต้อง');
      if (pointsRedeemed > 0) {
        if (!member) throw new DomainError('invalid', 'ต้องผูกสมาชิกก่อนใช้แต้ม');
        if (pointsRedeemed > (await this.members.balance(tx, member.id))) throw new DomainError('invalid', 'แต้มไม่พอ');
      }
      const pointsValue = pointsRedeemed * cfg.pointsValueSatang;
      if (pointsValue > cart.net) throw new DomainError('invalid', 'ใช้แต้มเกินยอดบิล', { maxPoints: Math.floor(cart.net / Math.max(1, cfg.pointsValueSatang)) });
      const due = cart.net - pointsValue;
      const payments = this.checkPayments(input.payments ?? [], due);
      const change = payments.reduce((s, p) => s + (p.method === 'cash' && p.tendered ? Math.max(0, p.tendered - p.amount) : 0), 0);

      if (!cfg.allowNegativeStock) {
        for (const l of cart.lines) {
          const [b] = await tx.query<{ q: number }>(`SELECT COALESCE(SUM(qty),0)::int AS q FROM stock_movements WHERE product_id=$1`, [l.productId]);
          if ((b?.q ?? 0) < l.qty) throw new DomainError('conflict', `${l.name} ในระบบเหลือไม่พอ ตรวจสต็อกก่อนขาย`, { productId: l.productId });
        }
      }
      if (input.exchangeFor) {
        const [cn] = await tx.query(`SELECT 1 FROM credit_notes WHERE doc_no=$1`, [input.exchangeFor]);
        if (!cn) throw new DomainError('invalid', 'ไม่พบใบลดหนี้ที่อ้างอิง');
      }

      const counterKey = `${shift.terminal_id}-${docPeriod(now)}`;
      const docNo = `${counterKey}-${String(await nextNumber(tx, counterKey)).padStart(6, '0')}`;
      const snapshot: PricingSnapshot = {
        products: keyed.map((l) => byId.get(l.productId) as Product),
        promotions: catalog.promotions,
        premiums: catalog.premiums.map((p) => ({ id: p.id, name: p.name })),
      };
      const pointsEarned = member ? await this.members.earn(tx, member.id, due, docNo, now) : 0;

      await tx.query(
        `INSERT INTO sales (doc_no, shift_id, employee_id, at, business_date, member_id, gross, discount, net, vat, change, cart, pricing, points_earned, points_redeemed, points_value, exchange_for)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [docNo, shiftId, input.employeeId, now, businessDate(now, cfg.cutoffHour), member?.id ?? null, cart.gross, cart.discount, cart.net, cart.vat, change, JSON.stringify(cart), JSON.stringify(snapshot), pointsEarned, pointsRedeemed, pointsValue, input.exchangeFor ?? null],
      );
      if (member && pointsRedeemed > 0) await tx.query(`INSERT INTO points_ledger (member_id, points, kind, doc_no, at) VALUES ($1,$2,'redeem',$3,$4)`, [member.id, -pointsRedeemed, docNo, now]);
      for (const l of cart.lines) {
        await tx.query(`INSERT INTO sale_lines (doc_no, product_id, name, qty, unit_price, gross, discount, net, applied, gift_of_product_id, cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          docNo, l.productId, l.name, l.qty, l.unitPrice, l.gross, l.discount, l.net, JSON.stringify(l.applied), l.giftOfProductId ?? null, await this.unitCost(tx, l.productId),
        ]);
        // Gift products leave the shelf too.
        await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, at) VALUES ($1,$2,'sale',$3,$4)`, [l.productId, -l.qty, docNo, now]);
      }
      for (const p of cart.premiums) {
        if (p.outOfStock) continue;
        await tx.query(`INSERT INTO stock_movements (premium_id, qty, kind, doc_no, at) VALUES ($1,$2,'premium',$3,$4)`, [p.premiumId, -p.qty, docNo, now]);
      }
      for (const p of payments) {
        await tx.query(`INSERT INTO payments (doc_no, method, amount, tendered, reference) VALUES ($1,$2,$3,$4,$5)`, [docNo, p.method, p.amount, p.tendered ?? null, p.reference ?? null]);
      }
      await audit(tx, now, { actor: input.employeeId, terminalId: shift.terminal_id, action: 'sale.close', entity: 'sale', entityId: docNo, after: { net: cart.net, clientNet: input.cart.net } });

      return {
        docNo,
        at: now.toISOString(),
        employeeId: input.employeeId,
        cart,
        payments,
        change,
        ...(member ? { memberPhone: member.phone, pointsEarned } : {}),
        ...(pointsRedeemed > 0 ? { pointsRedeemed, pointsValue } : {}),
      };
    });
  }

  private async unitCost(tx: Queryable, productId: string): Promise<number> {
    const [r] = await tx.query<{ cost: number }>(`SELECT cost FROM products WHERE id=$1`, [productId]);
    return r?.cost ?? 0;
  }

  private checkPayments(payments: Payment[], due: number): Payment[] {
    if (due === 0 && payments.length === 0) return [];
    if (!Array.isArray(payments) || payments.length === 0) throw new DomainError('invalid', 'ยังไม่ได้เลือกวิธีชำระเงิน');
    for (const p of payments) {
      if (!METHODS.includes(p.method) || !Number.isInteger(p.amount) || p.amount <= 0) throw new DomainError('invalid', 'ข้อมูลการชำระเงินไม่ถูกต้อง');
      if (p.tendered !== undefined && (p.method !== 'cash' || !Number.isInteger(p.tendered) || p.tendered < p.amount)) throw new DomainError('invalid', 'เงินที่รับมาน้อยกว่ายอดที่ต้องชำระ');
      if (p.method === 'card' && !(p.reference && p.reference.trim().length >= 4)) throw new DomainError('invalid', 'ใส่เลขอนุมัติบัตร (approval code)');
    }
    const paid = payments.reduce((s, p) => s + p.amount, 0);
    if (paid !== due) throw new DomainError('invalid', paid < due ? 'ยอดที่ชำระยังไม่ครบ' : 'ยอดที่ชำระเกินยอดบิล', { net: due, paid });
    return payments;
  }
}

export type { Catalog };
