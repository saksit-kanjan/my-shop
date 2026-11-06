import type { Promotion } from '@my-shop/contracts';
import { useState } from 'react';
import { api } from '../api';
import { Alert, Card, Field, Loading, PageHeader, baht, errText, fromSatang, toSatang, useLoad, useToast } from '../ui';

type Kind = Promotion['kind'];
const TYPES: { id: Kind; label: string; hint: string }[] = [
  { id: 'qty', label: 'ราคาพิเศษเมื่อซื้อครบ', hint: 'ซื้อ 2 ชิ้น ชิ้นละ ฿15' },
  { id: 'gift', label: 'ซื้อ A แถม B', hint: 'แถมสินค้าหรือของแถม' },
  { id: 'bogo', label: 'ซื้อ 1 แถม 1', hint: 'สินค้าเดียวกัน' },
  { id: 'bill', label: 'ส่วนลดท้ายบิล', hint: 'ครบ ฿200 ลด ฿20' },
];
const KIND_LABEL: Record<Kind, string> = { qty: 'ราคาพิเศษ', gift: 'ซื้อ A แถม B', bogo: '1 แถม 1', bill: 'ท้ายบิล' };

interface Form {
  id: string;
  kind: Kind;
  name: string;
  productId: string;
  minQty: string;
  unitPrice: string;
  countMode: 'set' | 'all';
  buyQty: string;
  giftType: 'product' | 'premium';
  giftId: string;
  giftQty: string;
  freeQty: string;
  minAmount: string;
  discount: string;
  /** When it applies: dates are yyyy-mm-dd, weekdays 0 = Sunday ... 6 = Saturday; empty means no limit. */
  from: string;
  to: string;
  weekdays: number[];
  active: boolean;
}

const DAY_NAMES = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

const blank = (productId: string): Form => ({ id: '', kind: 'qty', name: '', productId, minQty: '2', unitPrice: '', countMode: 'set', buyQty: '1', giftType: 'product', giftId: productId, giftQty: '1', freeQty: '1', minAmount: '', discount: '', from: '', to: '', weekdays: [], active: true });

