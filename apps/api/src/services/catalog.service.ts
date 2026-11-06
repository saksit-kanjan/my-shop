import { Inject, Injectable } from '@nestjs/common';
import type { Catalog, Promotion } from '@my-shop/contracts';
import { DB, type Db, type Queryable } from '../db/db';

@Injectable()
export class CatalogService {
  constructor(
    @Inject(DB) private readonly db: Db,
  ) {}

  async getCatalog(q: Queryable = this.db): Promise<Catalog> {
    const [categories, products, barcodes, premiums, promos, stock] = await Promise.all([
      q.query<{ id: string; name: string }>(`SELECT id, name FROM categories ORDER BY sort, id`),
      q.query<{ id: string; sku: string; name: string; category_id: string; price: number; member_price: number; image_key: string | null }>(
        `SELECT id, sku, name, category_id, price, member_price, image_key FROM products WHERE active ORDER BY sort, sku`,
      ),
      q.query<{ code: string; product_id: string }>(`SELECT code, product_id FROM barcodes ORDER BY code`),
      q.query<{ id: string; name: string }>(`SELECT id, name FROM premiums ORDER BY id`),
      q.query<{ body: Promotion }>(`SELECT body FROM promotions WHERE active ORDER BY sort, id`),
      q.query<{ premium_id: string; qty: number }>(`SELECT premium_id, COALESCE(SUM(qty),0)::int AS qty FROM stock_movements WHERE premium_id IS NOT NULL GROUP BY premium_id`),
    ]);
    const premiumStock = new Map(stock.map((s) => [s.premium_id, Number(s.qty)]));
    return {
      categories,
      products: products.map((p) => ({
        id: p.id,
        sku: p.sku,
        name: p.name,
        categoryId: p.category_id,
        price: p.price,
        memberPrice: p.member_price,
        barcodes: barcodes.filter((b) => b.product_id === p.id).map((b) => b.code),
        ...(p.image_key ? { imageKey: p.image_key } : {}),
      })),
      premiums: premiums.map((p) => ({ id: p.id, name: p.name, stock: premiumStock.get(p.id) ?? 0 })),
      promotions: promos.map((p) => p.body),
    };
  }
}
