import type { DisplayState } from '@my-shop/contracts';
import { formatBaht } from '@my-shop/domain';
import { SuccessCheck } from '@my-shop/ui';

export function ThanksScreen({ state }: { state: DisplayState }) {
  const t = state.thanks;
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-8 pb-10 text-center">
      <SuccessCheck size={140} label="ชำระเงินสำเร็จ" />
      <h1 className="text-6xl font-semibold anim-in">ขอบคุณที่อุดหนุน</h1>
      {t && (
        <div className="flex flex-wrap justify-center gap-4 anim-in">
          <div className="rounded-box bg-base-100 border border-base-300 px-10 py-6 flex flex-col">
            <span className="text-xl opacity-70">เงินทอน</span>
            <span className="text-6xl font-semibold">{formatBaht(t.change)}</span>
          </div>
          {t.saved > 0 && (
            <div className="rounded-box bg-secondary text-secondary-content px-10 py-6 flex flex-col">
              <span className="text-xl">วันนี้คุณประหยัด</span>
              <span className="text-6xl font-semibold">{formatBaht(t.saved)}</span>
            </div>
          )}
        </div>
      )}
    </main>
  );
}
