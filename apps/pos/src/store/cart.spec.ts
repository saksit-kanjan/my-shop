import type { PricedCart } from '@my-shop/contracts';
import { localPosApi } from '../api/local-pos-api';
import { useCart } from './cart';

const manual = { type: 'percent' as const, value: 5, reason: 'ลูกค้าประจำ' };

describe('cart with a manual discount', () => {
  beforeEach(() => useCart.getState().clear());

  it('keeps the discount through hold and resume', () => {
    const c = useCart.getState();
    c.add('bread');
    c.setManualDiscount(manual);
    c.hold('รอเพื่อน');
    expect(useCart.getState().manualDiscount).toBeNull();
    expect(useCart.getState().resume(useCart.getState().held[0].id)).toBe(true);
    expect(useCart.getState().manualDiscount).toEqual(manual);
  });

  it('drops the discount when the last line is removed', () => {
    const c = useCart.getState();
    c.add('bread');
    c.setManualDiscount(manual);
    c.setQty('bread', 0);
    expect(useCart.getState().manualDiscount).toBeNull();
  });
});

describe('demo API discount cap', () => {
  const cart = (discount: number): PricedCart => ({
    lines: [], premiums: [], pieces: 1, gross: 10000, discount, net: 10000 - discount, vat: 0, billNear: [],
    billApplied: [{ promotionId: 'manual', kind: 'manual', label: 'ส่วนลดพิเศษ', discount }],
  });
  const sell = async (discount: number) => {
    const shift = await localPosApi.openShift(`T${discount}`, 'E001', 0);
    return localPosApi.recordSale(shift.id, { employeeId: 'E001', cart: cart(discount), payments: [{ method: 'cash', amount: 10000 - discount }], change: 0, manualDiscount: manual });
  };

  it('takes a discount within the cap', async () => {
    await expect(sell(1000)).resolves.toMatchObject({ docNo: expect.any(String) });
  });

  it('refuses one over the cap', async () => {
    await expect(sell(1001)).rejects.toThrow('เกิน 10%');
  });
});
