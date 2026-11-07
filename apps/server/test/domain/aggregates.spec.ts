import { priceCart } from '@my-shop/domain';
import { demoCatalog } from '@my-shop/seed';
import type { Catalog, Payment } from '@my-shop/contracts';
import { Member } from '../../src/members/domain/member';
import { Product } from '../../src/products/domain/product';
import { CreditNote } from '../../src/sales/domain/credit-note';
import { Sale } from '../../src/sales/domain/sale';
import { Shift } from '../../src/sales/domain/shift';
import { StockCount } from '../../src/stock/domain/stock-count';

const now = new Date('2026-11-06T03:00:00Z');
const catalog = demoCatalog as Catalog;
const rules = { earnSatang: 2500, valueSatang: 10, expiryMonths: 0 };

describe('Shift', () => {
  const open = () => Shift.open({ id: 's1', terminalId: 'T01', employeeId: 'E001', businessDate: '2026-11-06', float: 200000, now });

  it('takes cash moves while open and refuses them once closed', () => {
    const shift = open();
    shift.addCashMove({ type: 'out', amount: 5000, reason: 'ค่าน้ำแข็ง', employeeId: 'E001' }, now);
    expect(shift.takeNewCashMoves()).toHaveLength(1);
    expect(shift.takeNewCashMoves()).toHaveLength(0);
    shift.close(195000, undefined, now);
    expect(() => shift.addCashMove({ type: 'in', amount: 100, reason: 'x', employeeId: 'E001' }, now)).toThrow('กะนี้ปิดแล้ว');
    expect(() => shift.close(1, undefined, now)).toThrow('กะนี้ปิดแล้ว');
  });

  it('validates a move and the opening float', () => {
    expect(() => open().addCashMove({ type: 'out', amount: 0, reason: 'x', employeeId: 'E001' }, now)).toThrow();
    expect(() => open().addCashMove({ type: 'out', amount: 100, reason: ' ', employeeId: 'E001' }, now)).toThrow();
    expect(() => Shift.open({ id: 's', terminalId: 'T', employeeId: 'E', businessDate: '2026-11-06', float: -1, now })).toThrow();
  });

  it('knows when a difference needs a supervisor', () => {
    expect(Shift.needsApproval(Shift.variance(10000, 20000), 5000)).toBe(true);
    expect(Shift.needsApproval(Shift.variance(19000, 20000), 5000)).toBe(false);
  });
});

describe('StockCount', () => {
  const start = () => StockCount.start({ id: 'c1', startedBy: 'E003', now, snapshot: [{ productId: 'a', qty: 10 }, { productId: 'b', qty: 5 }] });

  it('adjusts by counted minus what the ledger holds now, only for counted lines, and then is closed', () => {
    const count = start();
    count.record([{ productId: 'a', qty: 8 }]);
    const adjustments = count.approve('E003', now, (id) => (id === 'a' ? 9 : 5)); // one sold while counting
    expect(adjustments).toEqual([{ productId: 'a', qty: -1 }]);
    expect(() => count.cancel()).toThrow('ปิดแล้ว');
    expect(() => count.record([{ productId: 'a', qty: 1 }])).toThrow('ปิดแล้ว');
  });

  it('refuses a negative or fractional count', () => {
    expect(() => start().record([{ productId: 'a', qty: -1 }])).toThrow();
    expect(() => start().record([{ productId: 'a', qty: 1.5 }])).toThrow();
  });
});

describe('Member', () => {
  const member = () => Member.register({ id: 'm1', phone: '081-234-5678', name: 'สมศรี', consent: true, now });

  it('needs a valid phone, a name and PDPA consent', () => {
    expect(() => Member.register({ id: 'm', phone: '123', name: 'x', consent: true, now })).toThrow();
    expect(() => Member.register({ id: 'm', phone: '0812345678', name: ' ', consent: true, now })).toThrow();
    expect(() => Member.register({ id: 'm', phone: '0812345678', name: 'x', consent: false, now })).toThrow('ความยินยอม');
    expect(member().phone).toBe('0812345678');
  });

  it('earns, redeems within its balance and takes points back in proportion', () => {
    const m = member();
    expect(m.earn(10000, 'D1', rules, now)).toBe(4);
    expect(m.balance).toBe(4);
    expect(() => m.redeem(5, 10000, 'D2', rules, now)).toThrow('แต้มไม่พอ');
    expect(m.redeem(2, 10000, 'D2', rules, now)).toBe(20);
    m.adjustForCredit({ kind: 'void', creditDocNo: 'D1-V', priorCreditDocNos: [], earned: 4, redeemed: 2, saleNet: 9980, refundedAfter: 9980, now });
    expect(m.balance).toBe(0); // 4 earned - 2 spent = 2, then -4 clawed back and +2 returned: all undone
  });

  it('keeps no personal data after erasure and refuses further change', () => {
    const m = member();
    m.anonymize(now);
    expect(m.snapshot()).toMatchObject({ phone: null, name: '(ลบตามคำขอ)', birthday: null });
    expect(() => m.update({ name: 'x' })).toThrow('ไม่พบสมาชิก');
  });
});

