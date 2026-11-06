import type { PromoShowcaseItem } from '@my-shop/contracts';
import { ProductThumb } from '@my-shop/ui';

export function IdleScreen({ showcase, waiting }: { showcase: PromoShowcaseItem[]; waiting?: boolean }) {
  return (
    <main className="flex-1 flex flex-col justify-center gap-10 pb-10 overflow-hidden">
      <div className="px-8 flex flex-col gap-2 anim-in">
        <h1 className="text-6xl font-semibold">ยินดีต้อนรับ</h1>
        <span className="text-2xl opacity-70">{waiting ? 'กำลังเชื่อมต่อกับเครื่องคิดเงิน…' : 'โปรโมชันประจำสัปดาห์'}</span>
      </div>
      {showcase.length > 0 && (
        <div className="overflow-hidden" aria-label="โปรโมชันประจำสัปดาห์">
          <div className="flex gap-5 w-max anim-drift px-8">
            {[...showcase, ...showcase].map((p, i) => (
              <article key={i} className="card bg-base-100 border border-base-300 w-[300px] shrink-0" aria-hidden={i >= showcase.length}>
                <div className="card-body gap-3 p-5">
                  <span className="grid place-items-center rounded-xl h-40 bg-[#eef4f1]"><ProductThumb imageKey={p.imageKey} className="w-36 h-36" /></span>
                  <span className="badge badge-warning badge-lg">{p.tag}</span>
                  <span className="text-xl font-semibold">{p.name}</span>
                  <span className="text-3xl font-semibold text-primary">{p.deal}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="mx-8 rounded-box bg-secondary text-secondary-content px-8 py-6 flex flex-wrap items-center justify-between gap-4">
        <span className="text-2xl font-semibold">สมัครสมาชิกฟรีด้วยเบอร์โทร รับราคาพิเศษ</span>
        <span className="text-lg">แจ้งพนักงานได้เลย</span>
      </div>
    </main>
  );
}
