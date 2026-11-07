import type { CreditNote } from './credit-note';

export abstract class CreditNoteRepository {
  abstract add(note: CreditNote): Promise<void>;
  abstract findBySale(saleDocNo: string): Promise<CreditNote[]>;
  abstract findByShift(shiftId: string): Promise<CreditNote[]>;
  abstract exists(docNo: string): Promise<boolean>;
}
