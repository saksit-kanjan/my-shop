import type { Catalog, CreditNote, Member, Permission, Promotion, Role, SaleRecord, Satang } from '@my-shop/contracts';

const TOKEN_KEY = 'myshop.bo.token';
export const SESSION_EXPIRED = 'myshop:bo-session-expired';

const read = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const setToken = (t: string | null) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts until reload */
  }
};
export const hasToken = () => !!read();

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) {
    super(message);
  }
}

async function call<T>(path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const token = read();
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(token && init.auth !== false ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'ติดต่อเซิร์ฟเวอร์ร้านไม่ได้ ตรวจเครือข่ายแล้วลองอีกครั้ง');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const b = (data ?? {}) as { message?: string; code?: string };
    if (res.status === 401 && init.auth !== false) {
      setToken(null);
      window.dispatchEvent(new Event(SESSION_EXPIRED));
    }
    throw new ApiError(res.status, b.message ?? 'เซิร์ฟเวอร์ตอบกลับผิดพลาด ลองอีกครั้ง', b.code);
  }
  return data as T;
}

const qs = (o: object) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o as Record<string, string | undefined>)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

export interface Settings {
  pointsEarnSatang: number;
  pointsValueSatang: number;
  pointsExpiryMonths: number;
  refundDays: number;
  allowNegativeStock: boolean;
  cashVarianceLimit: number;
  manualDiscountCapPercent: number;
  cutoffHour: number;
  storeName: string;
  branchName: string;
  taxId: string;
  address: string;
}

export interface ProductRow {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  price: Satang;
  memberPrice: Satang;
  cost: Satang;
  reorderPoint: number;
  active: boolean;
  stock: number;
  barcodes: string[];
  imageKey?: string;
}
export type ProductInput = Pick<ProductRow, 'sku' | 'name' | 'categoryId' | 'price' | 'memberPrice' | 'cost' | 'reorderPoint' | 'active' | 'barcodes'>;

export interface Dashboard {
  today: string;
  dayClosed: boolean;
  sales: Record<'today' | 'yesterday' | 'lastWeek', { net: Satang; bills: number }>;
  openShifts: { id: string; terminalId: string; employeeId: string; openedAt: string }[];
  lowStock: { productId: string; sku: string; name: string; stock: number; reorderPoint: number }[];
  lowStockCount: number;
  pending: { stockCounts: number };
}

export interface CountView {
  id: string;
  scope: string;
  categoryId: string | null;
  startedAt: string;
  status: string;
  lines: { productId: string; sku: string; name: string; snapshot: number; soldSince: number; counted: number | null; diff: number | null }[];
}

export interface DayView {
  date: string;
  closed: { at: string; by: string } | null;
  shifts: { id: string; terminalId: string; cashier: string; openedAt: string; closedAt: string | null; bills: number; net: Satang; expected: Satang; counted: Satang | null; variance: Satang | null; note: string | null }[];
}

export interface UserRow {
  id: string;
  name: string;
  initials: string;
  role: Role;
  username?: string;
  active: boolean;
}

export interface SaleDetail {
  sale: SaleRecord;
  creditNotes: CreditNote[];
  taxInvoice: { docNo: string; buyerName: string; at: string } | null;
  reprints: number;
  shiftId: string;
  terminalId: string;
}

export interface Range {
  from?: string;
  to?: string;
  terminalId?: string;
  employeeId?: string;
  categoryId?: string;
}

