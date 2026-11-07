import { Inject, Injectable } from '@nestjs/common';
import { In } from 'typeorm';
import type { Category, Employee, Product as ShelfProduct, Promotion, Satang } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { BarcodeEntity, CategoryEntity, PremiumEntity, ProductEntity, PromotionEntity } from './entities/products.entities';
import { Product } from './domain/product';
import { ProductRepository } from './domain/product.repository';
import type { ProductInput, ProductRecord } from './product-rules';
import { checkPromotion } from './promotion-rules';

/** What the till prices against: active products and promotions, with the gift names but not their stock (that is the stock feature's). */
export interface CatalogSnapshot {
  categories: Category[];
  products: ShelfProduct[];
  premiums: { id: string; name: string }[];
  promotions: Promotion[];
}

/** Products, categories, promotions and free gifts. Every price change is kept in history and audited. */
@Injectable()
export class ProductsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly productRepo: ProductRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /* ---------- read, for other features ---------- */

  async snapshot(tx: Tx = this.db.manager): Promise<CatalogSnapshot> {
    const [categories, products, premiums, promotions] = await Promise.all([this.categories(tx), this.products(tx, true), this.premiums(tx), this.promotions(tx, true)]);
    return {
      categories,
      products: products.map((p): ShelfProduct => ({ id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, price: p.price, memberPrice: p.memberPrice, barcodes: p.barcodes, ...(p.imageKey ? { imageKey: p.imageKey } : {}) })),
      premiums,
      promotions: promotions.map(({ active: _active, ...p }) => p as Promotion),
    };
  }

  /** Every product with its cost and reorder point, for stock views and counts. */
  directory(tx: Tx = this.db.manager): Promise<ProductRecord[]> {
    return this.products(tx, false);
  }

  async costs(tx: Tx, ids: string[]): Promise<Map<string, Satang>> {
    const wanted = new Set(ids);
    return new Map((await this.products(tx, false)).filter((p) => wanted.has(p.id)).map((p) => [p.id, p.cost]));
  }

  async updateCost(tx: Tx, productId: string, cost: Satang): Promise<void> {
    await tx.update(ProductEntity, { id: productId }, { cost });
  }

  async productsExist(tx: Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return new Set((await tx.find(ProductEntity, { where: { id: In(ids) }, select: { id: true } })).map((r) => r.id));
  }

  async premiumsExist(tx: Tx, ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    return new Set((await tx.find(PremiumEntity, { where: { id: In(ids) }, select: { id: true } })).map((r) => r.id));
  }

  /* ---------- back office ---------- */

  async listProducts(canSeeCost: boolean): Promise<ProductRecord[]> {
    return (await this.products(this.db.manager, false)).map((p) => (canSeeCost ? p : { ...p, cost: 0 }));
  }

  async saveProduct(id: string | null, input: ProductInput, actor: Employee, canSeeCost: boolean): Promise<ProductRecord> {
    const now = this.clock();
    const productId = await this.db.transaction(async (tx) => {
      if (!(await this.productRepo.categoryExists(input.categoryId))) throw new DomainError('invalid', 'ไม่พบหมวดหมู่นี้');
      const ctx = { canSeeCost, now, by: actor.id };
      let product: Product;
      if (id) {
        const found = await this.productRepo.lockById(id);
        if (!found) throw new DomainError('not_found', 'ไม่พบสินค้า');
        product = found;
        product.edit(input, ctx);
      } else {
        product = Product.create({ id: `P${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`, sort: await this.productRepo.count(), data: input, canSeeCost, now, by: actor.id });
      }
      if (await this.productRepo.skuTaken(product.sku, id ?? undefined)) throw new DomainError('conflict', 'รหัสสินค้านี้มีอยู่แล้ว');
      const taken = await this.productRepo.barcodeTakenByOther(product.barcodes, product.id);
      if (taken) throw new DomainError('conflict', `บาร์โค้ด ${taken} ใช้กับสินค้าอื่นอยู่`);
      const change = product.pendingPriceChange;
      if (id) await this.productRepo.save(product);
      else await this.productRepo.add(product);
      if (change) {
        await this.audit.record(tx, now, {
          actor: actor.id, action: change.before ? 'product.price' : 'product.create', entity: 'product', entityId: product.id,
          before: change.before && { price: change.before.price, memberPrice: change.before.memberPrice, ...(canSeeCost ? { cost: change.before.cost } : {}) },
          after: { price: change.after.price, memberPrice: change.after.memberPrice, ...(canSeeCost ? { cost: change.after.cost } : {}) },
        });
      }
      return product.id;
    });
    return (await this.listProducts(canSeeCost)).find((p) => p.id === productId) as ProductRecord;
  }

  listCategories(): Promise<Category[]> {
    return this.categories(this.db.manager);
  }

  async saveCategory(id: string | null, name: string, actor: Employee): Promise<Category> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อหมวดหมู่');
    const cid = id ?? `C${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      if (id) await tx.update(CategoryEntity, { id }, { name: name.trim() });
      else await tx.insert(CategoryEntity, { id: cid, name: name.trim(), sort: ((await tx.maximum(CategoryEntity, 'sort')) ?? 0) + 1 });
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: id ? 'category.update' : 'category.create', entity: 'category', entityId: cid, after: { name } });
    });
    return { id: cid, name: name.trim() };
  }

  async listPromotions(): Promise<{ promotions: (Promotion & { active: boolean })[]; premiums: { id: string; name: string }[] }> {
    return { promotions: await this.promotions(this.db.manager, false), premiums: await this.premiums(this.db.manager) };
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
      const exists = await tx.existsBy(PromotionEntity, { id: promo.id });
      if (exists) await tx.update(PromotionEntity, { id: promo.id }, { kind: promo.kind, body: promo, active });
      else await tx.insert(PromotionEntity, { id: promo.id, kind: promo.kind, body: promo, active, sort: ((await tx.maximum(PromotionEntity, 'sort')) ?? 0) + 1 });
      await this.audit.record(tx, now, { actor: actor.id, action: exists ? 'promotion.update' : 'promotion.create', entity: 'promotion', entityId: promo.id, after: { ...promo, active } });
    });
  }

  async savePremium(name: string, actor: Employee): Promise<{ id: string; name: string }> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อของแถม');
    const id = `PR${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      await tx.insert(PremiumEntity, { id, name: name.trim() });
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'premium.save', entity: 'premium', entityId: id, after: { name } });
    });
    return { id, name: name.trim() };
  }

  /* ---------- queries ---------- */

  private async categories(tx: Tx): Promise<Category[]> {
    return (await tx.find(CategoryEntity, { order: { sort: 'ASC', id: 'ASC' } })).map((c) => ({ id: c.id, name: c.name }));
  }

  private async premiums(tx: Tx): Promise<{ id: string; name: string }[]> {
    return (await tx.find(PremiumEntity, { order: { id: 'ASC' } })).map((p) => ({ id: p.id, name: p.name }));
  }

  private async promotions(tx: Tx, activeOnly: boolean) {
    const rows = await tx.find(PromotionEntity, { where: activeOnly ? { active: true } : {}, order: { sort: 'ASC', id: 'ASC' } });
    return rows.map((r) => ({ ...(r.body as Promotion), active: r.active }));
  }

  private async products(tx: Tx, activeOnly: boolean): Promise<ProductRecord[]> {
    const rows = await tx.find(ProductEntity, { where: activeOnly ? { active: true } : {}, order: { sort: 'ASC', sku: 'ASC' } });
    const codes = await tx.find(BarcodeEntity, { order: { code: 'ASC' } });
    return rows.map((r) => ({
      id: r.id, sku: r.sku, name: r.name, categoryId: r.categoryId, price: r.price, memberPrice: r.memberPrice, cost: r.cost, reorderPoint: r.reorderPoint, active: r.active,
      barcodes: codes.filter((c) => c.productId === r.id).map((c) => c.code), ...(r.imageKey ? { imageKey: r.imageKey } : {}),
    }));
  }
}
