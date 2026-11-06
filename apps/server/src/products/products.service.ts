import { Inject, Injectable } from '@nestjs/common';
import type { Category, Employee, Product, Promotion, Satang } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { assertValidProduct, cleanBarcodes, costToStore, type ProductInput, type ProductRecord } from './product-rules';
import { checkPromotion } from './promotion-rules';

/** What the till prices against: active products and promotions, with the gift names but not their stock (that is the stock feature's). */
export interface CatalogSnapshot {
  categories: Category[];
  products: Product[];
  premiums: { id: string; name: string }[];
  promotions: Promotion[];
}

/** Products, categories, promotions and free gifts. Every price change is kept in history and audited. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /* ---------- read, for other features ---------- */

  async snapshot(tx: Tx = this.db): Promise<CatalogSnapshot> {
    const [categories, products, premiums, promotions] = await Promise.all([this.categories(tx), this.products(tx, true), this.premiums(tx), this.promotions(tx, true)]);
    return {
      categories,
      products: products.map((p): Product => ({ id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, price: p.price, memberPrice: p.memberPrice, barcodes: p.barcodes, ...(p.imageKey ? { imageKey: p.imageKey } : {}) })),
      premiums,
      promotions: promotions.map(({ active: _active, ...p }) => p as Promotion),
    };
  }

  /** Every product with its cost and reorder point, for stock views and counts. */
  directory(tx: Tx = this.db): Promise<ProductRecord[]> {
    return this.products(tx, false);
  }

  async costs(tx: Tx, ids: string[]): Promise<Map<string, Satang>> {
    const wanted = new Set(ids);
    return new Map((await this.products(tx, false)).filter((p) => wanted.has(p.id)).map((p) => [p.id, p.cost]));
  }

  async updateCost(tx: Tx, productId: string, cost: Satang): Promise<void> {
    await tx.query(`UPDATE products SET cost=$2 WHERE id=$1`, [productId, cost]);
  }

  async productsExist(tx: Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return new Set((await tx.query<{ id: string }>(`SELECT id FROM products WHERE id = ANY($1)`, [ids])).map((r) => r.id));
  }

  async premiumsExist(tx: Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return new Set((await tx.query<{ id: string }>(`SELECT id FROM premiums WHERE id = ANY($1)`, [ids])).map((r) => r.id));
  }

  /* ---------- back office ---------- */

  async listProducts(canSeeCost: boolean): Promise<ProductRecord[]> {
    return (await this.products(this.db, false)).map((p) => (canSeeCost ? p : { ...p, cost: 0 }));
  }

  async saveProduct(id: string | null, input: ProductInput, actor: Employee, canSeeCost: boolean): Promise<ProductRecord> {
    assertValidProduct(input);
    const now = this.clock();
    const productId = await this.db.transaction(async (tx) => {
      if (!(await tx.query(`SELECT 1 FROM categories WHERE id=$1`, [input.categoryId])).length) throw new DomainError('invalid', 'ไม่พบหมวดหมู่นี้');
      const [row] = id ? await tx.query<{ price: number; member_price: number; cost: number }>(`SELECT price, member_price, cost FROM products WHERE id=$1 FOR UPDATE`, [id]) : [];
      if (id && !row) throw new DomainError('not_found', 'ไม่พบสินค้า');
      const before = row ? { price: row.price, memberPrice: row.member_price, cost: row.cost } : null;
      if ((await tx.query(`SELECT 1 FROM products WHERE sku=$1 AND id IS DISTINCT FROM $2`, [input.sku.trim(), id])).length) throw new DomainError('conflict', 'รหัสสินค้านี้มีอยู่แล้ว');
      const cost = costToStore(input, before?.cost, canSeeCost);
      const f = [input.sku.trim(), input.name.trim(), input.categoryId, input.price, input.memberPrice, input.imageKey ?? null, cost, input.reorderPoint ?? 0, input.active ?? true];
      let pid = id;
      if (!pid) {
        pid = `P${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        const [{ n }] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM products`);
        await tx.query(`INSERT INTO products (id, sku, name, category_id, price, member_price, image_key, cost, reorder_point, active, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [pid, ...f, n]);
      } else {
        await tx.query(`UPDATE products SET sku=$2, name=$3, category_id=$4, price=$5, member_price=$6, image_key=$7, cost=$8, reorder_point=$9, active=$10 WHERE id=$1`, [pid, ...f]);
      }
      if (input.barcodes) {
        const codes = cleanBarcodes(input.barcodes);
        if (codes.length) {
          const [taken] = await tx.query<{ code: string }>(`SELECT code FROM barcodes WHERE code = ANY($1) AND product_id <> $2`, [codes, pid]);
          if (taken) throw new DomainError('conflict', `บาร์โค้ด ${taken.code} ใช้กับสินค้าอื่นอยู่`);
        }
        await tx.query(`DELETE FROM barcodes WHERE product_id=$1`, [pid]);
        for (const c of codes) await tx.query(`INSERT INTO barcodes (code, product_id) VALUES ($1,$2)`, [c, pid]);
      }
      if (!before || before.price !== input.price || before.memberPrice !== input.memberPrice || before.cost !== cost) {
        await tx.query(`INSERT INTO price_history (product_id, price, member_price, cost, at, by) VALUES ($1,$2,$3,$4,$5,$6)`, [pid, input.price, input.memberPrice, cost, now, actor.id]);
        await this.audit.record(tx, now, {
          actor: actor.id, action: before ? 'product.price' : 'product.create', entity: 'product', entityId: pid,
          before: before && { price: before.price, memberPrice: before.memberPrice, ...(canSeeCost ? { cost: before.cost } : {}) },
          after: { price: input.price, memberPrice: input.memberPrice, ...(canSeeCost ? { cost } : {}) },
        });
      }
      return pid;
    });
    return (await this.listProducts(canSeeCost)).find((p) => p.id === productId) as ProductRecord;
  }

  listCategories(): Promise<Category[]> {
    return this.categories(this.db);
  }

  async saveCategory(id: string | null, name: string, actor: Employee): Promise<Category> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อหมวดหมู่');
    const cid = id ?? `C${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      if (id) await tx.query(`UPDATE categories SET name=$2 WHERE id=$1`, [id, name.trim()]);
      else await tx.query(`INSERT INTO categories (id, name, sort) VALUES ($1,$2,(SELECT COALESCE(MAX(sort),0)+1 FROM categories))`, [cid, name.trim()]);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: id ? 'category.update' : 'category.create', entity: 'category', entityId: cid, after: { name } });
    });
    return { id: cid, name: name.trim() };
  }

  async listPromotions(): Promise<{ promotions: (Promotion & { active: boolean })[]; premiums: { id: string; name: string }[] }> {
    return { promotions: await this.promotions(this.db, false), premiums: await this.premiums(this.db) };
  }

  async savePromotion(promo: Promotion, active: boolean, actor: Employee): Promise<void> {
    const refs = checkPromotion(promo);
    const now = this.clock();
    await this.db.transaction(async (tx) => {
      const products = await this.productsExist(tx, refs.productIds);
      const missing = refs.productIds.find((p) => !products.has(p));
      if (missing) throw new DomainError('invalid', 'โปรโมชันอ้างถึงสินค้าที่ไม่มีในระบบ', { productId: missing });
      const premiums = await this.premiumsExist(tx, refs.premiumIds);
      if (refs.premiumIds.some((p) => !premiums.has(p))) throw new DomainError('invalid', 'ไม่พบของแถมนี้');
      const exists = (await tx.query(`SELECT 1 FROM promotions WHERE id=$1`, [promo.id])).length > 0;
      if (exists) await tx.query(`UPDATE promotions SET kind=$2, body=$3, active=$4 WHERE id=$1`, [promo.id, promo.kind, JSON.stringify(promo), active]);
      else await tx.query(`INSERT INTO promotions (id, kind, body, active, sort) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort),0)+1 FROM promotions))`, [promo.id, promo.kind, JSON.stringify(promo), active]);
      await this.audit.record(tx, now, { actor: actor.id, action: exists ? 'promotion.update' : 'promotion.create', entity: 'promotion', entityId: promo.id, after: { ...promo, active } });
    });
  }

  async savePremium(name: string, actor: Employee): Promise<{ id: string; name: string }> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อของแถม');
    const id = `PR${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO premiums (id, name) VALUES ($1,$2)`, [id, name.trim()]);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'premium.save', entity: 'premium', entityId: id, after: { name } });
    });
    return { id, name: name.trim() };
  }

  /* ---------- queries ---------- */

  private categories(tx: Tx) {
    return tx.query<Category>(`SELECT id, name FROM categories ORDER BY sort, id`);
  }

  private premiums(tx: Tx) {
    return tx.query<{ id: string; name: string }>(`SELECT id, name FROM premiums ORDER BY id`);
  }

  private async promotions(tx: Tx, activeOnly: boolean) {
    const rows = await tx.query<{ body: Promotion; active: boolean }>(`SELECT body, active FROM promotions ${activeOnly ? 'WHERE active' : ''} ORDER BY sort, id`);
    return rows.map((r) => ({ ...r.body, active: r.active }));
  }

  private async products(tx: Tx, activeOnly: boolean): Promise<ProductRecord[]> {
    const rows = await tx.query<{ id: string; sku: string; name: string; category_id: string; price: number; member_price: number; image_key: string | null; cost: number; reorder_point: number; active: boolean }>(
      `SELECT id, sku, name, category_id, price, member_price, image_key, cost, reorder_point, active FROM products ${activeOnly ? 'WHERE active' : ''} ORDER BY sort, sku`,
    );
    const codes = await tx.query<{ code: string; product_id: string }>(`SELECT code, product_id FROM barcodes ORDER BY code`);
    return rows.map((r) => ({
      id: r.id, sku: r.sku, name: r.name, categoryId: r.category_id, price: r.price, memberPrice: r.member_price, cost: r.cost, reorderPoint: r.reorder_point, active: r.active,
      barcodes: codes.filter((c) => c.product_id === r.id).map((c) => c.code), ...(r.image_key ? { imageKey: r.image_key } : {}),
    }));
  }
}
