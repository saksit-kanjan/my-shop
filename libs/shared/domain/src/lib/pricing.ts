import type {
  AppliedPromo,
  BillPromotion,
  BogoPromotion,
  CartLine,
  Catalog,
  GiftPromotion,
  NearPromo,
  PremiumLine,
  PricedCart,
  PricedLine,
  Product,
  QtyPricePromotion,
  Satang,
} from '@my-shop/contracts';
import { formatBaht, vatIncluded } from './money';
import { isPromotionActive } from './promotion-schedule';

export interface PriceOptions {
  isMember: boolean;
  /** The moment the bill is priced, to drop promotions that are out of their dates or weekdays. Omit to apply every promotion. */
  at?: Date;
}

/** Merge duplicate product lines and drop empty ones, keeping first-seen order. */
export function normalizeLines(lines: CartLine[]): CartLine[] {
  const order: string[] = [];
  const qty = new Map<string, number>();
  for (const l of lines) {
    if (!qty.has(l.productId)) order.push(l.productId);
    qty.set(l.productId, (qty.get(l.productId) ?? 0) + l.qty);
  }
  return order.map((productId) => ({ productId, qty: qty.get(productId) ?? 0 })).filter((l) => l.qty > 0);
}

function productMap(catalog: Catalog): Map<string, Product> {
  return new Map(catalog.products.map((p) => [p.id, p]));
}

function hasPricedPromo(line: PricedLine): boolean {
  return line.discount > 0 || line.giftOfProductId !== undefined;
}

function applyQty(promo: QtyPricePromotion, line: PricedLine, product: Product): void {
  const q = line.qty;
  const unitSave = product.price - promo.unitPrice;
  if (unitSave <= 0) return;
  const promoUnit = formatBaht(promo.unitPrice);

  if (promo.countMode === 'set') {
    const sets = Math.floor(q / promo.minQty);
    const rem = q % promo.minQty;
    if (sets > 0) {
      const discount = sets * promo.minQty * unitSave;
      let label = `ซื้อ ${promo.minQty} ลดเหลือชิ้นละ ${promoUnit}`;
      if (sets > 1) label += ` × ${sets} ชุด`;
      if (rem > 0) label += ` (${sets * promo.minQty} จาก ${q} ชิ้น)`;
      line.applied.push({ promotionId: promo.id, kind: 'qty', label, discount });
      line.discount += discount;
    }
    if (rem > 0) {
      const need = promo.minQty - rem;
      const extraPay = promo.minQty * promo.unitPrice - rem * product.price;
      line.near.push({
        promotionId: promo.id,
        kind: 'qty',
        label: sets > 0 ? `อีก ${need} ชิ้น ครบ ${sets + 1} ชุด` : `อีก ${need} ชิ้น ลดเหลือชิ้นละ ${promoUnit}`,
        addQty: need,
        addProductId: product.id,
        extraPay,
        gain: need * product.price - extraPay,
        gainIsFree: false,
      });
    }
    return;
  }

  if (q >= promo.minQty) {
    const discount = q * unitSave;
    line.applied.push({ promotionId: promo.id, kind: 'qty', label: `ซื้อ ${promo.minQty} ขึ้นไป ชิ้นละ ${promoUnit}`, discount });
    line.discount += discount;
  } else {
    const need = promo.minQty - q;
    const extraPay = promo.minQty * promo.unitPrice - q * product.price;
    line.near.push({
      promotionId: promo.id,
      kind: 'qty',
      label: `อีก ${need} ชิ้น ลดเหลือชิ้นละ ${promoUnit}`,
      addQty: need,
      addProductId: product.id,
      extraPay,
      gain: need * product.price - extraPay,
      gainIsFree: false,
    });
  }
}

