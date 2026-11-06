import 'reflect-metadata';
import { mkdtemp, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CartLine, Catalog, Employee, Payment, PricedCart } from '@my-shop/contracts';
import { summarizeShift } from '@my-shop/domain';
import { demoCatalog } from '@my-shop/seed';
import { priceCart } from '@my-shop/domain';
import { createServices, type Services } from './app';
import type { Db } from './db/db';
import { openTestDb } from './test-db';
import { seedDemo } from './seed';

let now: Date;
let db: Db;
let drop: () => Promise<void>;
let s: Services;
const advance = (ms: number) => (now = new Date(now.getTime() + ms));

beforeEach(async () => {
  now = new Date('2026-11-06T03:00:00Z'); // 10:00 Bangkok, business date 2026-11-06
  ({ db, drop } = await openTestDb());
  s = await createServices(db, { secret: 'test-secret', clock: () => now, backupDir: await mkdtemp(join(tmpdir(), 'myshop-bk-')) });
  await seedDemo(db, s.auth);
});
afterEach(() => drop());

const cartOf = (lines: CartLine[], isMember = false): PricedCart => priceCart(lines, demoCatalog as Catalog, { isMember });
const cash = (amount: number, tendered = amount): Payment => ({ method: 'cash', amount, tendered });
const who = async (code: string, terminal = 'T01') => (await s.auth.login(code, terminal)).employee;
const CASHIER = '100123';
const SUPERVISOR = '300789';
const MANAGER = '400111';
const OWNER = '500222';

async function start(code = CASHIER, float = 200000) {
  const employee = await who(code);
  return { employee, shift: await s.shifts.openShift('T01', employee.id, float) };
}
async function sell(shiftId: string, employee: Employee, lines: CartLine[], extra: Partial<Parameters<Services['sales']['closeSale']>[1]> = {}) {
  const cart = cartOf(lines, !!extra.memberPhone);
  const pointsValue = (extra.pointsRedeemed ?? 0) * 10;
  return s.sales.closeSale(shiftId, { employeeId: employee.id, cart, change: 0, payments: cart.net - pointsValue > 0 ? [cash(cart.net - pointsValue)] : [], ...extra });
}
const stockOf = async (id: string) => (await db.query<{ q: number }>(`SELECT COALESCE(SUM(qty),0)::int AS q FROM stock_movements WHERE product_id=$1`, [id]))[0].q;

describe('approvals', () => {
  it('a cashier cannot void alone, a wrong code is refused and counted, a supervisor code works', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 2 }]);
    const base = { saleDocNo: sale.docNo, reason: 'ลูกค้าเปลี่ยนใจ' };
    await expect(s.documents.credit(shift.id, 'void', base, employee, 'T01')).rejects.toMatchObject({ code: 'forbidden', details: { needsApproval: 'void' } });
    await expect(s.documents.credit(shift.id, 'void', { ...base, approverCode: '999999' }, employee, 'T01')).rejects.toMatchObject({ code: 'forbidden', message: 'รหัสอนุมัติไม่ถูกต้อง' });
    // Another cashier's code is a real code but has no void right.
    await expect(s.documents.credit(shift.id, 'void', { ...base, approverCode: '200456' }, employee, 'T01')).rejects.toMatchObject({ code: 'forbidden' });
    const cn = await s.documents.credit(shift.id, 'void', { ...base, approverCode: SUPERVISOR }, employee, 'T01');
    expect(cn).toMatchObject({ type: 'void', saleDocNo: sale.docNo, approvedBy: 'E003', employeeId: employee.id });
    const actions = (await db.query<{ action: string; approver: string | null }>(`SELECT action, approver FROM audit_log WHERE action='sale.void'`));
    expect(actions[0].approver).toBe('E003');
  });

  it('locks approvals on a terminal after 5 wrong codes', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }]);
    for (let i = 0; i < 5; i++) await expect(s.documents.credit(shift.id, 'void', { saleDocNo: sale.docNo, reason: 'x', approverCode: '111111' }, employee, 'T01')).rejects.toBeTruthy();
    await expect(s.documents.credit(shift.id, 'void', { saleDocNo: sale.docNo, reason: 'x', approverCode: SUPERVISOR }, employee, 'T01')).rejects.toMatchObject({ code: 'locked' });
  });

  it('lets a supervisor act without a second code', async () => {
    const { employee, shift } = await start(SUPERVISOR);
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }]);
    await expect(s.documents.credit(shift.id, 'void', { saleDocNo: sale.docNo, reason: 'คีย์ผิด' }, employee, 'T01')).resolves.toMatchObject({ approvedBy: employee.id });
  });
});

