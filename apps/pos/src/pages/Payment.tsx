import type { Payment, PaymentMethod } from '@my-shop/contracts';
import { formatBaht, formatBahtFull, keypadToSatang } from '@my-shop/domain';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApproval } from '../components/ApprovalDialog';
import { Keypad, applyKey } from '../components/Keypad';
import { Steps } from '../components/Steps';
import { useDisplayExtras } from '../display/bridge';
import { useCart } from '../store/cart';
import { usePricedCart } from '../store/priced';
import { useSession } from '../store/session';

const METHODS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'เงินสด' },
  { id: 'promptpay', label: 'PromptPay' },
  { id: 'card', label: 'บัตร' },
  { id: 'transfer', label: 'โอน' },
];

const methodLabel = (m: PaymentMethod) => METHODS.find((x) => x.id === m)?.label ?? m;

export function PaymentPage() {
  const { cart } = usePricedCart();
  const { lines, memberPhone, manualDiscount, completeSale } = useCart();
  const { run, dialog } = useApproval();
  const { employee, shiftId } = useSession();
  const { setPay, setThanks } = useDisplayExtras();
  const navigate = useNavigate();

  const [payments, setPayments] = useState<Payment[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [cashDigits, setCashDigits] = useState('');
  const [amountDigits, setAmountDigits] = useState('');
  const [reference, setReference] = useState('');
  const [qrChecked, setQrChecked] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [member, setMember] = useState<{ points: number; name: string } | null>(null);
  const [pointValue, setPointValue] = useState(10);
  const [redeem, setRedeem] = useState(0);
  useEffect(() => {
    if (!memberPhone) return setMember(null);
    void api.findMember(memberPhone).then((m) => setMember(m ? { points: m.points, name: m.name } : null)).catch(() => setMember(null));
    void api.getMe().then((me) => setPointValue(me.settings.pointsValueSatang)).catch(() => undefined);
  }, [memberPhone]);
  // Points are spent against the bill before any money is taken: the server checks the balance and the cap again.
  const maxRedeem = member ? Math.min(member.points, Math.floor(cart.net / Math.max(1, pointValue))) : 0;
  const redeemPoints = Math.min(redeem, maxRedeem);
  const due = cart.net - redeemPoints * pointValue;
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = Math.max(0, due - paid);

  const tendered = keypadToSatang(cashDigits);
  const nonCashAmount = amountDigits ? Math.min(keypadToSatang(amountDigits), remaining) : remaining;
  const entryAmount = method === 'cash' ? Math.min(tendered, remaining) : nonCashAmount;
  const change = method === 'cash' ? Math.max(0, tendered - remaining) : 0;
  const entryValid =
    method === 'cash' ? tendered > 0 : method === 'promptpay' ? qrChecked && entryAmount > 0 : method === 'card' ? reference.trim().length >= 4 && entryAmount > 0 : reference.trim().length > 0 && entryAmount > 0;
  const canFinish = due === 0 ? true : entryValid && paid + entryAmount >= due;

  useEffect(() => {
    setPay({ method, due: remaining, tendered: method === 'cash' && tendered > 0 ? tendered : undefined, change: method === 'cash' && tendered > 0 ? change : undefined });
  }, [method, remaining, tendered, change, setPay]);

  useEffect(() => () => setPay(null), [setPay]);

  if (lines.length === 0) return <Navigate to="/sale" replace />;

  const resetEntry = (m: PaymentMethod = method) => {
    setMethod(m);
    setCashDigits('');
    setAmountDigits('');
    setReference('');
    setQrChecked(false);
    setError('');
  };

  const currentPayment = (): Payment => ({
    method,
    amount: entryAmount,
    tendered: method === 'cash' ? tendered : undefined,
    reference: reference.trim() || undefined,
  });

  const addSplit = () => {
    if (!entryValid || entryAmount >= remaining) return;
    setPayments((p) => [...p, currentPayment()]);
    resetEntry(method === 'cash' ? 'promptpay' : 'cash');
  };

  const finish = async () => {
    if (!canFinish || !employee || !shiftId || saving) return;
    setSaving(true);
    try {
      const all = due === 0 ? [] : [...payments, currentPayment()];
      const record = await run((approverCode) =>
        api.recordSale(shiftId, { employeeId: employee.id, cart, payments: all, change, memberPhone: memberPhone ?? undefined, ...(redeemPoints > 0 ? { pointsRedeemed: redeemPoints, pointsValue: redeemPoints * pointValue } : {}), ...(manualDiscount ? { manualDiscount, approverCode } : {}) }),
      );
      if (!record) {
        setSaving(false);
        return;
      }
      completeSale(record);
      setThanks({ change, saved: cart.discount });
      navigate('/success');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกบิลไม่สำเร็จ ลองอีกครั้ง');
      setSaving(false);
    }
  };

  return (
    <main className="flex-1 flex flex-col gap-4 p-4">
      {dialog}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Steps items={['คีย์สินค้า', 'ตรวจโปรโมชัน', 'ชำระเงิน']} current={2} />
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/offers')}>กลับไปตรวจโปร</button>
      </div>
      <div className="flex flex-wrap gap-4 items-stretch">
        <section aria-label="สรุปยอด" className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '999 1 420px', minWidth: 0 }}>
          <div className="card-body gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-sm opacity-70">ยอดที่ต้องชำระ</span>
              <span className="text-6xl font-semibold leading-none">{formatBahtFull(due)}</span>
              <span className="text-sm opacity-70">{cart.lines.length} รายการ · {cart.pieces} ชิ้น · รวม VAT 7% แล้ว {formatBahtFull(cart.vat)}</span>
            </div>
            {member && member.points > 0 && (
              <div className="rounded-box border border-base-300 p-4 flex flex-wrap items-center justify-between gap-3">
                <span className="flex flex-col"><span className="text-sm font-semibold">ใช้แต้มสมาชิก ({member.name})</span><span className="text-sm opacity-70">มี {member.points} แต้ม · 1 แต้ม = {formatBahtFull(pointValue)} · ใช้ได้สูงสุด {maxRedeem} แต้ม</span></span>
                <span className="join">
                  <button type="button" className="btn join-item" aria-label="ลดแต้ม" disabled={redeemPoints <= 0 || payments.length > 0} onClick={() => setRedeem(Math.max(0, redeemPoints - 10))}>−10</button>
                  <span className="join-item btn btn-ghost no-animation min-w-16">{redeemPoints}</span>
                  <button type="button" className="btn join-item" aria-label="เพิ่มแต้ม" disabled={redeemPoints >= maxRedeem || payments.length > 0} onClick={() => setRedeem(Math.min(maxRedeem, redeemPoints + 10))}>+10</button>
                  <button type="button" className="btn join-item" disabled={redeemPoints >= maxRedeem || payments.length > 0} onClick={() => setRedeem(maxRedeem)}>ทั้งหมด</button>
                </span>
              </div>
            )}
            <div className="rounded-box border border-base-300 bg-base-200/50 p-4 flex flex-col gap-2">
              <span className="text-sm font-semibold">รายการชำระ</span>
              {payments.map((p, i) => (
                <div key={i} className="flex justify-between items-center gap-2">
                  <span>{methodLabel(p.method)}{p.reference ? ` · ${p.reference}` : ''}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-semibold">{formatBahtFull(p.amount)}</span>
                    <button type="button" className="btn btn-ghost btn-xs text-error" aria-label="ลบรายการชำระนี้" onClick={() => setPayments((x) => x.filter((_, j) => j !== i))}>ลบ</button>
                  </span>
                </div>
              ))}
              <div className="flex justify-between opacity-70">
                <span>{methodLabel(method)} (กำลังรับ)</span>
                <span>{formatBahtFull(method === 'cash' ? tendered : entryAmount)}</span>
              </div>
              <div className="divider my-0" />
              <div className="flex justify-between text-sm opacity-70"><span>คงค้าง</span><span>{formatBahtFull(Math.max(0, remaining - entryAmount))}</span></div>
            </div>
            {method === 'cash' && (
              <div className="rounded-box bg-secondary text-secondary-content p-5 flex justify-between items-baseline">
                <span className="text-lg font-semibold">เงินทอน</span>
                <span key={change} className="text-5xl font-semibold anim-pop">{formatBahtFull(change)}</span>
              </div>
            )}
            {error && <div role="alert" className="alert alert-error alert-soft">{error}</div>}
            <div className="flex-1" />
            <button type="button" className="btn btn-primary btn-lg h-16 text-lg" disabled={!canFinish || saving} onClick={finish}>
              {saving ? 'กำลังบันทึก…' : 'ยืนยันและปิดบิล'}
            </button>
          </div>
        </section>

        <section aria-label="รับชำระ" className="card bg-base-100 border border-base-300 anim-in" style={{ flex: '1 1 440px', maxWidth: 520, minWidth: 0 }}>
          <div className="card-body gap-4">
            <div role="tablist" aria-label="ช่องทางชำระ" className="tabs tabs-box grid grid-cols-4">
              {METHODS.map((m) => (
                <button key={m.id} type="button" role="tab" aria-selected={method === m.id} onClick={() => resetEntry(m.id)} className={`tab h-12 ${method === m.id ? 'tab-active font-semibold' : ''}`}>
                  {m.label}
                </button>
              ))}
            </div>

            {method === 'cash' && (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className="text-sm opacity-70">รับเงินมา</span>
                  <input readOnly value={formatBahtFull(tendered)} className="input input-lg w-full h-16 text-right text-3xl font-semibold border-2 border-primary" />
                </label>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { label: 'พอดี', value: Math.ceil(remaining / 100) },
                    { label: '฿100', value: 100 },
                    { label: '฿500', value: 500 },
                    { label: '฿1,000', value: 1000 },
                  ].map((q) => (
                    <button key={q.label} type="button" className="btn btn-soft lift" onClick={() => setCashDigits(String(q.value))}>{q.label}</button>
                  ))}
                </div>
                <Keypad size="md" onKey={(k) => setCashDigits((d) => applyKey(d, k, 6))} />
              </div>
            )}

            {method !== 'cash' && (
              <label className="flex flex-col gap-1">
                <span className="text-sm opacity-70">ยอดที่รับช่องทางนี้</span>
                <input
                  inputMode="numeric"
                  className="input input-lg w-full text-right text-2xl font-semibold"
                  value={amountDigits}
                  placeholder={formatBaht(remaining)}
                  onChange={(e) => setAmountDigits(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <span className="text-xs opacity-70">ว่างไว้ = รับเต็มยอดคงค้าง</span>
              </label>
            )}

            {method === 'promptpay' && (
              <div className="flex flex-col items-center gap-3 py-2 anim-in">
                <div className="w-48 h-48 rounded-box border-2 border-dashed border-base-300 grid place-items-center text-sm opacity-70 text-center p-4">
                  QR PromptPay {formatBaht(entryAmount)}
                  <br />
                  แสดงบนจอลูกค้า
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" className="checkbox checkbox-primary" checked={qrChecked} onChange={(e) => setQrChecked(e.target.checked)} />
                  <span>ตรวจแล้ว ยอดเข้าครบ</span>
                </label>
              </div>
            )}

            {method === 'card' && (
              <label className="flex flex-col gap-1 anim-in">
                <span className="text-sm">Approval code จากสลิป EDC</span>
                <input className="input input-lg w-full" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase().slice(0, 12))} placeholder="เช่น 123456" />
              </label>
            )}

            {method === 'transfer' && (
              <label className="flex flex-col gap-1 anim-in">
                <span className="text-sm">เลขอ้างอิงจากสลิปโอน</span>
                <input className="input input-lg w-full" value={reference} onChange={(e) => setReference(e.target.value.slice(0, 30))} />
              </label>
            )}

            <button type="button" className="btn btn-outline btn-primary border-dashed" disabled={!entryValid || entryAmount >= remaining} onClick={addSplit}>
              + แยกจ่ายอีกช่องทาง
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
