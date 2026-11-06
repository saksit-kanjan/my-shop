import { formatBahtFull } from '@my-shop/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { DenominationCounter, totalOf, type Counts } from '../components/DenominationCounter';
import { Steps } from '../components/Steps';
import { storeInfo } from '../data/demo-catalog';
import { useSession } from '../store/session';

export function OpenShiftPage() {
  const employee = useSession((s) => s.employee);
  const setShift = useSession((s) => s.setShift);
  const logout = useSession((s) => s.logout);
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Counts>({});
  const [error, setError] = useState('');
  const total = totalOf(counts);

  const open = async () => {
    if (!employee) return;
    try {
      const shift = await api.openShift(storeInfo.terminalId, employee.id, total);
      setShift(shift.id);
      navigate('/sale');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เปิดกะไม่สำเร็จ');
    }
  };

  return (
    <main className="min-h-screen bg-base-200 flex flex-col items-center gap-6 p-6">
      <div className="w-full max-w-[640px] anim-in">
        <Steps items={['เข้าสู่ระบบ', 'เปิดกะ', 'เริ่มขาย']} current={1} />
      </div>
      <div className="w-full max-w-[880px] flex flex-wrap gap-4 anim-in">
        <section className="card bg-base-100 border border-base-300" style={{ flex: '999 1 460px', minWidth: 0 }}>
          <div className="card-body gap-4">
            <div>
              <h1 className="text-xl font-semibold">นับเงินทอนตั้งต้น</h1>
              <p className="text-sm opacity-70">นับเงินในลิ้นชักก่อนเริ่มขาย แล้วกรอกจำนวนแต่ละชนิด</p>
            </div>
            <DenominationCounter counts={counts} onChange={setCounts} />
          </div>
        </section>
        <aside className="flex flex-col gap-4" style={{ flex: '1 1 300px', minWidth: 0 }}>
          <div className="card bg-base-100 border border-base-300">
            <div className="card-body gap-1">
              <span className="text-sm opacity-70">เงินทอนตั้งต้น</span>
              <span className="text-4xl font-semibold">{formatBahtFull(total)}</span>
              <span className="text-sm opacity-70">แคชเชียร์ {employee?.name} · เครื่อง {storeInfo.terminalId}</span>
            </div>
          </div>
          <div role="note" className="alert alert-soft text-sm">ยอดนี้เป็นจุดเริ่มของการกระทบยอดเงินสดตอนปิดกะ</div>
          {error && <div role="alert" className="alert alert-error alert-soft text-sm">{error}</div>}
          <button type="button" className="btn btn-primary btn-lg h-14" onClick={open}>เปิดกะและเริ่มขาย</button>
          <button type="button" className="btn btn-ghost" onClick={() => { logout(); navigate('/login'); }}>ออกจากระบบ</button>
        </aside>
      </div>
    </main>
  );
}
