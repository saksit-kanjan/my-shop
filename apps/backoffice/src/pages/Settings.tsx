import { useEffect, useState } from 'react';
import { api, type Settings } from '../api';
import { Alert, Card, Field, Loading, PageHeader, dateTime, errText, fromSatang, toSatang, useLoad, useToast } from '../ui';

export function SettingsPage() {
  const { data, error, loading, reload } = useLoad(async () => ({ settings: await api.settings(), backups: await api.backups() }));
  const [f, setF] = useState<Record<string, string | boolean>>({});
  const [msg, setMsg] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (!data) return;
    const s = data.settings;
    setF({ ...s, pointsEarnSatang: fromSatang(s.pointsEarnSatang), pointsValueSatang: fromSatang(s.pointsValueSatang), cashVarianceLimit: fromSatang(s.cashVarianceLimit), pointsExpiryMonths: String(s.pointsExpiryMonths), refundDays: String(s.refundDays), manualDiscountCapPercent: String(s.manualDiscountCapPercent), cutoffHour: String(s.cutoffHour) });
  }, [data]);
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const str = (k: string) => String(f[k] ?? '');
  const set = (k: string, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));

  const save = async () => {
    setMsg('');
    const money = (k: string) => toSatang(str(k));
    const earn = money('pointsEarnSatang'), val = money('pointsValueSatang'), lim = money('cashVarianceLimit');
    if (earn === null || val === null || lim === null) return setMsg('ใส่จำนวนเงินเป็นตัวเลข เช่น 25.00');
    const patch: Partial<Settings> = {
      pointsEarnSatang: earn, pointsValueSatang: val, cashVarianceLimit: lim, pointsExpiryMonths: Number(f['pointsExpiryMonths']), refundDays: Number(f['refundDays']), manualDiscountCapPercent: Number(f['manualDiscountCapPercent']), cutoffHour: Number(f['cutoffHour']),
      allowNegativeStock: !!f['allowNegativeStock'], storeName: str('storeName'), branchName: str('branchName'), taxId: str('taxId'), address: str('address'),
    };
    try {
      await api.saveSettings(patch);
      toast.show('บันทึกการตั้งค่าแล้ว');
      await reload();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  const text = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><input className="input w-full" value={str(k)} onChange={(e) => set(k, e.target.value)} /></Field>;
  const num = (k: string, label: string, hint?: string) => <Field label={label} hint={hint}><input inputMode="decimal" className="input w-full text-right" value={str(k)} onChange={(e) => set(k, e.target.value)} /></Field>;

  return (
    <>
      <PageHeader title="ตั้งค่าร้าน" sub="ค่าเริ่มต้นเป็นคำแนะนำจากเอกสารออกแบบ ปรับให้ตรงกับร้านได้" />
      <Alert kind="success">{toast.msg}</Alert>
      <Card title="ข้อมูลร้าน (แสดงบนใบเสร็จ)" className="anim-in-2">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {text('storeName', 'ชื่อร้าน')}{text('branchName', 'สาขา')}{text('taxId', 'เลขประจำตัวผู้เสียภาษี')}{text('address', 'ที่อยู่')}
        </div>
      </Card>
      <Card title="แต้มสมาชิก" className="anim-in-2">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {num('pointsEarnSatang', 'ยอดซื้อต่อ 1 แต้ม (บาท)', 'เช่น 25 = ซื้อ 25 บาทได้ 1 แต้ม ปัดเศษลง')}
          {num('pointsValueSatang', 'มูลค่า 1 แต้มตอนใช้ (บาท)', 'เช่น 0.10 = 100 แต้มแทน 10 บาท')}
          {num('pointsExpiryMonths', 'แต้มหมดอายุใน (เดือน)', '0 = ไม่หมดอายุ')}
        </div>
      </Card>
      <Card title="การคืนสินค้า สต็อก และเงินสด" className="anim-in-3">
        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {num('refundDays', 'คืนสินค้าได้ภายใน (วัน)', 'เกินกำหนดต้องให้ผู้จัดการอนุมัติ')}
          {num('manualDiscountCapPercent', 'ส่วนลดพิเศษที่แคชเชียร์ให้ได้เอง (%)', 'เกินกว่านี้ต้องให้หัวหน้ากะกดรหัสอนุมัติ')}
          {num('cashVarianceLimit', 'เงินขาด/เกินที่ต้องอนุมัติ (บาท)', 'ปิดกะที่ต่างเกินนี้ต้องมีหมายเหตุและรหัสหัวหน้ากะ')}
          {num('cutoffHour', 'ตัดวันทำการตอนกี่โมง (0–23)', '0 = เที่ยงคืน ถ้าร้านปิดหลังเที่ยงคืนให้ใส่เช่น 4')}
        </div>
        <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="toggle toggle-primary" checked={!!f['allowNegativeStock']} onChange={(e) => set('allowNegativeStock', e.target.checked)} /><span className="text-sm">ยอมขายเมื่อสต็อกในระบบเป็น 0 หรือติดลบ (แนะนำ: สินค้าอยู่หน้าร้านแต่ยังไม่ได้รับเข้าระบบเกิดบ่อย)</span></label>
        <Alert>{msg}</Alert>
        <div className="flex justify-end"><button type="button" className="btn btn-primary" onClick={() => void save()}>บันทึกการตั้งค่า</button></div>
      </Card>
      <Card title="สำรองข้อมูล" className="anim-in-3">
        <p className="text-sm opacity-70 m-0">ระบบสำรองอัตโนมัติทุกวันตี 3 เก็บย้อนหลัง 30 วัน ควรคัดลอกไฟล์ไปเครื่องหรือดิสก์ภายนอกด้วย</p>
        <div><button type="button" className="btn" onClick={() => void api.runBackup().then(() => { toast.show('สำรองข้อมูลแล้ว'); return reload(); }).catch((e: unknown) => setMsg(errText(e)))}>สำรองตอนนี้</button></div>
        <ul className="m-0 p-0 list-none text-sm">{data.backups.slice(0, 10).map((b) => <li key={b.name}>{b.name} · {(b.bytes / 1024).toFixed(0)} KB · {dateTime(b.at)}</li>)}{data.backups.length === 0 && <li className="opacity-70">ยังไม่มีไฟล์สำรอง</li>}</ul>
      </Card>
    </>
  );
}
