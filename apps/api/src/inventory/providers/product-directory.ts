import type { Satang } from '@my-shop/contracts';
import type { Tx } from '../../database/unit-of-work';

export interface DirectoryProduct {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  cost: Satang;
  reorderPoint: number;
  active: boolean;
}

/**
 * Port (anti-corruption layer): what inventory needs to know about products and free gifts. Inventory owns the stock ledger;
 * the catalog context owns the products. The adapter in infrastructure/ asks the catalog's public service.
 */
export abstract class ProductDirectory {
  abstract all(tx: Tx): Promise<DirectoryProduct[]>;
  abstract exist(tx: Tx, ids: string[]): Promise<Set<string>>;
  abstract premiumsExist(tx: Tx, ids: string[]): Promise<Set<string>>;
  abstract setCost(tx: Tx, productId: string, cost: Satang): Promise<void>;
}
