import { formatBahtFull } from '@my-shop/domain';
import { SuccessCheck } from '@my-shop/ui';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { storeInfo } from '../data/demo-catalog';
import { useDisplayExtras } from '../display/bridge';
import { useCart } from '../store/cart';
import { useSession } from '../store/session';

const methodLabel = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร', transfer: 'โอน' } as const;

export function SuccessPage() {
  const sale = useCart((s) => s.lastSale);
  const employee = useSession((s) => s.employee);
  const setThanks = useDisplayExtras((s) => s.setThanks);
  const navigate = useNavigate();
  const taxDialog = useRef<HTMLDialogElement>(null);
  const [taxDoc, setTaxDoc] = useState('');
  const [buyer, setBuyer] = useState({ buyerName: '', buyerAddress: '', buyerTaxId: '', buyerBranch: 'สำนักงานใหญ่' });
  const [taxError, setTaxError] = useState('');

  const issueTax = async () => {
    if (!sale) return;
    setTaxError('');
    try {
      setTaxDoc((await api.issueTaxInvoice(sale.docNo, buyer)).docNo);
      taxDialog.current?.close();
    } catch (e) {
      setTaxError(e instanceof Error ? e.message : 'ออกใบกำกับภาษีไม่สำเร็จ ลองอีกครั้ง');
    }
  };

  const next = () => {
    setThanks(null);
    navigate('/sale');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !(e.target as HTMLElement).closest('dialog')) next();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!sale) return <Navigate to="/sale" replace />;
  const when = new Date(sale.at);

  return (
    <main className="flex-1 flex flex-wrap items-center justify-center gap-8 p-6">
      <section className="flex flex-col items-center text-center gap-4" style={{ flex: '1 1 380px', maxWidth: 460 }}>
        <SuccessCheck label="ชำระเงินสำเร็จ" />
        <h1 className="text-2xl font-semibold anim-in">ชำระเงินสำเร็จ</h1>
        <div className="flex flex-col anim-in">
          <span className="text-sm opacity-70">เงินทอน</span>
          <span className="text-6xl font-semibold">{formatBahtFull(sale.change)}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 w-full anim-in">
          <button type="button" className="btn btn-lg" onClick={() => window.print()}>พิมพ์ใบเสร็จ</button>
          <button type="button" className="btn btn-lg" onClick={() => taxDialog.current?.showModal()}>{taxDoc ? `ใบกำกับเต็มรูป ${taxDoc}` : 'ขอใบกำกับเต็มรูป'}</button>
          <button type="button" className="btn btn-primary btn-lg h-16 col-span-2 text-lg" onClick={next}>
            บิลถัดไป <kbd className="kbd kbd-sm text-base-content">Enter</kbd>
          </button>
        </div>
      </section>

      <section aria-label="ใบเสร็จ" className="bg-base-100 border border-base-300 rounded-box p-6 flex flex-col gap-2 text-sm anim-in" style={{ flex: '0 1 340px' }}>
        <div className="text-center flex flex-col">
          <span className="font-semibold text-base">{storeInfo.storeName}</span>
          <span className="opacity-70">สาขา {storeInfo.branchName} · เลขผู้เสียภาษี {storeInfo.taxId}</span>
          <span className="opacity-70">ใบกำกับภาษีอย่างย่อ</span>
        </div>
        <div className="flex justify-between opacity-70"><span>{sale.docNo}</span><span>{when.toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span></div>
        <div className="border-t border-dashed border-base-300 my-1" />
        {sale.cart.lines.map((l) => (
          <div key={l.productId} className="flex flex-col">
            <div className="flex justify-between"><span>{l.name} ×{l.qty}</span><span>{(l.gross / 100).toFixed(2)}</span></div>
            {l.applied.filter((a) => a.discount > 0).map((a) => (
              <div key={a.promotionId} className="flex justify-between text-primary"><span>  {a.label}</span><span>−{(a.discount / 100).toFixed(2)}</span></div>
            ))}
          </div>
        ))}
        {sale.cart.premiums.map((p) => (
          <div key={p.promotionId} className="flex justify-between text-primary"><span>ของแถม {p.name} ×{p.qty}</span><span>0.00</span></div>
        ))}
        {sale.cart.billApplied.map((a) => (
          <div key={a.promotionId} className="flex justify-between text-primary"><span>{a.label}</span><span>−{(a.discount / 100).toFixed(2)}</span></div>
        ))}
        <div className="border-t border-dashed border-base-300 my-1" />
        <div className="flex justify-between font-semibold text-base"><span>ยอดสุทธิ</span><span>{(sale.cart.net / 100).toFixed(2)}</span></div>
        <div className="flex justify-between opacity-70"><span>VAT 7% (รวมในราคา)</span><span>{(sale.cart.vat / 100).toFixed(2)}</span></div>
        {sale.payments.map((p, i) => (
          <div key={i} className="flex justify-between"><span>{methodLabel[p.method]}</span><span>{((p.tendered ?? p.amount) / 100).toFixed(2)}</span></div>
        ))}
        <div className="flex justify-between"><span>เงินทอน</span><span>{(sale.change / 100).toFixed(2)}</span></div>
        {(sale.pointsRedeemed ?? 0) > 0 && <div className="flex justify-between"><span>ใช้แต้ม {sale.pointsRedeemed}</span><span>{((sale.pointsValue ?? 0) / 100).toFixed(2)}</span></div>}
        {sale.memberPhone && <div className="flex justify-between opacity-70"><span>สมาชิก ···{sale.memberPhone.slice(-4)}</span><span>ได้แต้ม {sale.pointsEarned ?? 0}</span></div>}
        <div className="border-t border-dashed border-base-300 my-1" />
        <span className="text-center opacity-70">แคชเชียร์ {employee?.name} · ขอบคุณที่อุดหนุน</span>
      </section>
      <dialog ref={taxDialog} className="modal" aria-labelledby="tax-title">
        <form method="dialog" className="modal-box flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void issueTax(); }}>
          <h2 id="tax-title" className="text-lg font-semibold">ใบกำกับภาษีเต็มรูป · {sale.docNo}</h2>
          {([['buyerName', 'ชื่อผู้ซื้อ'], ['buyerAddress', 'ที่อยู่'], ['buyerTaxId', 'เลขประจำตัวผู้เสียภาษี 13 หลัก'], ['buyerBranch', 'สาขา (สำนักงานใหญ่ หรือเลขสาขา)']] as const).map(([k, label]) => (
            <label key={k} className="flex flex-col gap-1">
              <span className="text-sm">{label}</span>
              <input className="input w-full" value={buyer[k]} inputMode={k === 'buyerTaxId' ? 'numeric' : undefined} onChange={(e) => setBuyer((b) => ({ ...b, [k]: e.target.value }))} />
            </label>
          ))}
          {taxError && <div role="alert" className="text-sm text-error">{taxError}</div>}
          <div className="modal-action">
            <button type="button" className="btn btn-ghost" onClick={() => taxDialog.current?.close()}>ยกเลิก</button>
            <button type="submit" className="btn btn-primary">ออกใบกำกับภาษี</button>
          </div>
        </form>
      </dialog>
    </main>
  );
}
