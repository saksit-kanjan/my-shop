import { formatBahtFull } from '@my-shop/domain';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { summarizeShift, type Shift } from '../api/pos-api';
import { Steps } from '../components/Steps';
import { useSession } from '../store/session';

const DIFF_THRESHOLD = 10000; // ฿100 needs a note

export function ZReportPage() {
  const { closedShiftId, logout } = useSession();
  const navigate = useNavigate();
  const [shift, setShift] = useState<Shift | null | undefined>(undefined);

  useEffect(() => {
    if (closedShiftId) void api.getShift(closedShiftId).then(setShift);
    else setShift(null);
  }, [closedShiftId]);

  if (shift === null) return <Navigate to="/login" replace />;
  if (!shift) return null;

  const s = summarizeShift(shift);
  const counted = shift.counted ?? 0;
  const diff = counted - s.expectedCash;
  const diffText = diff === 0 ? 'ไม่มีผลต่าง' : diff < 0 ? 'ขาด' : 'เกิน';

  return (
    <main className="flex-1 flex flex-col items-center gap-5 p-6">
      <div className="w-full max-w-[640px]"><Steps items={['นับเงินสด', 'ตรวจช่องทางอื่น', 'สรุปปิดกะ']} current={2} /></div>
      <div className="w-full max-w-[960px] flex flex-col gap-4">
        <div className="stats stats-vertical sm:stats-horizontal bg-base-100 border border-base-300 w-full anim-in">
          <div className="stat"><div className="stat-title">ยอดขายสุทธิ</div><div className="stat-value text-3xl">{formatBahtFull(s.net)}</div><div className="stat-desc">ส่วนลดรวม {formatBahtFull(s.discount)}</div></div>
          <div className="stat"><div className="stat-title">จำนวนบิล</div><div className="stat-value text-3xl">{s.bills}</div></div>
          <div className="stat">
            <div className="stat-title">ผลต่างเงินสด</div>
            <div className={`stat-value text-3xl anim-pop ${diff === 0 ? '' : 'text-warning'}`}>{diff > 0 ? '+' : ''}{formatBahtFull(diff)}</div>
            <div className="stat-desc">{diffText}{Math.abs(diff) > DIFF_THRESHOLD ? ' · เกินเกณฑ์ ต้องให้หัวหน้ารับทราบ' : ''}</div>
          </div>
        </div>

        <div className="flex flex-wrap gap-4 anim-in">
          <section className="card bg-base-100 border border-base-300" style={{ flex: '1 1 400px', minWidth: 0 }}>
            <div className="card-body gap-2">
              <h2 className="text-lg font-semibold">กระทบยอดเงินสด</h2>
              <table className="table table-sm"><tbody>
                <tr><td>เงินทอนตั้งต้น</td><td className="text-right">{formatBahtFull(shift.float)}</td></tr>
                <tr><td>ขายด้วยเงินสด</td><td className="text-right">{formatBahtFull(s.cashSales)}</td></tr>
                <tr><td>คืนเงินสด (ยกเลิก/คืนสินค้า)</td><td className="text-right">{formatBahtFull(-s.cashRefunds)}</td></tr>
                <tr><td>นำเงินเข้า</td><td className="text-right">{formatBahtFull(s.cashIn)}</td></tr>
                <tr><td>จ่ายเงินออก</td><td className="text-right">{formatBahtFull(-s.cashOut)}</td></tr>
                <tr><td>นำเงินออกเข้าเซฟ</td><td className="text-right">{formatBahtFull(-s.cashDrop)}</td></tr>
                <tr className="font-semibold"><td>ยอดที่ควรมี</td><td className="text-right">{formatBahtFull(s.expectedCash)}</td></tr>
                <tr className="font-semibold"><td>ยอดที่นับได้</td><td className="text-right">{formatBahtFull(counted)}</td></tr>
                <tr className={`font-semibold ${diff === 0 ? '' : 'text-warning'}`}><td>ผลต่าง</td><td className="text-right">{formatBahtFull(diff)}</td></tr>
              </tbody></table>
            </div>
          </section>
          <section className="card bg-base-100 border border-base-300" style={{ flex: '1 1 400px', minWidth: 0 }}>
            <div className="card-body gap-2">
              <h2 className="text-lg font-semibold">ยอดตามช่องทางชำระ</h2>
              <table className="table table-sm"><tbody>
                <tr><td>เงินสด</td><td className="text-right">{formatBahtFull(s.byMethod.cash)}</td></tr>
                <tr><td>PromptPay</td><td className="text-right">{formatBahtFull(s.byMethod.promptpay)}</td></tr>
                <tr><td>บัตร</td><td className="text-right">{formatBahtFull(s.byMethod.card)}</td></tr>
                <tr><td>โอน</td><td className="text-right">{formatBahtFull(s.byMethod.transfer)}</td></tr>
                <tr><td className="opacity-70">ยกเลิกและคืนสินค้า {(shift.creditNotes ?? []).length} ใบ (หักแล้ว)</td><td className="text-right opacity-70">{formatBahtFull(-s.refunds)}</td></tr>
                <tr className="font-semibold"><td>รวมสุทธิ</td><td className="text-right">{formatBahtFull(s.net)}</td></tr>
                <tr><td className="opacity-70">VAT 7% ในยอดขาย</td><td className="text-right opacity-70">{formatBahtFull(s.vat)}</td></tr>
              </tbody></table>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" className="btn btn-lg" onClick={() => window.print()}>พิมพ์ Z report</button>
          <button type="button" className="btn btn-primary btn-lg" onClick={() => { logout(); navigate('/login'); }}>ออกจากระบบ</button>
        </div>
      </div>
    </main>
  );
}