function applyBogo(promo: BogoPromotion, line: PricedLine, product: Product): void {
  const group = promo.buyQty + promo.freeQty;
  const full = Math.floor(line.qty / group);
  const rem = line.qty % group;
  const free = full * promo.freeQty + Math.max(0, rem - promo.buyQty);
  const tag = `${promo.buyQty} แถม ${promo.freeQty}`;
  if (free > 0) {
    const discount = free * product.price;
    line.applied.push({ promotionId: promo.id, kind: 'bogo', label: `${tag} · ฟรี ${free} ชิ้น`, discount });
    line.discount += discount;
  }
  if (rem >= promo.buyQty) {
    const canTake = group - rem;
    line.near.push({
      promotionId: promo.id,
      kind: 'bogo',
      label: `${tag} · หยิบอีก ${canTake} ชิ้น ฟรี`,
      addQty: canTake,
      addProductId: product.id,
      extraPay: 0,
      gain: canTake * product.price,
      gainIsFree: true,
    });
  }
}

function applyGift(
  promo: GiftPromotion,
  lines: Map<string, PricedLine>,
  products: Map<string, Product>,
  catalog: Catalog,
  premiums: PremiumLine[],
): void {
  const source = lines.get(promo.buyProductId);
  if (!source) return;
  const entitled = Math.floor(source.qty / promo.buyQty) * promo.giftQty;
  if (entitled === 0) return;

  if (promo.gift.type === 'premium') {
    const giftId = promo.gift.premiumId;
    const premium = catalog.premiums.find((p) => p.id === giftId);
    if (!premium) return;
    const qty = Math.min(entitled, premium.stock);
    premiums.push({
      premiumId: premium.id,
      name: premium.name,
      qty,
      fromProductId: source.productId,
      promotionId: promo.id,
      outOfStock: qty < entitled,
    });
    if (qty > 0) {
      source.applied.push({ promotionId: promo.id, kind: 'gift', label: `แถม${premium.name} ${qty} ชิ้น`, discount: 0 });
    }
    return;
  }

  const giftProduct = products.get(promo.gift.productId);
  if (!giftProduct) return;
  const giftLine = lines.get(giftProduct.id);
  const inCart = giftLine?.qty ?? 0;
  const free = Math.min(entitled, inCart);

  if (giftLine && free > 0) {
    const discount = Math.min(free * giftProduct.price, giftLine.gross - giftLine.discount);
    giftLine.applied.push({ promotionId: promo.id, kind: 'gift', label: `ของแถมจาก ${source.name}`, discount });
    giftLine.discount += discount;
    giftLine.giftOfProductId = source.productId;
    source.applied.push({ promotionId: promo.id, kind: 'gift', label: `แถม${giftProduct.name} ${free} ชิ้น`, discount: 0 });
  }
  if (entitled > inCart) {
    const more = entitled - inCart;
    source.near.push({
      promotionId: promo.id,
      kind: 'gift',
      label: `รับ${giftProduct.name}ฟรี ${more} ชิ้น`,
      addQty: more,
      addProductId: giftProduct.id,
      extraPay: 0,
      gain: more * giftProduct.price,
      gainIsFree: true,
    });
  }
}

function applyMember(lines: PricedLine[], products: Map<string, Product>): void {
  for (const line of lines) {
    if (hasPricedPromo(line)) continue;
    const p = products.get(line.productId);
    if (!p || p.memberPrice >= p.price) continue;
    const discount = (p.price - p.memberPrice) * line.qty;
    line.applied.push({ promotionId: 'member', kind: 'member', label: 'ราคาสมาชิก', discount });
    line.discount += discount;
  }
}

/** What a non-member would save on this cart by giving their phone number. */
export function memberSaving(lines: CartLine[], catalog: Catalog): Satang {
  const asGuest = priceCart(lines, catalog, { isMember: false });
  const asMember = priceCart(lines, catalog, { isMember: true });
  return Math.max(0, asGuest.net - asMember.net);
}

