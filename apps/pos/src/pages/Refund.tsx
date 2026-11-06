import type { CreditNote } from '@my-shop/contracts';
import { formatBaht, formatBahtFull } from '@my-shop/domain';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { SaleDetail, SaleSummary } from '../api/pos-api';
import { useApproval } from '../components/ApprovalDialog';
import { useSession } from '../store/session';

const REASONS = ['สินค้าชำรุด', 'ลูกค้าเปลี่ยนใจ', 'แคชเชียร์คิดเงินผิด', 'อื่น ๆ'];
const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร', transfer: 'โอน' };
const time = (iso: string) => new Date(iso).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' });

/** Void a whole bill (same shift) or return some items (any time). The server prices the refund; this page only asks. */
export function RefundPage() {
  const { shiftId, employee } = useSession();
  const { run, dialog } = useApproval();
  const [mode, setMode] = useState<'refund' | 'void'>('refund');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SaleSummary[]>([]);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState(REASONS[0]);
  const [restock, setRestock] = useState(true);
  const [preview, setPreview] = useState<CreditNote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<CreditNote | null>(null);

  const needsApproval = employee?.role === 'cashier';

  const returned = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of detail?.creditNotes ?? []) for (const l of c.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
    return m;
  }, [detail]);

  const search = async (value: string) => {
    setError('');
    setDetail(null);
    setPreview(null);
    if (!value.trim()) return setResults([]);
    try {
      const found = await api.searchSales(value.trim());
      setResults(found);
      if (found.length === 1) await open(found[0].docNo);
      else if (found.length === 0) setError('ไม่พบบิลนี้ ตรวจเลขที่บิลหรือเบอร์สมาชิกอีกครั้ง');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ค้นหาไม่สำเร็จ ลองอีกครั้ง');
    }
  };

  const open = async (docNo: string) => {
    try {
      setDetail(await api.getSale(docNo));
      setResults([]);
      setQty({});
      setPreview(null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดบิลไม่สำเร็จ');
    }
  };

  // The amount comes from the server (rule 2: no price math in the UI). Refresh it whenever the selection changes.
  const picked = Object.entries(qty).filter(([, n]) => n > 0).map(([productId, n]) => ({ productId, qty: n }));
  const canVoid = !!detail && detail.shiftId === shiftId && detail.creditNotes.length === 0 && !detail.sale.voided;
  useEffect(() => {
    if (!detail || !shiftId) return setPreview(null);
    if (mode === 'refund' && picked.length === 0) return setPreview(null);
    if (mode === 'void' && !canVoid) return setPreview(null);
    let live = true;
    const req = { saleDocNo: detail.sale.docNo, reason, restock, preview: true, ...(mode === 'refund' ? { lines: picked } : {}) };
    (mode === 'void' ? api.voidSale(shiftId, req) : api.refundSale(shiftId, req))
      .then((p) => live && (setPreview(p), setError('')))
      .catch((e: unknown) => live && (setPreview(null), setError(e instanceof Error ? e.message : '')));
    return () => {
      live = false;
    };
  }, [detail, mode, JSON.stringify(picked), restock, shiftId, canVoid]); // eslint-disable-line react-hooks/exhaustive-deps

  const confirm = async () => {
    if (!detail || !shiftId || !preview || busy) return;
    setBusy(true);
    setError('');
    try {
      const req = { saleDocNo: detail.sale.docNo, reason, restock, ...(mode === 'refund' ? { lines: picked } : {}) };
      const note = await run((approverCode) => (mode === 'void' ? api.voidSale(shiftId, { ...req, approverCode }) : api.refundSale(shiftId, { ...req, approverCode })));
      if (note) setDone(note);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <main className="flex-1 grid place-items-center p-6">
        <div className="card bg-base-100 border border-base-300 anim-in w-full max-w-[460px]">
          <div className="card-body gap-3 items-center text-center">
            <h1 className="text-xl font-semibold">{done.type === 'void' ? 'ยกเลิกบิลแล้ว' : 'คืนสินค้าแล้ว'}</h1>
            <span className="text-4xl font-semibold">{formatBahtFull(done.amount)}</span>
            <p className="text-sm opacity-70">
              คืนเงิน {done.payments.map((p) => `${METHOD[p.method] ?? p.method} ${formatBaht(p.amount)}`).join(' + ') || 'ไม่มีเงินต้องคืน'} · เอกสาร {done.docNo}
            </p>
            {done.payments.some((p) => p.method !== 'cash') && <p className="text-sm text-warning">ส่วนที่คืนผ่านบัตรหรือโอน ให้ทำที่เครื่อง EDC หรือแอปธนาคารเอง ระบบบันทึกไว้แล้ว</p>}
            <Link to="/sale" className="btn btn-primary btn-lg w-full mt-2">กลับหน้าขาย</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 flex flex-wrap gap-4 p-4 items-start">
      <section className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '999 1 520px', minWidth: 0 }}>
        <div className="card-body gap-4">
          <div role="tablist" className="tabs tabs-box self-start">
            {(['refund', 'void'] as const).map((m) => (
              <button key={m} type="button" role="tab" aria-selected={mode === m} className={`tab ${mode === m ? 'tab-active font-semibold' : ''}`} onClick={() => setMode(m)}>
                {m === 'refund' ? 'คืนสินค้า' : 'ยกเลิกทั้งบิล'}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void search(term);
            }}
          >
            <label className="input input-lg w-full">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
              <input type="search" autoFocus aria-label="ค้นหาบิล" placeholder="เลขที่บิล หรือเบอร์สมาชิก แล้วกด Enter" className="grow" value={term} onChange={(e) => setTerm(e.target.value)} />
            </label>
          </form>

          {results.length > 1 && (
            <ul className="menu bg-base-200 rounded-box" aria-label="ผลการค้นหา">
              {results.map((r) => (
                <li key={r.docNo}>
                  <button type="button" onClick={() => void open(r.docNo)} className="flex justify-between">
                    <span>{r.docNo} · {time(r.at)}</span>
                    <span>{r.voided ? 'ยกเลิกแล้ว' : formatBaht(r.net)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && <div role="alert" className="alert alert-soft alert-error text-sm">{error}</div>}

          {detail && (
            <>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <span><span className="font-semibold">{detail.sale.docNo}</span> · {time(detail.sale.at)}</span>
                <span className="flex gap-2">
                  {detail.sale.voided && <span className="badge badge-soft badge-error">ยกเลิกแล้ว</span>}
                  <span className="badge badge-soft badge-success">ชำระ {detail.sale.payments.map((p) => `${METHOD[p.method]} ${formatBahtFull(p.amount)}`).join(' + ') || 'ด้วยแต้ม'}</span>
                </span>
              </div>
              {mode === 'void' ? (
                <p className="text-sm opacity-80">{canVoid ? 'ยกเลิกทั้งบิลและคืนเงินเต็มจำนวนตามช่องทางเดิม สินค้าทั้งหมดกลับเข้าสต็อก' : 'ยกเลิกทั้งบิลได้เฉพาะบิลที่ขายในกะนี้และยังไม่เคยคืน ถ้าไม่ใช่ให้ใช้แท็บ "คืนสินค้า"'}</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="table">
                    <thead><tr><th className="w-10"><span className="sr-only">เลือก</span></th><th>สินค้า</th><th className="text-right">ขาย</th><th className="text-center">คืน</th></tr></thead>
                    <tbody>
                      {detail.sale.cart.lines.map((l) => {
                        const left = l.qty - (returned.get(l.productId) ?? 0);
                        const n = qty[l.productId] ?? 0;
                        return (
                          <tr key={l.productId} className={n > 0 ? 'bg-secondary/60' : ''}>
                            <td><input type="checkbox" className="checkbox checkbox-primary" disabled={left <= 0} aria-label={`เลือก ${l.name}`} checked={n > 0} onChange={(e) => setQty((q) => ({ ...q, [l.productId]: e.target.checked ? left : 0 }))} /></td>
                            <td className={n > 0 ? 'font-medium' : ''}>
                              {l.name} {l.applied.length > 0 && <span className="text-xs text-warning">มีโปร</span>} {l.giftOfProductId && <span className="text-xs text-success">ของแถม</span>}
                            </td>
                            <td className="text-right">{l.qty}{left < l.qty && <span className="text-xs opacity-60"> (คืนแล้ว {l.qty - left})</span>}</td>
                            <td className="text-center">
                              <input type="number" min={0} max={left} aria-label={`จำนวนที่คืน ${l.name}`} disabled={left <= 0} className="input input-sm w-20 text-center" value={n} onChange={(e) => setQty((q) => ({ ...q, [l.productId]: Math.max(0, Math.min(left, Number(e.target.value) || 0)) }))} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <label className="flex flex-col gap-1">
                <span className="text-sm">เหตุผล</span>
                <select className="select w-full" value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="checkbox checkbox-sm" checked={restock} onChange={(e) => setRestock(e.target.checked)} />
                <span className="text-sm">คืนสินค้าเข้าสต็อก (ไม่ใช่ของเสีย)</span>
              </label>
            </>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4 anim-in-2" style={{ flex: '1 1 340px', maxWidth: 420, minWidth: 0 }}>
        <div className="card bg-base-100 border border-base-300">
          <div className="card-body gap-2">
            <span className="text-sm opacity-70">ยอดคืนเงิน</span>
            <span className="text-4xl font-semibold">{preview ? formatBahtFull(preview.amount) : '฿0.00'}</span>
            <span className="text-sm opacity-70">
              {preview && preview.payments.length > 0 ? `คืนเป็น ${preview.payments.map((p) => `${METHOD[p.method]} ${formatBaht(p.amount)}`).join(' + ')} ตามช่องทางเดิม` : 'เลือกสินค้าที่คืน แล้วระบบคำนวณจากราคาที่ลูกค้าจ่ายจริง'}
              {' · ออกใบลดหนี้อ้างอิงบิลเดิม'}
            </span>
          </div>
        </div>
        {needsApproval && (
          <div className="card bg-base-100 border border-warning/40">
            <div className="card-body gap-1">
              <span className="font-semibold">ต้องให้หัวหน้ากะอนุมัติ</span>
              <span className="text-sm opacity-70">กดปุ่มด้านล่างแล้วให้หัวหน้ากะกดรหัสพนักงานของตัวเอง ระบบบันทึกทั้งผู้ขอและผู้อนุมัติ</span>
            </div>
          </div>
        )}
        <button type="button" className="btn btn-primary btn-lg h-14" disabled={!preview || busy || !shiftId} onClick={() => void confirm()}>
          {needsApproval ? 'ขออนุมัติและคืนเงิน' : 'ยืนยันและคืนเงิน'} {preview ? formatBahtFull(preview.amount) : ''}
        </button>
        <Link to="/sale" className="btn btn-ghost">ยกเลิก</Link>
      </aside>
      {dialog}
    </main>
  );
}
