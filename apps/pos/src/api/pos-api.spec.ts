import type { PricedCart } from '@my-shop/contracts';
import { summarizeShift, type Shift } from './pos-api';

const cart = (net: number): PricedCart => ({ lines: [], premiums: [], billApplied: [], billNear: [], pieces: 1, gross: net, discount: 0, net, vat: 0 });

describe('summarizeShift', () => {
  it('computes expected cash from float, cash sales and drawer moves', () => {
    const shift: Shift = {
      id: 's', terminalId: 'T01', employeeId: 'E001', openedAt: '', float: 200000,
      sales: [
        { docNo: '1', at: '', employeeId: 'E001', cart: cart(13000), payments: [{ method: 'cash', amount: 13000, tendered: 20000 }], change: 7000 },
        { docNo: '2', at: '', employeeId: 'E001', cart: cart(5000), payments: [{ method: 'promptpay', amount: 5000 }], change: 0 },
      ],
      cashMoves: [
        { at: '', type: 'out', amount: 12000, reason: 'ค่าน้ำแข็ง', employeeId: 'E001' },
        { at: '', type: 'drop', amount: 100000, reason: 'เข้าเซฟ', employeeId: 'E001' },
      ],
    };
    const s = summarizeShift(shift);
    expect(s.bills).toBe(2);
    expect(s.net).toBe(18000);
    expect(s.byMethod.promptpay).toBe(5000);
    expect(s.expectedCash).toBe(200000 + 13000 - 12000 - 100000);
  });
});