describe('Product', () => {
  const data = { sku: 'X1', name: 'ของ', categoryId: 'c', price: 1000, memberPrice: 900, cost: 600 };

  it('records a price change only when a price or the cost moved', () => {
    const p = Product.create({ id: 'p1', sort: 0, data, canSeeCost: true, now, by: 'E004' });
    expect(p.pendingPriceChange).toMatchObject({ before: null, after: { price: 1000, memberPrice: 900, cost: 600 } });
    p.priceChangeStored();
    p.edit({ ...data, name: 'ชื่อใหม่' }, { canSeeCost: true, now, by: 'E004' });
    expect(p.pendingPriceChange).toBeNull();
    p.edit({ ...data, price: 1100 }, { canSeeCost: true, now, by: 'E004' });
    expect(p.pendingPriceChange).toMatchObject({ before: { price: 1000 }, after: { price: 1100 } });
  });

  it('keeps the stored cost from someone who may not see it, and rejects a member price above the price', () => {
    const p = Product.create({ id: 'p1', sort: 0, data, canSeeCost: true, now, by: 'E004' });
    p.edit({ ...data, cost: 1 }, { canSeeCost: false, now, by: 'E004' });
    expect(p.prices().cost).toBe(600);
    expect(() => p.edit({ ...data, memberPrice: 2000 }, { canSeeCost: true, now, by: 'E004' })).toThrow();
  });
});

describe('Sale and CreditNote', () => {
  const lines = [{ productId: 'tissue', qty: 2 }]; // 2 x 89 baht
  const cart = priceCart(lines, catalog, { isMember: false, at: now });
  const pricing = { products: catalog.products, promotions: catalog.promotions, premiums: [] };
  const close = (payments: Payment[]) =>
    Sale.close({ docNo: 'T01-1', shiftId: 's1', employeeId: 'E001', now, businessDate: '2026-11-06', memberId: null, cart, pricing, costs: new Map([['tissue', 5000]]), payments, pointsRedeemed: 0, pointsValue: 0, pointsEarned: 0, capPercent: 10, discountApprover: null });

  it('closes only when the payments cover what is due exactly, and works out the change', () => {
    expect(() => close([{ method: 'cash', amount: cart.net - 1 }])).toThrow('ยังไม่ครบ');
    expect(() => close([{ method: 'cash', amount: cart.net + 1 }])).toThrow('เกิน');
    const sale = close([{ method: 'cash', amount: cart.net, tendered: cart.net + 2000 }]);
    expect(sale.snapshot().change).toBe(2000);
    expect(sale.snapshot().lines[0].cost).toBe(5000);
  });

  it('needs approval for a manual discount over the cap', () => {
    const big = priceCart(lines, catalog, { isMember: false, at: now, manual: { type: 'percent', value: 30, reason: 'x' } });
    expect(() => Sale.assertManualDiscountApproved(big, 10, false)).toThrow('เกินเพดาน');
    expect(Sale.assertManualDiscountApproved(big, 10, true)).toBe(true);
  });

  it('plans a refund from the price paid, spreads it over the lines and refuses to return more than was sold', () => {
    const sale = close([{ method: 'cash', amount: cart.net }]);
    const plan = CreditNote.plan({ kind: 'refund', sale, pricing, shiftId: 's1', prior: [], wanted: [{ productId: 'tissue', qty: 1 }] });
    expect(plan.amount).toBe(8900);
    expect(plan.payments).toEqual([{ method: 'cash', amount: 8900 }]);
    expect(() => CreditNote.plan({ kind: 'refund', sale, pricing, shiftId: 's1', prior: [], wanted: [{ productId: 'tissue', qty: 3 }] })).toThrow('ไม่เกินจำนวนที่ขาย');
    const note = CreditNote.issue(plan, { docNo: 'CN-1', shiftId: 's1', now, businessDate: '2026-11-06', reason: 'คืน', restock: true, employeeId: 'E001', approvedBy: 'E003' });
    expect(() => CreditNote.plan({ kind: 'refund', sale, pricing, shiftId: 's1', prior: [note], wanted: [{ productId: 'tissue', qty: 2 }] })).toThrow('ไม่เกินจำนวนที่ขาย');
  });

  it('voids only in the shift of the sale, and only once', () => {
    const sale = close([{ method: 'cash', amount: cart.net }]);
    expect(() => CreditNote.plan({ kind: 'void', sale, pricing, shiftId: 'other', prior: [] })).toThrow('กะนี้');
    const plan = CreditNote.plan({ kind: 'void', sale, pricing, shiftId: 's1', prior: [] });
    expect(plan.amount).toBe(cart.net);
    const note = CreditNote.issue(plan, { docNo: 'T01-1-V', shiftId: 's1', now, businessDate: '2026-11-06', reason: 'ผิด', restock: true, employeeId: 'E001', approvedBy: 'E003' });
    expect(() => CreditNote.plan({ kind: 'void', sale, pricing, shiftId: 's1', prior: [note] })).toThrow('ถูกยกเลิกแล้ว');
  });
});
