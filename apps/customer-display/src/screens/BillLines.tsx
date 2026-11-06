import type { DisplayState, PricedLine } from '@my-shop/contracts';
import { GiftThumb, PriceStack, ProductThumb, PromoChip } from '@my-shop/ui';

/**
 * The bill as the customer sees it: one price per line, promo status as short chips under the
 * line, gifts nested under the item that earned them.
 */
export function BillLines({ state, showNear }: { state: DisplayState; showNear: boolean }) {
  const cart = state.cart;
  if (!cart) return null;
  const premiums = new Map(cart.premiums.map((p) => [p.fromProductId, p]));
  return (
    <>
      {cart.lines.map((l: PricedLine) => {
        const child = !!l.giftOfProductId;
        const premium = premiums.get(l.productId);
        const fresh = l.productId === state.lastAddedProductId && !showNear;
        const chips = l.applied.filter((a) => a.discount > 0 || a.kind === 'gift');
        return (
          <div key={l.productId}>
            <div className={`flex items-center gap-4 py-3 ${child ? 'pl-4' : ''} ${fresh ? 'anim-slide bg-secondary/50 -mx-3 px-3 rounded-xl' : 'border-b border-base-200'}`}>
              {child && <span aria-hidden="true" className="text-2xl opacity-40 w-6 text-center shrink-0">↳</span>}
              <ProductThumb imageKey={l.imageKey} size={child ? 'md' : 'md'} />
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <span className="text-xl font-medium">
                  {l.name} <span className="font-normal opacity-60">×{l.qty}</span>
                </span>
                {(chips.length > 0 || (showNear && l.near.length > 0)) && (
                  <span className="flex flex-wrap gap-2">
                    {chips.map((a) => <PromoChip key={a.promotionId} state="got">{a.label}</PromoChip>)}
                    {showNear && l.near.map((n) => <PromoChip key={n.promotionId} state="near">{n.label}</PromoChip>)}
                  </span>
                )}
              </div>
              <PriceStack gross={l.gross} net={l.net} size="xl" />
            </div>
            {premium && premium.qty > 0 && (
              <div className="flex items-center gap-4 py-3 pl-4 border-b border-base-200">
                <span aria-hidden="true" className="text-2xl opacity-40 w-6 text-center shrink-0">↳</span>
                <GiftThumb />
                <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                  <span className="text-xl font-medium">{premium.name} <span className="font-normal opacity-60">×{premium.qty}</span></span>
                  <span className="flex"><PromoChip state="got">ของพรีเมียมจาก {l.name}</PromoChip></span>
                </div>
                <span className="text-2xl font-semibold text-primary">ฟรี</span>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
