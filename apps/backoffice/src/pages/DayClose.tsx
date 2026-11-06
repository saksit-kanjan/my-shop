import { useState } from 'react';
import { api } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, Empty, Loading, PageHeader, baht, dateTime, errText, todayIso, useLoad, useToast } from '../ui';

export function DayClosePage() {
  const { can } = useSession();
  const [date, setDate] = useState(todayIso());
  const { data, error, loading, reload } = useLoad(() => api.day(date), [date]);
  const [msg, setMsg] = useState('');
  const toast = useToast();
  const open = data?.shifts.filter((s) => !s.closedAt) ?? [];

  const close = async () => {
    setMsg('');
    try {
      const r = await api.closeDay(date);
      toast.show(`ปิดวัน ${date} แล้ว · ${r.bills} บิล ยอดสุทธิ ${baht(r.net)}`);
      await reload();
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <>
      <PageHeader title="กะและปิดวัน" sub="ปิดวันได้เมื่อทุกกะของวันนั้นปิดครบ หลังปิดวันแล้วยอดของวันนั้นถูกตรึงสำหรับรายงานและบัญชี">
        <input type="date" aria-label="วันทำการ" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
      </PageHeader>
      <Alert kind="success">{toast.msg}</Alert>
      <Alert>{msg || error}</Alert>
      {loading && !data ? <Loading /> : data && (
        <>
          <Card className="anim-in-2">
            <div className="overflow-x-auto"><table className="table">
              <thead><tr><th>เครื่อง</th><th>แคชเชียร์</th><th>เปิด</th><th>ปิด</th><th className="text-right">บิล</th><th className="text-right">ยอดสุทธิ</th><th className="text-right">ควรมี</th><th className="text-right">นับได้</th><th className="text-right">ผลต่าง</th></tr></thead>
              <tbody>
                {data.shifts.map((s) => (
                  <tr key={s.id} className="hover:bg-base-200">
                    <td>{s.terminalId}</td><td>{s.cashier}</td><td>{dateTime(s.openedAt)}</td>
                    <td>{s.closedAt ? dateTime(s.closedAt) : <span className="badge badge-soft badge-warning">ยังเปิดอยู่</span>}</td>
                    <td className="text-right">{s.bills}</td><td className="text-right font-semibold">{baht(s.net)}</td>
                    <td className="text-right opacity-70">{baht(s.expected)}</td><td className="text-right">{s.counted === null ? '–' : baht(s.counted)}</td>
                    <td className={`text-right font-semibold ${s.variance ? 'text-warning' : ''}`} title={s.note ?? undefined}>{s.variance === null ? '–' : baht(s.variance)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {data.shifts.length === 0 && <Empty>วันนี้ยังไม่มีกะ</Empty>}
            {data.shifts.some((s) => s.note) && <ul className="text-sm m-0 p-0 list-none opacity-80">{data.shifts.filter((s) => s.note).map((s) => <li key={s.id}>{s.terminalId} {s.cashier}: {s.note}</li>)}</ul>}
          </Card>
          <div className="flex flex-wrap items-center gap-3">
            {data.closed ? <span className="badge badge-soft badge-success badge-lg">ปิดวันแล้วเมื่อ {dateTime(data.closed.at)}</span>
              : <>
                <button type="button" className="btn btn-primary btn-lg" disabled={!can('reports.all') || data.shifts.length === 0 || open.length > 0} onClick={() => void close()}>ปิดวัน {date}</button>
                {open.length > 0 && <span className="text-sm text-warning">ยังมี {open.length} กะที่ไม่ได้ปิด ({open.map((s) => s.terminalId).join(', ')})</span>}
              </>}
          </div>
        </>
      )}
    </>
  );
}
