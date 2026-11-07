import type { StockCount } from './stock-count';

export abstract class StockCountRepository {
  abstract findById(id: string): Promise<StockCount | null>;
  abstract lockById(id: string): Promise<StockCount | null>;
  abstract findOpen(): Promise<StockCount | null>;
  /** A new count with its snapshot lines. */
  abstract add(count: StockCount): Promise<void>;
  /** The decision and the counted figures. */
  abstract save(count: StockCount): Promise<void>;
}
