import { Link } from 'react-router-dom';
import { api } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, Loading, PageHeader, baht, dateTime, useLoad } from '../ui';

export function DashboardPage() {
  const { can } = useSession();
  const { data, error, loading } = useLoad(async () => {
    const d = await api.dashboard();
    const hourly = await api.report<{ cells: { hour: number; net: number }[] }>('hourly', { from: d.today, to: d.today });
    return { d, hourly };
  });
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  const { d, hourly } = data;
  const t = d.sales.today;
  const byHour = new Map<number, number>();
  for (const c of hourly.cells) byHour.set(c.hour, (byHour.get(c.hour) ?? 0) + c.net);
  const hours = [...byHour.keys()].sort((a, b) => a - b);
  const max = Math.max(1, ...byHour.values());
  const delta = (now: number, was: number) => (was > 0 ? `${now >= was ? '+' : '−'}${Math.abs(Math.round(((now - was) / was) * 100))}%` : '');

  return (
    <>
      <PageHeader title="ภาพรวมวันนี้" sub={`วันทำการ ${new Date(`${d.today}T00:00:00`).toLocaleDateString('th-TH', { dateStyle: 'full' })}`}>
        {d.dayClosed ? <span className="badge badge-soft badge-success">ปิดวันแล้ว</span> : <span className="badge badge-soft badge-warning">ยังไม่ปิดวัน</span>}
      </PageHeader>
      <div className="stats stats-vertical lg:stats-horizontal bg-base-100 border border-base-300 w-full anim-in-2">
        <div className="stat"><div className="stat-title">ยอดขายสุทธิ</div><div className="stat-value text-3xl">{baht(t.net)}</div><div className="stat-desc">เมื่อวาน {baht(d.sales.yesterday.net)} {delta(t.net, d.sales.yesterday.net)} · สัปดาห์ก่อน {baht(d.sales.lastWeek.net)} {delta(t.net, d.sales.lastWeek.net)}</div></div>
        <div className="stat"><div className="stat-title">จำนวนบิล</div><div className="stat-value text-3xl">{t.bills}</div><div className="stat-desc">{d.openShifts.length} เครื่องเปิดอยู่</div></div>
        <div className="stat"><div className="stat-title">ค่าเฉลี่ยต่อบิล</div><div className="stat-value text-3xl">{baht(t.bills > 0 ? Math.round(t.net / t.bills) : 0)}</div><div className="stat-desc">หลังส่วนลดและคืนสินค้า</div></div>
        <div className="stat"><div className="stat-title">สินค้าใกล้หมด</div><div className={`stat-value text-3xl ${d.lowStockCount ? 'text-warning' : ''}`}>{d.lowStockCount}</div><div className="stat-desc">ต่ำกว่าจุดสั่งซื้อซ้ำ</div></div>
      </div>
      <Card title="ยอดขายรายชั่วโมง" className="anim-in-2">
        {hours.length === 0 ? (
          <p className="text-sm opacity-70 m-0">ยังไม่มีการขายวันนี้</p>
        ) : (
          <div className="flex items-end gap-2 h-40" role="img" aria-label={`ยอดขายรายชั่วโมง สูงสุดช่วง ${hours.reduce((a, b) => ((byHour.get(b) ?? 0) > (byHour.get(a) ?? 0) ? b : a))}:00`}>
            {hours.map((h) => (
              <div key={h} className="flex-1 flex flex-col items-center gap-1 h-full justify-end" title={baht(byHour.get(h) ?? 0)}>
                <div className="w-full rounded-t-md bg-primary/80" style={{ height: `${Math.max(4, ((byHour.get(h) ?? 0) / max) * 100)}%` }} />
                <span className="text-xs opacity-70">{String(h).padStart(2, '0')}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
      <div className="flex flex-wrap gap-4 anim-in-3">
        <Card title="กะที่เปิดอยู่" className="flex-[2_1_420px] min-w-0">
          {d.openShifts.length === 0 ? <p className="text-sm opacity-70 m-0">ไม่มีกะที่เปิดอยู่</p> : (
            <div className="overflow-x-auto"><table className="table"><thead><tr><th>เครื่อง</th><th>เปิดเมื่อ</th></tr></thead><tbody>
              {d.openShifts.map((s) => <tr key={s.id}><td>{s.terminalId}</td><td>{dateTime(s.openedAt)}</td></tr>)}
            </tbody></table></div>
          )}
        </Card>
        <Card title="ต้องจัดการ" className="flex-[1_1_300px] min-w-0">
          <ul className="flex flex-col gap-2 text-sm m-0 p-0 list-none">
            {d.pending.stockCounts > 0 && can('stock.view') && <li><Link className="link" to="/count">มีรอบตรวจนับสต็อกที่รออนุมัติ</Link></li>}
            {d.lowStock.slice(0, 6).map((p) => <li key={p.productId}><Link className="link" to="/stock">{p.name}</Link> เหลือ {p.stock} (จุดสั่งซื้อ {p.reorderPoint})</li>)}
            {d.openShifts.length > 0 && !d.dayClosed && <li><Link className="link" to="/day">ปิดวันหลังทุกกะปิดครบ</Link></li>}
            {d.pending.stockCounts === 0 && d.lowStockCount === 0 && d.openShifts.length === 0 && <li className="opacity-70">ไม่มีรายการค้าง</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
