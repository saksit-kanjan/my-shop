import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/** Loads data on mount and whenever `deps` change; `reload` runs it again after a save. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fnRef.current());
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดข้อมูลไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setLoading(false);
    }
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void reload(), deps);
  return { data, error, loading, reload, setData };
}

export const errText = (e: unknown, fallback = 'ทำรายการไม่สำเร็จ ลองอีกครั้ง') => (e instanceof Error ? e.message : fallback);

/** "18.00" or "18" -> 1800 satang. Returns null when it is not a money amount. */
export function toSatang(text: string): number | null {
  const t = text.replace(/[,\s฿]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(Number(t) * 100);
}
export const fromSatang = (s: number) => (s / 100).toFixed(2);

export const baht = (s: number) => `฿${(s / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const dateTime = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });
export const todayIso = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

export function PageHeader({ title, sub, children }: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between items-end gap-3 anim-in">
      <div className="flex flex-col">
        <h1 className="text-2xl font-semibold m-0">{title}</h1>
        {sub && <span className="text-sm opacity-70">{sub}</span>}
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">{children}</div>
    </div>
  );
}

export function Alert({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'success' | 'warning' | 'info' }) {
  if (!children) return null;
  return (
    <div role={kind === 'error' ? 'alert' : 'status'} className={`alert alert-soft alert-${kind} text-sm`}>
      {children}
    </div>
  );
}

export function Card({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card bg-base-100 border border-base-300 ${className}`}>
      <div className="card-body gap-3">
        {title && <h2 className="text-lg font-semibold m-0">{title}</h2>}
        {children}
      </div>
    </section>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-sm">{label}</span>
      {children}
      {hint && <span className="text-xs opacity-60">{hint}</span>}
    </label>
  );
}

/** Native <dialog>: focus trap, Esc and backdrop come for free. */
export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-labelledby="modal-title" onClose={onClose}>
      <div className={`modal-box flex flex-col gap-3 ${wide ? 'max-w-3xl' : ''}`}>
        <h2 id="modal-title" className="text-lg font-semibold m-0">{title}</h2>
        {children}
      </div>
      <form method="dialog" className="modal-backdrop"><button aria-label="ปิด">ปิด</button></form>
    </dialog>
  );
}

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <input type="date" aria-label="ตั้งแต่วันที่" className="input input-sm" value={from} max={to} onChange={(e) => onChange(e.target.value, to)} />
      <span className="text-sm">ถึง</span>
      <input type="date" aria-label="ถึงวันที่" className="input input-sm" value={to} min={from} onChange={(e) => onChange(from, e.target.value)} />
    </div>
  );
}

/**
 * Saves rows as a real Excel file (.xlsx): bold header row, money and counts as numbers so they can be summed.
 * Text stays text (SKU, barcodes, phone numbers keep their leading zeros). The library loads only when someone exports.
 */
export async function exportExcel(name: string, rows: (string | number | null | undefined)[][]) {
  const { default: writeExcelFile } = await import('write-excel-file/browser');
  // A string like "18.00" is an amount written with fromSatang(); other numeric-looking text (barcodes, phones) stays text.
  const cell = (v: string | number | null | undefined, header: boolean) => {
    if (v === null || v === undefined || v === '') return null;
    if (header) return { value: String(v), fontWeight: 'bold' as const };
    if (typeof v === 'number') return { value: v };
    return /^-?\d+\.\d{2}$/.test(v) ? { value: Number(v) } : { value: v };
  };
  const data = rows.map((r, i) => r.map((v) => cell(v, i === 0)));
  const blob = await writeExcelFile(data as never).toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="p-8 text-center opacity-70 text-sm">{children}</div>;
}

export function Loading() {
  return <div className="p-8 text-center opacity-60 text-sm" role="status">กำลังโหลด…</div>;
}

export function useToast() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(''), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return { msg, show: setMsg };
}
