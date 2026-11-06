import { allSuggestions, formatBaht } from '@my-shop/domain';
import { GiftThumb, ProductThumb, PromoChip } from '@my-shop/ui';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Steps } from '../components/Steps';
import { useCart } from '../store/cart';
import { usePricedCart } from '../store/priced';

export function OffersPage() {
  const { cart, memberSaving } = usePricedCart();
  const { add, skip, skipped, lines, memberPhone } = useCart();
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) navigate('/payment');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (lines.length === 0) return <Navigate to="/sale" replace />;

  const suggestions = allSuggestions(cart).filter((s) => !skipped.includes(s.near.promotionId + (s.line?.productId ?? '')));
  const applied = [
    ...cart.lines.flatMap((line) => line.applied.filter((a) => a.discount > 0).map((a) => ({ key: a.promotionId + line.productId, imageKey: line.imageKey, name: line.name, label: a.label, save: a.discount }))),
    ...cart.billApplied.map((a) => ({ key: a.promotionId, imageKey: undefined, name: 'ส่วนลดท้ายบิล', label: a.label, save: a.discount })),
  ];

  return (
    <main className="flex-1 flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3 anim-in">
        <Steps items={['คีย์สินค้า', 'ตรวจโปรโมชัน', 'ชำระเงิน']} current={1} />
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/sale')}>กลับไปแก้บิล</button>
      </div>

      <div className="flex flex-wrap gap-4 items-start">
        <div className="flex flex-col gap-5" style={{ flex: '999 1 560px', minWidth: 0 }}>
          <section aria-labelledby="suggest-title" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="suggest-title" className="text-lg font-semibold flex items-center gap-2">
                แนะนำ · ยังไม่ได้รับ <span className="badge badge-warning badge-soft">{suggestions.length + (memberSaving > 0 ? 1 : 0)}</span>
              </h2>
              <span className="text-sm opacity-70">บอกลูกค้าก่อนรับเงิน ส่วนลดยังไม่อยู่ในบิล</span>
            </div>
            {suggestions.map(({ line, near }) => {
              const key = near.promotionId + (line?.productId ?? '');
              return (
                <article key={key} className="anim-in card bg-base-100 border-2 border-dashed border-warning">
                  <div className="card-body p-4 flex-row flex-wrap items-center gap-4">
                    {line ? <ProductThumb imageKey={line.imageKey} size="lg" /> : <GiftThumb />}
                    <div className="flex flex-col gap-1" style={{ flex: '1 1 240px' }}>
                      <span className="font-semibold">{line?.name ?? 'ทั้งบิล'}</span>
                      <PromoChip state="near">{near.label}</PromoChip>
                      {near.extraPay > 0 && near.addQty > 0 && <span className="text-sm opacity-70">จ่ายเพิ่มแค่ {formatBaht(near.extraPay)}</span>}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-sm font-semibold text-warning">ถ้ารับ {near.gainIsFree ? 'ฟรี' : 'ประหยัด'} {formatBaht(near.gain)}</span>
                      <div className="flex gap-2">
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => skip(key)}>ลูกค้าไม่รับ</button>
                        {near.addProductId && near.addQty > 0 && (
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => add(near.addProductId as string, near.addQty)}>
                            {near.gainIsFree ? 'เพิ่มของแถม' : `เพิ่ม ${near.addQty} ชิ้น`}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
            {!memberPhone && memberSaving > 0 && (
              <article className="card bg-base-100 border-2 border-dashed border-warning">
                <div className="card-body p-4 flex-row flex-wrap items-center justify-between gap-3">
                  <PromoChip state="near">ราคาสมาชิก ลดอีก {formatBaht(memberSaving)}</PromoChip>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => navigate('/sale')}>ไปผูกสมาชิก</button>
                </div>
              </article>
            )}
            {suggestions.length === 0 && (memberPhone || memberSaving === 0) && (
              <div className="rounded-box border border-base-300 bg-base-100 p-6 text-center opacity-70">ไม่มีโปรที่แนะนำเพิ่มได้แล้ว</div>
            )}
          </section>

          <section aria-labelledby="applied-title" className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="applied-title" className="text-lg font-semibold flex items-center gap-2">
                ได้รับแล้ว <span className="badge badge-success badge-soft">{applied.length + cart.premiums.length}</span>
              </h2>
              <span className="text-sm opacity-70">ส่วนลดคิดในบิลแล้ว</span>
            </div>
            {applied.map((a) => (
              <article key={a.key} className="anim-in card bg-secondary border border-primary/30">
                <div className="card-body p-4 flex-row items-center gap-4">
                  {a.imageKey ? <ProductThumb imageKey={a.imageKey} /> : <GiftThumb />}
                  <div className="flex flex-col" style={{ flex: '1 1 200px' }}>
                    <span className="font-medium">{a.name}</span>
                    <span className="text-sm opacity-80">{a.label}</span>
                  </div>
                  <span className="flex flex-col items-end">
                    <span className="text-xs opacity-70">ลดแล้ว</span>
                    <span className="font-semibold text-primary text-lg">{formatBaht(-a.save)}</span>
                  </span>
                </div>
              </article>
            ))}
            {cart.premiums.map((p) => (
              <article key={p.promotionId} className="anim-in card bg-secondary border border-primary/30">
                <div className="card-body p-4 flex-row items-center gap-4">
                  <GiftThumb />
                  <div className="flex flex-col flex-1">
                    <span className="font-medium">{p.name} ×{p.qty}</span>
                    <span className="text-sm opacity-80">ของพรีเมียม · อย่าลืมหยิบให้ลูกค้า</span>
                  </div>
                  {p.outOfStock && <span className="badge badge-warning">ของแถมไม่พอ</span>}
                </div>
              </article>
            ))}
          </section>
        </div>

        <aside className="card bg-base-100 border border-base-300" style={{ flex: '1 1 340px', maxWidth: 420, minWidth: 0 }}>
          <div className="card-body gap-2">
            <span className="text-sm opacity-70">{cart.lines.length} รายการ · {cart.pieces} ชิ้น</span>
            <div className="flex justify-between text-sm"><span className="opacity-70">ราคาปกติ</span><span>{formatBaht(cart.gross)}</span></div>
            <div className="flex justify-between text-sm text-primary"><span>ส่วนลดจากโปร</span><span>{formatBaht(-cart.discount)}</span></div>
            <div className="divider my-0" />
            <div className="flex justify-between items-baseline"><span className="font-semibold">ยอดสุทธิ</span><span className="text-4xl font-semibold">{formatBaht(cart.net)}</span></div>
            <div className="rounded-box bg-secondary text-secondary-content px-4 py-3 flex justify-between items-center">
              <span className="font-medium">ลูกค้าประหยัด</span>
              <span key={cart.discount} className="text-2xl font-semibold anim-pop">{formatBaht(cart.discount)}</span>
            </div>
            <button type="button" onClick={() => navigate('/payment')} className="btn btn-primary btn-lg h-16 mt-2 justify-between text-lg">
              <span>ไปชำระเงิน</span>
              <span>{formatBaht(cart.net)}</span>
            </button>
          </div>
        </aside>
      </div>
    </main>
  );
}
