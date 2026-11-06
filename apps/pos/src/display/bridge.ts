import type { Catalog, DisplayMessage, DisplayPayState, DisplayPhase, DisplayState, PromoShowcaseItem } from '@my-shop/contracts';
import { displayChannelName } from '@my-shop/contracts';
import { formatBaht } from '@my-shop/domain';
import { useEffect, useMemo, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { create } from 'zustand';
import { storeInfo } from '../data/demo-catalog';
import { useCart } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { usePricedCart } from '../store/priced';

/** Extra state pages push to the customer display (payment progress, thank-you numbers). */
interface DisplayExtras {
  pay: DisplayPayState | null;
  thanks: { change: number; saved: number } | null;
  setPay: (pay: DisplayPayState | null) => void;
  setThanks: (thanks: { change: number; saved: number } | null) => void;
}

export const useDisplayExtras = create<DisplayExtras>((set) => ({
  pay: null,
  thanks: null,
  setPay: (pay) => set({ pay }),
  setThanks: (thanks) => set({ thanks }),
}));

export function promoShowcase(catalog: Catalog): PromoShowcaseItem[] {
  const byId = new Map(catalog.products.map((p) => [p.id, p]));
  const items: PromoShowcaseItem[] = [];
  for (const promo of catalog.promotions) {
    if (promo.kind === 'qty') {
      const p = byId.get(promo.productId);
      if (p) items.push({ productId: p.id, name: p.name, imageKey: p.imageKey, tag: `ซื้อ ${promo.minQty} ลดราคา`, deal: `${promo.minQty} ชิ้น ชิ้นละ ${formatBaht(promo.unitPrice)}` });
    } else if (promo.kind === 'bogo') {
      const p = byId.get(promo.productId);
      if (p) items.push({ productId: p.id, name: p.name, imageKey: p.imageKey, tag: `${promo.buyQty} แถม ${promo.freeQty}`, deal: `ซื้อ ${promo.buyQty} แถม ${promo.freeQty}` });
    } else if (promo.kind === 'gift') {
      const p = byId.get(promo.buyProductId);
      const giftName = promo.gift.type === 'product' ? byId.get(promo.gift.productId)?.name : catalog.premiums.find((x) => promo.gift.type === 'premium' && x.id === promo.gift.premiumId)?.name;
      if (p && giftName) items.push({ productId: p.id, name: p.name, imageKey: p.imageKey, tag: 'ซื้อแล้วมีของแถม', deal: `แถม${giftName}` });
    }
  }
  return items;
}

function phaseFor(path: string, hasLines: boolean): DisplayPhase {
  if (path.startsWith('/offers')) return 'offers';
  if (path.startsWith('/payment')) return 'pay';
  if (path.startsWith('/success')) return 'thanks';
  if (path.startsWith('/sale')) return hasLines ? 'cart' : 'idle';
  return 'idle';
}

/** Keeps the customer display in sync. Mounted once at the app root. */
export function useDisplaySync(): void {
  const { pathname } = useLocation();
  const catalog = useCatalog((s) => s.catalog);
  const { cart, memberSaving } = usePricedCart();
  const memberPhone = useCart((s) => s.memberPhone);
  const lastAdded = useCart((s) => s.lastAddedProductId);
  const pay = useDisplayExtras((s) => s.pay);
  const thanks = useDisplayExtras((s) => s.thanks);
  const channel = useRef<BroadcastChannel | null>(null);
  const latest = useRef<DisplayState | null>(null);

  const showcase = useMemo(() => (catalog ? promoShowcase(catalog) : []), [catalog]);

  const state: DisplayState = useMemo(
    () => ({
      phase: phaseFor(pathname, cart.lines.length > 0),
      cart,
      lastAddedProductId: lastAdded ?? undefined,
      isMember: !!memberPhone,
      memberSaving,
      pay: pay ?? undefined,
      thanks: thanks ?? undefined,
      promoShowcase: showcase,
      storeName: storeInfo.storeName,
      branchName: storeInfo.branchName,
    }),
    [pathname, cart, lastAdded, memberPhone, memberSaving, pay, thanks, showcase],
  );

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const ch = new BroadcastChannel(displayChannelName(storeInfo.terminalId));
    channel.current = ch;
    ch.onmessage = (e: MessageEvent<DisplayMessage>) => {
      if (e.data?.type === 'hello' && latest.current) ch.postMessage({ type: 'state', state: latest.current } satisfies DisplayMessage);
    };
    return () => ch.close();
  }, []);

  useEffect(() => {
    latest.current = state;
    channel.current?.postMessage({ type: 'state', state } satisfies DisplayMessage);
  }, [state]);
}
