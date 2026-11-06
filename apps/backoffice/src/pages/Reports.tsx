import type { Permission } from '@my-shop/contracts';
import { useState, type ReactNode } from 'react';
import { api } from '../api';
import { useSession } from '../app/app';
import { Alert, Card, DateRange, Empty, Loading, PageHeader, baht, dateTime, exportExcel, fromSatang, todayIso, useLoad } from '../ui';

const TABS: { id: string; label: string; perm: Permission }[] = [
  { id: 'sales', label: 'ยอดขายรายวัน', perm: 'reports.all' },
  { id: 'hourly', label: 'ตามช่วงเวลา', perm: 'reports.all' },
  { id: 'products', label: 'สินค้าขายดี/ไม่ออก', perm: 'reports.all' },
  { id: 'profit', label: 'กำไรขั้นต้น', perm: 'reports.cost' },
  { id: 'cash', label: 'กะและเงินสด', perm: 'reports.all' },
  { id: 'credits', label: 'ยกเลิกและคืน', perm: 'reports.all' },
  { id: 'stock-value', label: 'มูลค่าสต็อก', perm: 'reports.cost' },
  { id: 'tax', label: 'ภาษีขาย', perm: 'reports.cost' },
  { id: 'members', label: 'สมาชิกและโปร', perm: 'members.manage' },
];
const METHOD: Record<string, string> = { cash: 'เงินสด', promptpay: 'PromptPay', card: 'บัตร', transfer: 'โอน' };
const DOW = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];

interface Day { date: string; gross: number; discount: number; refunds: number; net: number; vat: number; bills: number }
interface ProductRow { productId: string; sku: string; name: string; qty: number; revenue: number; cost?: number; profit?: number; marginPct?: number }