describe('void', () => {
  it('reverses a bill in the same shift: money, stock, the shift summary and the voided flag', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'chips', qty: 2 }, { productId: 'paste', qty: 1 }]);
    expect(await stockOf('chips')).toBe(48);
    const cn = await s.documents.credit(shift.id, 'void', { saleDocNo: sale.docNo, reason: 'คีย์ผิด', approverCode: SUPERVISOR }, employee, 'T01');
    expect(cn.docNo).toBe(`${sale.docNo}-V`);
    expect(cn.amount).toBe(sale.cart.net);
    expect(cn.payments).toEqual([{ method: 'cash', amount: sale.cart.net }]);
    expect(await stockOf('chips')).toBe(50);
    const brush = (await s.catalog.getCatalog()).premiums[0].stock;
    expect(brush).toBe(120);
    const after = (await s.shifts.getShift(shift.id))!;
    expect(after.sales[0].voided).toBe(true);
    const sum = summarizeShift(after);
    expect(sum).toMatchObject({ bills: 0, net: 0, refunds: sale.cart.net, cashRefunds: sale.cart.net, expectedCash: 200000 });
    await expect(s.documents.credit(shift.id, 'void', { saleDocNo: sale.docNo, reason: 'again', approverCode: SUPERVISOR }, employee, 'T01')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses to void a bill from another shift', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }]);
    await s.shifts.closeShift(shift.id, 200000 + sale.cart.net);
    advance(3_600_000);
    const next = await s.shifts.openShift('T01', employee.id, 100000);
    await expect(s.documents.credit(next.id, 'void', { saleDocNo: sale.docNo, reason: 'x', approverCode: SUPERVISOR }, employee, 'T01')).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('refund', () => {
  it('refunds from the price actually paid, re-pricing what is left under the old promotion rules', async () => {
    const { employee, shift } = await start();
    // 3 chips: 2 at the promo price of 15, the third at 20 = 50.
    const sale = await sell(shift.id, employee, [{ productId: 'chips', qty: 3 }]);
    expect(sale.cart.net).toBe(5000);
    const one = await s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'chips', qty: 1 }], reason: 'ชำรุด', approverCode: SUPERVISOR }, employee, 'T01');
    expect(one.docNo).toMatch(/^CN-6911-000001$/);
    expect(one.amount).toBe(2000); // 50 - 2 chips still on the promo (30)
    const two = await s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'chips', qty: 2 }], reason: 'ชำรุด', approverCode: SUPERVISOR }, employee, 'T01');
    expect(two.amount).toBe(3000);
    expect(one.amount + two.amount).toBe(sale.cart.net);
    await expect(s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'chips', qty: 1 }], reason: 'x', approverCode: SUPERVISOR }, employee, 'T01')).rejects.toMatchObject({ code: 'invalid' });
    expect(await stockOf('chips')).toBe(50);
  });

  it('takes the value of a gift out of the refund when the buy condition is lost', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'bread', qty: 1 }, { productId: 'milk', qty: 1 }]);
    expect(sale.cart.net).toBe(4500); // milk is free
    const cn = await s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'bread', qty: 1 }], reason: 'คืน', approverCode: SUPERVISOR }, employee, 'T01');
    expect(cn.amount).toBe(4500 - 1400); // the customer keeps the milk, so it is charged at its shelf price
  });

  it('can write returned goods off instead of restocking them', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }, { productId: 'coffee', qty: 1 }]);
    await s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'coffee', qty: 1 }], reason: 'หมดอายุ', restock: false, approverCode: SUPERVISOR }, employee, 'T01');
    expect(await stockOf('coffee')).toBe(49);
    const kinds = await db.query<{ kind: string }>(`SELECT kind FROM stock_movements WHERE product_id='coffee' ORDER BY id`);
    expect(kinds.map((k) => k.kind)).toEqual(['opening', 'sale', 'refund', 'waste']);
  });

  it('splits the money back over the original payment methods', async () => {
    const { employee, shift } = await start();
    const cart = cartOf([{ productId: 'tissue', qty: 2 }]); // 178
    const sale = await s.sales.closeSale(shift.id, { employeeId: employee.id, cart, change: 0, payments: [cash(10000), { method: 'promptpay', amount: cart.net - 10000 }] });
    const cn = await s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'tissue', qty: 1 }], reason: 'คืน', approverCode: SUPERVISOR }, employee, 'T01');
    expect(cn.amount).toBe(8900);
    expect(cn.payments.reduce((a, p) => a + p.amount, 0)).toBe(8900);
    expect(cn.payments.map((p) => p.method).sort()).toEqual(['cash', 'promptpay']);
    const sum = summarizeShift((await s.shifts.getShift(shift.id))!);
    expect(sum.byMethod.cash + sum.byMethod.promptpay).toBe(cart.net - 8900);
  });

  it('needs a manager when the return is past the refund window', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }]);
    await s.shifts.closeShift(shift.id, 200000 + sale.cart.net);
    advance(8 * 86_400_000);
    const next = await s.shifts.openShift('T01', employee.id, 100000);
    const input = { saleDocNo: sale.docNo, lines: [{ productId: 'water', qty: 1 }], reason: 'คืน' };
    await expect(s.documents.credit(next.id, 'refund', { ...input, approverCode: SUPERVISOR }, employee, 'T01')).rejects.toMatchObject({ code: 'forbidden', details: { needsApproval: 'refund.late' } });
    await expect(s.documents.credit(next.id, 'refund', { ...input, approverCode: MANAGER }, employee, 'T01')).resolves.toMatchObject({ approvedBy: 'E004' });
  });
});

