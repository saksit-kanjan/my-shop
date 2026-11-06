import type { Product } from '@my-shop/contracts';
import { formatBaht } from '@my-shop/domain';
import { GiftThumb, PriceStack, ProductThumb, PromoChip } from '@my-shop/ui';
import { api } from '../api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../store/cart';
import { useCatalog } from '../store/catalog';
import { usePricedCart } from '../store/priced';

export function SalePage() {
  const catalog = useCatalog((s) => s.catalog);
  const { cart, memberSaving } = usePricedCart();
  const { add, setQty, clear, hold, memberPhone, attachMember, detachMember, lines } = useCart();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const [notice, setNotice] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const memberDialog = useRef<HTMLDialogElement>(null);
  const holdDialog = useRef<HTMLDialogElement>(null);
  const clearDialog = useRef<HTMLDialogElement>(null);
  const [phone, setPhone] = useState('');
  const [memberStep, setMemberStep] = useState<'phone' | 'register'>('phone');
  const [memberName, setMemberName] = useState('');
  const [memberConsent, setMemberConsent] = useState(false);
  const [memberError, setMemberError] = useState('');

  const submitMember = async () => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 9) return setMemberError('ใส่เบอร์โทรอย่างน้อย 9 หลัก');
    setMemberError('');
    try {
      if (memberStep === 'phone') {
        const found = await api.findMember(digits);
        if (found) {
          attachMember(digits);
          memberDialog.current?.close();
        } else setMemberStep('register');
        return;
      }
      await api.registerMember({ phone: digits, name: memberName, consent: memberConsent });
      attachMember(digits);
      memberDialog.current?.close();
    } catch (e) {
      setMemberError(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ ลองอีกครั้ง');
    }
  };
  const [holdNote, setHoldNote] = useState('');

  useEffect(() => {
    searchRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'F12' && useCart.getState().lines.length > 0) {
        e.preventDefault();
        navigate('/offers');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const products = useMemo(() => {
    if (!catalog) return [];
    const q = query.trim().toLowerCase();
    return catalog.products.filter(
      (p) => (category === 'all' || p.categoryId === category) && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcodes.includes(q)),
    );
  }, [catalog, query, category]);

  const addProduct = (p: Product) => {
    add(p.id);
    setNotice('');
  };

  /** Barcode scanners type the code and press Enter. */
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter' || !catalog) return;
    const q = query.trim();
    if (!q) return;
    const exact = catalog.products.find((p) => p.barcodes.includes(q) || p.sku.toLowerCase() === q.toLowerCase());
    const only = products.length === 1 ? products[0] : undefined;
    const hit = exact ?? only;
    if (hit) {
      addProduct(hit);
      setQuery('');
    } else {
      setNotice(`ไม่พบสินค้า "${q}"`);
    }
  };

  const pieces = cart.pieces;
  const empty = lines.length === 0;
  const premiumsByProduct = new Map(cart.premiums.map((p) => [p.fromProductId, p]));

  return (
    <main className="flex-1 min-h-0 flex flex-wrap gap-4 p-4 items-stretch">
      <section aria-label="เลือกสินค้า" className="flex flex-col gap-3 min-h-0 overflow-y-auto" style={{ flex: '999 1 560px', minWidth: 0 }}>
        <label className="input input-lg w-full h-14 border-2 border-primary bg-base-100">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className="text-primary">
            <path d="M3 5v14M7 5v14M11 5v14M15 5v14M19 5v14" />
          </svg>
          <input
            ref={searchRef}
            type="search"
            aria-label="สแกนบาร์โค้ดหรือค้นหาสินค้า"
            placeholder="สแกนบาร์โค้ด หรือพิมพ์ชื่อสินค้า"
            className="grow text-base"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <kbd className="kbd kbd-sm">F2</kbd>
        </label>
        {notice && <div role="alert" className="alert alert-warning alert-soft py-2 text-sm">{notice}</div>}

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="หมวดสินค้า">
          {[{ id: 'all', name: 'ทั้งหมด' }, ...(catalog?.categories ?? [])].map((c) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={category === c.id}
              onClick={() => setCategory(c.id)}
              className={`btn rounded-full ${category === c.id ? 'btn-neutral' : 'btn-outline border-base-300 bg-base-100'}`}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
          {products.map((p) => (
            <button key={p.id} type="button" onClick={() => addProduct(p)} className="lift flex flex-col items-stretch text-left gap-1 p-2 pb-3 rounded-box border border-base-300 bg-base-100 cursor-pointer">
              <span className="grid place-items-center rounded-lg h-24 overflow-hidden bg-[#eef4f1]">
                <ProductThumb imageKey={p.imageKey} size="xl" />
              </span>
              <span className="px-1 pt-1 font-medium leading-snug">{p.name}</span>
              <span className="px-1 font-semibold text-primary">{formatBaht(p.price)}</span>
            </button>
          ))}
          {products.length === 0 && <p className="col-span-full p-8 text-center opacity-70">ไม่พบสินค้าที่ตรงกับคำค้น</p>}
        </div>
      </section>

      <aside aria-label="บิลปัจจุบัน" className="card bg-base-100 border border-base-300 min-h-0 max-h-full" style={{ flex: '1 1 360px', maxWidth: 440, minWidth: 0 }}>
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-base-300">
          <div className="flex flex-col">
            <span className="font-semibold text-lg">บิลปัจจุบัน</span>
            <span className="text-sm opacity-70">{lines.length} รายการ · {pieces} ชิ้น</span>
          </div>
          {memberPhone ? (
            <button type="button" className="btn btn-sm btn-soft btn-primary" onClick={detachMember} title="ถอดสมาชิกออกจากบิล">
              สมาชิก ···{memberPhone.slice(-4)} ✕
            </button>
          ) : (
            <button type="button" className="btn btn-outline btn-primary border-dashed" onClick={() => { setPhone(''); memberDialog.current?.showModal(); }}>
              + สมาชิก
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 flex flex-col px-4 py-1 overflow-y-auto">
          {empty && <div className="flex-1 grid place-items-center py-16 text-center opacity-70">สแกนหรือแตะสินค้าเพื่อเริ่มบิล</div>}
          {cart.lines.map((l) => {
            const child = !!l.giftOfProductId;
            const premium = premiumsByProduct.get(l.productId);
            return (
              <div key={l.productId} className={`anim-in flex flex-col gap-1 py-3 border-b border-base-200 ${child ? 'pl-6' : ''}`}>
                <div className="flex justify-between gap-3">
                  <span className="flex items-center gap-2">
                    {child && <span aria-hidden="true" className="opacity-40">↳</span>}
                    <ProductThumb imageKey={l.imageKey} size="sm" />
                    <span className="font-medium">{l.name}</span>
                  </span>
                  <PriceStack gross={l.gross} net={l.net} size="md" />
                </div>
                <div className="flex justify-between items-center gap-3">
                  <span className="text-sm opacity-70">{formatBaht(l.unitPrice)} / ชิ้น</span>
                  <div className="join">
                    <button type="button" onClick={() => setQty(l.productId, l.qty - 1)} aria-label={`ลดจำนวน ${l.name}`} className="btn btn-sm join-item w-10">−</button>
                    <span className="join-item grid place-items-center w-10 border-y border-base-300 font-semibold" aria-label="จำนวน">{l.qty}</span>
                    <button type="button" onClick={() => setQty(l.productId, l.qty + 1)} aria-label={`เพิ่มจำนวน ${l.name}`} className="btn btn-sm join-item w-10">+</button>
                  </div>
                </div>
                {l.applied.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {l.applied.map((a) => (
                      <PromoChip key={a.promotionId} state="got" size="sm">{a.label}</PromoChip>
                    ))}
                  </div>
                )}
                {premium && premium.qty > 0 && (
                  <div className="flex items-center gap-2 pl-6 pt-1 text-sm">
                    <span aria-hidden="true" className="opacity-40">↳</span>
                    <GiftThumb size="sm" />
                    <span className="flex-1">{premium.name} ×{premium.qty}</span>
                    <span className="font-semibold text-primary">ฟรี</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-1 px-4 py-4 border-t border-base-300 bg-base-200/50 rounded-b-box">
          <div className="flex justify-between text-sm opacity-70"><span>รวม</span><span>{formatBaht(cart.gross)}</span></div>
          <div className="flex justify-between text-sm text-primary"><span>ส่วนลด</span><span>{formatBaht(-cart.discount)}</span></div>
          <div className="flex justify-between items-baseline mt-1"><span className="font-semibold">ยอดสุทธิ</span><span className="text-3xl font-semibold">{formatBaht(cart.net)}</span></div>
          <div className="flex justify-between text-sm opacity-70"><span>VAT 7% (รวมในราคาแล้ว)</span><span>{formatBaht(cart.vat)}</span></div>
          {!memberPhone && memberSaving > 0 && <div className="text-sm text-warning">ถามลูกค้าว่าเป็นสมาชิกไหม ลดได้อีก {formatBaht(memberSaving)}</div>}
          <div className="grid grid-cols-2 gap-2 mt-3">
            <button type="button" className="btn" disabled={empty} onClick={() => { setHoldNote(''); holdDialog.current?.showModal(); }}>พักบิล</button>
            <button type="button" className="btn text-error" disabled={empty} onClick={() => clearDialog.current?.showModal()}>ล้างบิล</button>
          </div>
          <button type="button" disabled={empty} onClick={() => navigate('/offers')} className="btn btn-primary btn-lg h-16 mt-1 justify-between text-lg">
            <span>ตรวจโปรโมชัน <kbd className="kbd kbd-sm text-base-content">F12</kbd></span>
            <span>{formatBaht(cart.net)}</span>
          </button>
        </div>
      </aside>

      <dialog ref={memberDialog} className="modal" aria-labelledby="member-title" onClose={() => { setMemberStep('phone'); setMemberError(''); }}>
        <form
          method="dialog"
          className="modal-box flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submitMember();
          }}
        >
          <h2 id="member-title" className="text-lg font-semibold">{memberStep === 'phone' ? 'ผูกสมาชิกกับบิล' : 'สมัครสมาชิกใหม่'}</h2>
          <label className="flex flex-col gap-1">
            <span className="text-sm">เบอร์โทรสมาชิก</span>
            <input autoFocus type="tel" inputMode="numeric" className="input input-lg w-full" value={phone} disabled={memberStep === 'register'} onChange={(e) => setPhone(e.target.value)} placeholder="0812345678" />
          </label>
          {memberStep === 'register' && (
            <>
              <p className="text-sm opacity-70">เบอร์นี้ยังไม่เป็นสมาชิก สมัครได้เลยด้วยเบอร์โทร</p>
              <label className="flex flex-col gap-1">
                <span className="text-sm">ชื่อสมาชิก</span>
                <input autoFocus type="text" className="input w-full" value={memberName} onChange={(e) => setMemberName(e.target.value)} />
              </label>
              <label className="flex items-start gap-2 cursor-pointer">
                <input type="checkbox" className="checkbox checkbox-sm mt-1" checked={memberConsent} onChange={(e) => setMemberConsent(e.target.checked)} />
                <span className="text-sm">ลูกค้ายินยอมให้ร้านเก็บชื่อและเบอร์โทรเพื่อสะสมแต้มและรับสิทธิ์สมาชิก (PDPA)</span>
              </label>
            </>
          )}
          {memberError && <div role="alert" className="text-sm text-error">{memberError}</div>}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={() => memberDialog.current?.close()}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary">{memberStep === 'phone' ? 'ผูกสมาชิก' : 'สมัครและผูกกับบิล'}</button>
          </div>
        </form>
      </dialog>

      <dialog ref={holdDialog} className="modal" aria-labelledby="hold-title">
        <form method="dialog" className="modal-box flex flex-col gap-3" onSubmit={() => hold(holdNote.trim() || 'ไม่มีหมายเหตุ')}>
          <h2 id="hold-title" className="text-lg font-semibold">พักบิลนี้</h2>
          <label className="flex flex-col gap-1">
            <span className="text-sm">หมายเหตุ (ไม่บังคับ)</span>
            <input autoFocus type="text" className="input w-full" value={holdNote} onChange={(e) => setHoldNote(e.target.value)} placeholder="เช่น ลูกค้าไปหยิบของเพิ่ม" />
          </label>
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={() => holdDialog.current?.close()}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary">พักบิล</button>
          </div>
        </form>
      </dialog>

      <dialog ref={clearDialog} className="modal" aria-labelledby="clear-title">
        <form method="dialog" className="modal-box flex flex-col gap-3" onSubmit={() => clear()}>
          <h2 id="clear-title" className="text-lg font-semibold">ล้างบิลนี้?</h2>
          <p className="opacity-70">สินค้าทั้ง {pieces} ชิ้นจะถูกเอาออกจากบิล</p>
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={() => clearDialog.current?.close()}>ไม่ล้าง</button>
            <button type="submit" className="btn btn-error">ล้างบิล</button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
