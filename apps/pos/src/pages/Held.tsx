import { formatBaht, priceCart } from '@my-shop/domain';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../store/cart';
import { useCatalog } from '../store/catalog';

export function HeldPage() {
  const { held, resume, deleteHeld, lines } = useCart();
  const catalog = useCatalog((s) => s.catalog);
  const navigate = useNavigate();
  const [message, setMessage] = useState('');

  const onResume = (id: string) => {
    if (resume(id)) navigate('/sale');
    else setMessage('มีบิลที่กำลังคีย์อยู่ พักหรือปิดบิลนั้นก่อน แล้วค่อยเรียกคืน');
  };

  return (
    <main className="flex-1 flex flex-col items-center gap-4 p-6">
      <div className="w-full max-w-[760px] flex flex-wrap items-end justify-between gap-2 anim-in">
        <div>
          <h1 className="text-2xl font-semibold">บิลที่พัก</h1>
          <p className="text-sm opacity-70">บิลที่พักไว้ในกะนี้ ต้องเรียกคืนหรือลบก่อนปิดกะ</p>
        </div>
        <button type="button" className="btn" onClick={() => navigate('/sale')}>กลับไปหน้าขาย</button>
      </div>
      {message && <div role="alert" className="alert alert-warning alert-soft w-full max-w-[760px]">{message}</div>}
      <div className="w-full max-w-[760px] flex flex-col gap-3">
        {held.length === 0 && <div className="rounded-box border border-base-300 bg-base-100 p-10 text-center opacity-70">ไม่มีบิลที่พักอยู่</div>}
        {held.map((h) => {
          const total = catalog ? priceCart(h.lines, catalog, { isMember: !!h.memberPhone }).net : 0;
          const pieces = h.lines.reduce((s, l) => s + l.qty, 0);
          return (
            <article key={h.id} className="card bg-base-100 border border-base-300 anim-in">
              <div className="card-body flex-row flex-wrap items-center justify-between gap-4 py-5">
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2"><span className="font-semibold text-lg">{formatBaht(total)}</span><span className="badge badge-ghost">{pieces} ชิ้น</span></div>
                  <span className="text-sm opacity-70">พักเมื่อ {new Date(h.at).toLocaleTimeString('th-TH', { timeStyle: 'short' })} · {h.note}</span>
                </div>
                <div className="flex gap-2">
                  <button type="button" className="btn btn-ghost text-error" onClick={() => deleteHeld(h.id)}>ลบ</button>
                  <button type="button" className="btn btn-primary" disabled={lines.length > 0} onClick={() => onResume(h.id)}>เรียกคืน</button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}
