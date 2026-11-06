import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, Empty, Field, Loading, Modal, PageHeader, baht, dateTime, errText, exportCsv, useLoad, useToast } from '../ui';

const KIND: Record<string, string> = { opening: 'ยอดยกมา', receive: 'รับสินค้า', sale: 'ขาย', void: 'ยกเลิกบิล', refund: 'ลูกค้าคืน', waste: 'ตัดของเสีย', count: 'ปรับจากตรวจนับ', adjust_waste: 'ปรับ: เสียหาย', adjust_lost: 'ปรับ: สูญหาย', adjust_expired: 'ปรับ: หมดอายุ', adjust_other: 'ปรับ: อื่น ๆ', premium: 'แถม' };

export function StockPage() {
  const { can } = useSession();
  const [cat, setCat] = useState('');
  const [low, setLow] = useState(false);
  const { data, error, loading, reload } = useLoad(async () => ({ rows: await api.stock({ categoryId: cat || undefined, low }), cats: await api.categories() }), [cat, low]);
  const [open, setOpen] = useState<{ productId: string; name: string } | null>(null);
  const moves = useLoad(() => (open ? api.movements(open.productId) : Promise.resolve([])), [open?.productId]);
  const [adj, setAdj] = useState<{ productId: string; name: string; qty: string; reason: 'waste' | 'lost' | 'expired' | 'other'; note: string } | null>(null);
  const [adjError, setAdjError] = useState('');
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const canValue = data.rows.some((r) => r.value !== undefined);
  const total = data.rows.reduce((a, r) => a + (r.value ?? 0), 0);

  const submitAdjust = async () => {
    if (!adj) return;
    const qty = Number(adj.qty);
    try {
      await api.adjust({ productId: adj.productId, qty, reason: adj.reason, note: adj.note || undefined });
      setAdj(null);
      toast.show('บันทึกการปรับสต็อกแล้ว');
      await reload();
    } catch (e) {
      setAdjError(errText(e));
    }
  };

  return (
    <>
      <PageHeader title="สต็อกคงเหลือ" sub={canValue ? `มูลค่าตามต้นทุน ${baht(total)}` : 'ยอดคงเหลือคือผลรวมรายการเคลื่อนไหวทั้งหมด แก้ตัวเลขตรง ๆ ไม่ได้'}>
        <button type="button" className="btn" onClick={() => exportCsv('stock', [['SKU', 'สินค้า', 'คงเหลือ', 'จุดสั่งซื้อซ้ำ', ...(canValue ? ['มูลค่า'] : [])], ...data.rows.map((r) => [r.sku, r.name, r.stock, r.reorderPoint, ...(canValue ? [(r.value ?? 0) / 100] : [])])])}>ส่งออก (Excel)</button>
      </PageHeader>
      <Alert kind="success">{toast.msg}</Alert>
      <div className="flex flex-wrap gap-3 items-center">
        <select className="select bg-base-100" aria-label="หมวด" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">ทุกหมวด</option>{data.cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="toggle toggle-warning" checked={low} onChange={(e) => setLow(e.target.checked)} /><span className="text-sm">เฉพาะสินค้าใกล้หมด</span></label>
      </div>
      <Card>
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>SKU</th><th>สินค้า</th><th className="text-right">คงเหลือ</th><th className="text-right">จุดสั่งซื้อซ้ำ</th>{canValue && <th className="text-right">มูลค่า</th>}<th><span className="sr-only">จัดการ</span></th></tr></thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.productId} className="hover:bg-base-200">
                <td className="opacity-70">{r.sku}</td><td className="font-medium">{r.name}</td>
                <td className={`text-right ${r.stock < 0 ? 'text-error font-semibold' : r.low ? 'text-warning font-semibold' : ''}`}>{r.stock}{r.stock < 0 && ' (ติดลบ)'}</td>
                <td className="text-right opacity-70">{r.reorderPoint || '–'}</td>
                {canValue && <td className="text-right">{baht(r.value ?? 0)}</td>}
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen({ productId: r.productId, name: r.name })}>ประวัติ</button>
                  {can('stock.manage') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdjError(''); setAdj({ productId: r.productId, name: r.name, qty: '', reason: 'waste', note: '' }); }}>ปรับสต็อก</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data.rows.length === 0 && <Empty>ไม่มีสินค้าตามเงื่อนไขนี้</Empty>}
      </Card>
      <Modal open={!!open} onClose={() => setOpen(null)} title={`ความเคลื่อนไหว · ${open?.name ?? ''}`} wide>
        <div className="overflow-x-auto max-h-96"><table className="table table-sm"><thead><tr><th>เวลา</th><th>ประเภท</th><th>เอกสาร</th><th className="text-right">จำนวน</th></tr></thead><tbody>
          {(moves.data ?? []).map((m, i) => <tr key={i}><td>{dateTime(m.at)}</td><td>{KIND[m.kind] ?? m.kind}</td><td className="opacity-70">{m.docNo ?? ''}</td><td className={`text-right ${m.qty < 0 ? '' : 'text-success'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td></tr>)}
        </tbody></table></div>
        <div className="modal-action mt-0"><button type="button" className="btn" onClick={() => setOpen(null)}>ปิด</button></div>
      </Modal>
      <Modal open={!!adj} onClose={() => setAdj(null)} title={`ปรับสต็อก · ${adj?.name ?? ''}`}>
        {adj && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void submitAdjust(); }}>
            <Field label="จำนวน (ติดลบ = ตัดออก)" hint="ตัวอย่าง −5 สำหรับของหมดอายุ 5 ชิ้น"><input autoFocus inputMode="numeric" className="input w-full text-right" value={adj.qty} onChange={(e) => setAdj({ ...adj, qty: e.target.value })} /></Field>
            <Field label="เหตุผล"><select className="select w-full" value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value as typeof adj.reason })}><option value="waste">เสียหาย</option><option value="lost">สูญหาย</option><option value="expired">หมดอายุ</option><option value="other">อื่น ๆ</option></select></Field>
            <Field label="หมายเหตุ (ไม่บังคับ)"><input className="input w-full" value={adj.note} onChange={(e) => setAdj({ ...adj, note: e.target.value })} /></Field>
            <Alert>{adjError}</Alert>
            <div className="modal-action mt-0"><button type="button" className="btn btn-ghost" onClick={() => setAdj(null)}>ยกเลิก</button><button type="submit" className="btn btn-primary">บันทึก</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}
