import { formatBahtFull } from '@my-shop/domain';

export const DENOMINATIONS = [
  { label: 'ธนบัตร 1,000', value: 100000 },
  { label: 'ธนบัตร 500', value: 50000 },
  { label: 'ธนบัตร 100', value: 10000 },
  { label: 'ธนบัตร 50', value: 5000 },
  { label: 'ธนบัตร 20', value: 2000 },
  { label: 'เหรียญ 10', value: 1000 },
  { label: 'เหรียญ 5', value: 500 },
  { label: 'เหรียญ 2', value: 200 },
  { label: 'เหรียญ 1', value: 100 },
] as const;

export type Counts = Record<number, number>;

export function totalOf(counts: Counts): number {
  return DENOMINATIONS.reduce((s, d) => s + d.value * (counts[d.value] ?? 0), 0);
}

export function DenominationCounter({ counts, onChange }: { counts: Counts; onChange: (c: Counts) => void }) {
  const set = (value: number, qty: number) => onChange({ ...counts, [value]: Math.max(0, qty) });
  return (
    <div className="flex flex-col">
      {DENOMINATIONS.map((d) => {
        const qty = counts[d.value] ?? 0;
        return (
          <div key={d.value} className="flex items-center justify-between gap-3 py-2 border-b border-base-200">
            <span className="w-28 font-medium">{d.label}</span>
            <div className="join">
              <button type="button" className="btn join-item w-11" aria-label={`ลด ${d.label}`} onClick={() => set(d.value, qty - 1)}>−</button>
              <input
                type="text"
                inputMode="numeric"
                aria-label={d.label}
                className="input join-item w-16 text-center"
                value={String(qty)}
                onChange={(e) => set(d.value, parseInt(e.target.value.replace(/\D/g, '') || '0', 10))}
              />
              <button type="button" className="btn join-item w-11" aria-label={`เพิ่ม ${d.label}`} onClick={() => set(d.value, qty + 1)}>+</button>
            </div>
            <span className="w-28 text-right">{formatBahtFull(d.value * qty)}</span>
          </div>
        );
      })}
    </div>
  );
}
