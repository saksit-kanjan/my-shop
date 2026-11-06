import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, Empty, Field, Loading, PageHeader, baht, dateTime, errText, fromSatang, toSatang, useLoad, useToast } from '../ui';

interface Line {
  productId: string;
  qty: string;
  cost: string;
}

export function ReceivePage() {
  const { can } = useSession();
  const canReceive = can('stock.manage');
  const { data, error, loading, reload } = useLoad(async () => ({ suppliers: await api.suppliers(), products: await api.products(), receipts: await api.receipts() }));
  const [supplierId, setSupplierId] = useState('');
  const [ref, setRef] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState('');
  const [newSup, setNewSup] = useState('');
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;

  const supplier = supplierId || data.suppliers[0]?.id || '';
  const product = (id: string) => data.products.find((p) => p.id === id);
  const add = (id: string) => {
    if (!id || lines.some((l) => l.productId === id)) return;
    setLines((ls) => [...ls, { productId: id, qty: '1', cost: can('reports.cost') ? fromSatang(product(id)?.cost ?? 0) : '' }]);
    setPick('');
  };
  const total = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (toSatang(l.cost) ?? 0), 0);

  const submit = async () => {
    setMsg('');
    const payload = lines.map((l) => ({ productId: l.productId, qty: Number(l.qty), unitCost: toSatang(l.cost) }));
    if (payload.some((l) => !Number.isInteger(l.qty) || l.qty <= 0 || l.unitCost === null)) return setMsg('ใส่จำนวนเป็นเลขจำนวนเต็มและต้นทุนต่อหน่วยให้ครบทุกรายการ');
    try {
      const r = await api.receive({ supplierId: supplier, ref: ref || undefined, lines: payload as { productId: string; qty: number; unitCost: number }[] });
      toast.show(`รับสินค้าแล้ว เลขที่ ${r.docNo}`);
      setLines([]);
      setRef('');
      await reload();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <>
      <PageHeader title="รับสินค้า" sub="รับเข้าแล้วยอดสต็อกเพิ่มทันที และต้นทุนเฉลี่ยของสินค้าถูกคำนวณใหม่" />
      <Alert kind="success">{toast.msg}</Alert>
      {canReceive ? (
        <Card title="ใบรับสินค้าใหม่" className="anim-in-2">
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
            <Field label="ผู้ขาย"><select className="select w-full" value={supplier} onChange={(e) => setSupplierId(e.target.value)}>{data.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
            <Field label="เลขที่ใบส่งของ (ไม่บังคับ)"><input className="input w-full" value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
            <Field label="เพิ่มสินค้า"><select className="select w-full" value={pick} onChange={(e) => add(e.target.value)}><option value="">เลือกสินค้า…</option>{data.products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></Field>
          </div>
          {lines.length > 0 && (
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>สินค้า</th><th className="text-right">คงเหลือ</th><th className="text-right w-28">จำนวนรับ</th><th className="text-right w-36">ต้นทุน/หน่วย</th><th className="text-right">รวม</th><th /></tr></thead>
              <tbody>{lines.map((l, i) => (
                <tr key={l.productId}>
                  <td className="font-medium">{product(l.productId)?.name}</td><td className="text-right opacity-70">{product(l.productId)?.stock}</td>
                  <td><input aria-label="จำนวนรับ" inputMode="numeric" className="input input-sm w-full text-right" value={l.qty} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, qty: e.target.value } : x)))} /></td>
                  <td><input aria-label="ต้นทุนต่อหน่วย" inputMode="decimal" className="input input-sm w-full text-right" value={l.cost} onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} /></td>
                  <td className="text-right">{baht((Number(l.qty) || 0) * (toSatang(l.cost) ?? 0))}</td>
                  <td><button type="button" className="btn btn-ghost btn-xs" aria-label="เอาออก" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button></td>
                </tr>
              ))}</tbody>
            </table></div>
          )}
          <Alert>{msg}</Alert>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-lg font-semibold">รวม {baht(total)}</span>
            <button type="button" className="btn btn-primary" disabled={lines.length === 0 || !supplier} onClick={() => void submit()}>บันทึกการรับสินค้า</button>
          </div>
          <form className="flex flex-wrap gap-2 pt-2 border-t border-base-300" onSubmit={(e) => { e.preventDefault(); if (newSup.trim()) void api.saveSupplier({ name: newSup }).then((r) => { setNewSup(''); setSupplierId(r.id); return reload(); }).catch((er: unknown) => toast.show(errText(er))); }}>
            <input className="input input-sm" aria-label="ชื่อผู้ขายใหม่" placeholder="ผู้ขายใหม่" value={newSup} onChange={(e) => setNewSup(e.target.value)} /><button type="submit" className="btn btn-sm">เพิ่มผู้ขาย</button>
          </form>
        </Card>
      ) : <Alert kind="info">บทบาทของคุณดูประวัติการรับสินค้าได้อย่างเดียว</Alert>}
      <Card title="การรับสินค้าล่าสุด" className="anim-in-3">
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>เลขที่</th><th>เวลา</th><th>ผู้ขาย</th><th>ใบส่งของ</th><th className="text-right">จำนวนรวม</th></tr></thead><tbody>
          {data.receipts.map((r) => <tr key={r.docNo}><td className="font-medium">{r.docNo}</td><td>{dateTime(r.at)}</td><td>{r.supplier}</td><td className="opacity-70">{r.ref ?? ''}</td><td className="text-right">{r.qty}</td></tr>)}
        </tbody></table></div>
        {data.receipts.length === 0 && <Empty>ยังไม่มีการรับสินค้า</Empty>}
      </Card>
    </>
  );
}
