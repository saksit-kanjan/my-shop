import { Injectable } from '@nestjs/common';
import type { Satang } from '@my-shop/contracts';
import type { Tx } from '../../database/unit-of-work';
import { CatalogService } from '../../catalog/catalog.service';
import { ProductDirectory, type DirectoryProduct } from './product-directory';

/** Adapter: answers inventory's questions with the catalog context's public service. */
@Injectable()
export class CatalogProductDirectory extends ProductDirectory {
  constructor(private readonly catalog: CatalogService) {
    super();
  }

  async all(tx: Tx): Promise<DirectoryProduct[]> {
    return (await this.catalog.directory(tx)).map((p) => ({ id: p.id, sku: p.sku, name: p.name, categoryId: p.categoryId, cost: p.cost, reorderPoint: p.reorderPoint, active: p.active }));
  }

  exist(tx: Tx, ids: string[]) {
    return this.catalog.productsExist(tx, ids);
  }

  premiumsExist(tx: Tx, ids: string[]) {
    return this.catalog.premiumsExist(tx, ids);
  }

  setCost(tx: Tx, productId: string, cost: Satang) {
    return this.catalog.updateCost(tx, productId, cost);
  }
}
