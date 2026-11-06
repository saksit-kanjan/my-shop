import { Injectable } from '@nestjs/common';
import type { Category, Promotion, Satang } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import { CatalogRepository, type NewProduct } from '../domain/catalog.repository';
import type { ProductRecord } from '../domain/product';

@Injectable()
export class PgCatalogRepository extends CatalogRepository {
  categories(tx: Tx) {
    return tx.query<Category>(`SELECT id, name FROM categories ORDER BY sort, id`);
  }

  async categoryExists(tx: Tx, id: string) {
    return (await tx.query(`SELECT 1 FROM categories WHERE id=$1`, [id])).length > 0;
  }

  async saveCategory(tx: Tx, id: string, name: string, isNew: boolean) {
    if (isNew) await tx.query(`INSERT INTO categories (id, name, sort) VALUES ($1,$2,(SELECT COALESCE(MAX(sort),0)+1 FROM categories))`, [id, name]);
    else await tx.query(`UPDATE categories SET name=$2 WHERE id=$1`, [id, name]);
  }

  async products(tx: Tx, activeOnly: boolean): Promise<ProductRecord[]> {
    const rows = await tx.query<{ id: string; sku: string; name: string; category_id: string; price: number; member_price: number; image_key: string | null; cost: number; reorder_point: number; active: boolean }>(
      `SELECT id, sku, name, category_id, price, member_price, image_key, cost, reorder_point, active FROM products ${activeOnly ? 'WHERE active' : ''} ORDER BY sort, sku`,
    );
    const codes = await tx.query<{ code: string; product_id: string }>(`SELECT code, product_id FROM barcodes ORDER BY code`);
    return rows.map((r) => ({
      id: r.id, sku: r.sku, name: r.name, categoryId: r.category_id, price: r.price, memberPrice: r.member_price, cost: r.cost, reorderPoint: r.reorder_point, active: r.active,
      barcodes: codes.filter((c) => c.product_id === r.id).map((c) => c.code), ...(r.image_key ? { imageKey: r.image_key } : {}),
    }));
  }

  async productCount(tx: Tx) {
    const [r] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM products`);
    return r.n;
  }

  async productsExist(tx: Tx, ids: string[]) {
    if (ids.length === 0) return new Set<string>();
    return new Set((await tx.query<{ id: string }>(`SELECT id FROM products WHERE id = ANY($1)`, [ids])).map((r) => r.id));
  }

  async priceRow(tx: Tx, id: string, lock: boolean) {
    const [r] = await tx.query<{ price: number; member_price: number; cost: number }>(`SELECT price, member_price, cost FROM products WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return r ? { price: r.price, memberPrice: r.member_price, cost: r.cost } : null;
  }

  async skuTaken(tx: Tx, sku: string, exceptId: string | null) {
    return (await tx.query(`SELECT 1 FROM products WHERE sku=$1 AND id IS DISTINCT FROM $2`, [sku, exceptId])).length > 0;
  }

  async insertProduct(tx: Tx, p: NewProduct) {
    await tx.query(`INSERT INTO products (id, sku, name, category_id, price, member_price, image_key, cost, reorder_point, active, sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      p.id, p.sku, p.name, p.categoryId, p.price, p.memberPrice, p.imageKey, p.cost, p.reorderPoint, p.active, p.sort,
    ]);
  }

  async updateProduct(tx: Tx, id: string, p: Omit<NewProduct, 'id' | 'sort'>) {
    await tx.query(`UPDATE products SET sku=$2, name=$3, category_id=$4, price=$5, member_price=$6, image_key=$7, cost=$8, reorder_point=$9, active=$10 WHERE id=$1`, [
      id, p.sku, p.name, p.categoryId, p.price, p.memberPrice, p.imageKey, p.cost, p.reorderPoint, p.active,
    ]);
  }

  async barcodeUsedByOther(tx: Tx, codes: string[], productId: string) {
    if (codes.length === 0) return null;
    const [r] = await tx.query<{ code: string }>(`SELECT code FROM barcodes WHERE code = ANY($1) AND product_id <> $2`, [codes, productId]);
    return r?.code ?? null;
  }

  async replaceBarcodes(tx: Tx, productId: string, codes: string[]) {
    await tx.query(`DELETE FROM barcodes WHERE product_id=$1`, [productId]);
    for (const c of codes) await tx.query(`INSERT INTO barcodes (code, product_id) VALUES ($1,$2)`, [c, productId]);
  }

  async recordPrice(tx: Tx, productId: string, price: Satang, memberPrice: Satang, cost: Satang, at: Date, by: string) {
    await tx.query(`INSERT INTO price_history (product_id, price, member_price, cost, at, by) VALUES ($1,$2,$3,$4,$5,$6)`, [productId, price, memberPrice, cost, at, by]);
  }

  async setCost(tx: Tx, productId: string, cost: Satang) {
    await tx.query(`UPDATE products SET cost=$2 WHERE id=$1`, [productId, cost]);
  }

  async promotions(tx: Tx, activeOnly: boolean) {
    const rows = await tx.query<{ body: Promotion; active: boolean }>(`SELECT body, active FROM promotions ${activeOnly ? 'WHERE active' : ''} ORDER BY sort, id`);
    return rows.map((r) => ({ ...r.body, active: r.active }));
  }

  async promotionExists(tx: Tx, id: string) {
    return (await tx.query(`SELECT 1 FROM promotions WHERE id=$1`, [id])).length > 0;
  }

  async savePromotion(tx: Tx, p: Promotion, active: boolean, isNew: boolean) {
    if (isNew) await tx.query(`INSERT INTO promotions (id, kind, body, active, sort) VALUES ($1,$2,$3,$4,(SELECT COALESCE(MAX(sort),0)+1 FROM promotions))`, [p.id, p.kind, JSON.stringify(p), active]);
    else await tx.query(`UPDATE promotions SET kind=$2, body=$3, active=$4 WHERE id=$1`, [p.id, p.kind, JSON.stringify(p), active]);
  }

  premiums(tx: Tx) {
    return tx.query<{ id: string; name: string }>(`SELECT id, name FROM premiums ORDER BY id`);
  }

  async premiumsExist(tx: Tx, ids: string[]) {
    if (ids.length === 0) return new Set<string>();
    return new Set((await tx.query<{ id: string }>(`SELECT id FROM premiums WHERE id = ANY($1)`, [ids])).map((r) => r.id));
  }

  async savePremium(tx: Tx, id: string, name: string) {
    await tx.query(`INSERT INTO premiums (id, name) VALUES ($1,$2) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name`, [id, name]);
  }
}
