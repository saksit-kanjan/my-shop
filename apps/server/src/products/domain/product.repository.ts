import type { Product } from './product';

export abstract class ProductRepository {
  abstract findById(id: string): Promise<Product | null>;
  abstract lockById(id: string): Promise<Product | null>;
  abstract count(): Promise<number>;
  abstract categoryExists(id: string): Promise<boolean>;
  /** Another product (not `exceptId`) already uses this SKU. */
  abstract skuTaken(sku: string, exceptId?: string): Promise<boolean>;
  /** The first of `codes` that belongs to a product other than `productId`, if any. */
  abstract barcodeTakenByOther(codes: string[], productId: string): Promise<string | null>;
  abstract add(product: Product): Promise<void>;
  /** Fields, barcodes (when they changed) and the price history row (when prices changed). */
  abstract save(product: Product): Promise<void>;
}
