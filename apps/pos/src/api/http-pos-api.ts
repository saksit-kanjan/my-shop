import type { Catalog, Employee } from '@my-shop/contracts';
import type { CashMove, CreditNote, Member, PosApi, SaleDetail, SaleRecord, SaleSummary, Shift } from './pos-api';

const TOKEN_KEY = 'myshop.pos.token';

const readToken = () => {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const writeToken = (t: string | null) => {
  try {
    if (t) sessionStorage.setItem(TOKEN_KEY, t);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session then lasts until reload */
  }
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Fired when the server says the session is gone, so the app can send the cashier back to login. */
export const SESSION_EXPIRED_EVENT = 'myshop:session-expired';

async function call<T>(base: string, path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const token = readToken();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(token && init.auth !== false ? { authorization: `Bearer ${token}` } : {}) },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'ติดต่อเซิร์ฟเวอร์ร้านไม่ได้ ตรวจสาย LAN แล้วลองอีกครั้ง');
  }
  const text = await res.text();
  const data = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const body = (data ?? {}) as { message?: string; code?: string; details?: Record<string, unknown> };
    if (res.status === 401 && init.auth !== false) {
      writeToken(null);
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, body.message ?? 'เซิร์ฟเวอร์ตอบกลับผิดพลาด ลองอีกครั้ง', body.code, body.details);
  }
  return data as T;
}

/** `PosApi` over the NestJS server in apps/api. `base` is `/api` when served from the shop server. */
export function createHttpPosApi(base = '/api'): PosApi {
  return {
    getCatalog: () => call<Catalog>(base, '/catalog'),
    async login(code, terminalId) {
      try {
        const r = await call<{ token: string; employee: Employee }>(base, '/login', { body: { code, terminalId }, auth: false });
        writeToken(r.token);
        return r.employee;
      } catch (e) {
        if (e instanceof ApiError && e.code === 'unauthorized') return null;
        throw e;
      }
    },
    async logout() {
      try {
        await call<null>(base, '/logout', { method: 'POST', body: {} });
      } finally {
        writeToken(null);
      }
    },
    findEmployee: (id) => call<Employee>(base, `/employees/${encodeURIComponent(id)}`).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
    getOpenShift: (terminalId) => call<Shift | null>(base, `/terminals/${encodeURIComponent(terminalId)}/open-shift`),
    openShift: (terminalId, _employeeId, float) => call<Shift>(base, '/shifts', { body: { terminalId, float } }),
    recordSale: (shiftId, sale) => call<SaleRecord>(base, `/shifts/${encodeURIComponent(shiftId)}/sales`, { body: sale }),
    addCashMove: (shiftId, move: Omit<CashMove, 'at'>) => call<Shift>(base, `/shifts/${encodeURIComponent(shiftId)}/cash-moves`, { body: move }),
    closeShift: (shiftId, counted, note, approverCode) => call<Shift>(base, `/shifts/${encodeURIComponent(shiftId)}/close`, { body: { counted, note, approverCode } }),
    getMe: () => call(base, '/me'),
    openDrawer: (shiftId, reason, approverCode) => call<null>(base, `/shifts/${encodeURIComponent(shiftId)}/drawer-open`, { body: { reason, approverCode } }).then(() => undefined),
    checkApproval: (permission, code) => call(base, '/approvals', { body: { permission, code } }),
    findMember: (phone) => call<Member | null>(base, `/members/${encodeURIComponent(phone.replace(/\D/g, ''))}`),
    registerMember: (input) => call<Member>(base, '/members', { body: input }),
    searchSales: (term) => call<SaleSummary[]>(base, `/sales?term=${encodeURIComponent(term)}`),
    getSale: (docNo) => call<SaleDetail>(base, `/sales/${encodeURIComponent(docNo)}`),
    voidSale: (shiftId, req) => call<CreditNote>(base, `/shifts/${encodeURIComponent(shiftId)}/void`, { body: req }),
    refundSale: (shiftId, req) => call<CreditNote>(base, `/shifts/${encodeURIComponent(shiftId)}/refund`, { body: req }),
    reprintSale: (docNo) => call<{ copy: number }>(base, `/sales/${encodeURIComponent(docNo)}/reprint`, { method: 'POST', body: {} }).then((r) => r.copy),
    issueTaxInvoice: (docNo, buyer) => call<{ docNo: string }>(base, `/sales/${encodeURIComponent(docNo)}/tax-invoice`, { body: buyer }),
    getShift: (shiftId) => call<Shift>(base, `/shifts/${encodeURIComponent(shiftId)}`).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e))),
  };
}