export const api = {
  login: (username: string, password: string) => call<{ token: string; employee: { id: string; name: string; initials: string; role: Role } }>('/bo/login', { body: { username, password }, auth: false }),
  logout: () => call<null>('/logout', { method: 'POST', body: {} }),
  me: () => call<{ employee: { id: string; name: string; initials: string; role: Role }; permissions: Permission[]; settings: Settings }>('/me'),
  dashboard: () => call<Dashboard>('/bo/dashboard'),
  /** Products come from the catalog context and stock from inventory, so the screen joins them. */
  products: async () => {
    const [products, stock] = await Promise.all([call<Omit<ProductRow, 'stock'>[]>('/bo/products'), call<{ productId: string; stock: number }[]>('/bo/stock')]);
    const onHand = new Map(stock.map((r) => [r.productId, r.stock]));
    return products.map((p): ProductRow => ({ ...p, stock: onHand.get(p.id) ?? 0 }));
  },
  categories: () => call<{ id: string; name: string }[]>('/bo/categories'),
  saveCategory: (id: string | null, name: string) => call<{ id: string; name: string }>(id ? `/bo/categories/${id}` : '/bo/categories', { method: id ? 'PUT' : 'POST', body: { name } }),
  saveProduct: (id: string | null, p: Partial<ProductInput>) => call<ProductRow>(id ? `/bo/products/${id}` : '/bo/products', { method: id ? 'PUT' : 'POST', body: p }),
  /** Promotions and gift names come from the catalog, how many gifts are left from inventory. */
  promotions: async () => {
    const [list, levels] = await Promise.all([call<{ promotions: (Promotion & { active: boolean })[]; premiums: { id: string; name: string }[] }>('/bo/promotions'), call<{ id: string; stock: number }[]>('/bo/premiums/stock').catch(() => [])]);
    const left = new Map(levels.map((r) => [r.id, r.stock]));
    return { promotions: list.promotions, premiums: list.premiums.map((p): Catalog['premiums'][number] => ({ ...p, stock: left.get(p.id) ?? 0 })) };
  },
  savePromotion: (promotion: Promotion, active: boolean, isNew: boolean) => call<null>(isNew ? '/bo/promotions' : `/bo/promotions/${promotion.id}`, { method: isNew ? 'POST' : 'PUT', body: { promotion, active } }),
  premiumStock: (id: string, qty: number) => call<null>(`/bo/premiums/${id}/stock`, { body: { qty } }),
  savePremium: (name: string) => call<{ id: string; name: string }>('/bo/premiums', { body: { name } }),
  suppliers: () => call<{ id: string; name: string; contact: string | null; terms: string | null; active: boolean }[]>('/bo/suppliers'),
  saveSupplier: (s: { name: string; contact?: string; terms?: string }) => call<{ id: string }>('/bo/suppliers', { body: s }),
  receipts: () => call<{ docNo: string; at: string; supplier: string; ref: string | null; qty: number }[]>('/bo/receipts'),
  receive: (r: { supplierId: string; ref?: string; note?: string; lines: { productId: string; qty: number; unitCost: Satang }[] }) => call<{ docNo: string }>('/bo/receipts', { body: r }),
  stock: (q: { categoryId?: string; low?: boolean } = {}) =>
    call<{ productId: string; sku: string; name: string; categoryId: string; stock: number; reorderPoint: number; low: boolean; value?: Satang }[]>(`/bo/stock${qs({ categoryId: q.categoryId, low: q.low ? '1' : undefined })}`),
  movements: (productId: string) => call<{ at: string; qty: number; kind: string; docNo: string | null }[]>(`/bo/stock/${productId}/movements`),
  adjust: (a: { productId: string; qty: number; reason: 'waste' | 'lost' | 'expired' | 'other'; note?: string }) => call<null>('/bo/stock/adjust', { body: a }),
  openCount: () => call<CountView | null>('/bo/counts/open'),
  startCount: (categoryId?: string) => call<{ id: string; lines: number }>('/bo/counts', { body: { categoryId } }),
  saveCounted: (id: string, lines: { productId: string; qty: number }[]) => call<null>(`/bo/counts/${id}/lines`, { method: 'PUT', body: { lines } }),
  approveCount: (id: string) => call<{ adjusted: number }>(`/bo/counts/${id}/approve`, { body: {} }),
  cancelCount: (id: string) => call<null>(`/bo/counts/${id}/cancel`, { body: {} }),
  day: (date: string) => call<DayView>(`/bo/days/${date}`),
  closeDay: (date: string) => call<{ date: string; net: Satang; bills: number }>(`/bo/days/${date}/close`, { body: {} }),
  report: <T,>(name: string, r: Range & Record<string, string | undefined>) => call<T>(`/bo/reports/${name}${qs(r)}`),
  searchSales: (term: string, date?: string) => call<{ docNo: string; at: string; net: Satang; employeeId: string; voided: boolean; refunded: Satang }[]>(`/bo/sales${qs({ term, date })}`),
  sale: (docNo: string) => call<SaleDetail>(`/sales/${encodeURIComponent(docNo)}`),
  reprint: (docNo: string) => call<{ copy: number }>(`/sales/${encodeURIComponent(docNo)}/reprint`, { body: {} }),
  members: (term: string) => call<Member[]>(`/bo/members${qs({ term })}`),
  updateMember: (id: string, patch: { name?: string; tier?: string }) => call<null>(`/bo/members/${id}`, { method: 'PUT', body: patch }),
  anonymizeMember: (id: string) => call<null>(`/bo/members/${id}/anonymize`, { body: {} }),
  users: () => call<UserRow[]>('/bo/users'),
  createUser: (u: { name: string; role: Role; code: string; username?: string; password?: string }) => call<UserRow>('/bo/users', { body: u }),
  updateUser: (id: string, patch: { name?: string; role?: Role; active?: boolean; code?: string; password?: string; username?: string }) => call<null>(`/bo/users/${id}`, { method: 'PUT', body: patch }),
  permissions: () => call<Record<Role, Permission[]>>('/bo/permissions'),
  setPermission: (role: Role, permission: Permission, allowed: boolean) => call<null>('/bo/permissions', { method: 'PUT', body: { role, permission, allowed } }),
  settings: () => call<Settings>('/bo/settings'),
  saveSettings: (patch: Partial<Settings>) => call<Settings>('/bo/settings', { method: 'PUT', body: patch }),
  audit: (r: Range & { action?: string }) => call<{ id: number; at: string; actor: string | null; approver: string | null; terminalId: string | null; action: string; entity: string | null; entityId: string | null; before: unknown; after: unknown }[]>(`/bo/audit${qs(r)}`),
  backups: () => call<{ name: string; bytes: number; at: string }[]>('/bo/backups'),
  runBackup: () => call<{ file: string; removed: number }>('/bo/backups', { method: 'POST', body: {} }),
};
