import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { CreditNote, Employee, Payment, PaymentMethod, PricedCart, Product, SaleRecord } from '@my-shop/contracts';
import { priceCart } from '@my-shop/domain';
import { DB, type Db, type Queryable } from '../db/db';
import { DomainError } from '../errors';
import { ApprovalService } from './approval.service';
import { audit } from './audit';
import { MemberService } from './member.service';
import { nextNumber, type PricingSnapshot } from './sale.service';
import { SettingsService } from './settings.service';
import { businessDate, docPeriod, iso, type Clock } from './util';

interface SaleRow {
  doc_no: string;
  shift_id: string;
  employee_id: string;
  at: Date;
  member_id: string | null;
  net: number;
  vat: number;
  change: number;
  cart: PricedCart;
  pricing: PricingSnapshot | null;
  points_earned: number;
  points_redeemed: number;
  points_value: number;
}

export interface RefundInput {
  saleDocNo: string;
  /** Omit for a full void. For a refund: what comes back, by product. */
  lines?: { productId: string; qty: number }[];
  reason: string;
  /** True: goods go back on the shelf. False: written off (spec: "ตัดเป็นของเสีย"). */
  restock?: boolean;
  approverCode?: string;
  /** Work out the amount and the split but write nothing, so the till can show "ยอดคืนเงิน" before anyone approves. */
  preview?: boolean;
}