export function PromosPage() {
  const { data, error, loading, reload } = useLoad(async () => ({ promos: await api.promotions(), products: await api.products() }));
  const [form, setForm] = useState<Form | null>(null);
  const [isNew, setIsNew] = useState(true);
  const [formError, setFormError] = useState('');
  const [newPremium, setNewPremium] = useState('');
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const { promos, products } = data;
  const pname = (id: string) => products.find((p) => p.id === id)?.name ?? id;
  const first = products[0]?.id ?? '';
  const set = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f));

  const describe = (p: Promotion): string => {
    switch (p.kind) {
      case 'qty': return `${pname(p.productId)} ซื้อ ${p.minQty} ชิ้น ชิ้นละ ${baht(p.unitPrice)} (${p.countMode === 'set' ? 'นับเป็นชุด' : 'ทุกชิ้นเมื่อครบ'})`;
      case 'gift': return `ซื้อ ${pname(p.buyProductId)} ${p.buyQty} ชิ้น แถม ${p.gift.type === 'product' ? pname(p.gift.productId) : data.promos.premiums.find((x) => x.id === (p.gift as { premiumId: string }).premiumId)?.name} ${p.giftQty}`;
      case 'bogo': return `${pname(p.productId)} ซื้อ ${p.buyQty} แถม ${p.freeQty}`;
      case 'bill': return `ซื้อครบ ${baht(p.minAmount)} ลด ${baht(p.discount)}`;
    }
  };

  /** "1–30 พ.ย. 2569 · ศ." style summary of when a promotion runs, and whether it runs today. */
  const when = (p: Promotion): { text: string; state: 'always' | 'live' | 'soon' | 'ended' } => {
    const sc = p.schedule;
    if (!sc || (!sc.from && !sc.to && !sc.weekdays?.length)) return { text: 'ตลอด', state: 'always' };
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
    const parts = [sc.from || sc.to ? `${sc.from ?? '…'} ถึง ${sc.to ?? '…'}` : '', sc.weekdays?.length ? sc.weekdays.map((d) => DAY_NAMES[d]).join(' ') : ''].filter(Boolean);
    const state = sc.to && today > sc.to ? 'ended' : sc.from && today < sc.from ? 'soon' : 'live';
    return { text: parts.join(' · '), state };
  };

  const edit = (p: Promotion & { active: boolean }) => {
    const f = blank(first);
    f.id = p.id; f.kind = p.kind; f.name = p.name; f.active = p.active;
    if (p.kind === 'qty') Object.assign(f, { productId: p.productId, minQty: String(p.minQty), unitPrice: fromSatang(p.unitPrice), countMode: p.countMode });
    if (p.kind === 'gift') Object.assign(f, { productId: p.buyProductId, buyQty: String(p.buyQty), giftType: p.gift.type, giftId: p.gift.type === 'product' ? p.gift.productId : p.gift.premiumId, giftQty: String(p.giftQty) });
    if (p.kind === 'bogo') Object.assign(f, { productId: p.productId, buyQty: String(p.buyQty), freeQty: String(p.freeQty) });
    if (p.kind === 'bill') Object.assign(f, { minAmount: fromSatang(p.minAmount), discount: fromSatang(p.discount) });
    f.from = p.schedule?.from ?? '';
    f.to = p.schedule?.to ?? '';
    f.weekdays = p.schedule?.weekdays ?? [];
    setIsNew(false);
    setFormError('');
    setForm(f);
  };

  const scheduleOf = (f: Form): Promotion['schedule'] => (f.from || f.to || f.weekdays.length ? { ...(f.from ? { from: f.from } : {}), ...(f.to ? { to: f.to } : {}), ...(f.weekdays.length ? { weekdays: [...f.weekdays].sort() } : {}) } : undefined);

  const build = (f: Form): Promotion | string => {
    const made = buildBase(f);
    return typeof made === 'string' ? made : { ...made, ...(scheduleOf(f) ? { schedule: scheduleOf(f) } : {}) };
  };

  const buildBase = (f: Form): Promotion | string => {
    const name = f.name.trim();
    if (!name) return 'ตั้งชื่อโปร เช่น "มันฝรั่งทอด 2 ชิ้น ชิ้นละ ฿15"';
    const n = (s: string) => Number(s);
    switch (f.kind) {
      case 'qty': { const u = toSatang(f.unitPrice); return u === null ? 'ใส่ราคาโปรเป็นตัวเลข' : { kind: 'qty', id: f.id, name, productId: f.productId, minQty: n(f.minQty), unitPrice: u, countMode: f.countMode }; }
      case 'gift': return { kind: 'gift', id: f.id, name, buyProductId: f.productId, buyQty: n(f.buyQty), gift: f.giftType === 'product' ? { type: 'product', productId: f.giftId } : { type: 'premium', premiumId: f.giftId }, giftQty: n(f.giftQty) };
      case 'bogo': return { kind: 'bogo', id: f.id, name, productId: f.productId, buyQty: n(f.buyQty), freeQty: n(f.freeQty) };
      case 'bill': { const a = toSatang(f.minAmount); const d = toSatang(f.discount); return a === null || d === null ? 'ใส่ยอดและส่วนลดเป็นตัวเลข' : { kind: 'bill', id: f.id, name, minAmount: a, discount: d }; }
    }
  };

  const save = async () => {
    if (!form) return;
    const promo = build(form);
    if (typeof promo === 'string') return setFormError(promo);
    try {
      await api.savePromotion(promo, form.active, isNew);
      toast.show('บันทึกโปรโมชันแล้ว ใช้ที่ POS ทันทีเมื่อโหลดรายการสินค้าใหม่');
      setForm(null);
      await reload();
    } catch (e) {
      setFormError(errText(e));
    }
  };

  const toggle = async (p: Promotion & { active: boolean }) => {
    try {
      await api.savePromotion(p, !p.active, false);
      await reload();
    } catch (e) {
      toast.show(errText(e));
    }
  };

  const prodSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <Field label={label}><select className="select w-full" value={value} onChange={(e) => onChange(e.target.value)}>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {baht(p.price)}</option>)}</select></Field>
  );

  return (
    <>
      <PageHeader title="โปรโมชัน" sub={`${promos.promotions.filter((p) => p.active).length} โปรใช้งานอยู่`}>
        <button type="button" className="btn btn-primary" onClick={() => { setIsNew(true); setFormError(''); setForm(blank(first)); }}>+ สร้างโปรใหม่</button>
      </PageHeader>
      <Alert kind="success">{toast.msg}</Alert>
      <div className="flex flex-wrap gap-4 items-start">
        <Card className="anim-in-2 min-w-0" >
          <div className="overflow-x-auto"><table className="table">
            <thead><tr><th>โปร</th><th>ประเภท</th><th>เงื่อนไข</th><th>ช่วงเวลา</th><th>ใช้งาน</th><th><span className="sr-only">แก้ไข</span></th></tr></thead>
            <tbody>
              {promos.promotions.map((p) => (
                <tr key={p.id} className="hover:bg-base-200">
                  <td className="font-medium">{p.name}</td>
                  <td><span className="badge badge-ghost">{KIND_LABEL[p.kind]}</span></td>
                  <td className="text-sm opacity-80">{describe(p)}</td>
                  <td className="text-sm">{(() => { const w = when(p); return <span className={w.state === 'ended' ? 'opacity-50' : ''}>{w.text}{w.state === 'ended' && <span className="badge badge-ghost badge-sm ml-1">หมดแล้ว</span>}{w.state === 'soon' && <span className="badge badge-info badge-soft badge-sm ml-1">ยังไม่เริ่ม</span>}</span>; })()}</td>
                  <td><input type="checkbox" className="toggle toggle-primary toggle-sm" aria-label={`เปิดใช้ ${p.name}`} checked={p.active} onChange={() => void toggle(p)} /></td>
                  <td className="text-right"><button type="button" className="btn btn-ghost btn-sm" onClick={() => edit(p)}>แก้ไข</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Card>
        {form && (
          <Card title={isNew ? 'สร้างโปรใหม่' : 'แก้ไขโปร'} className="anim-in-3 w-full max-w-[520px]">
            <div role="radiogroup" aria-label="ประเภทโปร" className="grid grid-cols-2 gap-2">
              {TYPES.map((t) => (
                <button key={t.id} type="button" role="radio" aria-checked={form.kind === t.id} disabled={!isNew} onClick={() => set({ kind: t.id })} className={form.kind === t.id ? 'btn h-auto py-3 flex-col gap-0 border-2 border-primary bg-secondary text-secondary-content' : 'btn btn-outline h-auto py-3 flex-col gap-0 border-base-300'}>
                  <span className="font-semibold">{t.label}</span><span className="text-xs opacity-70 font-normal">{t.hint}</span>
                </button>
              ))}
            </div>
            <Field label="ชื่อโปร (แสดงบนใบเสร็จและจอลูกค้า)"><input className="input w-full" value={form.name} onChange={(e) => set({ name: e.target.value })} /></Field>
            {form.kind === 'qty' && <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">{prodSelect(form.productId, (v) => set({ productId: v }), 'สินค้า')}</div>
              <Field label="ซื้อครบ (ชิ้น)"><input inputMode="numeric" className="input w-full text-right" value={form.minQty} onChange={(e) => set({ minQty: e.target.value })} /></Field>
              <Field label="ราคาต่อชิ้น (บาท)"><input inputMode="decimal" className="input w-full text-right" value={form.unitPrice} onChange={(e) => set({ unitPrice: e.target.value })} /></Field>
              <fieldset className="col-span-2 flex flex-col gap-1"><legend className="text-sm mb-1">วิธีนับ</legend>
                {([['set', 'นับเป็นชุด ชิ้นที่เหลือไม่ครบชุดจ่ายราคาปกติ'], ['all', 'ครบแล้วทุกชิ้นได้ราคาโปร']] as const).map(([v, l]) => <label key={v} className="flex items-center gap-2 cursor-pointer"><input type="radio" name="mode" className="radio radio-primary radio-sm" checked={form.countMode === v} onChange={() => set({ countMode: v })} /><span className="text-sm">{l}</span></label>)}
              </fieldset></div>}
            {form.kind === 'gift' && <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">{prodSelect(form.productId, (v) => set({ productId: v }), 'ซื้อสินค้า A')}</div>
              <Field label="ซื้อ (ชิ้น)"><input inputMode="numeric" className="input w-full text-right" value={form.buyQty} onChange={(e) => set({ buyQty: e.target.value })} /></Field>
              <Field label="แถม (ชิ้น)"><input inputMode="numeric" className="input w-full text-right" value={form.giftQty} onChange={(e) => set({ giftQty: e.target.value })} /></Field>
              <Field label="ของแถมเป็น"><select className="select w-full" value={form.giftType} onChange={(e) => set({ giftType: e.target.value as 'product' | 'premium', giftId: e.target.value === 'product' ? first : promos.premiums[0]?.id ?? '' })}><option value="product">สินค้าในร้าน</option><option value="premium">ของแถม (ไม่ขาย)</option></select></Field>
              <Field label="ของแถม"><select className="select w-full" value={form.giftId} onChange={(e) => set({ giftId: e.target.value })}>{form.giftType === 'product' ? products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>) : promos.premiums.map((p) => <option key={p.id} value={p.id}>{p.name} (เหลือ {p.stock})</option>)}</select></Field>
            </div>}
            {form.kind === 'bogo' && <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">{prodSelect(form.productId, (v) => set({ productId: v }), 'สินค้า')}</div>
              <Field label="ซื้อ (ชิ้น)"><input inputMode="numeric" className="input w-full text-right" value={form.buyQty} onChange={(e) => set({ buyQty: e.target.value })} /></Field>
              <Field label="แถม (ชิ้น)"><input inputMode="numeric" className="input w-full text-right" value={form.freeQty} onChange={(e) => set({ freeQty: e.target.value })} /></Field>
            </div>}
            {form.kind === 'bill' && <div className="grid grid-cols-2 gap-3">
              <Field label="ซื้อครบ (บาท)"><input inputMode="decimal" className="input w-full text-right" value={form.minAmount} onChange={(e) => set({ minAmount: e.target.value })} /></Field>
              <Field label="ลด (บาท)"><input inputMode="decimal" className="input w-full text-right" value={form.discount} onChange={(e) => set({ discount: e.target.value })} /></Field>
            </div>}
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm mb-1">ช่วงเวลาที่ใช้ได้ (เว้นว่าง = ตลอด)</legend>
              <div className="grid grid-cols-2 gap-3">
                <Field label="ตั้งแต่วันที่"><input type="date" className="input w-full" value={form.from} max={form.to || undefined} onChange={(e) => set({ from: e.target.value })} /></Field>
                <Field label="ถึงวันที่ (รวมวันนี้)"><input type="date" className="input w-full" value={form.to} min={form.from || undefined} onChange={(e) => set({ to: e.target.value })} /></Field>
              </div>
              <div className="flex flex-wrap gap-1" role="group" aria-label="วันในสัปดาห์">
                {DAY_NAMES.map((d, i) => (
                  <button key={d} type="button" aria-pressed={form.weekdays.includes(i)} className={`btn btn-sm ${form.weekdays.includes(i) ? 'btn-neutral' : 'btn-outline border-base-300'}`} onClick={() => set({ weekdays: form.weekdays.includes(i) ? form.weekdays.filter((x) => x !== i) : [...form.weekdays, i] })}>{d}</button>
                ))}
              </div>
              <span className="text-xs opacity-60">เวลาตามเวลาร้าน (กรุงเทพฯ) ไม่เลือกวันในสัปดาห์ = ทุกวัน</span>
            </fieldset>
            <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="toggle toggle-primary" checked={form.active} onChange={(e) => set({ active: e.target.checked })} /><span className="text-sm">เปิดใช้งาน</span></label>
            <Alert>{formError}</Alert>
            <div className="flex gap-2 justify-end"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>ยกเลิก</button><button type="button" className="btn btn-primary" onClick={() => void save()}>บันทึกโปร</button></div>
          </Card>
        )}
      </div>
      <Card title="ของแถม (ไม่ขาย)" className="anim-in-3">
        <p className="text-sm opacity-70 m-0">ของแถมไม่มีราคา มีสต็อกของตัวเอง ถ้าหมดโปรจะหยุดเสนอและแคชเชียร์จะเห็นแจ้งเตือน</p>
        <ul className="m-0 p-0 list-none text-sm flex flex-col gap-1">{promos.premiums.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-48">{p.name} · เหลือ {p.stock}</span>
            {[10, 50].map((n) => <button key={n} type="button" className="btn btn-xs" onClick={() => void api.premiumStock(p.id, n).then(reload).catch((er: unknown) => toast.show(errText(er)))}>+{n}</button>)}
          </li>
        ))}</ul>
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newPremium.trim()) void api.savePremium(newPremium).then(() => { setNewPremium(''); return reload(); }).catch((er: unknown) => toast.show(errText(er))); }}>
          <input className="input" aria-label="ชื่อของแถมใหม่" placeholder="ชื่อของแถมใหม่" value={newPremium} onChange={(e) => setNewPremium(e.target.value)} />
          <button type="submit" className="btn">เพิ่มของแถม</button>
        </form>
      </Card>
    </>
  );
}
