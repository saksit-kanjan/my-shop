import { useMemo, useState } from 'react';
import { api, type ProductRow } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, Empty, Field, Loading, Modal, PageHeader, baht, errText, exportExcel, fromSatang, toSatang, useLoad, useToast } from '../ui';

interface Form {
  sku: string;
  name: string;
  categoryId: string;
  price: string;
  memberPrice: string;
  cost: string;
  reorderPoint: string;
  barcodes: string;
  active: boolean;
}

const blank = (categoryId: string): Form => ({ sku: '', name: '', categoryId, price: '', memberPrice: '', cost: '', reorderPoint: '0', barcodes: '', active: true });
const toForm = (p: ProductRow): Form => ({ sku: p.sku, name: p.name, categoryId: p.categoryId, price: fromSatang(p.price), memberPrice: fromSatang(p.memberPrice), cost: fromSatang(p.cost), reorderPoint: String(p.reorderPoint), barcodes: p.barcodes.join('\n'), active: p.active });

export function ProductsPage() {
  const { can } = useSession();
  const canEdit = can('products.manage');
  const canCost = can('reports.cost');
  const { data, error, loading, reload } = useLoad(async () => ({ products: await api.products(), categories: await api.categories() }));
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const toast = useToast();

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return (data?.products ?? []).filter((p) => (!cat || p.categoryId === cat) && (!term || p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term) || p.barcodes.some((b) => b.includes(term))));
  }, [data, q, cat]);

  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? id;

  const save = async () => {
    if (!editing) return;
    const f = editing.form;
    const price = toSatang(f.price);
    const memberPrice = toSatang(f.memberPrice);
    const cost = f.cost === '' ? 0 : toSatang(f.cost);
    if (price === null || memberPrice === null || cost === null) return setFormError('ใส่ราคาเป็นตัวเลข เช่น 18.00');
    setBusy(true);
    setFormError('');
    try {
      await api.saveProduct(editing.id, {
        sku: f.sku.trim(), name: f.name.trim(), categoryId: f.categoryId, price, memberPrice, reorderPoint: Number(f.reorderPoint) || 0, active: f.active,
        barcodes: f.barcodes.split(/[\n,]/).map((b) => b.trim()).filter(Boolean), ...(canCost ? { cost } : {}),
      });
      setEditing(null);
      toast.show('บันทึกสินค้าแล้ว');
      await reload();
    } catch (e) {
      setFormError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Form>) => setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  return (
    <>
      <PageHeader title="สินค้าและราคา" sub={`${rows.length} จาก ${data.products.length} รายการ`}>
        <button type="button" className="btn" onClick={() => exportExcel('products', [['SKU', 'สินค้า', 'หมวด', 'ราคา', 'ราคาสมาชิก', 'คงเหลือ', ...(canCost ? ['ต้นทุน'] : []), 'สถานะ'], ...rows.map((p) => [p.sku, p.name, catName(p.categoryId), fromSatang(p.price), fromSatang(p.memberPrice), p.stock, ...(canCost ? [fromSatang(p.cost)] : []), p.active ? 'ขายอยู่' : 'ไม่ขาย'])])}>ส่งออก (Excel)</button>
        {canEdit && <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setEditing({ id: null, form: blank(data.categories[0]?.id ?? '') }); }}>+ เพิ่มสินค้า</button>}
      </PageHeader>
      <Alert kind="success">{toast.msg}</Alert>
      <div className="flex flex-wrap gap-2 anim-in-2">
        <label className="input bg-base-100" style={{ flex: '1 1 320px' }}>
          <input type="search" aria-label="ค้นหาสินค้า" placeholder="ค้นหาชื่อ SKU หรือบาร์โค้ด" value={q} onChange={(e) => setQ(e.target.value)} className="grow" />
        </label>
        <div role="radiogroup" aria-label="หมวด" className="join flex-wrap">
          {[{ id: '', name: 'ทั้งหมด' }, ...data.categories].map((c) => (
            <button key={c.id} type="button" role="radio" aria-checked={cat === c.id} onClick={() => setCat(c.id)} className={`btn join-item ${cat === c.id ? 'btn-neutral' : ''}`}>{c.name}</button>
          ))}
        </div>
      </div>
      <Card className="anim-in-3">
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>SKU</th><th>สินค้า</th><th>หมวด</th><th className="text-right">ราคา</th><th className="text-right">ราคาสมาชิก</th>{canCost && <th className="text-right">ต้นทุน</th>}<th className="text-right">คงเหลือ</th><th>สถานะ</th><th><span className="sr-only">แก้ไข</span></th></tr></thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="hover:bg-base-200">
                  <td className="opacity-70">{p.sku}</td>
                  <td className="font-medium">{p.name}</td>
                  <td>{catName(p.categoryId)}</td>
                  <td className="text-right">{baht(p.price)}</td>
                  <td className="text-right opacity-70">{baht(p.memberPrice)}</td>
                  {canCost && <td className="text-right opacity-70">{baht(p.cost)}</td>}
                  <td className={`text-right ${p.reorderPoint > 0 && p.stock <= p.reorderPoint ? 'text-warning font-semibold' : ''}`}>{p.stock}</td>
                  <td><span className={`badge badge-soft ${p.active ? 'badge-success' : 'badge-ghost'}`}>{p.active ? 'ขายอยู่' : 'ไม่ขาย'}</span></td>
                  <td className="text-right">{canEdit && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFormError(''); setEditing({ id: p.id, form: toForm(p) }); }}>แก้ไข</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <Empty>ไม่พบสินค้าที่ค้นหา</Empty>}
      </Card>
      {canEdit && (
        <Card title="หมวดหมู่" className="anim-in-3">
          <form className="flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (!newCat.trim()) return; void api.saveCategory(null, newCat).then(() => { setNewCat(''); return reload(); }).catch((er: unknown) => toast.show(errText(er))); }}>
            <input className="input" aria-label="ชื่อหมวดใหม่" placeholder="ชื่อหมวดใหม่" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
            <button type="submit" className="btn">เพิ่มหมวด</button>
          </form>
        </Card>
      )}
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing?.id ? `แก้ไข ${editing.form.name}` : 'เพิ่มสินค้า'} wide>
        {editing && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
              <Field label="ชื่อสินค้า"><input autoFocus className="input w-full" value={editing.form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="รหัสสินค้า (SKU)"><input className="input w-full" value={editing.form.sku} onChange={(e) => set({ sku: e.target.value })} /></Field>
              <Field label="หมวด"><select className="select w-full" value={editing.form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>{data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="ราคาขาย (รวม VAT)"><input inputMode="decimal" className="input w-full text-right" value={editing.form.price} onChange={(e) => set({ price: e.target.value })} /></Field>
              <Field label="ราคาสมาชิก"><input inputMode="decimal" className="input w-full text-right" value={editing.form.memberPrice} onChange={(e) => set({ memberPrice: e.target.value })} /></Field>
              {canCost && <Field label="ต้นทุนต่อหน่วย" hint="เห็นและแก้ได้เฉพาะเจ้าของ"><input inputMode="decimal" className="input w-full text-right" value={editing.form.cost} onChange={(e) => set({ cost: e.target.value })} /></Field>}
              <Field label="จุดสั่งซื้อซ้ำ (ชิ้น)"><input inputMode="numeric" className="input w-full text-right" value={editing.form.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} /></Field>
            </div>
            <Field label="บาร์โค้ด (บรรทัดละ 1 รหัส)"><textarea className="textarea w-full" value={editing.form.barcodes} onChange={(e) => set({ barcodes: e.target.value })} /></Field>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="toggle toggle-primary" checked={editing.form.active} onChange={(e) => set({ active: e.target.checked })} /><span className="text-sm">ขายอยู่ (ปิดแล้วจะไม่แสดงที่ POS)</span></label>
            <Alert>{formError}</Alert>
            <div className="modal-action mt-0">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>ยกเลิก</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>บันทึก</button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
