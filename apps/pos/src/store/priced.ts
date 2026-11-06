import type { PricedCart } from '@my-shop/contracts';
import { memberSaving, priceCart } from '@my-shop/domain';
import { useMemo } from 'react';
import { useCart } from './cart';
import { useCatalog } from './catalog';

const EMPTY: PricedCart = { lines: [], premiums: [], billApplied: [], billNear: [], pieces: 0, gross: 0, discount: 0, net: 0, vat: 0 };

/** The current bill priced with every promotion. Recomputes only when the bill changes. */
export function usePricedCart(): { cart: PricedCart; memberSaving: number } {
  const catalog = useCatalog((s) => s.catalog);
  const lines = useCart((s) => s.lines);
  const memberPhone = useCart((s) => s.memberPhone);
  return useMemo(() => {
    if (!catalog) return { cart: EMPTY, memberSaving: 0 };
    return {
      cart: priceCart(lines, catalog, { isMember: !!memberPhone }),
      memberSaving: memberPhone ? 0 : memberSaving(lines, catalog),
    };
  }, [catalog, lines, memberPhone]);
}
