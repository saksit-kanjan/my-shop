import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { Category, Employee, Product, Promotion } from '@my-shop/contracts';
import { summarizeShift } from '@my-shop/domain';
import { DB, type Db, type Queryable } from '../db/db';
import { DomainError } from '../errors';
import { audit } from './audit';
import { nextNumber } from './sale.service';
import { SettingsService } from './settings.service';
import { ShiftService } from './shift.service';
import { businessDate, docPeriod, iso, type Clock } from './util';

export interface ProductAdmin extends Product {
  cost: number;
  reorderPoint: number;
  active: boolean;
  stock: number;
}

export interface ProductInput {
  sku: string;
  name: string;
  categoryId: string;
  price: number;
  memberPrice: number;
  cost?: number;
  reorderPoint?: number;
  barcodes?: string[];
  imageKey?: string;
  active?: boolean;
}

const isSatang = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 0;

/** Everything the back-office screens write that is not a sale: catalog, receiving, counting, day close. */
@Injectable()
export class BackOfficeService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ShiftService) private readonly shifts: ShiftService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Runs `fn` in a transaction and writes the audit row for it, for small admin writes that have no service of their own. */
  async audited(actor: Employee, action: string, detail: unknown, fn: (tx: Queryable) => Promise<unknown>, after: () => unknown = () => detail): Promise<void> {
    await this.db.transaction(async (tx) => {
      await fn(tx);
      await audit(tx, this.clock(), { actor: actor.id, action, after: after() });
    });
  }

  /* ---------------- products ---------------- */

  async listProducts(): Promise<ProductAdmin[]> {
    const rows = await this.db.query<{ id: string; sku: string; name: string; category_id: string; price: number; member_price: number; image_key: string | null; cost: number; reorder_point: number; active: boolean; stock: number }>(
      `SELECT p.id, p.sku, p.name, p.category_id, p.price, p.member_price, p.image_key, p.cost, p.reorder_point, p.active,
              COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=p.id),0)::int AS stock
         FROM products p ORDER BY p.sort, p.sku`,
    );
    const codes = await this.db.query<{ code: string; product_id: string }>(`SELECT code, product_id FROM barcodes ORDER BY code`);
    return rows.map((r) => ({
      id: r.id, sku: r.sku, name: r.name, categoryId: r.category_id, price: r.price, memberPrice: r.member_price, cost: r.cost, reorderPoint: r.reorder_point, active: r.active, stock: r.stock,
      barcodes: codes.filter((c) => c.product_id === r.id).map((c) => c.code), ...(r.image_key ? { imageKey: r.image_key } : {}),
    }));
  }

  async saveProduct(id: string | null, input: ProductInput, actor: Employee, canSeeCost: boolean): Promise<ProductAdmin> {
    if (!input.sku?.trim() || !input.name?.trim()) throw new DomainError('invalid', 'ใส่รหัสสินค้าและชื่อสินค้า');
    if (!isSatang(input.price) || !isSatang(input.memberPrice)) throw new DomainError('invalid', 'ราคาต้องเป็นจำนวนเงินที่ไม่ติดลบ');
    if (input.memberPrice > input.price) throw new DomainError('invalid', 'ราคาสมาชิกต้องไม่สูงกว่าราคาปกติ');
    if (input.cost !== undefined && !isSatang(input.cost)) throw new DomainError('invalid', 'ต้นทุนไม่ถูกต้อง');
    const now = this.clock();
    const pid = await this.db.transaction(async (tx) => {
      const [cat] = await tx.query(`SELECT 1 FROM categories WHERE id=$1`, [input.categoryId]);
      if (!cat) throw new DomainError('invalid', 'ไม่พบหมวดหมู่นี้');
      let productId = id;
      const [before] = id ? await tx.query<{ price: number; member_price: number; cost: number }>(`SELECT price, member_price, cost FROM products WHERE id=$1 FOR UPDATE`, [id]) : [];
      if (id && !before) throw new DomainError('not_found', 'ไม่พบสินค้า');
      const [dupSku] = await tx.query(`SELECT 1 FROM products WHERE sku=$1 AND id IS DISTINCT FROM $2`, [input.sku.trim(), id]);
      if (dupSku) throw new DomainError('conflict', 'รหัสสินค้านี้มีอยู่แล้ว');
      // Only the owner may see or change cost (spec: "ดูต้นทุนและกำไร").
      const cost = canSeeCost && input.cost !== undefined ? input.cost : before?.cost ?? 0;
      if (!id) {
        productId = `P${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        const [{ n }] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM products`);
        await tx.query(`INSERT INTO products (id, sku, name, category_id, price, member_price, image_key, cost, reorder_point, active, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          productId, input.sku.trim(), input.name.trim(), input.categoryId, input.price, input.memberPrice, input.imageKey ?? null, cost, input.reorderPoint ?? 0, input.active ?? true, n,
        ]);
      } else {
        await tx.query(`UPDATE products SET sku=$2, name=$3, category_id=$4, price=$5, member_price=$6, image_key=$7, cost=$8, reorder_point=$9, active=$10 WHERE id=$1`, [
          id, input.sku.trim(), input.name.trim(), input.categoryId, input.price, input.memberPrice, input.imageKey ?? null, cost, input.reorderPoint ?? 0, input.active ?? true,
        ]);
      }
      if (input.barcodes) {
        const codes = [...new Set(input.barcodes.map((c) => c.trim()).filter(Boolean))];
        const [taken] = await tx.query<{ code: string }>(`SELECT code FROM barcodes WHERE code = ANY($1) AND product_id <> $2`, [codes, productId]);
        if (taken) throw new DomainError('conflict', `บาร์โค้ด ${taken.code} ใช้กับสินค้าอื่นอยู่`);
        await tx.query(`DELETE FROM barcodes WHERE product_id=$1`, [productId]);
        for (const c of codes) await tx.query(`INSERT INTO barcodes (code, product_id) VALUES ($1,$2)`, [c, productId]);
      }
      if (!before || before.price !== input.price || before.member_price !== input.memberPrice || before.cost !== cost) {
        await tx.query(`INSERT INTO price_history (product_id, price, member_price, cost, at, by) VALUES ($1,$2,$3,$4,$5,$6)`, [productId, input.price, input.memberPrice, cost, now, actor.id]);
        await audit(tx, now, { actor: actor.id, action: before ? 'product.price' : 'product.create', entity: 'product', entityId: productId as string, before: before && { price: before.price, memberPrice: before.member_price, ...(canSeeCost ? { cost: before.cost } : {}) }, after: { price: input.price, memberPrice: input.memberPrice, ...(canSeeCost ? { cost } : {}) } });
      }
      return productId as string;
    });
    const p = (await this.listProducts()).find((x) => x.id === pid) as ProductAdmin;
    return canSeeCost ? p : { ...p, cost: 0 };
  }

  async listCategories(): Promise<Category[]> {
    return this.db.query<Category>(`SELECT id, name FROM categories ORDER BY sort, id`);
  }

  async saveCategory(id: string | null, name: string, actor: Employee): Promise<Category> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อหมวดหมู่');
    const cid = id ?? `C${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      if (id) await tx.query(`UPDATE categories SET name=$2 WHERE id=$1`, [id, name.trim()]);
      else await tx.query(`INSERT INTO categories (id, name, sort) VALUES ($1,$2,(SELECT COALESCE(MAX(sort),0)+1 FROM categories))`, [cid, name.trim()]);
      await audit(tx, this.clock(), { actor: actor.id, action: id ? 'category.update' : 'category.create', entity: 'category', entityId: cid, after: { name } });
    });
    return { id: cid, name: name.trim() };
  }

  /* ---------------- promotions ---------------- */

  async listPromotions(): Promise<(Promotion & { active: boolean })[]> {
    const rows = await this.db.query<{ body: Promotion; active: boolean }>(`SELECT body, active FROM promotions ORDER BY sort, id`);
    return rows.map((r) => ({ ...r.body, active: r.active }));
  }

  async savePromotion(promo: Promotion, active: boolean, actor: Employee): Promise<void> {
    await this.validatePromotion(this.db, promo);
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.query(`SELECT 1 FROM promotions WHERE id=$1`, [promo.id]);
      if (cur) await tx.query(`UPDATE promotions SET kind=$2, body=$3, active=$4 WHERE id=$1`, [promo.id, promo.kind, JSON.stringify(promo), active]);
      else await tx.query(`INSERT INTO promotions (id, kind, body, active, sort) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort),0)+1 FROM promotions))`, [promo.id, promo.kind, JSON.stringify(promo), active]);
      await audit(tx, now, { actor: actor.id, action: cur ? 'promotion.update' : 'promotion.create', entity: 'promotion', entityId: promo.id, after: { ...promo, active } });
    });
  }

  private async validatePromotion(q: Queryable, p: Promotion): Promise<void> {
    if (!p?.id?.trim() || !p.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อโปรโมชัน');
    const product = async (id: string) => {
      const [r] = await q.query(`SELECT 1 FROM products WHERE id=$1`, [id]);
      if (!r) throw new DomainError('invalid', 'โปรโมชันอ้างถึงสินค้าที่ไม่มีในระบบ', { productId: id });
    };
    const pos = (n: unknown, msg: string) => {
      if (!Number.isInteger(n) || (n as number) <= 0) throw new DomainError('invalid', msg);
    };
    switch (p.kind) {
      case 'qty':
        await product(p.productId);
        pos(p.minQty, 'จำนวนขั้นต่ำต้องมากกว่า 0');
        if (!isSatang(p.unitPrice)) throw new DomainError('invalid', 'ราคาโปรไม่ถูกต้อง');
        if (p.countMode !== 'set' && p.countMode !== 'all') throw new DomainError('invalid', 'เลือกวิธีนับโปร');
        break;
      case 'gift':
        await product(p.buyProductId);
        pos(p.buyQty, 'จำนวนที่ต้องซื้อต้องมากกว่า 0');
        pos(p.giftQty, 'จำนวนของแถมต้องมากกว่า 0');
        if (p.gift.type === 'product') await product(p.gift.productId);
        else {
          const [r] = await q.query(`SELECT 1 FROM premiums WHERE id=$1`, [p.gift.premiumId]);
          if (!r) throw new DomainError('invalid', 'ไม่พบของแถมนี้');
        }
        break;
      case 'bogo':
        await product(p.productId);
        pos(p.buyQty, 'จำนวนที่ต้องซื้อต้องมากกว่า 0');
        pos(p.freeQty, 'จำนวนที่แถมต้องมากกว่า 0');
        break;
      case 'bill':
        pos(p.minAmount, 'ยอดขั้นต่ำต้องมากกว่า 0');
        pos(p.discount, 'ส่วนลดต้องมากกว่า 0');
        if (p.discount >= p.minAmount) throw new DomainError('invalid', 'ส่วนลดต้องน้อยกว่ายอดขั้นต่ำ');
        break;
      default:
        throw new DomainError('invalid', 'ประเภทโปรโมชันไม่ถูกต้อง');
    }
  }

  async savePremium(id: string | null, name: string, actor: Employee): Promise<{ id: string; name: string }> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อของแถม');
    const pid = id ?? `PR${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO premiums (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [pid, name.trim()]);
      await audit(tx, this.clock(), { actor: actor.id, action: 'premium.save', entity: 'premium', entityId: pid, after: { name } });
    });
    return { id: pid, name: name.trim() };
  }

  /** Premiums (free gifts) have their own stock; this adds to it (or removes with a negative number) through the ledger. */
  async premiumStock(id: string, qty: number, actor: Employee): Promise<void> {
    if (!Number.isInteger(qty) || qty === 0) throw new DomainError('invalid', 'ใส่จำนวนที่เติมหรือตัดออก');
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const [p] = await tx.query(`SELECT 1 FROM premiums WHERE id=$1`, [id]);
      if (!p) throw new DomainError('not_found', 'ไม่พบของแถมนี้');
      await tx.query(`INSERT INTO stock_movements (premium_id, qty, kind, doc_no, at) VALUES ($1,$2,$3,'PREMIUM',$4)`, [id, qty, qty > 0 ? 'receive' : 'adjust_other', now]);
      await audit(tx, now, { actor: actor.id, action: 'stock.premium', entity: 'premium', entityId: id, after: { qty } });
    });
  }

  /* ---------------- suppliers and receiving ---------------- */

  listSuppliers() {
    return this.db.query<{ id: string; name: string; contact: string | null; terms: string | null; active: boolean }>(`SELECT id, name, contact, terms, active FROM suppliers ORDER BY name`);
  }

  async saveSupplier(id: string | null, s: { name: string; contact?: string; terms?: string; active?: boolean }, actor: Employee): Promise<string> {
    if (!s.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อผู้ขาย');
    const sid = id ?? `S${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO suppliers (id, name, contact, terms, active) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, terms=EXCLUDED.terms, active=EXCLUDED.active`, [sid, s.name.trim(), s.contact ?? null, s.terms ?? null, s.active ?? true]);
      await audit(tx, this.clock(), { actor: actor.id, action: 'supplier.save', entity: 'supplier', entityId: sid, after: s });
    });
    return sid;
  }

  /** Goods in. Stock goes up through the ledger and the product's average cost moves with it (spec). */
  async receive(input: { supplierId: string; ref?: string; note?: string; lines: { productId: string; qty: number; unitCost: number }[] }, actor: Employee, canSeeCost: boolean): Promise<{ docNo: string }> {
    if (!input.lines?.length) throw new DomainError('invalid', 'เพิ่มสินค้าที่รับอย่างน้อย 1 รายการ');
    for (const l of input.lines) if (!Number.isInteger(l.qty) || l.qty <= 0 || !isSatang(l.unitCost)) throw new DomainError('invalid', 'จำนวนและต้นทุนต่อหน่วยไม่ถูกต้อง');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [sup] = await tx.query(`SELECT 1 FROM suppliers WHERE id=$1`, [input.supplierId]);
      if (!sup) throw new DomainError('invalid', 'เลือกผู้ขาย');
      const period = `GR-${docPeriod(now)}`;
      const docNo = `${period}-${String(await nextNumber(tx, period)).padStart(6, '0')}`;
      await tx.query(`INSERT INTO receipts (doc_no, supplier_id, at, ref, note, employee_id) VALUES ($1,$2,$3,$4,$5,$6)`, [docNo, input.supplierId, now, input.ref ?? null, input.note ?? null, actor.id]);
      for (const l of input.lines) {
        const [p] = await tx.query<{ cost: number; stock: number }>(`SELECT cost, COALESCE((SELECT SUM(qty) FROM stock_movements WHERE product_id=$1),0)::int AS stock FROM products WHERE id=$1 FOR UPDATE`, [l.productId]);
        if (!p) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ', { productId: l.productId });
        await tx.query(`INSERT INTO receipt_lines (doc_no, product_id, qty, unit_cost) VALUES ($1,$2,$3,$4)`, [docNo, l.productId, l.qty, l.unitCost]);
        await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, unit_cost, at) VALUES ($1,$2,'receive',$3,$4,$5)`, [l.productId, l.qty, docNo, l.unitCost, now]);
        // Weighted average over what is on hand; with nothing (or negative) on hand the new cost stands.
        const onHand = Math.max(0, p.stock);
        const avg = Math.round((onHand * p.cost + l.qty * l.unitCost) / (onHand + l.qty));
        await tx.query(`UPDATE products SET cost=$2 WHERE id=$1`, [l.productId, avg]);
      }
      await audit(tx, now, { actor: actor.id, action: 'stock.receive', entity: 'receipt', entityId: docNo, after: { supplierId: input.supplierId, lines: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(canSeeCost ? { unitCost: l.unitCost } : {}) })) } });
      return { docNo };
    });
  }

  async listReceipts(limit = 50) {
    const rows = await this.db.query<{ doc_no: string; at: Date; supplier: string; ref: string | null; qty: number }>(
      `SELECT r.doc_no, r.at, s.name AS supplier, r.ref, COALESCE((SELECT SUM(qty) FROM receipt_lines l WHERE l.doc_no=r.doc_no),0)::int AS qty FROM receipts r JOIN suppliers s ON s.id=r.supplier_id ORDER BY r.at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ docNo: r.doc_no, at: iso(r.at), supplier: r.supplier, ref: r.ref, qty: r.qty }));
  }

  /* ---------------- stock ---------------- */

  async stock(q: { categoryId?: string; lowOnly?: boolean } = {}, canSeeCost = false) {
    const list = await this.listProducts();
    return list
      .filter((p) => p.active && (!q.categoryId || p.categoryId === q.categoryId) && (!q.lowOnly || p.stock <= p.reorderPoint))
      .map((p) => ({ productId: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, stock: p.stock, reorderPoint: p.reorderPoint, low: p.reorderPoint > 0 && p.stock <= p.reorderPoint, ...(canSeeCost ? { value: Math.max(0, p.stock) * p.cost } : {}) }));
  }

  async movements(productId: string, limit = 200) {
    const rows = await this.db.query<{ at: Date; qty: number; kind: string; doc_no: string | null }>(`SELECT at, qty, kind, doc_no FROM stock_movements WHERE product_id=$1 ORDER BY id DESC LIMIT $2`, [productId, limit]);
    return rows.map((r) => ({ at: iso(r.at), qty: r.qty, kind: r.kind, docNo: r.doc_no }));
  }

  /** Waste, loss, expiry: each needs a reason and leaves a ledger row (spec: "ตัดของเสีย หาย หมดอายุ"). */
  async adjust(input: { productId: string; qty: number; reason: 'waste' | 'lost' | 'expired' | 'other'; note?: string }, actor: Employee): Promise<void> {
    if (!Number.isInteger(input.qty) || input.qty === 0) throw new DomainError('invalid', 'ใส่จำนวนที่ปรับ');
    if (!['waste', 'lost', 'expired', 'other'].includes(input.reason)) throw new DomainError('invalid', 'เลือกเหตุผลการปรับสต็อก');
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const [p] = await tx.query(`SELECT 1 FROM products WHERE id=$1`, [input.productId]);
      if (!p) throw new DomainError('not_found', 'ไม่พบสินค้า');
      const period = `ADJ-${docPeriod(now)}`;
      const docNo = `${period}-${String(await nextNumber(tx, period)).padStart(6, '0')}`;
      await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, at) VALUES ($1,$2,$3,$4,$5)`, [input.productId, input.qty, `adjust_${input.reason}`, docNo, now]);
      await audit(tx, now, { actor: actor.id, action: 'stock.adjust', entity: 'product', entityId: input.productId, after: { qty: input.qty, reason: input.reason, note: input.note, docNo } });
    });
  }

  /* ---------------- stock count ---------------- */

  async startCount(scope: { categoryId?: string }, actor: Employee): Promise<{ id: string; lines: number }> {
    const now = this.clock();
    const id = crypto.randomUUID();
    return this.db.transaction(async (tx) => {
      const [open] = await tx.query(`SELECT 1 FROM stock_counts WHERE status='open'`);
      if (open) throw new DomainError('conflict', 'มีรอบตรวจนับที่ยังไม่ปิดอยู่ ปิดหรืออนุมัติรอบนั้นก่อน');
      await tx.query(`INSERT INTO stock_counts (id, scope, category_id, started_at, started_by) VALUES ($1,$2,$3,$4,$5)`, [id, scope.categoryId ? 'category' : 'all', scope.categoryId ?? null, now, actor.id]);
      // The snapshot of system stock at the moment counting starts (spec step 2).
      const res = await tx.query<{ n: number }>(
        `WITH ins AS (INSERT INTO stock_count_lines (count_id, product_id, snapshot_qty)
           SELECT $1, p.id, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=p.id),0)::int FROM products p
            WHERE p.active AND ($2::text IS NULL OR p.category_id=$2) RETURNING 1) SELECT count(*)::int AS n FROM ins`,
        [id, scope.categoryId ?? null],
      );
      await audit(tx, now, { actor: actor.id, action: 'count.start', entity: 'stock_count', entityId: id });
      return { id, lines: res[0]?.n ?? 0 };
    });
  }

  async saveCounted(countId: string, counted: { productId: string; qty: number }[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ status: string }>(`SELECT status FROM stock_counts WHERE id=$1`, [countId]);
      if (!c) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
      if (c.status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
      for (const l of counted) {
        if (!Number.isInteger(l.qty) || l.qty < 0) throw new DomainError('invalid', 'จำนวนที่นับต้องเป็นเลขจำนวนเต็ม 0 ขึ้นไป');
        await tx.query(`UPDATE stock_count_lines SET counted_qty=$3 WHERE count_id=$1 AND product_id=$2`, [countId, l.productId, l.qty]);
      }
    });
  }

  async getCount(countId: string) {
    const [c] = await this.db.query<{ id: string; scope: string; category_id: string | null; started_at: Date; status: string }>(`SELECT id, scope, category_id, started_at, status FROM stock_counts WHERE id=$1`, [countId]);
    if (!c) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
    const lines = await this.db.query<{ product_id: string; sku: string; name: string; snapshot_qty: number; counted_qty: number | null; now_qty: number }>(
      `SELECT l.product_id, p.sku, p.name, l.snapshot_qty, l.counted_qty, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=l.product_id),0)::int AS now_qty
         FROM stock_count_lines l JOIN products p ON p.id=l.product_id WHERE l.count_id=$1 ORDER BY p.sku`,
      [countId],
    );
    return {
      id: c.id, scope: c.scope, categoryId: c.category_id, startedAt: iso(c.started_at), status: c.status,
      // Difference = counted - (snapshot + movements since the count began) = counted - the ledger balance now.
      lines: lines.map((l) => ({ productId: l.product_id, sku: l.sku, name: l.name, snapshot: l.snapshot_qty, soldSince: l.now_qty - l.snapshot_qty, counted: l.counted_qty, diff: l.counted_qty == null ? null : l.counted_qty - l.now_qty })),
    };
  }

  async approveCount(countId: string, actor: Employee): Promise<{ adjusted: number }> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ status: string }>(`SELECT status FROM stock_counts WHERE id=$1 FOR UPDATE`, [countId]);
      if (!c) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
      if (c.status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
      const lines = await tx.query<{ product_id: string; counted_qty: number; now_qty: number }>(
        `SELECT l.product_id, l.counted_qty, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=l.product_id),0)::int AS now_qty
           FROM stock_count_lines l WHERE l.count_id=$1 AND l.counted_qty IS NOT NULL`,
        [countId],
      );
      let adjusted = 0;
      for (const l of lines) {
        const diff = l.counted_qty - l.now_qty;
        if (diff === 0) continue;
        await tx.query(`INSERT INTO stock_movements (product_id, qty, kind, doc_no, at) VALUES ($1,$2,'count',$3,$4)`, [l.product_id, diff, `COUNT-${countId.slice(0, 8)}`, now]);
        adjusted += 1;
      }
      await tx.query(`UPDATE stock_counts SET status='approved', approved_at=$2, approved_by=$3 WHERE id=$1`, [countId, now, actor.id]);
      await audit(tx, now, { actor: actor.id, action: 'count.approve', entity: 'stock_count', entityId: countId, after: { adjusted } });
      return { adjusted };
    });
  }

  async cancelCount(countId: string, actor: Employee): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [c] = await tx.query<{ status: string }>(`SELECT status FROM stock_counts WHERE id=$1 FOR UPDATE`, [countId]);
      if (!c) throw new DomainError('not_found', 'ไม่พบรอบตรวจนับ');
      if (c.status !== 'open') throw new DomainError('conflict', 'รอบตรวจนับนี้ปิดแล้ว');
      await tx.query(`UPDATE stock_counts SET status='cancelled' WHERE id=$1`, [countId]);
      await audit(tx, this.clock(), { actor: actor.id, action: 'count.cancel', entity: 'stock_count', entityId: countId });
    });
  }

  async openCount(): Promise<string | null> {
    const [c] = await this.db.query<{ id: string }>(`SELECT id FROM stock_counts WHERE status='open'`);
    return c?.id ?? null;
  }

  /* ---------------- shifts and day close ---------------- */

  async dayShifts(date: string) {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM shifts WHERE business_date=$1::date ORDER BY opened_at`, [date]);
    const [closed] = await this.db.query<{ closed_at: Date; closed_by: string }>(`SELECT closed_at, closed_by FROM day_closes WHERE business_date=$1::date`, [date]);
    const names = new Map((await this.db.query<{ id: string; name: string }>(`SELECT id, name FROM employees`)).map((e) => [e.id, e.name]));
    const shifts = [];
    for (const r of rows) {
      const shift = await this.shifts.getShift(r.id);
      if (!shift) continue;
      const s = summarizeShift(shift);
      shifts.push({ id: shift.id, terminalId: shift.terminalId, cashier: names.get(shift.employeeId) ?? shift.employeeId, openedAt: shift.openedAt, closedAt: shift.closedAt ?? null, bills: s.bills, net: s.net, expected: s.expectedCash, counted: shift.counted ?? null, variance: shift.counted != null ? shift.counted - s.expectedCash : null, note: shift.note ?? null });
    }
    return { date, closed: closed ? { at: iso(closed.closed_at), by: closed.closed_by } : null, shifts };
  }

  /** Manager closes the day once every shift of it is closed; the figures are frozen for reports (spec step 6). */
  async closeDay(date: string, actor: Employee): Promise<{ date: string; net: number; bills: number }> {
    const now = this.clock();
    const day = await this.dayShifts(date);
    if (day.closed) throw new DomainError('conflict', 'ปิดวันนี้ไปแล้ว');
    if (day.shifts.length === 0) throw new DomainError('invalid', 'วันนี้ยังไม่มีกะ');
    const open = day.shifts.filter((s) => !s.closedAt);
    if (open.length) throw new DomainError('conflict', `ยังมี ${open.length} กะที่ไม่ได้ปิด (${open.map((s) => s.terminalId).join(', ')})`);
    const summary = { net: day.shifts.reduce((a, s) => a + s.net, 0), bills: day.shifts.reduce((a, s) => a + s.bills, 0), variance: day.shifts.reduce((a, s) => a + (s.variance ?? 0), 0), shifts: day.shifts.length };
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO day_closes (business_date, closed_at, closed_by, summary) VALUES ($1,$2,$3,$4)`, [date, now, actor.id, JSON.stringify(summary)]);
      await audit(tx, now, { actor: actor.id, action: 'day.close', entity: 'day', entityId: date, after: summary });
    });
    return { date, net: summary.net, bills: summary.bills };
  }

  async today(): Promise<string> {
    return businessDate(this.clock(), (await this.settings.getAll()).cutoffHour);
  }
}
