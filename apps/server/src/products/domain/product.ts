import type { Satang } from '@my-shop/contracts';
import { assertValidProduct, cleanBarcodes, costToStore, type ProductInput } from '../product-rules';

export interface Prices {
  price: Satang;
  memberPrice: Satang;
  cost: Satang;
}

/** A change of price, member price or cost. Every one is kept in history and audited. */
export interface PriceChange {
  before: Prices | null;
  after: Prices;
  at: Date;
  by: string;
}

export interface ProductState extends Prices {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  reorderPoint: number;
  imageKey: string | null;
  active: boolean;
  sort: number;
  barcodes: string[];
}

/**
 * Aggregate root: a product on the shelf with its prices and barcodes. Prices only change through here, so a price,
 * member-price or cost change always leaves a `PriceChange` for the history and the audit log.
 */
export class Product {
  private change: PriceChange | null = null;
  private barcodesChanged = false;

  private constructor(private readonly state: ProductState) {}

  static create(input: { id: string; sort: number; data: ProductInput; canSeeCost: boolean; now: Date; by: string }): Product {
    assertValidProduct(input.data);
    const d = input.data;
    const product = new Product({
      id: input.id, sku: d.sku.trim(), name: d.name.trim(), categoryId: d.categoryId, price: d.price, memberPrice: d.memberPrice, cost: costToStore(d, undefined, input.canSeeCost),
      reorderPoint: d.reorderPoint ?? 0, imageKey: d.imageKey ?? null, active: d.active ?? true, sort: input.sort, barcodes: cleanBarcodes(d.barcodes ?? []),
    });
    product.barcodesChanged = d.barcodes !== undefined;
    product.change = { before: null, after: product.prices(), at: input.now, by: input.by };
    return product;
  }

  static restore(state: ProductState): Product {
    return new Product({ ...state, barcodes: [...state.barcodes] });
  }

  get id() { return this.state.id; }
  get sku() { return this.state.sku; }
  get barcodes() { return this.state.barcodes; }

  snapshot(): Readonly<ProductState> {
    return this.state;
  }

  prices(): Prices {
    return { price: this.state.price, memberPrice: this.state.memberPrice, cost: this.state.cost };
  }

  /** The price change made since loading and not yet stored (the service audits it, the repository writes the history row). */
  get pendingPriceChange(): PriceChange | null {
    return this.change;
  }

  priceChangeStored(): void {
    this.change = null;
  }

  /** Barcodes are rewritten only when the edit sent them. */
  takeBarcodesChanged(): boolean {
    const c = this.barcodesChanged;
    this.barcodesChanged = false;
    return c;
  }

  edit(data: ProductInput, ctx: { canSeeCost: boolean; now: Date; by: string }): void {
    assertValidProduct(data);
    const before = this.prices();
    Object.assign(this.state, {
      sku: data.sku.trim(), name: data.name.trim(), categoryId: data.categoryId, price: data.price, memberPrice: data.memberPrice,
      cost: costToStore(data, before.cost, ctx.canSeeCost), reorderPoint: data.reorderPoint ?? 0, imageKey: data.imageKey ?? null, active: data.active ?? true,
    });
    if (data.barcodes) {
      this.state.barcodes = cleanBarcodes(data.barcodes);
      this.barcodesChanged = true;
    }
    const after = this.prices();
    if (before.price !== after.price || before.memberPrice !== after.memberPrice || before.cost !== after.cost) this.change = { before, after, at: ctx.now, by: ctx.by };
  }
}
