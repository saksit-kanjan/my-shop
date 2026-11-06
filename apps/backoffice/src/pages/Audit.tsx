import { useState } from 'react';
import { api } from '../api';
import { Alert, Card, DateRange, Empty, PageHeader, dateTime, exportExcel, todayIso, useLoad } from '../ui';

export function AuditPage() {
  const [from, setFrom] = useState(todayIso());
  const [to, setTo] = useState(todayIso());
  const [action, setAction] = useState('');
  const { data, error } = useLoad(() => api.audit({ from, to, action: action || undefined }), [from, to, action]);
  return (
    <>
      <PageHeader title="Audit log" sub="ทุกการกระทำที่กระทบเงิน สต็อก ราคา และสิทธิ์ ใครทำ เมื่อไร ที่เครื่องไหน ใครอนุมัติ แก้หรือลบไม่ได้">
        <button type="button" className="btn" onClick={() => exportExcel('audit', [['เวลา', 'ผู้ทำ', 'ผู้อนุมัติ', 'เครื่อง', 'การกระทำ', 'เอกสาร', 'ข้อมูลใหม่'], ...(data ?? []).map((a) => [a.at, a.actor, a.approver, a.terminalId, a.action, a.entityId, JSON.stringify(a.after ?? '')])])}>ส่งออก (Excel)</button>
      </PageHeader>
      <div className="flex flex-wrap gap-3 items-center">
        <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
        <select className="select select-sm bg-base-100" aria-label="ประเภทการกระทำ" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">ทุกการกระทำ</option><option value="login">เข้าระบบ</option><option value="sale.">บิล ยกเลิก คืน</option><option value="shift.">กะ</option><option value="cash.">เงินเข้าออก</option><option value="product.">สินค้าและราคา</option><option value="stock.">สต็อก</option><option value="user.">ผู้ใช้</option><option value="permission.">สิทธิ์</option><option value="settings.">ตั้งค่า</option>
        </select>
      </div>
      <Alert>{error}</Alert>
      <Card>
        <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>ผู้อนุมัติ</th><th>เครื่อง</th><th>การกระทำ</th><th>เอกสาร</th><th>รายละเอียด</th></tr></thead><tbody>
          {(data ?? []).map((a) => (
            <tr key={a.id}><td className="whitespace-nowrap">{dateTime(a.at)}</td><td>{a.actor ?? '–'}</td><td>{a.approver ?? ''}</td><td>{a.terminalId ?? ''}</td><td className="font-medium">{a.action}</td><td className="opacity-70">{a.entityId ?? ''}</td><td className="text-xs opacity-70 max-w-xs truncate" title={JSON.stringify(a.after ?? '')}>{a.after ? JSON.stringify(a.after) : ''}</td></tr>
          ))}
        </tbody></table></div>
        {data && data.length === 0 && <Empty>ไม่มีรายการในช่วงนี้</Empty>}
      </Card>
    </>
  );
}