describe('members and points', () => {
  it('registers with PDPA consent, earns 1 point per 25 baht and returns them with a refund', async () => {
    const { employee, shift } = await start();
    await expect(s.members.register({ phone: '0811111111', name: 'สม', consent: false }, employee.id)).rejects.toMatchObject({ code: 'invalid' });
    await s.members.register({ phone: '081-111-1111', name: 'สม', consent: true }, employee.id);
    await expect(s.members.register({ phone: '0811111111', name: 'ซ้ำ', consent: true }, employee.id)).rejects.toMatchObject({ code: 'conflict' });
    const sale = await sell(shift.id, employee, [{ productId: 'tissue', qty: 2 }], { memberPhone: '0811111111' }); // member 85 x2 = 170
    expect(sale.cart.net).toBe(17000);
    expect(sale.pointsEarned).toBe(6);
    expect((await s.members.findByPhone('0811111111'))?.points).toBe(6);
    await s.documents.credit(shift.id, 'refund', { saleDocNo: sale.docNo, lines: [{ productId: 'tissue', qty: 2 }], reason: 'คืน', approverCode: SUPERVISOR }, employee, 'T01');
    expect((await s.members.findByPhone('0811111111'))?.points).toBe(0);
  });

  it('redeems points against the bill and gives them back on a void', async () => {
    const { employee, shift } = await start();
    await s.members.register({ phone: '0822222222', name: 'ใจ', consent: true }, employee.id);
    await sell(shift.id, employee, [{ productId: 'tissue', qty: 6 }], { memberPhone: '0822222222' }); // 510 -> 20 points
    const before = (await s.members.findByPhone('0822222222'))!.points;
    expect(before).toBeGreaterThanOrEqual(10); // 510 baht less the ฿20 bill promo = 19 points
    const sale = await sell(shift.id, employee, [{ productId: 'tissue', qty: 1 }], { memberPhone: '0822222222', pointsRedeemed: 10 }); // 85 baht - 10 points x 0.10 = 84
    expect(sale.pointsValue).toBe(100);
    expect(sale.payments[0].amount).toBe(8500 - 100);
    await expect(sell(shift.id, employee, [{ productId: 'pen', qty: 1 }], { memberPhone: '0822222222', pointsRedeemed: 9999 })).rejects.toMatchObject({ code: 'invalid' });
    const mid = (await s.members.findByPhone('0822222222'))!.points;
    await s.documents.credit(shift.id, 'void', { saleDocNo: sale.docNo, reason: 'คีย์ผิด', approverCode: SUPERVISOR }, employee, 'T01');
    expect((await s.members.findByPhone('0822222222'))!.points).toBe(mid + 10 - (sale.pointsEarned ?? 0));
  });

  it('expires points past their date, never below what the member still has', async () => {
    const { employee, shift } = await start();
    await db.transaction((tx) => s.settings.update(tx, { pointsExpiryMonths: 1 }));
    await s.members.register({ phone: '0833333333', name: 'มี', consent: true }, employee.id);
    await sell(shift.id, employee, [{ productId: 'tissue', qty: 6 }], { memberPhone: '0833333333' });
    expect((await s.members.findByPhone('0833333333'))!.points).toBeGreaterThan(0);
    advance(40 * 86_400_000);
    await s.members.expireDue();
    expect((await s.members.findByPhone('0833333333'))!.points).toBe(0);
    await s.members.expireDue(); // idempotent
    expect((await s.members.findByPhone('0833333333'))!.points).toBe(0);
  });

  it('erases a member (PDPA) while the bills stay', async () => {
    const { employee, shift } = await start();
    const m = await s.members.register({ phone: '0844444444', name: 'ลบฉัน', consent: true }, employee.id);
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }], { memberPhone: '0844444444' });
    await s.members.anonymize(m.id, employee.id);
    expect(await s.members.findByPhone('0844444444')).toBeNull();
    const got = await s.documents.getSale(sale.docNo);
    expect(got.sale.memberPhone).toBeUndefined();
    expect(got.sale.cart.net).toBe(sale.cart.net);
    await expect(sell(shift.id, employee, [{ productId: 'water', qty: 1 }], { memberPhone: '0844444444' })).rejects.toMatchObject({ code: 'invalid' });
  });
});

