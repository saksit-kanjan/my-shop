import { Inject, Injectable } from '@nestjs/common';
import type { Category, Employee, Promotion } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { DomainError } from '../common/errors/domain-error';
import { CatalogRepository } from './repositories/catalog.repository';
import { assertValidProduct, cleanBarcodes, costToStore, type ProductInput, type ProductRecord } from './entities/product.entity';
import { checkPromotion } from './policies/promotion-rules';

/** Back-office edits of products, categories, promotions and free gifts. Every price change is kept in history and audited. */
@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: CatalogRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async listProducts(canSeeCost: boolean): Promise<ProductRecord[]> {
    return (await this.repo.products(this.uow.read, false)).map((p) => (canSeeCost ? p : { ...p, cost: 0 }));
  }

  async saveProduct(id: string | null, input: ProductInput, actor: Employee, canSeeCost: boolean): Promise<ProductRecord> {
    assertValidProduct(input);
    const now = this.clock();
    const productId = await this.uow.run(async (tx) => {
      if (!(await this.repo.categoryExists(tx, input.categoryId))) throw new DomainError('invalid', 'ไม่พบหมวดหมู่นี้');
      const before = id ? await this.repo.priceRow(tx, id, true) : null;
      if (id && !before) throw new DomainError('not_found', 'ไม่พบสินค้า');
      if (await this.repo.skuTaken(tx, input.sku.trim(), id)) throw new DomainError('conflict', 'รหัสสินค้านี้มีอยู่แล้ว');
      const cost = costToStore(input, before?.cost, canSeeCost);
      const fields = { sku: input.sku.trim(), name: input.name.trim(), categoryId: input.categoryId, price: input.price, memberPrice: input.memberPrice, imageKey: input.imageKey ?? null, cost, reorderPoint: input.reorderPoint ?? 0, active: input.active ?? true };
      let pid = id;
      if (!pid) {
        pid = `P${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
        await this.repo.insertProduct(tx, { id: pid, ...fields, sort: await this.repo.productCount(tx) });
      } else await this.repo.updateProduct(tx, pid, fields);
      if (input.barcodes) {
        const codes = cleanBarcodes(input.barcodes);
        const taken = await this.repo.barcodeUsedByOther(tx, codes, pid);
        if (taken) throw new DomainError('conflict', `บาร์โค้ด ${taken} ใช้กับสินค้าอื่นอยู่`);
        await this.repo.replaceBarcodes(tx, pid, codes);
      }
      if (!before || before.price !== input.price || before.memberPrice !== input.memberPrice || before.cost !== cost) {
        await this.repo.recordPrice(tx, pid, input.price, input.memberPrice, cost, now, actor.id);
        await this.audit.record(tx, now, {
          actor: actor.id, action: before ? 'product.price' : 'product.create', entity: 'product', entityId: pid,
          before: before && { price: before.price, memberPrice: before.memberPrice, ...(canSeeCost ? { cost: before.cost } : {}) },
          after: { price: input.price, memberPrice: input.memberPrice, ...(canSeeCost ? { cost } : {}) },
        });
      }
      return pid;
    });
    const saved = (await this.listProducts(canSeeCost)).find((p) => p.id === productId) as ProductRecord;
    return saved;
  }

  listCategories(): Promise<Category[]> {
    return this.repo.categories(this.uow.read);
  }

  async saveCategory(id: string | null, name: string, actor: Employee): Promise<Category> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อหมวดหมู่');
    const cid = id ?? `C${Date.now().toString(36)}`;
    await this.uow.run(async (tx) => {
      await this.repo.saveCategory(tx, cid, name.trim(), !id);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: id ? 'category.update' : 'category.create', entity: 'category', entityId: cid, after: { name } });
    });
    return { id: cid, name: name.trim() };
  }

  async listPromotions(): Promise<{ promotions: (Promotion & { active: boolean })[]; premiums: { id: string; name: string }[] }> {
    const read = this.uow.read;
    return { promotions: await this.repo.promotions(read, false), premiums: await this.repo.premiums(read) };
  }

  async savePromotion(promo: Promotion, active: boolean, actor: Employee): Promise<void> {
    const refs = checkPromotion(promo);
    const now = this.clock();
    await this.uow.run(async (tx) => {
      const products = await this.repo.productsExist(tx, refs.productIds);
      const missing = refs.productIds.find((p) => !products.has(p));
      if (missing) throw new DomainError('invalid', 'โปรโมชันอ้างถึงสินค้าที่ไม่มีในระบบ', { productId: missing });
      const premiums = await this.repo.premiumsExist(tx, refs.premiumIds);
      if (refs.premiumIds.some((p) => !premiums.has(p))) throw new DomainError('invalid', 'ไม่พบของแถมนี้');
      const exists = await this.repo.promotionExists(tx, promo.id);
      await this.repo.savePromotion(tx, promo, active, !exists);
      await this.audit.record(tx, now, { actor: actor.id, action: exists ? 'promotion.update' : 'promotion.create', entity: 'promotion', entityId: promo.id, after: { ...promo, active } });
    });
  }

  async savePremium(id: string | null, name: string, actor: Employee): Promise<{ id: string; name: string }> {
    if (!name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อของแถม');
    const pid = id ?? `PR${Date.now().toString(36)}`;
    await this.uow.run(async (tx) => {
      await this.repo.savePremium(tx, pid, name.trim());
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'premium.save', entity: 'premium', entityId: pid, after: { name } });
    });
    return { id: pid, name: name.trim() };
  }
}
