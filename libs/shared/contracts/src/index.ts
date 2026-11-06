/**
 * Shared contracts for POS, customer display, back office and API.
 * All money values are integer satang (1 baht = 100 satang) to avoid floating point errors.
 */
export type Satang = number;

export interface Category {
  id: string;
  name: string;
}

export interface Product {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  /** Selling price including VAT. */
  price: Satang;
  memberPrice: Satang;
  barcodes: string[];
  /** Key into the product image sprite until real uploads exist. */
  imageKey?: string;
}

/** A free item that is not for sale (tote bag, sample, keychain). */
export interface Premium {
  id: string;
  name: string;
  stock: number;
}

/**
 * When a promotion applies (shop time, Asia/Bangkok). Leave a field out for "no limit".
 * `from` and `to` are dates (yyyy-mm-dd, both included); `weekdays` are 0 = Sunday ... 6 = Saturday.
 */
export interface PromotionSchedule {
  from?: string;
  to?: string;
  weekdays?: number[];
}

interface Scheduled {
  schedule?: PromotionSchedule;
}

/** Buy `minQty` of a product and each unit drops to `unitPrice`. */
export interface QtyPricePromotion extends Scheduled {
  kind: 'qty';
  id: string;
  name: string;
  productId: string;
  minQty: number;
  unitPrice: Satang;
  /**
   * `set`: only complete sets get the promo price, leftovers pay normal price.
   * `all`: once minQty is reached every unit gets the promo price.
   */
  countMode: 'set' | 'all';
}

export type GiftTarget =
  | { type: 'product'; productId: string }
  | { type: 'premium'; premiumId: string };

/** Buy `buyQty` of A, get `giftQty` of B (a product or a premium) free. */
export interface GiftPromotion extends Scheduled {
  kind: 'gift';
  id: string;
  name: string;
  buyProductId: string;
  buyQty: number;
  gift: GiftTarget;
  giftQty: number;
}

/** Buy X get Y of the same product free (1 แถม 1 is buyQty 1, freeQty 1). */
export interface BogoPromotion extends Scheduled {
  kind: 'bogo';
  id: string;
  name: string;
  productId: string;
  buyQty: number;
  freeQty: number;
}

/** Spend at least `minAmount` after item promotions, get `discount` off the bill. */
export interface BillPromotion extends Scheduled {
  kind: 'bill';
  id: string;
  name: string;
  minAmount: Satang;
  discount: Satang;
}

export type Promotion = QtyPricePromotion | GiftPromotion | BogoPromotion | BillPromotion;

export interface CartLine {
  productId: string;
  qty: number;
}

export interface Catalog {
  categories: Category[];
  products: Product[];
  premiums: Premium[];
  promotions: Promotion[];
}

/** A promotion that is already applied to a line. */
export interface AppliedPromo {
  promotionId: string;
  kind: Promotion['kind'] | 'member';
  label: string;
  discount: Satang;
}

/** A promotion the customer is close to getting. */
export interface NearPromo {
  promotionId: string;
  kind: Promotion['kind'] | 'member';
  label: string;
  /** Extra units the customer needs to pick up (0 for bill-level or member hints). */
  addQty: number;
  /** Product to add when the cashier accepts the suggestion. */
  addProductId?: string;
  /** Extra money the customer pays if they accept. */
  extraPay: Satang;
  /** What the customer saves or gets free if they accept. */
  gain: Satang;
  gainIsFree: boolean;
}

export interface PricedLine {
  productId: string;
  name: string;
  imageKey?: string;
  qty: number;
  unitPrice: Satang;
  gross: Satang;
  discount: Satang;
  net: Satang;
  applied: AppliedPromo[];
  near: NearPromo[];
  /** Set when this line is a free gift from another product. */
  giftOfProductId?: string;
}

export interface PremiumLine {
  premiumId: string;
  name: string;
  qty: number;
  fromProductId: string;
  promotionId: string;
  outOfStock: boolean;
}

export interface PricedCart {
  lines: PricedLine[];
  premiums: PremiumLine[];
  billApplied: AppliedPromo[];
  billNear: NearPromo[];
  pieces: number;
  gross: Satang;
  discount: Satang;
  net: Satang;
  vat: Satang;
}

export type PaymentMethod = 'cash' | 'promptpay' | 'card' | 'transfer';

export interface Payment {
  method: PaymentMethod;
  amount: Satang;
  /** Cash handed over by the customer (cash only). */
  tendered?: Satang;
  reference?: string;
}

export type Role = 'cashier' | 'supervisor' | 'manager' | 'owner';

