import type { Catalog, Promotion } from '@my-shop/contracts';
import { formatBaht, formatBahtFull, vatIncluded } from './money';
import { memberSaving, priceCart } from './pricing';

const b = (n: number) => n * 100;

function catalog(promotions: Promotion[]): Catalog {
  return {
    categories: [],
    premiums: [{ id: 'brush', name: 'แปรงสีฟันพกพา', stock: 1 }],
    products: [
      { id: 'chips', sku: 'C', name: 'มันฝรั่งทอด', categoryId: 'x', price: b(20), memberPrice: b(19), barcodes: [] },
      { id: 'bread', sku: 'B', name: 'ขนมปัง', categoryId: 'x', price: b(45), memberPrice: b(42), barcodes: [] },
      { id: 'milk', sku: 'M', name: 'นมจืด', categoryId: 'x', price: b(14), memberPrice: b(13), barcodes: [] },
      { id: 'tea', sku: 'T', name: 'ชาเขียว', categoryId: 'x', price: b(20), memberPrice: b(19), barcodes: [] },
      { id: 'paste', sku: 'P', name: 'ยาสีฟัน', categoryId: 'x', price: b(39), memberPrice: b(37), barcodes: [] },
    ],
    promotions,
  };
}

const qty = (countMode: 'set' | 'all'): Promotion => ({ kind: 'qty', id: 'q', name: 'q', productId: 'chips', minQty: 2, unitPrice: b(15), countMode });

describe('money', () => {
  it('formats short and full baht', () => {
    expect(formatBaht(b(159))).toBe('฿159');
    expect(formatBaht(850)).toBe('฿8.50');
    expect(formatBahtFull(b(1234))).toBe('฿1,234.00');
    expect(formatBaht(-b(10))).toBe('−฿10');
  });
  it('extracts VAT from a VAT-inclusive price', () => {
    expect(vatIncluded(b(107))).toBe(b(7));
    expect(vatIncluded(b(130))).toBe(850);
  });
});

describe('buy 2, each drops to ฿15', () => {
  it.each([
    [1, 'set', 20, 0, 1],
    [2, 'set', 30, 10, 0],
    [3, 'set', 50, 10, 1],
    [4, 'set', 60, 20, 0],
    [3, 'all', 45, 15, 0],
    [4, 'all', 60, 20, 0],
  ] as const)('%i bags (%s) pays ฿%i, saves ฿%i, %i suggestion', (q, mode, pay, save, hints) => {
    const cart = priceCart([{ productId: 'chips', qty: q }], catalog([qty(mode)]), { isMember: false });
    const line = cart.lines[0];
    expect(line.net).toBe(b(pay));
    expect(line.discount).toBe(b(save));
    expect(line.near).toHaveLength(hints);
  });

  it('suggests completing the set for the right extra price', () => {
    const cart = priceCart([{ productId: 'chips', qty: 3 }], catalog([qty('set')]), { isMember: false });
    expect(cart.lines[0].near[0]).toMatchObject({ addQty: 1, extraPay: b(10), gain: b(10) });
  });
});

describe('1 แถม 1', () => {
  const bogo: Promotion = { kind: 'bogo', id: 'b', name: 'b', productId: 'tea', buyQty: 1, freeQty: 1 };
  it('gives one free per pair and suggests the free one on odd quantities', () => {
    const one = priceCart([{ productId: 'tea', qty: 1 }], catalog([bogo]), { isMember: false });
    expect(one.net).toBe(b(20));
    expect(one.lines[0].near[0]).toMatchObject({ addQty: 1, gainIsFree: true, gain: b(20) });
    const three = priceCart([{ productId: 'tea', qty: 3 }], catalog([bogo]), { isMember: false });
    expect(three.net).toBe(b(40));
  });
});

describe('buy A get B', () => {
  const gift: Promotion = { kind: 'gift', id: 'g', name: 'g', buyProductId: 'bread', buyQty: 1, gift: { type: 'product', productId: 'milk' }, giftQty: 1 };
  it('makes B free and nests it under A', () => {
    const cart = priceCart([{ productId: 'milk', qty: 1 }, { productId: 'bread', qty: 1 }], catalog([gift]), { isMember: false });
    expect(cart.lines.map((l) => l.productId)).toEqual(['bread', 'milk']);
    expect(cart.lines[1]).toMatchObject({ net: 0, giftOfProductId: 'bread' });
  });
  it('suggests picking up B when it is missing', () => {
    const cart = priceCart([{ productId: 'bread', qty: 1 }], catalog([gift]), { isMember: false });
    expect(cart.lines[0].near[0]).toMatchObject({ addProductId: 'milk', addQty: 1, gainIsFree: true });
  });
  it('adds a premium gift and flags when stock runs out', () => {
    const premium: Promotion = { kind: 'gift', id: 'p', name: 'p', buyProductId: 'paste', buyQty: 1, gift: { type: 'premium', premiumId: 'brush' }, giftQty: 1 };
    const cart = priceCart([{ productId: 'paste', qty: 2 }], catalog([premium]), { isMember: false });
    expect(cart.premiums[0]).toMatchObject({ qty: 1, outOfStock: true });
    expect(cart.net).toBe(b(78));
  });
});

describe('bill promotion and member price', () => {
  const bill: Promotion = { kind: 'bill', id: 'bill', name: 'ซื้อครบ ฿200 ลด ฿20', minAmount: b(200), discount: b(20) };
  it('shows the gap below the threshold and applies above it', () => {
    const below = priceCart([{ productId: 'bread', qty: 4 }], catalog([bill]), { isMember: false });
    expect(below.billNear[0]).toMatchObject({ extraPay: b(20) });
    const above = priceCart([{ productId: 'bread', qty: 5 }], catalog([bill]), { isMember: false });
    expect(above.net).toBe(b(205));
  });
  it('member price only applies to lines without a promotion', () => {
    const lines = [{ productId: 'chips', qty: 2 }, { productId: 'bread', qty: 1 }];
    const cat = catalog([qty('set')]);
    expect(memberSaving(lines, cat)).toBe(b(3));
  });
});
