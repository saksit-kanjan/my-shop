import { PERMISSIONS, type Permission, type Role } from '@my-shop/contracts';
import { useState } from 'react';
import { api } from '../api';
import { Alert, Card, Field, Loading, Modal, PageHeader, errText, useLoad, useToast } from '../ui';

const ROLES: { id: Role; label: string }[] = [{ id: 'cashier', label: 'แคชเชียร์' }, { id: 'supervisor', label: 'หัวหน้ากะ' }, { id: 'manager', label: 'ผู้จัดการ' }, { id: 'owner', label: 'เจ้าของ' }];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.id, r.label])) as Record<Role, string>;
const PERM_LABEL: Record<Permission, string> = {
  sale: 'ขาย รับชำระ พักบิล', 'discount.over_cap': 'ส่วนลดเกินเพดาน', void: 'ยกเลิกบิลที่ปิดแล้ว', refund: 'คืนสินค้า', 'refund.late': 'คืนสินค้าเกินกำหนด', 'drawer.nosale': 'เปิดลิ้นชักโดยไม่ขาย',
  'shift.open_close': 'เปิดและปิดกะ', 'shift.expected': 'ดูยอดคาดไว้ตอนปิดกะ / อนุมัติผลต่าง', 'products.manage': 'จัดการสินค้าและราคา', 'stock.view': 'ดูสต็อก', 'stock.manage': 'รับสินค้า ปรับสต็อก ตรวจนับ',
  'promos.manage': 'จัดการโปรโมชัน', 'members.manage': 'จัดการสมาชิก', 'reports.own_shift': 'ดูรายงานกะของตัวเอง', 'reports.all': 'ดูรายงานยอดขาย', 'reports.cost': 'ดูต้นทุนและกำไร', 'users.manage': 'จัดการผู้ใช้และสิทธิ์', 'settings.manage': 'ตั้งค่าร้าน', 'audit.view': 'ดู Audit log',
};

interface Form {
  id: string | null;
  name: string;
  role: Role;
  code: string;
  username: string;
  password: string;
  active: boolean;
}
const blank: Form = { id: null, name: '', role: 'cashier', code: '', username: '', password: '', active: true };

export function UsersPage() {
  const { data, error, loading, reload } = useLoad(async () => ({ users: await api.users(), matrix: await api.permissions() }));
  const [form, setForm] = useState<Form | null>(null);
  const [formError, setFormError] = useState('');
  const toast = useToast();
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;

  const save = async () => {
    if (!form) return;
    setFormError('');
    try {
      if (form.id) await api.updateUser(form.id, { name: form.name, role: form.role, active: form.active, ...(form.code ? { code: form.code } : {}), ...(form.password ? { password: form.password } : {}), ...(form.username ? { username: form.username } : {}) });
      else await api.createUser({ name: form.name, role: form.role, code: form.code, ...(form.username ? { username: form.username, password: form.password } : {}) });
      setForm(null);
      toast.show('บันทึกผู้ใช้แล้ว');
      await reload();
    } catch (e) {
      setFormError(errText(e));
    }
  };

  const toggle = async (role: Role, perm: Permission, allowed: boolean) => {
    try {
      await api.setPermission(role, perm, allowed);
      await reload();
    } catch (e) {
      toast.show(errText(e));
    }
  };

  return (
    <>
      <PageHeader title="ผู้ใช้และสิทธิ์" sub="สิทธิ์ผูกกับบทบาท ไม่ผูกกับตัวคน เจ้าของปรับสิทธิ์รายข้อได้">
        <button type="button" className="btn btn-primary" onClick={() => { setFormError(''); setForm(blank); }}>+ เพิ่มผู้ใช้</button>
      </PageHeader>
      <Alert kind="success">{toast.msg}</Alert>
      <Card className="anim-in-2">
        <div className="overflow-x-auto"><table className="table"><thead><tr><th>ชื่อ</th><th>บทบาท</th><th>เข้าหลังบ้านด้วย</th><th>สถานะ</th><th /></tr></thead><tbody>
          {data.users.map((u) => (
            <tr key={u.id} className="hover:bg-base-200">
              <td className="font-medium">{u.name}</td><td>{ROLE_LABEL[u.role]}</td><td className="opacity-70">{u.username ?? 'รหัส 6 หลักที่ POS อย่างเดียว'}</td>
              <td><span className={`badge badge-soft ${u.active ? 'badge-success' : 'badge-ghost'}`}>{u.active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></td>
              <td className="text-right"><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setFormError(''); setForm({ id: u.id, name: u.name, role: u.role, code: '', username: u.username ?? '', password: '', active: u.active }); }}>แก้ไข</button></td>
            </tr>
          ))}
        </tbody></table></div>
      </Card>
      <Card title="ตารางสิทธิ์" className="anim-in-3">
        <div className="overflow-x-auto"><table className="table table-sm">
          <thead><tr><th>สิทธิ์</th>{ROLES.map((r) => <th key={r.id} className="text-center">{r.label}</th>)}</tr></thead>
          <tbody>
            {PERMISSIONS.map((p) => (
              <tr key={p}><td>{PERM_LABEL[p]}</td>
                {ROLES.map((r) => {
                  const on = data.matrix[r.id].includes(p);
                  return <td key={r.id} className="text-center"><input type="checkbox" className="checkbox checkbox-sm checkbox-primary" aria-label={`${r.label}: ${PERM_LABEL[p]}`} checked={on} disabled={r.id === 'owner' && p === 'users.manage'} onChange={(e) => void toggle(r.id, p, e.target.checked)} /></td>;
                })}
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="text-xs opacity-60 m-0">แคชเชียร์ที่ไม่มีสิทธิ์ยกเลิก คืนสินค้า หรือส่วนลดเกินเพดาน จะขอให้ผู้มีสิทธิ์ใส่รหัสอนุมัติที่เครื่องนั้นได้ ระบบบันทึกทั้งผู้ขอและผู้อนุมัติ</p>
      </Card>
      <Modal open={!!form} onClose={() => setForm(null)} title={form?.id ? `แก้ไข ${form.name}` : 'เพิ่มผู้ใช้'}>
        {form && (
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field label="ชื่อ"><input autoFocus className="input w-full" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="บทบาท"><select className="select w-full" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>{ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
            <Field label={form.id ? 'รหัสพนักงาน 6 หลักใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสพนักงาน 6 หลัก (ใช้ที่ POS)'} hint="เป็นความลับ ห้ามซ้ำกับคนอื่น ระบบไม่แสดงรหัสเดิมกลับมา"><input inputMode="numeric" maxLength={6} autoComplete="off" className="input w-full tracking-widest" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, '') })} /></Field>
            {(form.role === 'manager' || form.role === 'owner' || form.username) && (
              <>
                <Field label="ชื่อผู้ใช้หลังบ้าน"><input autoComplete="off" className="input w-full" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></Field>
                <Field label={form.id ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่านหลังบ้าน'} hint="อย่างน้อย 8 ตัวอักษร"><input type="password" autoComplete="new-password" className="input w-full" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
              </>
            )}
            {form.id && <label className="flex items-center gap-2 cursor-pointer"><input type="checkbox" className="toggle toggle-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /><span className="text-sm">ใช้งาน (ปิดแล้วเข้าระบบไม่ได้ทันที)</span></label>}
            <Alert>{formError}</Alert>
            <div className="modal-action mt-0"><button type="button" className="btn btn-ghost" onClick={() => setForm(null)}>ยกเลิก</button><button type="submit" className="btn btn-primary">บันทึก</button></div>
          </form>
        )}
      </Modal>
    </>
  );
}
