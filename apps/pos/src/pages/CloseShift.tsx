import { formatBahtFull } from '@my-shop/domain';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { summarizeShift, type Shift } from '../api/pos-api';
import { DenominationCounter, totalOf, type Counts } from '../components/DenominationCounter';
import { useApproval } from '../components/ApprovalDialog';
import { Steps } from '../components/Steps';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';

export function CloseShiftPage() {
  const { shiftId, finishShift } = useSession();
  const heldCount = useCart((s) => s.held.length);
  const openLines = useCart((s) => s.lines.length);
  const navigate = useNavigate();
  const [shift, setShift] = useState<Shift | null>(null);
  const [counts, setCounts] = useState<Counts>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [note, setNote] = useState('');
  const [needNote, setNeedNote] = useState(false);
  const [error, setError] = useState('');
  const { run, dialog } = useApproval();

  useEffect(() => {
    if (shiftId) void api.getShift(shiftId).then(setShift);
  }, [shiftId]);

  const summary = shift ? summarizeShift(shift) : null;
  const counted = totalOf(counts);
  const others = summary
    ? ([
        ['promptpay', 'PromptPay', 'ตรวจกับแอปธนาคารแล้ว'],
        ['card', 'บัตร', 'ตรวจกับสลิปสรุปยอด EDC แล้ว'],
        ['transfer', 'โอน', 'ตรวจกับบัญชีธนาคารแล้ว'],
      ] as const).filter(([m]) => summary.byMethod[m] > 0)
    : [];
  const blocked = heldCount > 0 || openLines > 0;
  const allChecked = others.every(([m]) => checked[m]);

  const confirm = async () => {
    if (!shiftId || blocked || !allChecked) return;
    setError('');
    try {
      // Blind count: the till never shows the expected cash. If the count is far off the server asks for a note and a supervisor's code.
      const closed = await run((approverCode) => api.closeShift(shiftId, counted, note.trim() || undefined, approverCode));
      if (!closed) return;
      finishShift(shiftId);
      navigate('/z-report');
    } catch (e) {
      if (e instanceof Error && 'details' in e && (e as { details?: { variance?: number } }).details?.variance !== undefined) setNeedNote(true);
      setError(e instanceof Error ? e.message : 'ปิดกะไม่สำเร็จ ลองอีกครั้ง');
    }
  };

  return (
    <main className="flex-1 flex flex-col items-center gap-5 p-6">
      <div className="w-full max-w-[640px]"><Steps items={['นับเงินสด', 'ตรวจช่องทางอื่น', 'สรุปปิดกะ']} current={others.length && !allChecked ? 1 : 0} /></div>
      <div className="w-full max-w-[960px] flex flex-wrap gap-4 anim-in">
        <section className="card bg-base-100 border border-base-300" style={{ flex: '999 1 480px', minWidth: 0 }}>
          <div className="card-body gap-3">
            <div>
              <h1 className="text-xl font-semibold">นับเงินสดในลิ้นชัก</h1>
              <p className="text-sm opacity-70">นับเงินทั้งหมดที่อยู่ในลิ้นชักตอนนี้ ระบบจะแสดงยอดที่ควรมีหลังคุณยืนยัน</p>
            </div>
            <DenominationCounter counts={counts} onChange={setCounts} />
          </div>
        </section>
        <aside className="flex flex-col gap-4" style={{ flex: '1 1 320px', minWidth: 0 }}>
          {heldCount > 0 && (
            <div role="alert" className="alert alert-warning alert-soft">
              <span className="text-sm">ยังมีบิลที่พัก {heldCount} บิล ต้องเรียกคืนหรือลบก่อนปิดกะ</span>
              <button type="button" className="btn btn-sm" onClick={() => navigate('/held')}>ดูบิล</button>
            </div>
          )}
          {openLines > 0 && (
            <div role="alert" className="alert alert-warning alert-soft">
              <span className="text-sm">มีบิลที่กำลังคีย์อยู่ ปิดบิลหรือล้างบิลก่อน</span>
              <button type="button" className="btn btn-sm" onClick={() => navigate('/sale')}>ไปหน้าขาย</button>
            </div>
          )}
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body gap-1">
              <span className="text-sm opacity-70">ยอดที่นับได้</span>
              <span className="text-4xl font-semibold">{formatBahtFull(counted)}</span>
            </div>
          </div>
          {others.length > 0 && summary && (
            <div className="card bg-base-100 border border-base-300">
              <div className="card-body gap-3">
                <span className="font-semibold">ช่องทางอื่น</span>
                {others.map(([m, label, hint]) => (
                  <label key={m} className="flex items-start gap-3 cursor-pointer">
                    <input type="checkbox" className="checkbox checkbox-primary mt-0.5" checked={!!checked[m]} onChange={(e) => setChecked((c) => ({ ...c, [m]: e.target.checked }))} />
                    <span className="flex flex-col"><span>{label} {formatBahtFull(summary.byMethod[m])}</span><span className="text-sm opacity-70">{hint}</span></span>
                  </label>
                ))}
              </div>
            </div>
          )}
          {needNote && (
            <label className="flex flex-col gap-1">
              <span className="text-sm font-medium">หมายเหตุ (เงินขาดหรือเกินเกินเกณฑ์ ต้องให้หัวหน้ากะอนุมัติ)</span>
              <textarea className="textarea w-full" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ทอนเงินเกินให้ลูกค้า 1 ราย" />
            </label>
          )}
          {error && <div role="alert" className="alert alert-soft alert-warning text-sm">{error}</div>}
          <button type="button" className="btn btn-primary btn-lg h-14" disabled={blocked || !allChecked} onClick={confirm}>ยืนยันยอดนับและปิดกะ</button>
        </aside>
        {dialog}
      </div>
    </main>
  );
}
