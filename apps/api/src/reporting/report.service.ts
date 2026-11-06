import { Inject, Injectable } from '@nestjs/common';
import { vatIncluded } from '@my-shop/domain';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { iso } from '../common/utils/dates';
import { StockService } from '../inventory/stock.service';
import { DayCloseService } from '../sales/day-close.service';

export interface Range {
  from: string;
  to: string;
  terminalId?: string;
  employeeId?: string;
  categoryId?: string;
}

const day = (d: string, delta: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
};

/**
 * Reporting is the read side (CQRS): a query service that reads the append-only documents of every context and writes nothing,
 * so nothing here can break a rule of the contexts it reads. Sales are the closed bills minus voids and refunds, by business date (spec).
 */
@Injectable()
export class ReportService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly days: DayCloseService,
    private readonly stockService: StockService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db() {
    return this.uow.read;
  }

  /** Net sales per business date after returns. */
  private async dailyNet(from: string, to: string, f: Pick<Range, 'terminalId' | 'employeeId'> = {}) {
    const p = [from, to, f.terminalId ?? null, f.employeeId ?? null];
    const sales = await this.db.query<{ d: string; gross: number; discount: number; net: number; vat: number; bills: number }>(
      `SELECT s.business_date::text AS d, SUM(s.gross)::int AS gross, SUM(s.discount)::int AS discount, SUM(s.net)::int AS net, SUM(s.vat)::int AS vat, count(*)::int AS bills
         FROM sales s JOIN shifts h ON h.id=s.shift_id WHERE s.business_date BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL OR h.terminal_id=$3) AND ($4::text IS NULL OR s.employee_id=$4) GROUP BY 1 ORDER BY 1`,
      p,
    );
    const credits = await this.db.query<{ d: string; amount: number; voids: number }>(
      `SELECT c.business_date::text AS d, SUM(c.amount)::int AS amount, count(*) FILTER (WHERE c.type='void')::int AS voids
         FROM credit_notes c JOIN shifts h ON h.id=c.shift_id WHERE c.business_date BETWEEN $1::date AND $2::date
          AND ($3::text IS NULL OR h.terminal_id=$3) AND ($4::text IS NULL OR c.employee_id=$4) GROUP BY 1`,
      p,
    );
    const byDay = new Map<string, { date: string; gross: number; discount: number; refunds: number; net: number; vat: number; bills: number }>();
    for (const s of sales) byDay.set(s.d, { date: s.d, gross: s.gross, discount: s.discount, refunds: 0, net: s.net, vat: s.vat, bills: s.bills });
    for (const c of credits) {
      const row = byDay.get(c.d) ?? { date: c.d, gross: 0, discount: 0, refunds: 0, net: 0, vat: 0, bills: 0 };
      row.refunds += c.amount;
      row.net -= c.amount;
      row.vat -= vatIncluded(c.amount);
      row.bills -= c.voids;
      byDay.set(c.d, row);
    }
    return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async dashboard() {
    const today = await this.days.today();
    const [t, y, w] = await Promise.all([this.dailyNet(today, today), this.dailyNet(day(today, -1), day(today, -1)), this.dailyNet(day(today, -7), day(today, -7))]);
    const pick = (r: { net: number; bills: number }[]) => ({ net: r[0]?.net ?? 0, bills: r[0]?.bills ?? 0 });
    const open = await this.db.query<{ id: string; terminal_id: string; employee_id: string; opened_at: Date }>(`SELECT id, terminal_id, employee_id, opened_at FROM shifts WHERE closed_at IS NULL ORDER BY opened_at`);
    const low = await this.stockService.levels({ lowOnly: true });
    const [pend] = await this.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM stock_counts WHERE status='open'`);
    const [dc] = await this.db.query(`SELECT 1 FROM day_closes WHERE business_date=$1::date`, [today]);
    return {
      today, dayClosed: !!dc,
      sales: { today: pick(t), yesterday: pick(y), lastWeek: pick(w) },
      openShifts: open.map((s) => ({ id: s.id, terminalId: s.terminal_id, employeeId: s.employee_id, openedAt: iso(s.opened_at) })),
      lowStock: low.slice(0, 10), lowStockCount: low.length,
      pending: { stockCounts: pend?.n ?? 0 },
    };
  }

  async salesSummary(r: Range) {
    const rows = await this.dailyNet(r.from, r.to, r);
    const total = rows.reduce((a, d) => ({ gross: a.gross + d.gross, discount: a.discount + d.discount, refunds: a.refunds + d.refunds, net: a.net + d.net, vat: a.vat + d.vat, bills: a.bills + d.bills }), { gross: 0, discount: 0, refunds: 0, net: 0, vat: 0, bills: 0 });
    const methods = await this.db.query<{ method: string; amount: number }>(
      `SELECT p.method, SUM(p.amount)::int AS amount FROM payments p JOIN sales s ON s.doc_no=p.doc_no JOIN shifts h ON h.id=s.shift_id
        WHERE s.business_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR h.terminal_id=$3) AND ($4::text IS NULL OR s.employee_id=$4) GROUP BY 1`,
      [r.from, r.to, r.terminalId ?? null, r.employeeId ?? null],
    );
    const back = await this.db.query<{ method: string; amount: number }>(
      `SELECT p.method, SUM(p.amount)::int AS amount FROM credit_note_payments p JOIN credit_notes c ON c.doc_no=p.doc_no JOIN shifts h ON h.id=c.shift_id
        WHERE c.business_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR h.terminal_id=$3) AND ($4::text IS NULL OR c.employee_id=$4) GROUP BY 1`,
      [r.from, r.to, r.terminalId ?? null, r.employeeId ?? null],
    );
    const byMethod: Record<string, number> = { cash: 0, promptpay: 0, card: 0, transfer: 0 };
    for (const m of methods) byMethod[m.method] = (byMethod[m.method] ?? 0) + m.amount;
    for (const m of back) byMethod[m.method] = (byMethod[m.method] ?? 0) - m.amount;
    return { ...r, total: { ...total, average: total.bills > 0 ? Math.round(total.net / total.bills) : 0 }, byMethod, days: rows };
  }

  async hourly(r: Range) {
    const rows = await this.db.query<{ dow: number; hour: number; net: number; bills: number }>(
      `SELECT EXTRACT(DOW FROM s.at AT TIME ZONE 'Asia/Bangkok')::int AS dow, EXTRACT(HOUR FROM s.at AT TIME ZONE 'Asia/Bangkok')::int AS hour, SUM(s.net)::int AS net, count(*)::int AS bills
         FROM sales s JOIN shifts h ON h.id=s.shift_id WHERE s.business_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR h.terminal_id=$3) GROUP BY 1,2 ORDER BY 1,2`,
      [r.from, r.to, r.terminalId ?? null],
    );
    return { ...r, cells: rows };
  }

  /** Top and bottom sellers per SKU, plus products with no sale in the range. */
  async products(r: Range, canSeeCost: boolean) {
    const rows = await this.db.query<{ product_id: string; sku: string; name: string; category_id: string; qty: number; revenue: number; cost: number; rqty: number; ramount: number; rcost: number }>(
      `SELECT p.id AS product_id, p.sku, p.name, p.category_id,
              COALESCE(SUM(l.qty),0)::int AS qty, COALESCE(SUM(l.net),0)::int AS revenue, COALESCE(SUM(l.qty*l.cost),0)::int AS cost,
              COALESCE((SELECT SUM(n.qty) FROM credit_note_lines n JOIN credit_notes c ON c.doc_no=n.doc_no WHERE n.product_id=p.id AND c.business_date BETWEEN $1::date AND $2::date),0)::int AS rqty,
              COALESCE((SELECT SUM(n.amount) FROM credit_note_lines n JOIN credit_notes c ON c.doc_no=n.doc_no WHERE n.product_id=p.id AND c.business_date BETWEEN $1::date AND $2::date),0)::int AS ramount,
              COALESCE((SELECT SUM(n.qty*n.cost) FROM credit_note_lines n JOIN credit_notes c ON c.doc_no=n.doc_no WHERE n.product_id=p.id AND c.business_date BETWEEN $1::date AND $2::date),0)::int AS rcost
         FROM products p LEFT JOIN (SELECT sl.* FROM sale_lines sl JOIN sales s ON s.doc_no=sl.doc_no WHERE s.business_date BETWEEN $1::date AND $2::date) l ON l.product_id=p.id
        WHERE ($3::text IS NULL OR p.category_id=$3) GROUP BY p.id ORDER BY p.sku`,
      [r.from, r.to, r.categoryId ?? null],
    );
    const items = rows.map((x) => {
      const qty = x.qty - x.rqty;
      const revenue = x.revenue - x.ramount;
      return { productId: x.product_id, sku: x.sku, name: x.name, categoryId: x.category_id, qty, revenue, ...(canSeeCost ? { cost: x.cost - x.rcost, profit: revenue - (x.cost - x.rcost), marginPct: revenue > 0 ? Math.round(((revenue - (x.cost - x.rcost)) / revenue) * 1000) / 10 : 0 } : {}) };
    });
    const sold = items.filter((i) => i.qty > 0).sort((a, b) => b.qty - a.qty);
    return { ...r, top: sold.slice(0, 20), bottom: [...sold].reverse().slice(0, 20), notSold: items.filter((i) => i.qty <= 0), all: items };
  }

  async cash(r: Range) {
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM shifts WHERE business_date BETWEEN $1::date AND $2::date AND closed_at IS NOT NULL AND ($3::text IS NULL OR terminal_id=$3) AND ($4::text IS NULL OR employee_id=$4) ORDER BY opened_at`, [r.from, r.to, r.terminalId ?? null, r.employeeId ?? null]);
    const out = [];
    for (const d of await this.datesBetween(r.from, r.to)) out.push(...(await this.days.dayShifts(d)).shifts.filter((s) => s.closedAt && rows.some((x) => x.id === s.id)).map((s) => ({ ...s, date: d })));
    return { ...r, shifts: out, byCashier: this.groupVariance(out) };
  }

  private groupVariance(shifts: { cashier: string; variance: number | null }[]) {
    const m = new Map<string, { cashier: string; shifts: number; variance: number }>();
    for (const s of shifts) {
      const row = m.get(s.cashier) ?? { cashier: s.cashier, shifts: 0, variance: 0 };
      row.shifts += 1;
      row.variance += s.variance ?? 0;
      m.set(s.cashier, row);
    }
    return [...m.values()];
  }

  private async datesBetween(from: string, to: string): Promise<string[]> {
    const rows = await this.db.query<{ d: string }>(`SELECT DISTINCT business_date::text AS d FROM shifts WHERE business_date BETWEEN $1::date AND $2::date ORDER BY 1`, [from, to]);
    return rows.map((r) => r.d);
  }

  /** Every void and refund with who did it and who approved (spec: "ยกเลิก คืน ส่วนลด manual"). */
  async credits(r: Range) {
    const rows = await this.db.query<{ doc_no: string; sale_doc_no: string; type: string; at: Date; amount: number; reason: string; actor: string; approver: string }>(
      `SELECT c.doc_no, c.sale_doc_no, c.type, c.at, c.amount, c.reason, e.name AS actor, a.name AS approver
         FROM credit_notes c JOIN employees e ON e.id=c.employee_id JOIN employees a ON a.id=c.approved_by JOIN shifts h ON h.id=c.shift_id
        WHERE c.business_date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR h.terminal_id=$3) AND ($4::text IS NULL OR c.employee_id=$4) ORDER BY c.at DESC`,
      [r.from, r.to, r.terminalId ?? null, r.employeeId ?? null],
    );
    return { ...r, items: rows.map((x) => ({ docNo: x.doc_no, saleDocNo: x.sale_doc_no, type: x.type, at: iso(x.at), amount: x.amount, reason: x.reason, actor: x.actor, approver: x.approver })) };
  }

  /** Stock and its value at cost on a date (summing the ledger up to the end of that day). */
  async stockValue(asOf: string, categoryId?: string) {
    const rows = await this.db.query<{ id: string; sku: string; name: string; qty: number; cost: number }>(
      `SELECT p.id, p.sku, p.name, p.cost, COALESCE((SELECT SUM(m.qty) FROM stock_movements m WHERE m.product_id=p.id AND (m.at AT TIME ZONE 'Asia/Bangkok')::date <= $1::date),0)::int AS qty
         FROM products p WHERE p.active AND ($2::text IS NULL OR p.category_id=$2) ORDER BY p.sku`,
      [asOf, categoryId ?? null],
    );
    const items = rows.map((x) => ({ productId: x.id, sku: x.sku, name: x.name, qty: x.qty, cost: x.cost, value: Math.max(0, x.qty) * x.cost }));
    return { asOf, total: items.reduce((a, i) => a + i.value, 0), items };
  }

  /** ภ.พ.30 support: output VAT per day and every full tax invoice of the month. */
  async tax(month: string) {
    const from = `${month}-01`;
    const to = day(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 10), -1);
    const days = await this.dailyNet(from, to);
    const invoices = await this.db.query<{ doc_no: string; sale_doc_no: string; at: Date; buyer_name: string; buyer_tax_id: string; buyer_branch: string; net: number; vat: number }>(
      `SELECT t.doc_no, t.sale_doc_no, t.at, t.buyer_name, t.buyer_tax_id, t.buyer_branch, s.net, s.vat FROM tax_invoices t JOIN sales s ON s.doc_no=t.sale_doc_no WHERE (t.at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date ORDER BY t.doc_no`,
      [from, to],
    );
    const net = days.reduce((a, d) => a + d.net, 0);
    const vat = days.reduce((a, d) => a + d.vat, 0);
    return { month, from, to, net, vat, base: net - vat, days, invoices: invoices.map((i) => ({ docNo: i.doc_no, saleDocNo: i.sale_doc_no, at: iso(i.at), buyerName: i.buyer_name, buyerTaxId: i.buyer_tax_id, buyerBranch: i.buyer_branch, base: i.net - i.vat, vat: i.vat })) };
  }

  /** Member spend and points owed, and what each promotion gave away. */
  async membersAndPromos(r: Range) {
    const members = await this.db.query<{ id: string; name: string; phone: string | null; bills: number; spend: number; points: number }>(
      `SELECT m.id, m.name, m.phone, count(s.doc_no)::int AS bills, COALESCE(SUM(s.net),0)::int AS spend,
              COALESCE((SELECT SUM(points) FROM points_ledger l WHERE l.member_id=m.id),0)::int AS points
         FROM members m LEFT JOIN sales s ON s.member_id=m.id AND s.business_date BETWEEN $1::date AND $2::date WHERE m.anonymized_at IS NULL GROUP BY m.id ORDER BY spend DESC LIMIT 100`,
      [r.from, r.to],
    );
    const applied = await this.db.query<{ applied: { promotionId: string; label: string; discount: number }[]; qty: number; cost: number; gift_of_product_id: string | null; net: number; unit_price: number }>(
      `SELECT l.applied, l.qty, l.cost, l.gift_of_product_id, l.net, l.unit_price FROM sale_lines l JOIN sales s ON s.doc_no=l.doc_no WHERE s.business_date BETWEEN $1::date AND $2::date`,
      [r.from, r.to],
    );
    const promos = new Map<string, { promotionId: string; label: string; uses: number; discount: number }>();
    for (const l of applied) for (const a of l.applied ?? []) {
      const row = promos.get(a.promotionId) ?? { promotionId: a.promotionId, label: a.label, uses: 0, discount: 0 };
      row.uses += 1;
      row.discount += a.discount;
      promos.set(a.promotionId, row);
    }
    const [owed] = await this.db.query<{ p: number }>(`SELECT COALESCE(SUM(points),0)::int AS p FROM points_ledger`);
    return { ...r, members: members.map((m) => ({ id: m.id, name: m.name, phone: m.phone ?? '', bills: m.bills, spend: m.spend, points: m.points })), pointsOutstanding: owed?.p ?? 0, promotions: [...promos.values()].sort((a, b) => b.discount - a.discount) };
  }

  async audit(r: { from: string; to: string; action?: string; limit?: number }) {
    const rows = await this.db.query<{ id: number; at: Date; actor: string | null; approver: string | null; terminal_id: string | null; action: string; entity: string | null; entity_id: string | null; before: unknown; after: unknown }>(
      `SELECT a.id, a.at, e.name AS actor, ap.name AS approver, a.terminal_id, a.action, a.entity, a.entity_id, a.before, a.after
         FROM audit_log a LEFT JOIN employees e ON e.id=a.actor LEFT JOIN employees ap ON ap.id=a.approver
        WHERE (a.at AT TIME ZONE 'Asia/Bangkok')::date BETWEEN $1::date AND $2::date AND ($3::text IS NULL OR a.action LIKE $3) ORDER BY a.id DESC LIMIT $4`,
      [r.from, r.to, r.action ? `${r.action}%` : null, Math.min(r.limit ?? 200, 1000)],
    );
    return rows.map((a) => ({ id: a.id, at: iso(a.at), actor: a.actor, approver: a.approver, terminalId: a.terminal_id, action: a.action, entity: a.entity, entityId: a.entity_id, before: a.before, after: a.after }));
  }

  now() {
    return this.clock();
  }
}
