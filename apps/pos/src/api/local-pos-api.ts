import type { Catalog, Employee, Satang } from '@my-shop/contracts';
import { demoCatalog, demoEmployees } from '../data/demo-catalog';
import type { CashMove, PosApi, SaleRecord, Shift } from './pos-api';

const needsServer = (): never => {
  throw new Error('โหมดทดลองในเบราว์เซอร์ไม่รองรับฟังก์ชันนี้ ต้องใช้เซิร์ฟเวอร์ร้าน');
};

const KEY = 'myshop.pos.local.v1';

interface Db {
  shifts: Shift[];
  docCounter: Record<string, number>;
}

function load(): Db {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* storage unavailable or corrupt: start fresh */
  }
  return { shifts: [], docCounter: {} };
}

function save(db: Db): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch {
    /* ignore quota errors in the demo backend */
  }
}

function nextDocNo(db: Db, terminalId: string, now: Date): string {
  const yymm = String(now.getFullYear() + 543).slice(-2) + String(now.getMonth() + 1).padStart(2, '0');
  const key = `${terminalId}-${yymm}`;
  const n = (db.docCounter[key] ?? 0) + 1;
  db.docCounter[key] = n;
  return `${key}-${String(n).padStart(6, '0')}`;
}

function mutateShift(id: string, fn: (s: Shift, db: Db) => void): Shift {
  const db = load();
  const shift = db.shifts.find((s) => s.id === id);
  if (!shift) throw new Error('ไม่พบกะนี้');
  fn(shift, db);
  save(db);
  return shift;
}

/** Browser-only stand-in for the NestJS API. */
export const localPosApi: PosApi = {
  openDrawer: async () => undefined,
  getMe: async () => ({ permissions: [], settings: { pointsValueSatang: 10, cashVarianceLimit: 10000 } }),
  checkApproval: async () => needsServer(),
  findMember: async (phone) => ({ id: phone, phone, name: 'สมาชิก', tier: 'Standard', joinedAt: '', points: 0 }),
  registerMember: async () => needsServer(),
  searchSales: async () => needsServer(),
  getSale: async () => needsServer(),
  voidSale: async () => needsServer(),
  refundSale: async () => needsServer(),
  reprintSale: async () => needsServer(),
  issueTaxInvoice: async () => needsServer(),
  async getCatalog(): Promise<Catalog> {
    return demoCatalog;
  },
  async login(code: string, _terminalId: string): Promise<Employee | null> {
    return demoEmployees.find((e) => e.code === code) ?? null;
  },
  async logout(): Promise<void> {
    /* no server session in the browser-only stand-in */
  },
  async findEmployee(id: string): Promise<Employee | null> {
    return demoEmployees.find((e) => e.id === id) ?? null;
  },
  async getOpenShift(terminalId: string): Promise<Shift | null> {
    return load().shifts.find((s) => s.terminalId === terminalId && !s.closedAt) ?? null;
  },
  async openShift(terminalId: string, employeeId: string, float: Satang): Promise<Shift> {
    const db = load();
    if (db.shifts.some((s) => s.terminalId === terminalId && !s.closedAt)) throw new Error('เครื่องนี้มีกะเปิดอยู่แล้ว');
    const shift: Shift = { id: crypto.randomUUID(), terminalId, employeeId, openedAt: new Date().toISOString(), float, sales: [], cashMoves: [] };
    db.shifts.push(shift);
    save(db);
    return shift;
  },
  async recordSale(shiftId, sale): Promise<SaleRecord> {
    let record!: SaleRecord;
    mutateShift(shiftId, (shift, db) => {
      if (shift.closedAt) throw new Error('กะนี้ปิดแล้ว');
      const now = new Date();
      record = { ...sale, docNo: nextDocNo(db, shift.terminalId, now), at: now.toISOString() };
      shift.sales.push(record);
    });
    return record;
  },
  async addCashMove(shiftId, move): Promise<Shift> {
    return mutateShift(shiftId, (shift) => {
      shift.cashMoves.push({ ...move, at: new Date().toISOString() } as CashMove);
    });
  },
  async closeShift(shiftId, counted, note): Promise<Shift> {
    return mutateShift(shiftId, (shift) => {
      shift.closedAt = new Date().toISOString();
      shift.counted = counted;
      shift.note = note;
    });
  },
  async getShift(shiftId): Promise<Shift | null> {
    return load().shifts.find((s) => s.id === shiftId) ?? null;
  },
};
