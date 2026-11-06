import 'reflect-metadata';
import type { CartLine, Catalog, Payment, PricedCart } from '@my-shop/contracts';
import { priceCart } from '@my-shop/domain';
import { demoCatalog } from '@my-shop/seed';
import { createServices, type Services } from './helpers/services';
import type { Db } from '../src/database/database.types';
import { openTestDb } from './helpers/test-db';
import { seedDemo } from '../src/bootstrap/demo.seed';
import { LOCK_SECONDS, MAX_FAILS } from '../src/auth/login-attempts';

let now = new Date('2026-11-06T03:00:00Z'); // 10:00 in Bangkok
let db: Db;
let drop: () => Promise<void>;
let s: Services;

beforeEach(async () => {
  now = new Date('2026-11-06T03:00:00Z');
  ({ db, drop } = await openTestDb());
  s = await createServices(db, { clock: () => now });
  await seedDemo(s.db, s.credentials);
});
afterEach(() => drop());

const cartOf = (lines: CartLine[], isMember = false): PricedCart => priceCart(lines, demoCatalog as Catalog, { isMember });
const cash = (amount: number, tendered = amount): Payment => ({ method: 'cash', amount, tendered });

async function openShift() {
  const { employee } = await s.auth.login('100123', 'T01');
  return { employee, shift: await s.shifts.openShift('T01', employee.id, 200000) };
}

describe('login', () => {
  it('accepts a known code and never returns the code', async () => {
    const session = await s.auth.login('100123', 'T01');
    expect(session.employee).toMatchObject({ id: 'E001', name: 'สมชาย', role: 'cashier', code: '' });
    expect((await s.auth.authenticate(session.token))?.employee.id).toBe('E001');
  });

  it('locks the terminal for 30 s after 5 wrong codes, then lets a correct code in', async () => {
    for (let i = 0; i < MAX_FAILS - 1; i++) await expect(s.auth.login('999999', 'T01')).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(s.auth.login('999999', 'T01')).rejects.toMatchObject({ code: 'locked' }); // the 5th wrong code locks
    await expect(s.auth.login('100123', 'T01')).rejects.toMatchObject({ code: 'locked' });
    now = new Date(now.getTime() + (LOCK_SECONDS + 1) * 1000);
    await expect(s.auth.login('100123', 'T01')).resolves.toBeTruthy();
  });

  it('drops an idle session after 8 hours', async () => {
    const { token } = await s.auth.login('100123', 'T01');
    now = new Date(now.getTime() + 9 * 3_600_000);
    expect(await s.auth.authenticate(token)).toBeNull();
  });
});

