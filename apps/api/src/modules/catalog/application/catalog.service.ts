import { Inject, Injectable } from '@nestjs/common';
import type { Category, Product, Promotion, Satang } from '@my-shop/contracts';
import { UnitOfWork, type Tx } from '../../../shared/database/unit-of-work';
import { CatalogRepository } from '../domain/catalog.repository';
import type { ProductRecord } from '../domain/product';

/** What the till prices against: active products and promotions, with the gift names but not their stock (that is inventory's). */
export interface CatalogSnapshot {
  categories: Category[];
  products: Product[];
  premiums: { id: string; name: string }[];
  promotions: Promotion[];
}

/** The catalog context's public API for the other contexts. They never touch its tables or its repository. */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(CatalogRepository) private readonly repo: CatalogRepository,
  ) {}

  async snapshot(tx: Tx = this.uow.read): Promise<CatalogSnapshot> {
    const [categories, products, premiums, promotions] = await Promise.all([this.repo.categories(tx), this.repo.products(tx, true), this.repo.premiums(tx), this.repo.promotions(tx, true)]);
    return {
      categories,
      products: products.map((p): Product => ({ id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, price: p.price, memberPrice: p.memberPrice, barcodes: p.barcodes, ...(p.imageKey ? { imageKey: p.imageKey } : {}) })),
      premiums,
      promotions: promotions.map(({ active: _active, ...p }) => p as Promotion),
    };
  }

  /** Every product with its cost and reorder point, for stock views and counts. */
  directory(tx: Tx = this.uow.read): Promise<ProductRecord[]> {
    return this.repo.products(tx, false);
  }

  async costs(tx: Tx, ids: string[]): Promise<Map<string, Satang>> {
    const wanted = new Set(ids);
    return new Map((await this.repo.products(tx, false)).filter((p) => wanted.has(p.id)).map((p) => [p.id, p.cost]));
  }

  async updateCost(tx: Tx, productId: string, cost: Satang): Promise<void> {
    await this.repo.setCost(tx, productId, cost);
  }

  productsExist(tx: Tx, ids: string[]): Promise<Set<string>> {
    return this.repo.productsExist(tx, ids);
  }

  premiumsExist(tx: Tx, ids: string[]): Promise<Set<string>> {
    return this.repo.premiumsExist(tx, ids);
  }
}