export function ReportsPage() {
  const { can } = useSession();
  const tabs = TABS.filter((t) => can(t.perm));
  const [tab, setTab] = useState(tabs[0]?.id ?? 'sales');
  const [from, setFrom] = useState(todayIso().slice(0, 8) + '01');
  const [to, setTo] = useState(todayIso());
  const [month, setMonth] = useState(todayIso().slice(0, 7));
  const [terminal, setTerminal] = useState('');
  const range = { from, to, terminalId: terminal || undefined };

  return (
    <>
      <PageHeader title="รายงาน" sub="ยอดขายนับจากบิลที่ปิดแล้ว หักยกเลิกและคืนสินค้า · ส่งออกเป็นไฟล์ Excel (.xlsx) หรือพิมพ์เป็น PDF ได้">
        <button type="button" className="btn" onClick={() => window.print()}>พิมพ์ / PDF</button>
      </PageHeader>
      <div role="tablist" className="tabs tabs-box self-start flex-wrap print:hidden">
        {tabs.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'tab-active font-semibold' : ''}`} onClick={() => setTab(t.id)}>{t.label}</button>)}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        {tab === 'tax' ? <input type="month" aria-label="เดือน" className="input input-sm" value={month} onChange={(e) => setMonth(e.target.value)} />
          : tab === 'stock-value' ? <input type="date" aria-label="ณ วันที่" className="input input-sm" value={to} onChange={(e) => setTo(e.target.value)} />
          : <DateRange from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />}
        {['sales', 'hourly', 'cash', 'credits'].includes(tab) && <input className="input input-sm w-28 print:hidden" aria-label="เครื่อง POS" placeholder="เครื่อง เช่น T01" value={terminal} onChange={(e) => setTerminal(e.target.value.trim())} />}
      </div>
      {tab === 'sales' && <SalesTab r={range} />}
      {tab === 'hourly' && <HourlyTab r={range} />}
      {tab === 'products' && <ProductsTab r={range} profit={false} />}
      {tab === 'profit' && <ProductsTab r={range} profit />}
      {tab === 'cash' && <CashTab r={range} />}
      {tab === 'credits' && <CreditsTab r={range} />}
      {tab === 'stock-value' && <StockValueTab asOf={to} />}
      {tab === 'tax' && <TaxTab month={month} />}
      {tab === 'members' && <MembersTab r={range} />}
    </>
  );
}

type R = { from: string; to: string; terminalId?: string };

function Wrap<T>({ load, deps, children }: { load: () => Promise<T>; deps: unknown[]; children: (d: T) => ReactNode }) {
  const { data, error, loading } = useLoad(load, deps);
  if (loading && !data) return <Loading />;
  if (!data) return <Alert>{error}</Alert>;
  return <>{children(data)}</>;
}

function SalesTab({ r }: { r: R }) {
  return (
    <Wrap load={() => api.report<{ total: { gross: number; discount: number; refunds: number; net: number; vat: number; bills: number; average: number }; byMethod: Record<string, number>; days: Day[] }>('sales', r)} deps={[r.from, r.to, r.terminalId]}>
      {(d) => (
        <>
          <div className="stats stats-vertical lg:stats-horizontal bg-base-100 border border-base-300 w-full">
            <div className="stat"><div className="stat-title">ยอดขายสุทธิ</div><div className="stat-value text-3xl">{baht(d.total.net)}</div><div className="stat-desc">ก่อนส่วนลด {baht(d.total.gross)}</div></div>
            <div className="stat"><div className="stat-title">บิล</div><div className="stat-value text-3xl">{d.total.bills}</div><div className="stat-desc">เฉลี่ย {baht(d.total.average)} ต่อบิล</div></div>
            <div className="stat"><div className="stat-title">ส่วนลดรวม</div><div className="stat-value text-3xl">{baht(d.total.discount)}</div></div>
            <div className="stat"><div className="stat-title">ยกเลิก/คืน</div><div className="stat-value text-3xl text-warning">{baht(d.total.refunds)}</div></div>
            <div className="stat"><div className="stat-title">VAT 7%</div><div className="stat-value text-3xl">{baht(d.total.vat)}</div></div>
          </div>
          <div className="flex flex-wrap gap-4">
            <Card title="แยกตามช่องทางชำระ" className="flex-[1_1_280px] min-w-0">
              <table className="table table-sm"><tbody>{Object.entries(d.byMethod).map(([m, v]) => <tr key={m}><td>{METHOD[m] ?? m}</td><td className="text-right">{baht(v)}</td></tr>)}</tbody></table>
            </Card>
            <Card title="รายวัน" className="flex-[2_1_420px] min-w-0">
              <div className="flex justify-end print:hidden"><button type="button" className="btn btn-sm" onClick={() => exportExcel('sales-daily', [['วันที่', 'ขายก่อนลด', 'ส่วนลด', 'คืน/ยกเลิก', 'สุทธิ', 'VAT', 'บิล'], ...d.days.map((x) => [x.date, fromSatang(x.gross), fromSatang(x.discount), fromSatang(x.refunds), fromSatang(x.net), fromSatang(x.vat), x.bills])])}>ส่งออก (Excel)</button></div>
              <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>วันที่</th><th className="text-right">ขาย</th><th className="text-right">ส่วนลด</th><th className="text-right">คืน</th><th className="text-right">สุทธิ</th><th className="text-right">VAT</th><th className="text-right">บิล</th></tr></thead><tbody>
                {d.days.map((x) => <tr key={x.date}><td>{x.date}</td><td className="text-right">{baht(x.gross)}</td><td className="text-right">{baht(x.discount)}</td><td className="text-right">{baht(x.refunds)}</td><td className="text-right font-semibold">{baht(x.net)}</td><td className="text-right opacity-70">{baht(x.vat)}</td><td className="text-right">{x.bills}</td></tr>)}
              </tbody></table></div>
              {d.days.length === 0 && <Empty>ไม่มียอดขายในช่วงนี้</Empty>}
            </Card>
          </div>
        </>
      )}
    </Wrap>
  );
}

function HourlyTab({ r }: { r: R }) {
  return (
    <Wrap load={() => api.report<{ cells: { dow: number; hour: number; net: number; bills: number }[] }>('hourly', r)} deps={[r.from, r.to, r.terminalId]}>
      {(d) => {
        const hours = [...new Set(d.cells.map((c) => c.hour))].sort((a, b) => a - b);
        const max = Math.max(1, ...d.cells.map((c) => c.net));
        const at = (dow: number, h: number) => d.cells.find((c) => c.dow === dow && c.hour === h);
        return (
          <Card title="ยอดขายตามวันและชั่วโมง (สำหรับจัดคนเข้ากะ)">
            {hours.length === 0 ? <Empty>ไม่มียอดขายในช่วงนี้</Empty> : (
              <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th />{hours.map((h) => <th key={h} className="text-center">{String(h).padStart(2, '0')}</th>)}</tr></thead><tbody>
                {DOW.map((name, dow) => (
                  <tr key={name}><td className="font-medium">{name}</td>{hours.map((h) => {
                    const c = at(dow, h);
                    return <td key={h} className="text-center text-xs" style={{ background: c ? `color-mix(in oklab, var(--color-primary) ${Math.round((c.net / max) * 70)}%, transparent)` : undefined }} title={c ? `${baht(c.net)} · ${c.bills} บิล` : ''}>{c ? Math.round(c.net / 100) : ''}</td>;
                  })}</tr>
                ))}
              </tbody></table></div>
            )}
            <p className="text-xs opacity-60 m-0">ตัวเลขในช่องคือยอดขายเป็นบาท (ก่อนหักคืน) สีเข้มคือช่วงที่ขายมาก</p>
          </Card>
        );
      }}
    </Wrap>
  );
}

function ProductsTab({ r, profit }: { r: R; profit: boolean }) {
  return (
    <Wrap load={() => api.report<{ top: ProductRow[]; bottom: ProductRow[]; notSold: ProductRow[]; all: ProductRow[] }>('products', r)} deps={[r.from, r.to]}>
      {(d) => {
        const table = (rows: ProductRow[], withProfit: boolean) => (
          <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>สินค้า</th><th className="text-right">จำนวน</th><th className="text-right">ยอดขาย</th>{withProfit && <><th className="text-right">ต้นทุน</th><th className="text-right">กำไร</th><th className="text-right">%</th></>}</tr></thead><tbody>
            {rows.map((p) => <tr key={p.productId}><td>{p.name}</td><td className="text-right">{p.qty}</td><td className="text-right">{baht(p.revenue)}</td>{withProfit && <><td className="text-right opacity-70">{baht(p.cost ?? 0)}</td><td className="text-right font-semibold">{baht(p.profit ?? 0)}</td><td className="text-right">{p.marginPct}%</td></>}</tr>)}
          </tbody></table></div>
        );
        if (profit) {
          const rows = [...d.all].filter((p) => p.qty > 0).sort((a, b) => (b.profit ?? 0) - (a.profit ?? 0));
          return (
            <Card title="กำไรขั้นต้นต่อสินค้า">
              <div className="flex justify-end print:hidden"><button type="button" className="btn btn-sm" onClick={() => exportExcel('gross-profit', [['SKU', 'สินค้า', 'จำนวน', 'ยอดขาย', 'ต้นทุน', 'กำไร', '%'], ...rows.map((p) => [p.sku, p.name, p.qty, fromSatang(p.revenue), fromSatang(p.cost ?? 0), fromSatang(p.profit ?? 0), p.marginPct])])}>ส่งออก (Excel)</button></div>
              {table(rows, true)}
              <div className="text-right font-semibold">รวมกำไร {baht(rows.reduce((a, p) => a + (p.profit ?? 0), 0))}</div>
            </Card>
          );
        }
        return (
          <div className="flex flex-wrap gap-4">
            <Card title="ขายดี" className="flex-[1_1_360px] min-w-0">{table(d.top, false)}{d.top.length === 0 && <Empty>ไม่มียอดขาย</Empty>}</Card>
            <Card title="ขายไม่ค่อยออก" className="flex-[1_1_360px] min-w-0">{table(d.bottom, false)}</Card>
            <Card title={`ไม่มีการขายในช่วงนี้ (${d.notSold.length})`} className="flex-[1_1_100%] min-w-0">
              <p className="m-0 text-sm">{d.notSold.map((p) => p.name).join(' · ') || 'ทุกสินค้ามีการขาย'}</p>
            </Card>
          </div>
        );
      }}
    </Wrap>
  );
}

function CashTab({ r }: { r: R }) {
  return (
    <Wrap load={() => api.report<{ shifts: { id: string; date: string; terminalId: string; cashier: string; closedAt: string | null; bills: number; net: number; expected: number; counted: number | null; variance: number | null; note: string | null }[]; byCashier: { cashier: string; shifts: number; variance: number }[] }>('cash', r)} deps={[r.from, r.to, r.terminalId]}>
      {(d) => (
        <div className="flex flex-wrap gap-4">
          <Card title="รายกะ (Z report ย้อนหลัง)" className="flex-[2_1_520px] min-w-0">
            <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>วันที่</th><th>เครื่อง</th><th>แคชเชียร์</th><th className="text-right">บิล</th><th className="text-right">ยอดสุทธิ</th><th className="text-right">ควรมี</th><th className="text-right">นับได้</th><th className="text-right">ผลต่าง</th></tr></thead><tbody>
              {d.shifts.map((s) => <tr key={s.id} title={s.note ?? undefined}><td>{s.date}</td><td>{s.terminalId}</td><td>{s.cashier}</td><td className="text-right">{s.bills}</td><td className="text-right">{baht(s.net)}</td><td className="text-right opacity-70">{baht(s.expected)}</td><td className="text-right">{s.counted === null ? '–' : baht(s.counted)}</td><td className={`text-right font-semibold ${s.variance ? 'text-warning' : ''}`}>{s.variance === null ? '–' : baht(s.variance)}</td></tr>)}
            </tbody></table></div>
            {d.shifts.length === 0 && <Empty>ไม่มีกะที่ปิดแล้วในช่วงนี้</Empty>}
          </Card>
          <Card title="ผลต่างเงินสดรายแคชเชียร์" className="flex-[1_1_280px] min-w-0">
            <table className="table table-sm"><tbody>{d.byCashier.map((c) => <tr key={c.cashier}><td>{c.cashier} <span className="opacity-60">({c.shifts} กะ)</span></td><td className={`text-right font-semibold ${c.variance ? 'text-warning' : ''}`}>{baht(c.variance)}</td></tr>)}</tbody></table>
          </Card>
        </div>
      )}
    </Wrap>
  );
}

function CreditsTab({ r }: { r: R }) {
  return (
    <Wrap load={() => api.report<{ items: { docNo: string; saleDocNo: string; type: string; at: string; amount: number; reason: string; actor: string; approver: string }[] }>('credits', r)} deps={[r.from, r.to, r.terminalId]}>
      {(d) => (
        <Card title="ยกเลิกบิลและคืนสินค้า">
          <div className="flex justify-end print:hidden"><button type="button" className="btn btn-sm" onClick={() => exportExcel('credits', [['เอกสาร', 'บิลเดิม', 'ประเภท', 'เวลา', 'ยอด', 'เหตุผล', 'ผู้ทำ', 'ผู้อนุมัติ'], ...d.items.map((i) => [i.docNo, i.saleDocNo, i.type, i.at, fromSatang(i.amount), i.reason, i.actor, i.approver])])}>ส่งออก (Excel)</button></div>
          <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>เอกสาร</th><th>บิลเดิม</th><th>ประเภท</th><th>เวลา</th><th className="text-right">ยอด</th><th>เหตุผล</th><th>ผู้ทำ</th><th>ผู้อนุมัติ</th></tr></thead><tbody>
            {d.items.map((i) => <tr key={i.docNo}><td className="font-medium">{i.docNo}</td><td>{i.saleDocNo}</td><td>{i.type === 'void' ? 'ยกเลิก' : 'คืนสินค้า'}</td><td>{dateTime(i.at)}</td><td className="text-right">{baht(i.amount)}</td><td>{i.reason}</td><td>{i.actor}</td><td>{i.approver}</td></tr>)}
          </tbody></table></div>
          {d.items.length === 0 && <Empty>ไม่มีรายการในช่วงนี้</Empty>}
        </Card>
      )}
    </Wrap>
  );
}

function StockValueTab({ asOf }: { asOf: string }) {
  return (
    <Wrap load={() => api.report<{ total: number; items: { productId: string; sku: string; name: string; qty: number; cost: number; value: number }[] }>('stock-value', { asOf })} deps={[asOf]}>
      {(d) => (
        <Card title={`มูลค่าสต็อกตามต้นทุน ณ ${asOf} · ${baht(d.total)}`}>
          <div className="flex justify-end print:hidden"><button type="button" className="btn btn-sm" onClick={() => exportExcel('stock-value', [['SKU', 'สินค้า', 'จำนวน', 'ต้นทุน/หน่วย', 'มูลค่า'], ...d.items.map((i) => [i.sku, i.name, i.qty, fromSatang(i.cost), fromSatang(i.value)])])}>ส่งออก (Excel)</button></div>
          <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>SKU</th><th>สินค้า</th><th className="text-right">จำนวน</th><th className="text-right">ต้นทุน/หน่วย</th><th className="text-right">มูลค่า</th></tr></thead><tbody>
            {d.items.map((i) => <tr key={i.productId}><td className="opacity-70">{i.sku}</td><td>{i.name}</td><td className="text-right">{i.qty}</td><td className="text-right opacity-70">{baht(i.cost)}</td><td className="text-right font-semibold">{baht(i.value)}</td></tr>)}
          </tbody></table></div>
          <p className="text-xs opacity-60 m-0">ใช้ต้นทุนเฉลี่ยปัจจุบัน ไม่ใช่ต้นทุน ณ วันนั้น</p>
        </Card>
      )}
    </Wrap>
  );
}

function TaxTab({ month }: { month: string }) {
  return (
    <Wrap load={() => api.report<{ net: number; vat: number; base: number; days: Day[]; invoices: { docNo: string; saleDocNo: string; at: string; buyerName: string; buyerTaxId: string; buyerBranch: string; base: number; vat: number }[] }>('tax', { month })} deps={[month]}>
      {(d) => (
        <>
          <div className="stats stats-vertical lg:stats-horizontal bg-base-100 border border-base-300 w-full">
            <div className="stat"><div className="stat-title">มูลค่าสินค้า (ก่อน VAT)</div><div className="stat-value text-3xl">{baht(d.base)}</div></div>
            <div className="stat"><div className="stat-title">ภาษีขาย 7%</div><div className="stat-value text-3xl">{baht(d.vat)}</div></div>
            <div className="stat"><div className="stat-title">ยอดขายรวม VAT</div><div className="stat-value text-3xl">{baht(d.net)}</div></div>
          </div>
          <Card title="ใบกำกับภาษีเต็มรูปของเดือนนี้">
            <div className="flex justify-end print:hidden"><button type="button" className="btn btn-sm" onClick={() => exportExcel(`tax-${month}`, [['เลขที่', 'บิลอ้างอิง', 'วันที่', 'ผู้ซื้อ', 'เลขผู้เสียภาษี', 'สาขา', 'มูลค่า', 'VAT'], ...d.invoices.map((i) => [i.docNo, i.saleDocNo, i.at, i.buyerName, i.buyerTaxId, i.buyerBranch, fromSatang(i.base), fromSatang(i.vat)])])}>ส่งออก (Excel)</button></div>
            <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>เลขที่</th><th>วันที่</th><th>ผู้ซื้อ</th><th>เลขผู้เสียภาษี</th><th className="text-right">มูลค่า</th><th className="text-right">VAT</th></tr></thead><tbody>
              {d.invoices.map((i) => <tr key={i.docNo}><td className="font-medium">{i.docNo}</td><td>{dateTime(i.at)}</td><td>{i.buyerName}</td><td>{i.buyerTaxId}</td><td className="text-right">{baht(i.base)}</td><td className="text-right">{baht(i.vat)}</td></tr>)}
            </tbody></table></div>
            {d.invoices.length === 0 && <Empty>ไม่มีใบกำกับภาษีเต็มรูปในเดือนนี้</Empty>}
          </Card>
          <p className="text-xs opacity-60 m-0">ตัวเลขนี้ช่วยเตรียมยื่น ภ.พ.30 ควรให้นักบัญชีตรวจรูปแบบเอกสารและยอดก่อนยื่นจริง</p>
        </>
      )}
    </Wrap>
  );
}

function MembersTab({ r }: { r: R }) {
  return (
    <Wrap load={() => api.report<{ pointsOutstanding: number; members: { id: string; name: string; phone: string; bills: number; spend: number; points: number }[]; promotions: { promotionId: string; label: string; uses: number; discount: number }[] }>('members', r)} deps={[r.from, r.to]}>
      {(d) => (
        <div className="flex flex-wrap gap-4">
          <Card title={`สมาชิก · แต้มคงค้างทั้งระบบ ${d.pointsOutstanding}`} className="flex-[1_1_420px] min-w-0">
            <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>ชื่อ</th><th className="text-right">บิล</th><th className="text-right">ยอดซื้อ</th><th className="text-right">แต้ม</th></tr></thead><tbody>
              {d.members.map((m) => <tr key={m.id}><td>{m.name} <span className="opacity-60">{m.phone}</span></td><td className="text-right">{m.bills}</td><td className="text-right">{baht(m.spend)}</td><td className="text-right">{m.points}</td></tr>)}
            </tbody></table></div>
          </Card>
          <Card title="โปรโมชันที่ใช้" className="flex-[1_1_360px] min-w-0">
            <div className="overflow-x-auto"><table className="table table-sm"><thead><tr><th>โปร</th><th className="text-right">ครั้ง</th><th className="text-right">ส่วนลดที่ให้</th></tr></thead><tbody>
              {d.promotions.map((p) => <tr key={p.promotionId}><td>{p.label}</td><td className="text-right">{p.uses}</td><td className="text-right">{baht(p.discount)}</td></tr>)}
            </tbody></table></div>
            {d.promotions.length === 0 && <Empty>ไม่มีการใช้โปรในช่วงนี้</Empty>}
          </Card>
        </div>
      )}
    </Wrap>
  );
}