describe('shifts', () => {
  it('allows one open shift per terminal and one business date from the server clock', async () => {
    const { employee, shift } = await openShift();
    await expect(s.shifts.openShift('T01', employee.id, 0)).rejects.toMatchObject({ code: 'conflict' });
    const [row] = await db.query<{ business_date: string }>(`SELECT business_date::text AS business_date FROM shifts WHERE id=$1`, [shift.id]);
    expect(row.business_date).toBe('2026-11-06');
  });

  it('keeps the business date on the previous day before the cutoff hour', async () => {
    await db.transaction((tx) => s.settings.update(tx, { cutoffHour: 4 }));
    const late = await createServices(db, { clock: () => new Date('2026-11-06T18:30:00Z') }); // 01:30 on the 7th
    const { employee } = await late.auth.login('100123', 'T02');
    const shift = await late.shifts.openShift('T02', employee.id, 0);
    const [row] = await db.query<{ business_date: Date | string }>(`SELECT business_date::text AS business_date FROM shifts WHERE id=$1`, [shift.id]);
    expect(row.business_date).toBe('2026-11-06');
  });

  it('records cash moves and closes once', async () => {
    const { employee, shift } = await openShift();
    const moved = await s.shifts.addCashMove(shift.id, { type: 'out', amount: 12000, reason: 'ค่าน้ำแข็ง', employeeId: employee.id });
    expect(moved.cashMoves).toHaveLength(1);
    await expect(s.shifts.addCashMove(shift.id, { type: 'out', amount: 0, reason: 'x', employeeId: employee.id })).rejects.toMatchObject({ code: 'invalid' });
    const closed = await s.shifts.closeShift(shift.id, 188000, 'ตรง');
    expect(closed.closedAt).toBeTruthy();
    await expect(s.shifts.closeShift(shift.id, 1)).rejects.toMatchObject({ code: 'conflict' });
    await expect(s.shifts.addCashMove(shift.id, { type: 'in', amount: 100, reason: 'x', employeeId: employee.id })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('closeSale', () => {
  it('re-prices on the server, numbers the bill, cuts stock and stores a snapshot', async () => {
    const { employee, shift } = await openShift();
    const lines: CartLine[] = [{ productId: 'chips', qty: 3 }, { productId: 'paste', qty: 1 }];
    const cart = cartOf(lines);
    // A tampered client total must not win.
    const tampered: PricedCart = { ...cart, net: 1, gross: 1 };
    const sale = await s.sales.closeSale(shift.id, { employeeId: employee.id, cart: tampered, payments: [cash(cart.net, 50000)], change: 0 });
    expect(sale.cart.net).toBe(cart.net);
    expect(sale.change).toBe(50000 - cart.net);
    expect(sale.docNo).toBe('T01-6911-000001');

    const second = await s.sales.closeSale(shift.id, { employeeId: employee.id, cart: cartOf([{ productId: 'water', qty: 1 }]), payments: [cash(1000)], change: 0 });
    expect(second.docNo).toBe('T01-6911-000002');

    const stock = await db.query<{ product_id: string; qty: number }>(`SELECT product_id, SUM(qty)::int AS qty FROM stock_movements WHERE product_id IS NOT NULL GROUP BY product_id ORDER BY product_id`);
    expect(Object.fromEntries(stock.map((r) => [r.product_id, r.qty]))).toMatchObject({ chips: 47, paste: 49, water: 49 });

    const reloaded = await s.shifts.getShift(shift.id);
    expect(reloaded?.sales.map((x) => x.docNo)).toEqual(['T01-6911-000001', 'T01-6911-000002']);
    expect(reloaded?.sales[0]?.payments[0]).toMatchObject({ method: 'cash', tendered: 50000 });
  });

  it('cuts gift products and premium stock for promotions', async () => {
    const { employee, shift } = await openShift();
    // A gift product must already be on the bill; the promo then makes it free.
    const cart = cartOf([{ productId: 'bread', qty: 1 }, { productId: 'milk', qty: 1 }, { productId: 'paste', qty: 1 }]);
    expect(cart.lines.find((l) => l.productId === 'milk')?.giftOfProductId).toBe('bread');
    await s.sales.closeSale(shift.id, { employeeId: employee.id, cart, payments: [cash(cart.net)], change: 0 });
    const milk = await db.query<{ qty: number }>(`SELECT SUM(qty)::int AS qty FROM stock_movements WHERE product_id='milk'`);
    expect(milk[0]?.qty).toBe(49); // 50 opening, 1 gifted
    const catalog = await s.sales.catalog();
    expect(catalog.premiums.find((p) => p.id === 'brush')?.stock).toBe(119);
  });

  it('applies member price only when a member phone is on the bill', async () => {
    const { employee, shift } = await openShift();
    const member = cartOf([{ productId: 'tea', qty: 1 }], true);
    await expect(s.sales.closeSale(shift.id, { employeeId: employee.id, cart: member, payments: [cash(member.net)], change: 0, memberPhone: '0812345678' })).rejects.toMatchObject({ code: 'invalid' }); // not registered yet
    await s.members.register({ phone: '0812345678', name: 'ลูกค้า', consent: true }, employee.id);
    const sale = await s.sales.closeSale(shift.id, { employeeId: employee.id, cart: member, payments: [cash(member.net)], change: 0, memberPhone: '0812345678' });
    expect(sale.cart.net).toBe(member.net);
    expect(member.net).toBeLessThan(cartOf([{ productId: 'tea', qty: 1 }]).net);
  });

  it('rejects short, over and malformed payments and leaves nothing behind', async () => {
    const { employee, shift } = await openShift();
    const cart = cartOf([{ productId: 'water', qty: 2 }]);
    const base = { employeeId: employee.id, cart, change: 0 };
    await expect(s.sales.closeSale(shift.id, { ...base, payments: [cash(cart.net - 1)] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.sales.closeSale(shift.id, { ...base, payments: [cash(cart.net + 1)] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.sales.closeSale(shift.id, { ...base, payments: [{ method: 'card', amount: cart.net, reference: '12' }] })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.sales.closeSale(shift.id, { ...base, payments: [] })).rejects.toMatchObject({ code: 'invalid' });
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM sales`);
    expect(n).toBe(0);
  });

  it('rolls everything back when a late step fails (no doc number burned, no stock cut)', async () => {
    const { employee, shift } = await openShift();
    const cart = cartOf([{ productId: 'water', qty: 1 }]);
    // Force a failure after the bill row and stock rows are written: a payment row breaks its CHECK.
    await db.query(`ALTER TABLE payments ADD CONSTRAINT boom CHECK (reference IS DISTINCT FROM 'boom')`);
    await expect(s.sales.closeSale(shift.id, { employeeId: employee.id, cart, change: 0, payments: [{ method: 'transfer', amount: cart.net, reference: 'boom' }] })).rejects.toThrow();
    const counts = await db.query<{ t: string; n: number }>(`SELECT 'sales' t, count(*)::int n FROM sales UNION ALL SELECT 'stock', count(*)::int FROM stock_movements WHERE kind='sale' UNION ALL SELECT 'counters', count(*)::int FROM doc_counters`);
    expect(Object.fromEntries(counts.map((c) => [c.t, c.n]))).toEqual({ sales: 0, stock: 0, counters: 0 });
  });

  it('refuses unknown products, empty bills and closed shifts', async () => {
    const { employee, shift } = await openShift();
    const fake: PricedCart = { ...cartOf([{ productId: 'water', qty: 1 }]), lines: [{ productId: 'nope', name: 'x', qty: 1, unitPrice: 100, gross: 100, discount: 0, net: 100, applied: [], near: [] }] };
    await expect(s.sales.closeSale(shift.id, { employeeId: employee.id, cart: fake, payments: [cash(100)], change: 0 })).rejects.toMatchObject({ code: 'invalid' });
    await expect(s.sales.closeSale(shift.id, { employeeId: employee.id, cart: cartOf([]), payments: [cash(100)], change: 0 })).rejects.toMatchObject({ code: 'invalid' });
    await s.shifts.closeShift(shift.id, 200000);
    await expect(s.sales.closeSale(shift.id, { employeeId: employee.id, cart: cartOf([{ productId: 'water', qty: 1 }]), payments: [cash(1000)], change: 0 })).rejects.toMatchObject({ code: 'conflict' });
  });
});

describe('append-only documents (rule 3)', () => {
  it('blocks UPDATE and DELETE on closed bills, lines, payments, stock and the audit log', async () => {
    const { employee, shift } = await openShift();
    const cart = cartOf([{ productId: 'water', qty: 1 }]);
    const sale = await s.sales.closeSale(shift.id, { employeeId: employee.id, cart, payments: [cash(cart.net)], change: 0 });
    for (const sql of [
      `UPDATE sales SET net=1 WHERE doc_no='${sale.docNo}'`,
      `DELETE FROM sales WHERE doc_no='${sale.docNo}'`,
      `UPDATE sale_lines SET qty=9`,
      `DELETE FROM payments`,
      `UPDATE stock_movements SET qty=0`,
      `DELETE FROM audit_log`,
    ]) await expect(db.query(sql), sql).rejects.toThrow(/append-only/);
  });

  it('audits who did what', async () => {
    const { employee, shift } = await openShift();
    const cart = cartOf([{ productId: 'water', qty: 1 }]);
    await s.sales.closeSale(shift.id, { employeeId: employee.id, cart, payments: [cash(cart.net)], change: 0 });
    const actions = await db.query<{ action: string }>(`SELECT action FROM audit_log ORDER BY id`);
    expect(actions.map((a) => a.action)).toEqual(['login', 'shift.open', 'sale.close']);
  });
});

describe('HTTP', () => {
  let app: import('@nestjs/common').INestApplication;
  let base: string;

  beforeEach(async () => {
    app = s.app;
    await app.listen(0);
    base = (await app.getUrl()).replace('[::1]', 'localhost');
  });
  afterEach(() => app.close());

  const call = async (path: string, init: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await fetch(`${base}/api${path}`, {
      method: init.method ?? (init.body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', ...(init.token ? { authorization: `Bearer ${init.token}` } : {}) },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, headers: res.headers };
  };

  it('needs a session for everything except login', async () => {
    expect((await call('/terminals/T01/open-shift')).status).toBe(401);
    expect((await call('/catalog')).status).toBe(200); // read-only, loaded before sign-in
    const bad = await call('/login', { body: { code: '000000', terminalId: 'T01' } });
    expect(bad.status).toBe(401);
    expect(bad.body.message).toBeTruthy();
  });

  it('runs a whole shift: login, open, sell, close', async () => {
    const login = await call('/login', { body: { code: '100123', terminalId: 'T01' } });
    expect(login.status).toBe(200);
    const token = login.body.token as string;

    const catalog = await call('/catalog', { token });
    expect(catalog.body.products).toHaveLength(demoCatalog.products.length);

    const shift = (await call('/shifts', { token, body: { terminalId: 'T01', float: 200000 } })).body;
    expect((await call('/terminals/T01/open-shift', { token })).body.id).toBe(shift.id);

    const cart = cartOf([{ productId: 'chips', qty: 2 }]);
    const sale = await call(`/shifts/${shift.id}/sales`, { token, body: { employeeId: 'E003', cart, payments: [cash(cart.net)], change: 0 } });
    expect(sale.status).toBe(201);
    expect(sale.body.employeeId).toBe('E001'); // the session wins over the body
    expect(sale.body.docNo).toBe('T01-6911-000001');

    const bad = await call(`/shifts/${shift.id}/sales`, { token, body: { employeeId: 'E001', cart, payments: [cash(1)], change: 0 } });
    expect(bad.status).toBe(400);

    const closed = await call(`/shifts/${shift.id}/close`, { token, body: { counted: 200000 + cart.net } });
    expect(closed.status).toBe(200);
    expect(closed.body.closedAt).toBeTruthy();
    expect(closed.body.sales).toHaveLength(1);
  });

  it('answers 423 with Retry-After while a terminal is locked', async () => {
    for (let i = 0; i < MAX_FAILS; i++) await call('/login', { body: { code: '000000', terminalId: 'T09' } });
    const res = await call('/login', { body: { code: '100123', terminalId: 'T09' } });
    expect(res.status).toBe(423);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});
