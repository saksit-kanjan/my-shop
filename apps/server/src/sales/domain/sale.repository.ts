import type { Sale } from './sale';

export abstract class SaleRepository {
  /** Writes the bill, its lines and its payments. Closed bills are never updated. */
  abstract add(sale: Sale): Promise<void>;
  abstract findByDocNo(docNo: string): Promise<Sale | null>;
}
