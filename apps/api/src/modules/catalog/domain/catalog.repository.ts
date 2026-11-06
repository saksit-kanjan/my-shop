import type { Category, Promotion, Satang } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import type { ProductRecord } from './product';

export interface NewProduct {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  price: number;
  memberPrice: number;
  imageKey: string | null;
  cost: number;
  reorderPoint: number;
  active: boolean;
  sort: number;
}

/** Port: how the catalog context stores products, categories, promotions and free gifts. */
export abstract class CatalogRepository {
  abstract categories(tx: Tx): Promise<Category[]>;
  abstract categoryExists(tx: Tx, id: string): Promise<boolean>;
  abstract saveCategory(tx: Tx, id: string, name: string, isNew: boolean): Promise<void>;

  abstract products(tx: Tx, activeOnly: boolean): Promise<ProductRecord[]>;
  abstract productCount(tx: Tx): Promise<number>;
  abstract productsExist(tx: Tx, ids: string[]): Promise<Set<string>>;
  abstract priceRow(tx: Tx, id: string, lock: boolean): Promise<{ price: number; memberPrice: number; cost: number } | null>;
  abstract skuTaken(tx: Tx, sku: string, exceptId: string | null): Promise<boolean>;
  abstract insertProduct(tx: Tx, p: NewProduct): Promise<void>;
  abstract updateProduct(tx: Tx, id: string, p: Omit<NewProduct, 'id' | 'sort'>): Promise<void>;
  abstract barcodeUsedByOther(tx: Tx, codes: string[], productId: string): Promise<string | null>;
  abstract replaceBarcodes(tx: Tx, productId: string, codes: string[]): Promise<void>;
  abstract recordPrice(tx: Tx, productId: string, price: Satang, memberPrice: Satang, cost: Satang, at: Date, by: string): Promise<void>;
  abstract setCost(tx: Tx, productId: string, cost: Satang): Promise<void>;

  abstract promotions(tx: Tx, activeOnly: boolean): Promise<(Promotion & { active: boolean })[]>;
  abstract promotionExists(tx: Tx, id: string): Promise<boolean>;
  abstract savePromotion(tx: Tx, p: Promotion, active: boolean, isNew: boolean): Promise<void>;

  abstract premiums(tx: Tx): Promise<{ id: string; name: string }[]>;
  abstract premiumsExist(tx: Tx, ids: string[]): Promise<Set<string>>;
  abstract savePremium(tx: Tx, id: string, name: string): Promise<void>;
}
