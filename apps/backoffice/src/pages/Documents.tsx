import { useState } from 'react';
import { api, type SaleDetail } from '../api';
import { Alert, Card, Empty, PageHeader, baht, dateTime, errText, todayIso } from '../ui';

const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร', transfer: 'โอน' };

export function DocumentsPage() {
  const [term, setTerm] = useState('');
  const [date, setDate] = useState('');
  const [rows, setRows] = useState<Awaited<ReturnType<typeof api.searchSales>> | null>(null);
  const [detail, setDetail] = useState<SaleDetail | null>(null);
  const [copy, setCopy] = useState(0);
  const [error, setError] = useState('');

  const search = async () => {
    setError('');
    setDetail(null);
    try {
      setRows(await api.searchSales(term, date || undefined));
    } catch (e) {
      setError(errText(e));
    }
  };
  const open = async (docNo: string) => {
    setError('');
    setCopy(0);
    try {
      setDetail(await api.sale(docNo));
    } catch (e) {
      setError(errText(e));
    }
  };
  /** Reprint = a counted copy marked "สำเนา" (spec). The count is stored on the server. */
  const reprint = async () => {
    if (!detail) return;
    try {
      const r = await api.reprint(detail.sale.docNo);
      setCopy(r.copy);
      setTimeout(() => window.print(), 50);
      setDetail(await api.sale(detail.sale.docNo));
    } catch (e) {
      setError(errText(e));
    }
  };

  return (
    <>
      <PageHeader title="เอกสารการขาย" sub="ค้นหาบิล ดูใบลดหนี้ ใบกำกับภาษีเต็มรูป และพิมพ์สำเนา" />
      <form className="flex flex-wrap gap-2 print:hidden" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <label className="input bg-base-100" style={{ flex: '1 1 320px' }}><input type="search" aria-label="เลขที่บิลหรือเบอร์สมาชิก" placeholder="เลขที่บิล หรือเบอร์สมาชิก" className="grow" value={term} onChange={(e) => setTerm(e.target.value)} /></label>
        <input type="date" aria-label="วันทำการ" className="input" value={date} max={todayIso()} onChange={(e) => setDate(e.target.value)} />
        <button type="submit" className="btn btn-primary">ค้นหา</button>
      </form>
      <Alert>{error}</Alert>
      {rows && !detail && (
        <Card className="anim-in-2">
          <div className="overflow-x-auto"><table className="table"><thead><tr><th>เลขที่บิล</th><th>เวลา</th><th className="text-right">ยอดสุทธิ</th><th>สถานะ</th><th /></tr></thead><tbody>
            {rows.map((r) => (
              <tr key={r.docNo} className="hover:bg-base-200">
                <td className="font-medium">{r.docNo}</td><td>{dateTime(r.at)}</td><td className="text-right">{baht(r.net)}</td>
                <td>{r.voided ? <span className="badge badge-soft badge-error">ยกเลิกแล้ว</span> : r.refunded > 0 ? <span className="badge badge-soft badge-warning">คืนแล้ว {baht(r.refunded)}</span> : <span className="badge badge-soft badge-success">ปกติ</span>}</td>
                <td className="text-right"><button type="button" className="btn btn-ghost btn-sm" onClick={() => void open(r.docNo)}>เปิด</button></td>
              </tr>
            ))}
          </tbody></table></div>
          {rows.length === 0 && <Empty>ไม่พบเอกสาร</Empty>}
        </Card>
      )}
      {detail && (
        <section aria-label="เอกสาร" className="card bg-base-100 border border-base-300 max-w-[520px] anim-in">
          <div className="card-body gap-2 text-sm">
            {copy > 0 && <div className="text-center font-semibold">สำเนา (ครั้งที่ {copy})</div>}
            <div className="text-center flex flex-col"><span className="font-semibold text-base">ใบกำกับภาษีอย่างย่อ</span><span>{detail.sale.docNo} · เครื่อง {detail.terminalId}</span><span className="opacity-70">{dateTime(detail.sale.at)}</span></div>
            {detail.sale.voided && <div className="text-center font-semibold text-error">บิลนี้ถูกยกเลิก</div>}
            <div className="border-t border-dashed border-base-300 my-1" />
            {detail.sale.cart.lines.map((l) => (
              <div key={l.productId} className="flex flex-col">
                <div className="flex justify-between"><span>{l.name} ×{l.qty}</span><span>{(l.gross / 100).toFixed(2)}</span></div>
                {l.applied.filter((a) => a.discount > 0).map((a) => <div key={a.promotionId} className="flex justify-between text-primary"><span>  {a.label}</span><span>−{(a.discount / 100).toFixed(2)}</span></div>)}
              </div>
            ))}
            {detail.sale.cart.billApplied.map((a) => <div key={a.promotionId} className="flex justify-between text-primary"><span>{a.label}</span><span>−{(a.discount / 100).toFixed(2)}</span></div>)}
            <div className="border-t border-dashed border-base-300 my-1" />
            <div className="flex justify-between font-semibold text-base"><span>ยอดสุทธิ</span><span>{(detail.sale.cart.net / 100).toFixed(2)}</span></div>
            <div className="flex justify-between opacity-70"><span>VAT 7% (รวมในราคา)</span><span>{(detail.sale.cart.vat / 100).toFixed(2)}</span></div>
            {detail.sale.payments.map((p, i) => <div key={i} className="flex justify-between"><span>{METHOD[p.method]}</span><span>{((p.tendered ?? p.amount) / 100).toFixed(2)}</span></div>)}
            {detail.sale.change > 0 && <div className="flex justify-between"><span>เงินทอน</span><span>{(detail.sale.change / 100).toFixed(2)}</span></div>}
            {detail.creditNotes.map((c) => <div key={c.docNo} className="flex justify-between text-error"><span>{c.type === 'void' ? 'ใบยกเลิก' : 'ใบลดหนี้'} {c.docNo} · {c.reason}</span><span>−{(c.amount / 100).toFixed(2)}</span></div>)}
            {detail.taxInvoice && <div className="flex justify-between opacity-70"><span>ใบกำกับภาษีเต็มรูป {detail.taxInvoice.docNo}</span><span>{detail.taxInvoice.buyerName}</span></div>}
            <div className="flex gap-2 justify-end pt-2 print:hidden">
              <span className="text-xs opacity-60 self-center">พิมพ์ซ้ำแล้ว {detail.reprints} ครั้ง</span>
              <button type="button" className="btn btn-ghost" onClick={() => setDetail(null)}>กลับ</button>
              <button type="button" className="btn btn-primary" onClick={() => void reprint()}>พิมพ์สำเนา</button>
            </div>
          </div>
        </section>
      )}
    </>
  );
}