describe('documents', () => {
  it('issues one full tax invoice per bill with its own gapless number, and counts reprints', async () => {
    const { employee, shift } = await start();
    const a = await sell(shift.id, employee, [{ productId: 'water', qty: 1 }]);
    const b = await sell(shift.id, employee, [{ productId: 'coffee', qty: 1 }]);
    const buyer = { buyerName: 'บริษัท ตัวอย่าง จำกัด', buyerAddress: '1 ถนนตัวอย่าง', buyerTaxId: '0105500000000', buyerBranch: '00000' };
    await expect(s.documents.taxInvoice(a.docNo, { ...buyer, buyerTaxId: '123' }, employee, 'T01')).rejects.toMatchObject({ code: 'invalid' });
    expect((await s.documents.taxInvoice(a.docNo, buyer, employee, 'T01')).docNo).toBe('TI-6911-000001');
    expect((await s.documents.taxInvoice(b.docNo, buyer, employee, 'T01')).docNo).toBe('TI-6911-000002');
    await expect(s.documents.taxInvoice(a.docNo, buyer, employee, 'T01')).rejects.toMatchObject({ code: 'conflict' });
    expect(await s.documents.reprint(a.docNo, employee, 'T01')).toBe(1);
    expect(await s.documents.reprint(a.docNo, employee, 'T01')).toBe(2);
    const got = await s.documents.getSale(a.docNo);
    expect(got.reprints).toBe(2);
    expect(got.taxInvoice?.docNo).toBe('TI-6911-000001');
    expect((await s.documents.search({ term: a.docNo })).map((r) => r.docNo)).toEqual([a.docNo]);
  });
});