export interface TaxInvoiceInput {
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

@Injectable()
export class DocumentService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(MemberService) private readonly members: MemberService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** A closed bill as it was printed, with what happened to it since. */
  async getSale(docNo: string): Promise<{ sale: SaleRecord; creditNotes: CreditNote[]; taxInvoice: { docNo: string; buyerName: string; at: string } | null; reprints: number; shiftId: string; terminalId: string }> {
    const row = await this.loadSale(this.db, docNo);
    const payments = await this.db.query<{ method: PaymentMethod; amount: number; tendered: number | null; reference: string | null }>(`SELECT method, amount, tendered, reference FROM payments WHERE doc_no=$1 ORDER BY id`, [docNo]);
    const [m] = row.member_id ? await this.db.query<{ phone: string | null }>(`SELECT phone FROM members WHERE id=$1`, [row.member_id]) : [];
    const creditNotes = await this.creditNotesFor(this.db, docNo);
    const [ti] = await this.db.query<{ doc_no: string; buyer_name: string; at: Date }>(`SELECT doc_no, buyer_name, at FROM tax_invoices WHERE sale_doc_no=$1`, [docNo]);
    const [rp] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reprints WHERE doc_no=$1`, [docNo]);
    const [sh] = await this.db.query<{ terminal_id: string }>(`SELECT terminal_id FROM shifts WHERE id=$1`, [row.shift_id]);
    return {
      sale: {
        docNo,
        at: iso(row.at),
        employeeId: row.employee_id,
        cart: row.cart,
        change: row.change,
        payments: payments.map((p) => ({ method: p.method, amount: p.amount, ...(p.tendered != null ? { tendered: p.tendered } : {}), ...(p.reference ? { reference: p.reference } : {}) })),
        ...(m?.phone ? { memberPhone: m.phone, pointsEarned: row.points_earned } : {}),
        ...(row.points_redeemed > 0 ? { pointsRedeemed: row.points_redeemed, pointsValue: row.points_value } : {}),
        ...(creditNotes.some((c) => c.type === 'void') ? { voided: true } : {}),
      },
      creditNotes,
      taxInvoice: ti ? { docNo: ti.doc_no, buyerName: ti.buyer_name, at: iso(ti.at) } : null,
      reprints: rp?.n ?? 0,
      shiftId: row.shift_id,
      terminalId: sh?.terminal_id ?? '',
    };
  }

  /** Reprint counter (spec: copies say "สำเนา" and are counted). Returns the number of this copy. */
  async reprint(docNo: string, actor: Employee, terminalId: string): Promise<number> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.loadSale(tx, docNo);
      await tx.query(`INSERT INTO reprints (doc_no, at, employee_id) VALUES ($1,$2,$3)`, [docNo, now, actor.id]);
      const [r] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM reprints WHERE doc_no=$1`, [docNo]);
      await audit(tx, now, { actor: actor.id, terminalId, action: 'sale.reprint', entity: 'sale', entityId: docNo });
      return r.n;
    });
  }

  async search(q: { term?: string; date?: string; limit?: number }): Promise<{ docNo: string; at: string; net: number; employeeId: string; voided: boolean; refunded: number }[]> {
    const rows = await this.db.query<{ doc_no: string; at: Date; net: number; employee_id: string; voided: boolean; refunded: number }>(
      `SELECT s.doc_no, s.at, s.net, s.employee_id,
              EXISTS (SELECT 1 FROM credit_notes c WHERE c.sale_doc_no=s.doc_no AND c.type='void') AS voided,
              COALESCE((SELECT SUM(amount) FROM credit_notes c WHERE c.sale_doc_no=s.doc_no),0)::int AS refunded
         FROM sales s LEFT JOIN members m ON m.id=s.member_id
        WHERE ($1::text IS NULL OR s.doc_no ILIKE $1 OR m.phone LIKE $1) AND ($2::text IS NULL OR s.business_date = $2::date)
        ORDER BY s.at DESC LIMIT $3`,
      [q.term ? `%${q.term.trim()}%` : null, q.date ?? null, Math.min(q.limit ?? 50, 200)],
    );
    return rows.map((r) => ({ docNo: r.doc_no, at: iso(r.at), net: r.net, employeeId: r.employee_id, voided: r.voided, refunded: r.refunded }));
  }

  /** Void: whole bill, same shift, shift still open. A refund: any time, part or all, back through the current shift's drawer. */
  async credit(shiftId: string, kind: 'void' | 'refund', input: RefundInput, actor: Employee, terminalId: string): Promise<CreditNote> {
    if (!input.reason?.trim()) throw new DomainError('invalid', 'ใส่เหตุผลก่อนทำรายการ');
    const now = this.clock();
    const cfg = await this.settings.getAll();
    // Approval first, in its own transaction, so a wrong code is counted even when the rest aborts.
    const approver = input.preview ? actor : await this.approvals.resolve({ actor, permission: kind === 'void' ? 'void' : 'refund', approverCode: input.approverCode, terminalId });
    const sale0 = await this.loadSale(this.db, input.saleDocNo);
    const lateDays = (now.getTime() - sale0.at.getTime()) / 86_400_000;
    const late = kind === 'refund' && cfg.refundDays > 0 && lateDays > cfg.refundDays;
    const lateApprover = late && !input.preview ? await this.approvals.resolve({ actor: approver, permission: 'refund.late', approverCode: input.approverCode, terminalId }) : approver;

    return this.db.transaction(async (tx) => {
      const [shift] = await tx.query<{ terminal_id: string; closed_at: Date | null }>(`SELECT terminal_id, closed_at FROM shifts WHERE id=$1`, [shiftId]);
      if (!shift) throw new DomainError('not_found', 'ไม่พบกะนี้');
      if (shift.closed_at) throw new DomainError('conflict', 'กะนี้ปิดแล้ว');
      const sale = await this.loadSale(tx, input.saleDocNo);
      if (kind === 'void' && sale.shift_id !== shiftId) throw new DomainError('conflict', 'ยกเลิกบิลได้เฉพาะบิลที่ขายในกะนี้ บิลของกะอื่นให้ใช้คืนสินค้า');

      const lines = await tx.query<{ product_id: string; name: string; qty: number; unit_price: number; net: number; cost: number; gift_of_product_id: string | null }>(`SELECT product_id, name, qty, unit_price, net, cost, gift_of_product_id FROM sale_lines WHERE doc_no=$1 ORDER BY id`, [sale.doc_no]);
      const prior = await this.creditNotesFor(tx, sale.doc_no);
      if (prior.some((c) => c.type === 'void')) throw new DomainError('conflict', 'บิลนี้ถูกยกเลิกแล้ว');
      if (kind === 'void' && prior.length > 0) throw new DomainError('conflict', 'บิลนี้มีการคืนสินค้าแล้ว ยกเลิกทั้งบิลไม่ได้');

      const returned = new Map<string, number>();
      for (const c of prior) for (const l of c.lines) returned.set(l.productId, (returned.get(l.productId) ?? 0) + l.qty);
      const wanted = new Map<string, number>();
      if (kind === 'void') for (const l of lines) wanted.set(l.product_id, l.qty);
      else {
        if (!input.lines?.length) throw new DomainError('invalid', 'เลือกสินค้าที่คืนอย่างน้อย 1 รายการ');
        for (const l of input.lines) {
          if (!Number.isInteger(l.qty) || l.qty <= 0) throw new DomainError('invalid', 'จำนวนที่คืนต้องมากกว่า 0');
          wanted.set(l.productId, (wanted.get(l.productId) ?? 0) + l.qty);
        }
      }
      for (const [pid, qty] of wanted) {
        const sold = lines.find((l) => l.product_id === pid)?.qty ?? 0;
        if (qty > sold - (returned.get(pid) ?? 0)) throw new DomainError('invalid', 'คืนได้ไม่เกินจำนวนที่ขาย (หักที่คืนไปแล้ว)', { productId: pid, available: sold - (returned.get(pid) ?? 0) });
      }

      // Re-price what is left under the promotions of the day: this is how a lost "buy 2 get 1" takes the gift's value out of the refund.
      const remaining = lines.map((l) => ({ productId: l.product_id, qty: l.qty - (returned.get(l.product_id) ?? 0) - (wanted.get(l.product_id) ?? 0) })).filter((l) => l.qty > 0);
      const snap = sale.pricing ?? (await this.fallbackSnapshot(tx, lines.map((l) => l.product_id)));
      const catalog = { categories: [], products: snap.products, premiums: snap.premiums.map((p) => ({ ...p, stock: 1_000_000 })), promotions: snap.promotions };
      const remainingNet = remaining.length ? priceCart(remaining, catalog, { isMember: !!sale.member_id }).net : 0;
      const refundedAfter = sale.net - remainingNet;
      const priorAmount = sum(prior.map((c) => c.amount));
      const amount = Math.max(0, refundedAfter - priorAmount);

      // Spread the amount over the returned lines by their share of the shelf price.
      const returning = [...wanted].map(([pid, qty]) => ({ pid, qty, line: lines.find((l) => l.product_id === pid)! }));
      const weights = returning.map((r) => r.qty * r.line.unit_price);
      const totalW = sum(weights) || 1;
      const amounts = weights.map((w) => Math.floor((amount * w) / totalW));
      amounts[0] += amount - sum(amounts);

      // Money back follows how the customer paid; points the customer spent come back as points.
      const paid = await tx.query<{ method: PaymentMethod; amount: number }>(`SELECT method, amount FROM payments WHERE doc_no=$1 ORDER BY id`, [sale.doc_no]);
      const paidTotal = sum(paid.map((p) => p.amount));
      const priorMoney = sum(prior.flatMap((c) => c.payments.map((p) => p.amount)));
      const moneyShare = Math.min(sale.net === 0 ? 0 : Math.round((amount * paidTotal) / sale.net), paidTotal - priorMoney);
      const payments = allocate(paid, moneyShare);

      if (input.preview) {
        return {
          docNo: '(preview)', at: now.toISOString(), type: kind, saleDocNo: sale.doc_no, amount, reason: input.reason.trim(), employeeId: actor.id, approvedBy: actor.id, restock: input.restock !== false, payments,
          lines: returning.map((r, i) => ({ productId: r.pid, name: r.line.name, qty: r.qty, amount: amounts[i] })),
        };
      }
      const docNo = kind === 'void' ? `${sale.doc_no}-V` : `CN-${docPeriod(now)}-${String(await nextNumber(tx, `CN-${docPeriod(now)}`)).padStart(6, '0')}`;
      const restock = input.restock !== false;
      await tx.query(`INSERT INTO credit_notes (doc_no, sale_doc_no, shift_id, type, at, business_date, amount, reason, restock, employee_id, approved_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
        docNo, sale.doc_no, shiftId, kind, now, businessDate(now, cfg.cutoffHour), amount, input.reason.trim(), restock, actor.id, lateApprover.id,
      ]);
      for (const [i, r] of returning.entries()) {
        await tx.query(`INSERT INTO credit_note_lines (doc_no, product_id, name, qty, amount, cost) VALUES ($1,$2,$3,$4,$5,$6)`, [docNo, r.pid, r.line.name, r.qty, amounts[i], r.line.cost]);
        await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, at) VALUES ($1,$2,$3,$4,$5)`, [r.pid, r.qty, kind, docNo, now]);
        // Written off = it came back, then left again as waste, so the ledger shows both.
        if (!restock) await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, at) VALUES ($1,$2,'waste',$3,$4)`, [r.pid, -r.qty, docNo, now]);
      }
      if (kind === 'void') {
        for (const p of sale.cart.premiums) if (!p.outOfStock) await tx.query(`INSERT INTO stock_movements (premium_id, qty, kind, doc_no, at) VALUES ($1,$2,'void',$3,$4)`, [p.premiumId, p.qty, docNo, now]);
      }
      for (const p of payments) await tx.query(`INSERT INTO credit_note_payments (doc_no, method, amount) VALUES ($1,$2,$3)`, [docNo, p.method, p.amount]);

      if (sale.member_id && sale.net > 0) {
        const [pp] = await tx.query<{ claw: number; back: number }>(
          `SELECT COALESCE(SUM(points) FILTER (WHERE points<0),0)::int AS claw, COALESCE(SUM(points) FILTER (WHERE points>0),0)::int AS back
             FROM points_ledger WHERE doc_no IN (SELECT doc_no FROM credit_notes WHERE sale_doc_no=$1)`,
          [sale.doc_no],
        );
        const claw = Math.max(0, Math.min(sale.points_earned, Math.round((sale.points_earned * refundedAfter) / sale.net)) + (pp?.claw ?? 0));
        const back = Math.max(0, Math.min(sale.points_redeemed, Math.round((sale.points_redeemed * refundedAfter) / sale.net)) - (pp?.back ?? 0));
        if (claw > 0) await tx.query(`INSERT INTO points_ledger (member_id, points, kind, doc_no, at) VALUES ($1,$2,$3,$4,$5)`, [sale.member_id, -claw, kind, docNo, now]);
        if (back > 0) await tx.query(`INSERT INTO points_ledger (member_id, points, kind, doc_no, at) VALUES ($1,$2,$3,$4,$5)`, [sale.member_id, back, kind, docNo, now]);
      }
      await audit(tx, now, { actor: actor.id, approver: approver.id === actor.id ? undefined : approver.id, terminalId, action: `sale.${kind}`, entity: 'credit_note', entityId: docNo, after: { saleDocNo: sale.doc_no, amount, reason: input.reason, lateApprover: late ? lateApprover.id : undefined } });

      return {
        docNo, at: now.toISOString(), type: kind, saleDocNo: sale.doc_no, amount, reason: input.reason.trim(), employeeId: actor.id, approvedBy: lateApprover.id, restock, payments,
        lines: returning.map((r, i) => ({ productId: r.pid, name: r.line.name, qty: r.qty, amount: amounts[i] })),
      };
    });
  }

  /** Full tax invoice on request, referencing the bill. One per bill; numbered per branch (spec). */
  async taxInvoice(saleDocNo: string, buyer: TaxInvoiceInput, actor: Employee, terminalId: string): Promise<{ docNo: string }> {
    if (!buyer.buyerName?.trim() || !buyer.buyerAddress?.trim()) throw new DomainError('invalid', 'ใส่ชื่อและที่อยู่ผู้ซื้อ');
    if (!/^\d{13}$/.test(buyer.buyerTaxId ?? '')) throw new DomainError('invalid', 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      await this.loadSale(tx, saleDocNo);
      const [dup] = await tx.query(`SELECT 1 FROM tax_invoices WHERE sale_doc_no=$1`, [saleDocNo]);
      if (dup) throw new DomainError('conflict', 'บิลนี้ออกใบกำกับภาษีเต็มรูปแล้ว');
      const docNo = `TI-${docPeriod(now)}-${String(await nextNumber(tx, `TI-${docPeriod(now)}`)).padStart(6, '0')}`;
      await tx.query(`INSERT INTO tax_invoices (doc_no, sale_doc_no, at, buyer_name, buyer_address, buyer_tax_id, buyer_branch, issued_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [
        docNo, saleDocNo, now, buyer.buyerName.trim(), buyer.buyerAddress.trim(), buyer.buyerTaxId, buyer.buyerBranch?.trim() || 'สำนักงานใหญ่', actor.id,
      ]);
      await audit(tx, now, { actor: actor.id, terminalId, action: 'sale.tax_invoice', entity: 'tax_invoice', entityId: docNo, after: { saleDocNo } });
      return { docNo };
    });
  }

  private async loadSale(q: Queryable, docNo: string): Promise<SaleRow> {
    const [row] = await q.query<SaleRow>(`SELECT doc_no, shift_id, employee_id, at, member_id, net, vat, change, cart, pricing, points_earned, points_redeemed, points_value FROM sales WHERE doc_no=$1`, [docNo]);
    if (!row) throw new DomainError('not_found', 'ไม่พบบิลเลขที่นี้');
    return row;
  }

  private async creditNotesFor(q: Queryable, saleDocNo: string): Promise<CreditNote[]> {
    const notes = await q.query<{ doc_no: string; at: Date; type: 'void' | 'refund'; amount: number; reason: string; restock: boolean; employee_id: string; approved_by: string }>(
      `SELECT doc_no, at, type, amount, reason, restock, employee_id, approved_by FROM credit_notes WHERE sale_doc_no=$1 ORDER BY at, doc_no`,
      [saleDocNo],
    );
    const out: CreditNote[] = [];
    for (const n of notes) {
      const [lines, pays] = await Promise.all([
        q.query<{ product_id: string; name: string; qty: number; amount: number }>(`SELECT product_id, name, qty, amount FROM credit_note_lines WHERE doc_no=$1 ORDER BY id`, [n.doc_no]),
        q.query<{ method: PaymentMethod; amount: number }>(`SELECT method, amount FROM credit_note_payments WHERE doc_no=$1 ORDER BY id`, [n.doc_no]),
      ]);
      out.push({
        docNo: n.doc_no, at: iso(n.at), type: n.type, saleDocNo, amount: n.amount, reason: n.reason, employeeId: n.employee_id, approvedBy: n.approved_by, restock: n.restock,
        payments: pays.map((p) => ({ method: p.method, amount: p.amount })),
        lines: lines.map((l) => ({ productId: l.product_id, name: l.name, qty: l.qty, amount: l.amount })),
      });
    }
    return out;
  }

  /** Bills closed before snapshots existed: price against today's shelf prices. */
  private async fallbackSnapshot(q: Queryable, productIds: string[]): Promise<PricingSnapshot> {
    const products = await q.query<{ id: string; sku: string; name: string; category_id: string; price: number; member_price: number }>(`SELECT id, sku, name, category_id, price, member_price FROM products WHERE id = ANY($1)`, [productIds]);
    const promos = await q.query<{ body: PricingSnapshot['promotions'][number] }>(`SELECT body FROM promotions WHERE active`);
    return {
      products: products.map((p): Product => ({ id: p.id, sku: p.sku, name: p.name, categoryId: p.category_id, price: p.price, memberPrice: p.member_price, barcodes: [] })),
      promotions: promos.map((p) => p.body),
      premiums: [],
    };
  }
}

/** Splits `total` over the original payments in proportion, remainder to the first. */
function allocate(paid: Payment[] | { method: PaymentMethod; amount: number }[], total: number): { method: PaymentMethod; amount: number }[] {
  const all = sum(paid.map((p) => p.amount)) || 1;
  const parts = paid.map((p) => ({ method: p.method, amount: Math.floor((total * p.amount) / all) }));
  if (parts.length) parts[0].amount += total - sum(parts.map((p) => p.amount));
  return parts.filter((p) => p.amount > 0);
}
