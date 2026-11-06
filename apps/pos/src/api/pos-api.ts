import type { CashMove, Catalog, ManualDiscount, CreditNote, Employee, Member, Permission, SaleRecord, Satang, Shift } from '@my-shop/contracts';

export type { CashMove, CashMoveType, CreditNote, Member, SaleRecord, Shift, ShiftSummary } from '@my-shop/contracts';
export { summarizeShift } from '@my-shop/domain';

export interface SaleDetail {
  sale: SaleRecord;
  creditNotes: CreditNote[];
  taxInvoice: { docNo: string; buyerName: string; at: string } | null;
  reprints: number;
  shiftId: string;
  terminalId: string;
}

export interface SaleSummary {
  docNo: string;
  at: string;
  net: Satang;
  employeeId: string;
  voided: boolean;
  refunded: Satang;
}

export interface RefundRequest {
  saleDocNo: string;
  /** Leave out for a void of the whole bill. */
  lines?: { productId: string; qty: number }[];
  reason: string;
  restock?: boolean;
  /** Only work out the amount and how it is paid back; nothing is written. */
  preview?: boolean;
  /** A supervisor's code, when the signed-in user is not allowed to do this alone. */
  approverCode?: string;
}

export interface TaxInvoiceRequest {
  buyerName: string;
  buyerAddress: string;
  buyerTaxId: string;
  buyerBranch: string;
}

/**
 * Everything the POS needs from the back end. The local implementation keeps data in the
 * browser for now; a NestJS implementation will satisfy the same interface.
 */
/** A bill to close. `manualDiscount` is already in `cart`; the server re-checks it and may ask for a supervisor's code. */
export type SaleRequest = Omit<SaleRecord, 'docNo' | 'at'> & { manualDiscount?: ManualDiscount; approverCode?: string };

export interface PosApi {
  getCatalog(): Promise<Catalog>;
  /** Null when the code is wrong. Throws (with a message to show) when the terminal is locked or the server is unreachable. */
  login(code: string, terminalId: string): Promise<Employee | null>;
  logout(): Promise<void>;
  findEmployee(id: string): Promise<Employee | null>;
  getOpenShift(terminalId: string): Promise<Shift | null>;
  openShift(terminalId: string, employeeId: string, float: Satang): Promise<Shift>;
  recordSale(shiftId: string, sale: SaleRequest): Promise<SaleRecord>;
  addCashMove(shiftId: string, move: Omit<CashMove, 'at'>): Promise<Shift>;
  closeShift(shiftId: string, counted: Satang, note?: string, approverCode?: string): Promise<Shift>;
  openDrawer(shiftId: string, reason: string, approverCode?: string): Promise<void>;
  /** Checks a supervisor's code for one kind of approval without doing anything yet. */
  checkApproval(permission: Permission, code: string): Promise<{ approverId: string; name: string }>;
  /** Store settings the till needs (points value, ...) and what the signed-in role may do. */
  getMe(): Promise<{ permissions: Permission[]; settings: { pointsValueSatang: number; cashVarianceLimit: number } }>;
  findMember(phone: string): Promise<Member | null>;
  registerMember(input: { phone: string; name: string; consent: boolean }): Promise<Member>;
  searchSales(term: string): Promise<SaleSummary[]>;
  getSale(docNo: string): Promise<SaleDetail>;
  voidSale(shiftId: string, req: RefundRequest): Promise<CreditNote>;
  refundSale(shiftId: string, req: RefundRequest): Promise<CreditNote>;
  reprintSale(docNo: string): Promise<number>;
  issueTaxInvoice(docNo: string, buyer: TaxInvoiceRequest): Promise<{ docNo: string }>;
  getShift(shiftId: string): Promise<Shift | null>;
}