describe('close shift', () => {
  it('needs a note and a supervisor code when the count is off by more than the limit', async () => {
    const { employee, shift } = await start();
    await expect(s.shifts.closeShift(shift.id, 150000, undefined, employee)).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.shifts.closeShift(shift.id, 150000, 'ขาด', employee)).rejects.toMatchObject({ code: 'forbidden' });
    const closed = await s.shifts.closeShift(shift.id, 150000, 'ขาด', employee, SUPERVISOR);
    expect(closed.closedAt).toBeTruthy();
    const log = await db.query<{ approver: string | null }>(`SELECT approver FROM audit_log WHERE action='shift.close'`);
    expect(log[0].approver).toBe('E003');
  });

  it('logs a no-sale drawer open with its reason and approver', async () => {
    const { employee, shift } = await start();
    await expect(s.shifts.openDrawer(shift.id, 'ทอนเงิน', employee)).rejects.toMatchObject({ code: 'forbidden' });
    await s.shifts.openDrawer(shift.id, 'ทอนเงิน', employee, SUPERVISOR);
    expect((await db.query(`SELECT 1 FROM audit_log WHERE action='drawer.nosale'`)).length).toBe(1);
  });
});

describe('stock and receiving', () => {
  it('receives goods through the ledger and moves the average cost', async () => {
    const owner = await who(OWNER);
    const [{ cost }] = await db.query<{ cost: number }>(`SELECT cost FROM products WHERE id='water'`); // 650, 50 on hand
    await s.backoffice.receive({ supplierId: 'SUP1', ref: 'INV-1', lines: [{ productId: 'water', qty: 50, unitCost: cost + 200 }] }, owner, true);
    expect(await stockOf('water')).toBe(100);
    const [after] = await db.query<{ cost: number }>(`SELECT cost FROM products WHERE id='water'`);
    expect(after.cost).toBe(cost + 100);
    await expect(s.backoffice.receive({ supplierId: 'NOPE', lines: [{ productId: 'water', qty: 1, unitCost: 1 }] }, owner, true)).rejects.toMatchObject({ code: 'invalid' });
    expect((await s.backoffice.listReceipts())[0]).toMatchObject({ supplier: 'ผู้ขายตัวอย่าง', qty: 50 });
  });

  it('adjusts waste with a reason and flags low stock', async () => {
    const manager = await who(MANAGER);
    await s.backoffice.adjust({ productId: 'milk', qty: -45, reason: 'expired' }, manager);
    expect(await stockOf('milk')).toBe(5);
    const low = await s.backoffice.stock({ lowOnly: true });
    expect(low.map((r) => r.productId)).toContain('milk');
    await expect(s.backoffice.adjust({ productId: 'milk', qty: 0, reason: 'waste' }, manager)).rejects.toMatchObject({ code: 'invalid' });
  });

  it('counts stock against a snapshot and adjusts for sales made while counting', async () => {
    const manager = await who(MANAGER);
    const { employee, shift } = await start();
    const { id } = await s.backoffice.startCount({ categoryId: 'drink' }, manager);
    await expect(s.backoffice.startCount({}, manager)).rejects.toMatchObject({ code: 'conflict' });
    await sell(shift.id, employee, [{ productId: 'water', qty: 2 }]); // sold while counting: the shelf now holds 48
    await s.backoffice.saveCounted(id, [{ productId: 'water', qty: 47 }, { productId: 'coffee', qty: 50 }]);
    const view = await s.backoffice.getCount(id);
    expect(view.lines.find((l) => l.productId === 'water')).toMatchObject({ snapshot: 50, soldSince: -2, counted: 47, diff: -1 });
    expect(await s.backoffice.approveCount(id, manager)).toEqual({ adjusted: 1 });
    expect(await stockOf('water')).toBe(47);
    await expect(s.backoffice.approveCount(id, manager)).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('catalog admin', () => {
  it('keeps cost to the owner and records price history and audit', async () => {
    const manager = await who(MANAGER);
    const owner = await who(OWNER);
    const input = { sku: 'NEW-1', name: 'สินค้าใหม่', categoryId: 'drink', price: 2500, memberPrice: 2300, cost: 1500, barcodes: ['8859999999990'] };
    const asManager = await s.backoffice.saveProduct(null, input, manager, false);
    expect(asManager.cost).toBe(0); // a manager can't set or see cost
    const asOwner = await s.backoffice.saveProduct(asManager.id, { ...input, cost: 1500, price: 2600 }, owner, true);
    expect(asOwner).toMatchObject({ cost: 1500, price: 2600 });
    const hist = await db.query(`SELECT 1 FROM price_history WHERE product_id=$1`, [asManager.id]);
    expect(hist.length).toBe(2);
    await expect(s.backoffice.saveProduct(null, { ...input, sku: 'NEW-2' }, owner, true)).rejects.toMatchObject({ code: 'conflict' }); // barcode in use
    await expect(s.backoffice.saveProduct(null, { ...input, sku: 'NEW-3', price: 100, barcodes: [] }, owner, true)).rejects.toMatchObject({ code: 'invalid' }); // member price > price
  });

  it('validates promotions and lets the till pick them up', async () => {
    const manager = await who(MANAGER);
    await expect(s.backoffice.savePromotion({ kind: 'qty', id: 'p-x', name: 'x', productId: 'ghost', minQty: 2, unitPrice: 100, countMode: 'set' }, true, manager)).rejects.toMatchObject({ code: 'invalid' });
    await s.backoffice.savePromotion({ kind: 'bogo', id: 'p-pen', name: 'ปากกา 1 แถม 1', productId: 'pen', buyQty: 1, freeQty: 1 }, true, manager);
    expect((await s.catalog.getCatalog()).promotions.some((p) => p.id === 'p-pen')).toBe(true);
    await s.backoffice.savePromotion({ kind: 'bogo', id: 'p-pen', name: 'ปากกา 1 แถม 1', productId: 'pen', buyQty: 1, freeQty: 1 }, false, manager);
    expect((await s.catalog.getCatalog()).promotions.some((p) => p.id === 'p-pen')).toBe(false);
  });
});

describe('day close and reports', () => {
  it('blocks closing the day while a shift is open, then freezes it', async () => {
    const manager = await who(MANAGER);
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'water', qty: 2 }]);
    await expect(s.backoffice.closeDay('2026-11-06', manager)).rejects.toMatchObject({ code: 'conflict' });
    await s.shifts.closeShift(shift.id, 200000 + sale.cart.net);
    expect(await s.backoffice.closeDay('2026-11-06', manager)).toMatchObject({ bills: 1, net: sale.cart.net });
    await expect(s.backoffice.closeDay('2026-11-06', manager)).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.shifts.openShift('T01', employee.id, 0)).rejects.toMatchObject({ code: 'conflict' });
    const day = await s.backoffice.dayShifts('2026-11-06');
    expect(day.closed).toBeTruthy();
    expect(day.shifts[0]).toMatchObject({ variance: 0, bills: 1 });
  });

  it('reports sales net of refunds, by method, with cost only when allowed', async () => {
    const { employee, shift } = await start();
    const a = await sell(shift.id, employee, [{ productId: 'tissue', qty: 2 }]); // 178
    await sell(shift.id, employee, [{ productId: 'water', qty: 1 }]); // 10
    await s.documents.credit(shift.id, 'refund', { saleDocNo: a.docNo, lines: [{ productId: 'tissue', qty: 1 }], reason: 'คืน', approverCode: SUPERVISOR }, employee, 'T01');
    const r = await s.reports.salesSummary({ from: '2026-11-06', to: '2026-11-06' });
    expect(r.total).toMatchObject({ gross: 18800, refunds: 8900, net: 18800 - 8900, bills: 2 });
    expect(r.byMethod.cash).toBe(18800 - 8900);
    const withCost = await s.reports.products({ from: '2026-11-06', to: '2026-11-06' }, true);
    const without = await s.reports.products({ from: '2026-11-06', to: '2026-11-06' }, false);
    const tissue = withCost.all.find((p) => p.productId === 'tissue')!;
    expect(tissue).toMatchObject({ qty: 1, revenue: 8900, cost: 5785, profit: 8900 - 5785 });
    expect('cost' in (without.all.find((p) => p.productId === 'tissue') ?? {})).toBe(false);
    expect(withCost.notSold.length).toBeGreaterThan(5);
    const credits = await s.reports.credits({ from: '2026-11-06', to: '2026-11-06' });
    expect(credits.items[0]).toMatchObject({ actor: 'สมชาย', approver: 'ปรีชา', reason: 'คืน' });
    const dash = await s.reports.dashboard();
    expect(dash.sales.today.net).toBe(r.total.net);
    expect(dash.openShifts).toHaveLength(1);
  });

  it('builds the monthly tax report with full invoices', async () => {
    const { employee, shift } = await start();
    const sale = await sell(shift.id, employee, [{ productId: 'tissue', qty: 1 }]);
    await s.documents.taxInvoice(sale.docNo, { buyerName: 'ลูกค้า', buyerAddress: 'ที่อยู่', buyerTaxId: '0105500000000', buyerBranch: '00000' }, employee, 'T01');
    const t = await s.reports.tax('2026-11');
    expect(t.net).toBe(8900);
    expect(t.vat).toBe(582);
    expect(t.base).toBe(8318);
    expect(t.invoices[0]).toMatchObject({ docNo: 'TI-6911-000001', vat: 582 });
  });
});

