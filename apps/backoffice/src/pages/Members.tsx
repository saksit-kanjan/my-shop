import type { Member } from '@my-shop/contracts';
import { useState } from 'react';
import { api } from '../api';
import { Alert, Card, Empty, Modal, PageHeader, errText, useLoad, useToast } from '../ui';

export function MembersPage() {
  const [term, setTerm] = useState('');
  const { data, error, reload } = useLoad(() => api.members(term), [term]);
  const [edit, setEdit] = useState<Member | null>(null);
  const [name, setName] = useState('');
  const [tier, setTier] = useState('');
  const [erase, setErase] = useState<Member | null>(null);
  const toast = useToast();

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.show(done);
      setEdit(null);
      setErase(null);
      await reload();
    } catch (e) {
      toast.show(errText(e));
    }
  };

  return (
    <>
      <PageHeader title="สมาชิก" sub="สมัครได้ที่เครื่อง POS ด้วยเบอร์โทร ที่นี่แก้ข้อมูลและจัดการคำขอลบข้อมูล (PDPA)" />
      <Alert kind="success">{toast.msg}</Alert>
      <label className="input bg-base-100 w-full max-w-xl"><input type="search" aria-label="ค้นหาสมาชิก" placeholder="ค้นหาเบอร์โทรหรือชื่อ" className="grow" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
      <Alert>{error}</Alert>
      <Card>
        <div className="overflow-x-auto"><table className="table">
          <thead><tr><th>ชื่อ</th><th>เบอร์โทร</th><th>ระดับ</th><th className="text-right">แต้มคงเหลือ</th><th>สมัครเมื่อ</th><th><span className="sr-only">จัดการ</span></th></tr></thead>
          <tbody>
            {(data ?? []).map((m) => (
              <tr key={m.id} className="hover:bg-base-200">
                <td className="font-medium">{m.name}</td><td>{m.phone}</td><td>{m.tier}</td><td className="text-right">{m.points}</td><td>{new Date(m.joinedAt).toLocaleDateString('th-TH')}</td>
                <td className="text-right whitespace-nowrap">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEdit(m); setName(m.name); setTier(m.tier); }}>แก้ไข</button>
                  <button type="button" className="btn btn-ghost btn-sm text-error" onClick={() => setErase(m)}>ลบข้อมูล</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        {data && data.length === 0 && <Empty>ไม่พบสมาชิก</Empty>}
      </Card>
      <Modal open={!!edit} onClose={() => setEdit(null)} title="แก้ไขสมาชิก">
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); if (edit) void run(() => api.updateMember(edit.id, { name, tier }), 'บันทึกแล้ว'); }}>
          <label className="flex flex-col gap-1"><span className="text-sm">ชื่อ</span><input className="input w-full" value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label className="flex flex-col gap-1"><span className="text-sm">ระดับสมาชิก</span><input className="input w-full" value={tier} onChange={(e) => setTier(e.target.value)} /></label>
          <div className="modal-action mt-0"><button type="button" className="btn btn-ghost" onClick={() => setEdit(null)}>ยกเลิก</button><button type="submit" className="btn btn-primary">บันทึก</button></div>
        </form>
      </Modal>
      <Modal open={!!erase} onClose={() => setErase(null)} title="ลบข้อมูลสมาชิก?">
        <p className="m-0 text-sm">ชื่อ เบอร์โทรและข้อมูลส่วนตัวของ {erase?.name} จะถูกลบถาวร ส่วนบิลเดิมยังอยู่แต่ไม่โยงกับตัวบุคคลอีก และกู้คืนไม่ได้</p>
        <div className="modal-action mt-0"><button type="button" className="btn btn-ghost" onClick={() => setErase(null)}>ไม่ลบ</button><button type="button" className="btn btn-error" onClick={() => erase && void run(() => api.anonymizeMember(erase.id), 'ลบข้อมูลสมาชิกแล้ว')}>ลบข้อมูล</button></div>
      </Modal>
    </>
  );
}
