import type { Tx } from '../../../shared/database/unit-of-work';
import type { MovementKind } from './stock-rules';

export interface Movement {
  /** Exactly one of productId and premiumId. */
  productId?: string;
  premiumId?: string;
  qty: number;
  kind: MovementKind;
  docNo?: string;
  unitCost?: number;
  at: Date;
}

export interface Supplier {
  id: string;
  name: string;
  contact: string | null;
  terms: string | null;
  active: boolean;
}

export interface CountHeader {
  id: string;
  scope: string;
  categoryId: string | null;
  startedAt: Date;
  status: string;
}

export interface CountLine {
  productId: string;
  snapshot: number;
  counted: number | null;
  balanceNow: number;
}

/** Port: the stock ledger, suppliers and receipts, and stock counts. */
export abstract class StockRepository {
  abstract append(tx: Tx, m: Movement): Promise<void>;
  abstract balances(tx: Tx): Promise<Map<string, number>>;
  abstract balanceOf(tx: Tx, productId: string): Promise<number>;
  abstract premiumBalances(tx: Tx): Promise<Map<string, number>>;
  abstract movementsOf(tx: Tx, productId: string, limit: number): Promise<{ at: Date; qty: number; kind: string; docNo: string | null }[]>;

  abstract suppliers(tx: Tx): Promise<Supplier[]>;
  abstract supplierExists(tx: Tx, id: string): Promise<boolean>;
  abstract saveSupplier(tx: Tx, s: { id: string; name: string; contact: string | null; terms: string | null; active: boolean }): Promise<void>;
  abstract insertReceipt(tx: Tx, r: { docNo: string; supplierId: string; at: Date; ref: string | null; note: string | null; employeeId: string }): Promise<void>;
  abstract insertReceiptLine(tx: Tx, docNo: string, productId: string, qty: number, unitCost: number): Promise<void>;
  abstract receipts(tx: Tx, limit: number): Promise<{ docNo: string; at: Date; supplier: string; ref: string | null; qty: number }[]>;

  abstract openCountId(tx: Tx): Promise<string | null>;
  abstract insertCount(tx: Tx, c: { id: string; scope: string; categoryId: string | null; at: Date; by: string }): Promise<void>;
  abstract snapshotLines(tx: Tx, countId: string, productIds: string[]): Promise<void>;
  abstract countStatus(tx: Tx, id: string, lock: boolean): Promise<string | null>;
  abstract setCounted(tx: Tx, countId: string, productId: string, qty: number): Promise<void>;
  abstract countHeader(tx: Tx, id: string): Promise<CountHeader | null>;
  abstract countLines(tx: Tx, countId: string, countedOnly: boolean): Promise<CountLine[]>;
  abstract closeCount(tx: Tx, id: string, status: 'approved' | 'cancelled', at: Date, by: string | null): Promise<void>;
}
