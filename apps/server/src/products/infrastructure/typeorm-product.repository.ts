import { Injectable } from '@nestjs/common';
import { In, Not } from 'typeorm';
import { DatabaseService } from '../../database/database.service';
import { Product } from '../domain/product';
import { ProductRepository } from '../domain/product.repository';
import { BarcodeEntity, CategoryEntity, PriceHistory, ProductEntity } from '../entities/products.entities';

@Injectable()
export class TypeOrmProductRepository extends ProductRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  private async restore(row: ProductEntity | null): Promise<Product | null> {
    if (!row) return null;
    const codes = await this.db.manager.find(BarcodeEntity, { where: { productId: row.id }, order: { code: 'ASC' } });
    return Product.restore({
      id: row.id, sku: row.sku, name: row.name, categoryId: row.categoryId, price: row.price, memberPrice: row.memberPrice, cost: row.cost,
      reorderPoint: row.reorderPoint, imageKey: row.imageKey, active: row.active, sort: row.sort, barcodes: codes.map((c) => c.code),
    });
  }

  findById(id: string) {
    return this.db.manager.findOneBy(ProductEntity, { id }).then((r) => this.restore(r));
  }

  lockById(id: string) {
    return this.db.manager.findOne(ProductEntity, { where: { id }, lock: { mode: 'pessimistic_write' } }).then((r) => this.restore(r));
  }

  count() {
    return this.db.manager.count(ProductEntity);
  }

  categoryExists(id: string) {
    return this.db.manager.existsBy(CategoryEntity, { id });
  }

  skuTaken(sku: string, exceptId?: string) {
    return this.db.manager.existsBy(ProductEntity, exceptId ? { sku, id: Not(exceptId) } : { sku });
  }

  async barcodeTakenByOther(codes: string[], productId: string) {
    if (codes.length === 0) return null;
    return (await this.db.manager.findOne(BarcodeEntity, { where: { code: In(codes), productId: Not(productId) } }))?.code ?? null;
  }

  async add(product: Product): Promise<void> {
    const s = product.snapshot();
    await this.db.manager.insert(ProductEntity, { id: s.id, sku: s.sku, name: s.name, categoryId: s.categoryId, price: s.price, memberPrice: s.memberPrice, imageKey: s.imageKey, cost: s.cost, reorderPoint: s.reorderPoint, active: s.active, sort: s.sort });
    await this.writeBarcodes(product);
    await this.writeHistory(product);
  }

  async save(product: Product): Promise<void> {
    const s = product.snapshot();
    await this.db.manager.update(ProductEntity, { id: s.id }, { sku: s.sku, name: s.name, categoryId: s.categoryId, price: s.price, memberPrice: s.memberPrice, imageKey: s.imageKey, cost: s.cost, reorderPoint: s.reorderPoint, active: s.active });
    await this.writeBarcodes(product);
    await this.writeHistory(product);
  }

  private async writeBarcodes(product: Product) {
    if (!product.takeBarcodesChanged()) return;
    await this.db.manager.delete(BarcodeEntity, { productId: product.id });
    if (product.barcodes.length) await this.db.manager.insert(BarcodeEntity, product.barcodes.map((code) => ({ code, productId: product.id })));
  }

  private async writeHistory(product: Product) {
    const change = product.pendingPriceChange;
    if (!change) return;
    await this.db.manager.insert(PriceHistory, { productId: product.id, ...change.after, at: change.at, by: change.by });
    product.priceChangeStored();
  }
}
