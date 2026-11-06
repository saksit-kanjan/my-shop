import { formatBahtFull, keypadToSatang } from '@my-shop/domain';
import { useEffect, useState } from 'react';
import { api } from '../api';
import type { CashMoveType, Shift } from '../api/pos-api';
import { useApproval } from '../components/ApprovalDialog';
import { Keypad, applyKey } from '../components/Keypad';
import { useSession } from '../store/session';

const TYPES: { id: CashMoveType; label: string; hint: string; reasons: string[] }[] = [
  { id: 'drop', label: 'นำเงินออก', hint: 'เข้าตู้เซฟ', reasons: ['ย้ายเข้าตู้เซฟ', 'ส่งเงินให้ผู้จัดการ'] },
  { id: 'out', label: 'จ่ายเงินออก', hint: 'ค่าใช้จ่ายร้าน', reasons: ['ค่าน้ำแข็ง', 'ค่าส่งของ', 'ซื้อของใช้ในร้าน', 'อื่น ๆ'] },
  { id: 'in', label: 'นำเงินเข้า', hint: 'เติมเงินทอน', reasons: ['เติมเงินทอน', 'อื่น ๆ'] },
];

export function CashMovePage() {
  const { shiftId, employee } = useSession();
  const [shift, setShift] = useState<Shift | null>(null);
  const [type, setType] = useState<CashMoveType>('drop');
  const [digits, setDigits] = useState('');
  const [reason, setReason] = useState(TYPES[0].reasons[0]);
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState(false);
  const [drawerMsg, setDrawerMsg] = useState('');
  const { run, dialog } = useApproval();

  useEffect(() => {
    if (shiftId) void api.getShift(shiftId).then(setShift);
  }, [shiftId]);

  const def = TYPES.find((t) => t.id === type) ?? TYPES[0];
  const amount = keypadToSatang(digits);

  const save = async () => {
    if (!shiftId || !employee || amount <= 0) return;
    const updated = await api.addCashMove(shiftId, { type, amount, reason: note.trim() ? `${reason} · ${note.trim()}` : reason, employeeId: employee.id });
    setShift({ ...updated });
    setDigits('');
    setNote('');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  /** "เปิดลิ้นชักโดยไม่ขาย": needs a supervisor, and the reason is logged (spec). */
  const openDrawer = async () => {
    if (!shiftId) return;
    setDrawerMsg('');
    try {
      const done = await run(async (approverCode) => {
        await api.openDrawer(shiftId, reason, approverCode);
        return true;
      });
      if (done) setDrawerMsg('บันทึกการเปิดลิ้นชักแล้ว');
    } catch (e) {
      setDrawerMsg(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ');
    }
  };

  return (
    <main className="flex-1 flex flex-wrap gap-4 p-4 items-start">
      <section className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '1 1 420px', maxWidth: 520, minWidth: 0 }}>
        <div className="card-body gap-4">
          <h1 className="text-xl font-semibold">บันทึกเงินเข้าออกลิ้นชัก</h1>
          <div role="radiogroup" aria-label="ประเภท" className="grid grid-cols-3 gap-2">
            {TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={type === t.id}
                onClick={() => { setType(t.id); setReason(t.reasons[0]); }}
                className={type === t.id ? 'btn h-auto py-3 flex-col gap-0 border-2 border-primary bg-secondary text-secondary-content' : 'btn btn-outline h-auto py-3 flex-col gap-0 border-base-300'}
              >
                <span className="font-semibold">{t.label}</span>
                <span className="text-xs opacity-70 font-normal">{t.hint}</span>
              </button>
            ))}
          </div>
          <label className="flex flex-col gap-1">
            <span className="text-sm">จำนวนเงิน</span>
            <input readOnly value={formatBahtFull(amount)} className="input input-lg w-full h-16 text-right text-3xl font-semibold" />
          </label>
          <Keypad size="md" onKey={(k) => setDigits((d) => applyKey(d, k, 6))} />
          <label className="flex flex-col gap-1">
            <span className="text-sm">เหตุผล</span>
            <select className="select w-full" value={reason} onChange={(e) => setReason(e.target.value)}>
              {def.reasons.map((r) => <option key={r}>{r}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm">หมายเหตุ (ไม่บังคับ)</span>
            <input className="input w-full" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <button type="button" className="btn btn-primary btn-lg h-14" disabled={amount <= 0} onClick={save}>{saved ? 'บันทึกแล้ว' : 'บันทึก'}</button>
        </div>
      </section>

      <section className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '999 1 460px', minWidth: 0 }}>
        <div className="card-body gap-3">
          <h2 className="text-lg font-semibold">รายการในกะนี้</h2>
          <div className="overflow-x-auto">
            <table className="table">
              <thead><tr><th>เวลา</th><th>ประเภท</th><th>เหตุผล</th><th className="text-right">จำนวน</th></tr></thead>
              <tbody>
                {(shift?.cashMoves ?? []).slice().reverse().map((m, i) => (
                  <tr key={i}>
                    <td>{new Date(m.at).toLocaleTimeString('th-TH', { timeStyle: 'short' })}</td>
                    <td><span className="badge badge-ghost">{TYPES.find((t) => t.id === m.type)?.label}</span></td>
                    <td>{m.reason}</td>
                    <td className="text-right font-semibold">{m.type === 'in' ? '' : '−'}{formatBahtFull(m.amount)}</td>
                  </tr>
                ))}
                {(shift?.cashMoves.length ?? 0) === 0 && <tr><td colSpan={4} className="text-center opacity-70 py-8">ยังไม่มีรายการ</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <div className="w-full flex flex-wrap items-center gap-3 anim-in">
        <button type="button" className="btn btn-outline" onClick={() => void openDrawer()}>เปิดลิ้นชักโดยไม่ขาย (ใช้เหตุผลที่เลือกไว้)</button>
        <span className="text-sm opacity-70" aria-live="polite">{drawerMsg}</span>
      </div>
      {dialog}
    </main>
  );
}
