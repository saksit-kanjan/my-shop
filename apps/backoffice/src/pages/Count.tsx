import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, Loading, PageHeader, dateTime, errText, useLoad, useToast } from '../ui';

export function CountPage() {
  const { can } = useSession();
  const canManage = can('stock.manage');
  const { data, error, loading, reload } = useLoad(async () => ({ count: await api.openCount(), cats: await api.categories() }));
  const [cat, setCat] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState('');
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const count = data.count;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setMsg('');
    try {
      await fn();
      toast.show(done);
      setDraft({});
      await reload();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const saveDraft = () => {
    const lines = Object.entries(draft).filter(([, v]) => v !== '').map(([productId, v]) => ({ productId, qty: Number(v) }));
    return lines.length ? api.saveCounted(count?.id ?? '', lines) : Promise.resolve();
  };

  return (
    <>
      <PageHeader title="ตรวจนับสต็อก" sub={count ? `เริ่มเมื่อ ${dateTime(count.startedAt)} · ${count.scope === 'all' ? 'ทั้งร้าน' : 'บางหมวด'}` : 'ถ่ายภาพยอดในระบบไว้ แล้วนับของจริงเทียบ'} />
      <Alert kind="success">{toast.msg}</Alert>
      <Alert>{msg}</Alert>
      {!count ? (
        canManage ? (
          <Card title="เริ่มรอบตรวจนับใหม่" className="anim-in-2">
            <p className="text-sm opacity-70 m-0">ระบบบันทึกยอดในระบบ ณ ตอนนี้ไว้ (snapshot) ระหว่างนับร้านขายต่อได้ ผลต่างจะคิดรวมการขายระหว่างนับให้</p>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="flex flex-col gap-1"><span className="text-sm">ขอบเขต</span><select className="select" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">ทั้งร้าน</option>{data.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
              <button type="button" className="btn btn-primary" onClick={() => void act(() => api.startCount(cat || undefined), 'เริ่มรอบตรวจนับแล้ว')}>เริ่มตรวจนับ</button>
            </div>
          </Card>
        ) : <Alert kind="info">ยังไม่มีรอบตรวจนับ</Alert>
      ) : (
        <Card className="anim-in-2">
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>SKU</th><th>สินค้า</th><th className="text-right">ยอดระบบตอนเริ่ม</th><th className="text-right">เปลี่ยนระหว่างนับ</th><th className="text-right w-32">นับได้</th><th className="text-right">ผลต่าง</th></tr></thead>
            <tbody>
              {count.lines.map((l) => {
                const typed = draft[l.productId];
                const counted = typed !== undefined ? (typed === '' ? null : Number(typed)) : l.counted;
                const diff = counted === null ? null : counted - (l.snapshot + l.soldSince);
                return (
                  <tr key={l.productId} className="hover:bg-base-200">
                    <td className="opacity-70">{l.sku}</td><td className="font-medium">{l.name}</td>
                    <td className="text-right">{l.snapshot}</td><td className="text-right opacity-70">{l.soldSince === 0 ? '–' : l.soldSince}</td>
                    <td><input aria-label={`นับได้ ${l.name}`} inputMode="numeric" disabled={!canManage} className="input input-sm w-full text-right" value={typed ?? (l.counted ?? '')} onChange={(e) => setDraft((d) => ({ ...d, [l.productId]: e.target.value.replace(/[^\d]/g, '') }))} /></td>
                    <td className={`text-right font-semibold ${diff ? (diff < 0 ? 'text-error' : 'text-warning') : ''}`}>{diff === null ? '' : diff > 0 ? `+${diff}` : diff}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
          {canManage && (
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn btn-ghost text-error" onClick={() => void act(() => api.cancelCount(count.id), 'ยกเลิกรอบตรวจนับแล้ว')}>ยกเลิกรอบนี้</button>
              <button type="button" className="btn" onClick={() => void act(saveDraft, 'บันทึกยอดนับแล้ว')}>บันทึกยอดที่นับ</button>
              <button type="button" className="btn btn-primary" onClick={() => void act(async () => { await saveDraft(); const r = await api.approveCount(count.id); toast.show(`อนุมัติแล้ว ปรับสต็อก ${r.adjusted} รายการ`); }, 'อนุมัติแล้ว')}>อนุมัติและปรับสต็อก</button>
            </div>
          )}
          <p className="text-xs opacity-60 m-0">สินค้าที่ยังไม่ได้กรอกยอดนับจะไม่ถูกปรับ</p>
        </Card>
      )}
    </>
  );
}
