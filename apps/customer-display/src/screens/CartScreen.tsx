import type { DisplayState } from '@my-shop/contracts';
import { PromoChip } from '@my-shop/ui';
import { BillLines } from './BillLines';
import { Totals } from './Totals';

export function CartScreen({ state }: { state: DisplayState }) {
  const cart = state.cart;
  if (!cart) return null;
  return (
    <main className="flex-1 flex flex-wrap gap-6 px-8 pb-8 items-stretch min-h-0">
      <section aria-label="รายการสินค้า" className="card bg-base-100 border border-base-300 min-h-0" style={{ flex: '999 1 600px', minWidth: 0 }}>
        <div className="card-body px-6 py-4 gap-0 overflow-hidden flex flex-col-reverse">
          {/* newest at the bottom stays visible on long bills */}
          <div><BillLines state={state} showNear={false} /></div>
        </div>
      </section>
      <div className="flex flex-col gap-4" style={{ flex: '1 1 340px', minWidth: 0 }}>
        <Totals net={cart.net} saved={cart.discount} />
        {cart.billNear.map((n) => (
          <div key={n.promotionId} className="flex"><PromoChip state="near" size="lg">{n.label}</PromoChip></div>
        ))}
      </div>
    </main>
  );
}
