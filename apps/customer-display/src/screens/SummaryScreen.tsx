import type { DisplayState } from '@my-shop/contracts';
import { formatBaht } from '@my-shop/domain';
import { PromoChip } from '@my-shop/ui';
import { BillLines } from './BillLines';
import { Totals } from './Totals';

/** Bill summary with promotion status on each line, shown while the cashier checks offers. */
export function SummaryScreen({ state }: { state: DisplayState }) {
  const cart = state.cart;
  if (!cart) return null;
  return (
    <main className="flex-1 flex flex-wrap gap-6 px-8 pb-8 items-stretch min-h-0">
      <section aria-label="สรุปบิล" className="card bg-base-100 border border-base-300 anim-in min-h-0" style={{ flex: '999 1 600px', minWidth: 0 }}>
        <div className="card-body px-6 py-4 gap-0 overflow-y-auto">
          <BillLines state={state} showNear />
        </div>
      </section>
      <div className="flex flex-col gap-4 justify-center" style={{ flex: '1 1 340px', minWidth: 0 }}>
        <Totals net={cart.net} saved={cart.discount} legend />
          <div className="flex flex-wrap gap-2 ">
            {cart.billApplied.map((a) => <PromoChip key={a.promotionId} state="got" size="lg">{a.label}</PromoChip>)}
            {cart.billNear.map((n) => <PromoChip key={n.promotionId} state="near" size="lg">{n.label}</PromoChip>)}
            {!state.isMember && state.memberSaving > 0 && <PromoChip state="near" size="lg">แจ้งเบอร์สมาชิก ลดอีก {formatBaht(state.memberSaving)}</PromoChip>}
          </div>
      </div>
    </main>
  );
}
