import type { CreditNote, PaymentMethod } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';

export interface NewCreditNote {
  docNo: string;
  saleDocNo: string;
  shiftId: string;
  type: 'void' | 'refund';
  at: Date;
  businessDate: string;
  amount: number;
  reason: string;
  restock: boolean;
  employeeId: string;
  approvedBy: string;
  lines: { productId: string; name: string; qty: number; amount: number; cost: number }[];
  payments: { method: PaymentMethod; amount: number }[];
}

/** Port: voids and refunds as credit notes referencing the original bill. */
export abstract class CreditNoteRepository {
  abstract insert(tx: Tx, n: NewCreditNote): Promise<void>;
  abstract forSale(tx: Tx, saleDocNo: string): Promise<CreditNote[]>;
  abstract ofShift(tx: Tx, shiftId: string): Promise<CreditNote[]>;
  abstract exists(tx: Tx, docNo: string): Promise<boolean>;
}
