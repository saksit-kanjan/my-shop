import type { DisplayState } from '@my-shop/contracts';
import { formatBaht } from '@my-shop/domain';

export function PayScreen({ state }: { state: DisplayState }) {
  const pay = state.pay;
  const due = pay?.due ?? state.cart?.net ?? 0;
  const saved = state.cart?.discount ?? 0;
  return (
    <main className="flex-1 flex flex-wrap items-center justify-center gap-10 px-8 pb-10">
      <section className="flex flex-col gap-2 anim-in" style={{ flex: '1 1 420px', maxWidth: 560 }}>
        <span className="text-2xl opacity-70">ยอดที่ต้องชำระ</span>
        <span className="text-8xl font-semibold leading-none">{formatBaht(due)}</span>
        {saved > 0 && <span className="text-xl opacity-70 mt-2">ประหยัดแล้ว {formatBaht(saved)}</span>}
        {pay?.method === 'cash' && pay.tendered !== undefined && (
          <div className="flex flex-col gap-3 mt-6 anim-in">
            <div className="flex justify-between text-2xl"><span className="opacity-70">รับเงิน</span><span className="font-semibold">{formatBaht(pay.tendered)}</span></div>
            <div className="rounded-box bg-secondary text-secondary-content px-7 py-5 flex justify-between items-baseline">
              <span className="text-2xl font-semibold">เงินทอน</span>
              <span key={pay.change} className="text-6xl font-semibold anim-pop">{formatBaht(pay.change ?? 0)}</span>
            </div>
          </div>
        )}
      </section>
      {pay?.method === 'promptpay' && (
        <section className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '0 1 420px' }}>
          <div className="card-body items-center text-center gap-4 p-8">
            <span className="text-2xl font-semibold">สแกนเพื่อชำระด้วย PromptPay</span>
            <div className="w-72 h-72 rounded-box border-2 border-dashed border-base-300 grid place-items-center text-lg opacity-70">QR {formatBaht(due)}</div>
          </div>
        </section>
      )}
      {pay?.method === 'card' && (
        <section className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '0 1 420px' }}>
          <div className="card-body items-center text-center gap-5 p-10">
            <svg width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#0e6b58" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="6" width="18" height="12" rx="2" />
              <path d="M3 10h18M7 15h4" />
            </svg>
            <span className="text-3xl font-semibold">เสียบหรือแตะบัตรที่เครื่องชำระเงิน</span>
          </div>
        </section>
      )}
    </main>
  );
}