function applyBill(promos: BillPromotion[], subtotal: Satang): { applied: AppliedPromo[]; near: NearPromo[] } {
  const reached = promos.filter((p) => subtotal >= p.minAmount).sort((a, b) => b.discount - a.discount)[0];
  const next = promos
    .filter((p) => subtotal < p.minAmount && (!reached || p.discount > reached.discount))
    .sort((a, b) => a.minAmount - b.minAmount)[0];
  const applied: AppliedPromo[] = reached
    ? [{ promotionId: reached.id, kind: 'bill', label: reached.name, discount: Math.min(reached.discount, subtotal) }]
    : [];
  const near: NearPromo[] =
    next && subtotal > 0
      ? [
          {
            promotionId: next.id,
            kind: 'bill',
            label: `ซื้ออีก ${formatBaht(next.minAmount - subtotal)} ลด ${formatBaht(next.discount)}`,
            addQty: 0,
            extraPay: next.minAmount - subtotal,
            gain: next.discount - (reached?.discount ?? 0),
            gainIsFree: false,
          },
        ]
      : [];
  return { applied, near };
}

/**
 * Price a cart: item promotions first (qty, buy X get Y, gifts), then member prices on lines
 * without a promotion, then the best bill-level promotion on what is left.
 */
export function priceCart(input: CartLine[], catalog: Catalog, options: PriceOptions): PricedCart {
  const promotions = options.at ? catalog.promotions.filter((p) => isPromotionActive(p, options.at as Date)) : catalog.promotions;
  const products = productMap(catalog);
  const lines = new Map<string, PricedLine>();

  for (const { productId, qty } of normalizeLines(input)) {
    const p = products.get(productId);
    if (!p) continue;
    lines.set(productId, {
      productId,
      name: p.name,
      imageKey: p.imageKey,
      qty,
      unitPrice: p.price,
      gross: p.price * qty,
      discount: 0,
      net: 0,
      applied: [],
      near: [],
    });
  }

  for (const promo of promotions) {
    if (promo.kind === 'qty' || promo.kind === 'bogo') {
      const line = lines.get(promo.productId);
      const product = products.get(promo.productId);
      if (!line || !product) continue;
      if (promo.kind === 'qty') applyQty(promo, line, product);
      else applyBogo(promo, line, product);
    }
  }

  const premiums: PremiumLine[] = [];
  for (const promo of promotions) {
    if (promo.kind === 'gift') applyGift(promo, lines, products, catalog, premiums);
  }

  const priced = [...lines.values()];
  if (options.isMember) applyMember(priced, products);

  for (const line of priced) {
    line.discount = Math.min(line.discount, line.gross);
    line.net = line.gross - line.discount;
  }

  const itemNet = priced.reduce((s, l) => s + l.net, 0);
  const billPromos = promotions.filter((p): p is BillPromotion => p.kind === 'bill');
  const bill = applyBill(billPromos, itemNet);
  const billDiscount = bill.applied.reduce((s, a) => s + a.discount, 0);

  const gross = priced.reduce((s, l) => s + l.gross, 0);
  const net = itemNet - billDiscount;

  return {
    lines: orderGiftsUnderSource(priced),
    premiums,
    billApplied: bill.applied,
    billNear: bill.near,
    pieces: priced.reduce((s, l) => s + l.qty, 0),
    gross,
    discount: gross - net,
    net,
    vat: vatIncluded(net),
  };
}

/** Put each free-gift line directly under the line that earned it. */
export function orderGiftsUnderSource(lines: PricedLine[]): PricedLine[] {
  const gifts = lines.filter((l) => l.giftOfProductId);
  const out: PricedLine[] = [];
  for (const line of lines) {
    if (line.giftOfProductId) continue;
    out.push(line, ...gifts.filter((g) => g.giftOfProductId === line.productId));
  }
  for (const g of gifts) if (!out.includes(g)) out.push(g);
  return out;
}

/** Every suggestion in the cart, item-level first, for the offers screen. */
export function allSuggestions(cart: PricedCart): { line?: PricedLine; near: NearPromo }[] {
  return [
    ...cart.lines.flatMap((line) => line.near.map((near) => ({ line, near }))),
    ...cart.billNear.map((near) => ({ near })),
  ];
}