describe('users and permissions', () => {
  it('follows the matrix and lets the owner override a cell', async () => {
    expect(await s.permissions.can('cashier', 'products.manage')).toBe(false);
    expect(await s.permissions.can('manager', 'products.manage')).toBe(true);
    await db.transaction((tx) => s.permissions.set(tx, 'supervisor', 'products.manage', true));
    expect(await s.permissions.can('supervisor', 'products.manage')).toBe(true);
    await db.transaction((tx) => s.permissions.set(tx, 'manager', 'refund', false));
    expect((await s.permissions.matrix()).manager).not.toContain('refund');
    await expect(db.transaction((tx) => s.permissions.set(tx, 'owner', 'users.manage', false))).rejects.toThrow();
  });

  it('signs in to the back office with a username and password, and locks after repeated failures', async () => {
    const ok = await s.auth.loginBackOffice('Owner', 'myshop-demo-1234');
    expect(ok.employee.role).toBe('owner');
    for (let i = 0; i < 5; i++) await expect(s.auth.loginBackOffice('manager', 'wrong-password')).rejects.toBeTruthy();
    await expect(s.auth.loginBackOffice('manager', 'myshop-demo-1234')).rejects.toMatchObject({ code: 'locked' });
    await expect(s.auth.loginBackOffice('E001', 'x')).rejects.toMatchObject({ code: 'unauthorized' }); // cashiers have no password
  });

  it('manages users without exposing secrets, and never removes the last owner', async () => {
    const owner = await who(OWNER);
    const u = await s.users.create({ name: 'สมศรี ใจดี', role: 'cashier', code: '600333' }, owner.id);
    expect(u).toMatchObject({ role: 'cashier', code: '' });
    await expect(s.users.create({ name: 'ซ้ำ', role: 'cashier', code: '600333' }, owner.id)).rejects.toMatchObject({ code: 'conflict' });
    expect((await who('600333')).name).toBe('สมศรี ใจดี');
    await s.users.update(u.id, { active: false }, owner.id);
    await expect(s.auth.login('600333', 'T01')).rejects.toBeTruthy();
    await expect(s.users.update('E005', { role: 'manager' }, owner.id)).rejects.toMatchObject({ code: 'conflict' });
    const log = await db.query<{ after: Record<string, unknown> }>(`SELECT after FROM audit_log WHERE action='user.create'`);
    expect(JSON.stringify(log)).not.toContain('600333');
  });

  it('validates settings', async () => {
    await expect(db.transaction((tx) => s.settings.update(tx, { refundDays: -1 }))).rejects.toThrow();
    await expect(db.transaction((tx) => s.settings.update(tx, { nonsense: 1 }))).rejects.toThrow();
    await db.transaction((tx) => s.settings.update(tx, { refundDays: 14, allowNegativeStock: false }));
    const cfg = await s.settings.getAll();
    expect(cfg).toMatchObject({ refundDays: 14, allowNegativeStock: false });
    const { employee, shift } = await start();
    await s.backoffice.adjust({ productId: 'pen', qty: -50, reason: 'lost' }, await who(MANAGER));
    await expect(sell(shift.id, employee, [{ productId: 'pen', qty: 1 }])).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('backup', () => {
  it('writes a backup file and prunes ones older than the retention window', async () => {
    const first = await s.backup.run();
    expect((await readdir(s.backup.dir)).length).toBe(1);
    const old = new Date(Date.now() - 40 * 86_400_000);
    await utimes(first.file, old, old);
    advance(0);
    await new Promise((r) => setTimeout(r, 1100)); // distinct file names
    const second = await s.backup.run();
    expect(second.removed).toBe(1);
    expect((await readdir(s.backup.dir)).length).toBe(1);
  });
});

describe('HTTP permissions', () => {
  let app: import('@nestjs/common').INestApplication;
  let base: string;
  beforeEach(async () => {
    const { NestFactory } = await import('@nestjs/core');
    const { AppModule } = await import('./modules');
    app = await NestFactory.create(AppModule.forRoot(s.options), { logger: false });
    app.setGlobalPrefix('api');
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });
  afterEach(() => app.close());

  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}/api${path}`, { method: init.method ?? (init.body ? 'POST' : 'GET'), headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) }, body: init.body ? JSON.stringify(init.body) : undefined });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  it('keeps back-office routes behind the role matrix, and hides cost from managers', async () => {
    const till = await call('/login', { body: { code: CASHIER, terminalId: 'T01' } });
    expect((await call('/bo/products', { token: till.body.token })).status).toBe(403); // cashiers cannot even view stock
    expect((await call('/bo/products')).status).toBe(401);

    const manager = (await call('/bo/login', { body: { username: 'manager', password: 'myshop-demo-1234' } })).body.token as string;
    const list = await call('/bo/products', { token: manager });
    expect(list.status).toBe(200);
    expect(list.body[0].cost).toBe(0); // managers never see cost
    expect((await call('/bo/users', { token: manager })).status).toBe(403);
    expect((await call('/bo/reports/tax?month=2026-11', { token: manager })).status).toBe(403);
    const me = await call('/me', { token: manager });
    expect(me.body.permissions).toContain('products.manage');
    expect(me.body.permissions).not.toContain('users.manage');

    const owner = (await call('/bo/login', { body: { username: 'owner', password: 'myshop-demo-1234' } })).body.token as string;
    expect((await call('/bo/products', { token: owner })).body[0].cost).toBeGreaterThan(0);
    expect((await call('/bo/users', { token: owner })).status).toBe(200);
    const day = await call(`/bo/dashboard`, { token: owner });
    expect(day.status).toBe(200);
    expect(day.body.sales.today.net).toBe(0);
    const bad = await call('/bo/reports/sales?from=2026-11-09&to=2026-11-01', { token: owner });
    expect(bad.status).toBe(400);
  });

  it('runs a till refund over HTTP: preview, approval needed, then done', async () => {
    const till = (await call('/login', { body: { code: CASHIER, terminalId: 'T01' } })).body.token as string;
    const shift = (await call('/shifts', { token: till, body: { terminalId: 'T01', float: 100000 } })).body;
    const cart = cartOf([{ productId: 'tissue', qty: 2 }]);
    const sale = (await call(`/shifts/${shift.id}/sales`, { token: till, body: { employeeId: 'x', cart, payments: [cash(cart.net)], change: 0 } })).body;
    const req = { saleDocNo: sale.docNo, lines: [{ productId: 'tissue', qty: 1 }], reason: 'คืน' };
    const preview = await call(`/shifts/${shift.id}/refund`, { token: till, body: { ...req, preview: true } });
    expect(preview.status).toBe(201);
    expect(preview.body.amount).toBe(8900);
    const refused = await call(`/shifts/${shift.id}/refund`, { token: till, body: req });
    expect(refused.status).toBe(403);
    expect(refused.body.details.needsApproval).toBe('refund');
    const ok = await call(`/shifts/${shift.id}/refund`, { token: till, body: { ...req, approverCode: SUPERVISOR } });
    expect(ok.status).toBe(201);
    expect(ok.body.docNo).toBe('CN-6911-000001');
    const checked = await call('/approvals', { token: till, body: { permission: 'void', code: SUPERVISOR } });
    expect(checked.body).toMatchObject({ approverId: 'E003' });
    expect((await call('/approvals', { token: till, body: { permission: 'users.manage', code: SUPERVISOR } })).status).toBe(403);
    const full = await call(`/shifts/${shift.id}`, { token: till });
    expect(full.body.creditNotes).toHaveLength(1);
    expect(full.body.sales).toHaveLength(1);
  });
});