/** What the spec's permission matrix calls "สิทธิ์". The owner can override each cell. */
export const PERMISSIONS = [
  'sale',
  'discount.over_cap',
  'void',
  'refund',
  'refund.late',
  'drawer.nosale',
  'shift.open_close',
  'shift.expected',
  'products.manage',
  'stock.view',
  'stock.manage',
  'promos.manage',
  'members.manage',
  'reports.own_shift',
  'reports.all',
  'reports.cost',
  'users.manage',
  'settings.manage',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CASHIER: Permission[] = ['sale', 'shift.open_close'];
const SUPERVISOR: Permission[] = [...CASHIER, 'discount.over_cap', 'void', 'refund', 'drawer.nosale', 'shift.expected', 'stock.view', 'reports.own_shift'];
const MANAGER: Permission[] = [...SUPERVISOR, 'refund.late', 'products.manage', 'stock.manage', 'promos.manage', 'members.manage', 'reports.all', 'audit.view'];

/** Defaults from the spec's matrix. Cashiers get "ask for approval" on void, refund and big discounts. */
export const DEFAULT_PERMISSIONS: Record<Role, readonly Permission[]> = {
  cashier: CASHIER,
  supervisor: SUPERVISOR,
  manager: MANAGER,
  owner: PERMISSIONS,
};

export interface Employee {
  id: string;
  code: string;
  name: string;
  initials: string;
  role: Role;
}

/* ---------- Shifts and sales documents ---------- */

export type CashMoveType = 'drop' | 'out' | 'in';

export interface CashMove {
  at: string;
  type: CashMoveType;
  amount: Satang;
  reason: string;
  employeeId: string;
  /** Supervisor who approved it, when the rules ask for one. */
  approvedBy?: string;
}

export interface SaleRecord {
  docNo: string;
  at: string;
  employeeId: string;
  cart: PricedCart;
  payments: Payment[];
  change: Satang;
  memberPhone?: string;
  /** Points the member earned on this bill. */
  pointsEarned?: number;
  /** Points spent and the baht value (satang) they took off what the customer paid. */
  pointsRedeemed?: number;
  pointsValue?: Satang;
  /** Set once a void credit note exists for the bill. */
  voided?: boolean;
}

export interface CreditNoteLine {
  productId: string;
  name: string;
  qty: number;
  amount: Satang;
}

/** A void or a refund. Both are new documents that point at the original bill (rule 3). */
export interface CreditNote {
  docNo: string;
  at: string;
  type: 'void' | 'refund';
  saleDocNo: string;
  amount: Satang;
  reason: string;
  employeeId: string;
  approvedBy: string;
  /** True when the goods went back on the shelf, false when they were written off. */
  restock: boolean;
  payments: { method: PaymentMethod; amount: Satang }[];
  lines: CreditNoteLine[];
}

export interface Member {
  id: string;
  phone: string;
  name: string;
  birthday?: string;
  tier: string;
  joinedAt: string;
  points: number;
}

export interface Shift {
  id: string;
  terminalId: string;
  employeeId: string;
  openedAt: string;
  float: Satang;
  closedAt?: string;
  counted?: Satang;
  note?: string;
  sales: SaleRecord[];
  cashMoves: CashMove[];
  creditNotes?: CreditNote[];
}

export interface ShiftSummary {
  bills: number;
  gross: Satang;
  discount: Satang;
  net: Satang;
  vat: Satang;
  byMethod: Record<PaymentMethod, Satang>;
  cashSales: Satang;
  cashIn: Satang;
  cashOut: Satang;
  cashDrop: Satang;
  /** Total refunded and voided in this shift, and the cash part of it. */
  refunds: Satang;
  cashRefunds: Satang;
  expectedCash: Satang;
}

/* ---------- Customer display channel ---------- */

export const DISPLAY_CHANNEL_PREFIX = 'myshop-display-';

export type DisplayPhase = 'idle' | 'cart' | 'offers' | 'pay' | 'thanks';

export interface DisplayPayState {
  method: PaymentMethod;
  due: Satang;
  tendered?: Satang;
  change?: Satang;
}

export interface PromoShowcaseItem {
  productId: string;
  name: string;
  imageKey?: string;
  tag: string;
  deal: string;
}

export interface DisplayState {
  phase: DisplayPhase;
  cart?: PricedCart;
  lastAddedProductId?: string;
  isMember: boolean;
  /** What the customer would save by becoming a member (0 if already a member). */
  memberSaving: Satang;
  pay?: DisplayPayState;
  thanks?: { change: Satang; saved: Satang };
  promoShowcase: PromoShowcaseItem[];
  storeName: string;
  branchName: string;
}

export type DisplayMessage =
  | { type: 'state'; state: DisplayState }
  | { type: 'hello' };

export function displayChannelName(terminalId: string): string {
  return DISPLAY_CHANNEL_PREFIX + terminalId;
}
