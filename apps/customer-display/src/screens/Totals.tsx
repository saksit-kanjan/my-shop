import { formatBaht } from '@my-shop/domain';

export function Totals({ net, saved, legend }: { net: number; saved: number; legend?: boolean }) {
  return (
    <aside className="flex flex-col gap-4">
      <div className="card bg-neutral text-neutral-content">
        <div className="card-body gap-2 p-8">
          <span className="text-2xl opacity-80">ยอดชำระ</span>
          <span className="text-8xl font-semibold leading-none">{formatBaht(net)}</span>
        </div>
      </div>
      {saved > 0 && (
        <div className="rounded-box bg-secondary text-secondary-content px-8 py-5 flex justify-between items-center">
          <span className="text-2xl font-medium">ประหยัดแล้ว</span>
          <span key={saved} className="text-4xl font-semibold anim-pop">{formatBaht(saved)}</span>
        </div>
      )}
      {legend && (
        <span className="text-xl px-1">
          <span className="text-warning font-semibold">+ สีส้ม</span> <span className="opacity-70">คือรับเพิ่มได้ แจ้งพนักงาน</span>
        </span>
      )}
    </aside>
  );
}
