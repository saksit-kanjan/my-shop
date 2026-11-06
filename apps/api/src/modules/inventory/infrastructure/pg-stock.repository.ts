import { Injectable } from '@nestjs/common';
import type { Tx } from '../../../shared/database/unit-of-work';
import { StockRepository, type CountHeader, type CountLine, type Movement, type Supplier } from '../domain/stock.repository';

@Injectable()
export class PgStockRepository extends StockRepository {
  async append(tx: Tx, m: Movement) {
    await tx.query(`INSERT INTO stock_movements (product_id, premium_id, qty, kind, doc_no, unit_cost, at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [m.productId ?? null, m.premiumId ?? null, m.qty, m.kind, m.docNo ?? null, m.unitCost ?? null, m.at]);
  }

  async balances(tx: Tx) {
    const rows = await tx.query<{ product_id: string; q: number }>(`SELECT product_id, SUM(qty)::int AS q FROM stock_movements WHERE product_id IS NOT NULL GROUP BY product_id`);
    return new Map(rows.map((r) => [r.product_id, r.q]));
  }

  async balanceOf(tx: Tx, productId: string) {
    const [r] = await tx.query<{ q: number }>(`SELECT COALESCE(SUM(qty),0)::int AS q FROM stock_movements WHERE product_id=$1`, [productId]);
    return r?.q ?? 0;
  }

  async premiumBalances(tx: Tx) {
    const rows = await tx.query<{ premium_id: string; q: number }>(`SELECT premium_id, COALESCE(SUM(qty),0)::int AS q FROM stock_movements WHERE premium_id IS NOT NULL GROUP BY premium_id`);
    return new Map(rows.map((r) => [r.premium_id, Number(r.q)]));
  }

  movementsOf(tx: Tx, productId: string, limit: number) {
    return tx.query<{ at: Date; qty: number; kind: string; docNo: string | null }>(`SELECT at, qty, kind, doc_no AS "docNo" FROM stock_movements WHERE product_id=$1 ORDER BY id DESC LIMIT $2`, [productId, limit]);
  }

  suppliers(tx: Tx): Promise<Supplier[]> {
    return tx.query<Supplier>(`SELECT id, name, contact, terms, active FROM suppliers ORDER BY name`);
  }

  async supplierExists(tx: Tx, id: string) {
    return (await tx.query(`SELECT 1 FROM suppliers WHERE id=$1`, [id])).length > 0;
  }

  async saveSupplier(tx: Tx, s: { id: string; name: string; contact: string | null; terms: string | null; active: boolean }) {
    await tx.query(`INSERT INTO suppliers (id, name, contact, terms, active) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, contact=EXCLUDED.contact, terms=EXCLUDED.terms, active=EXCLUDED.active`, [s.id, s.name, s.contact, s.terms, s.active]);
  }

  async insertReceipt(tx: Tx, r: { docNo: string; supplierId: string; at: Date; ref: string | null; note: string | null; employeeId: string }) {
    await tx.query(`INSERT INTO receipts (doc_no, supplier_id, at, ref, note, employee_id) VALUES ($1,$2,$3,$4,$5,$6)`, [r.docNo, r.supplierId, r.at, r.ref, r.note, r.employeeId]);
  }

  async insertReceiptLine(tx: Tx, docNo: string, productId: string, qty: number, unitCost: number) {
    await tx.query(`INSERT INTO receipt_lines (doc_no, product_id, qty, unit_cost) VALUES ($1,$2,$3,$4)`, [docNo, productId, qty, unitCost]);
  }

  receipts(tx: Tx, limit: number) {
    return tx.query<{ docNo: string; at: Date; supplier: string; ref: string | null; qty: number }>(
      `SELECT r.doc_no AS "docNo", r.at, s.name AS supplier, r.ref, COALESCE((SELECT SUM(qty) FROM receipt_lines l WHERE l.doc_no=r.doc_no),0)::int AS qty FROM receipts r JOIN suppliers s ON s.id=r.supplier_id ORDER BY r.at DESC LIMIT $1`,
      [limit],
    );
  }

  async openCountId(tx: Tx) {
    const [r] = await tx.query<{ id: string }>(`SELECT id FROM stock_counts WHERE status='open'`);
    return r?.id ?? null;
  }

  async insertCount(tx: Tx, c: { id: string; scope: string; categoryId: string | null; at: Date; by: string }) {
    await tx.query(`INSERT INTO stock_counts (id, scope, category_id, started_at, started_by) VALUES ($1,$2,$3,$4,$5)`, [c.id, c.scope, c.categoryId, c.at, c.by]);
  }

  async snapshotLines(tx: Tx, countId: string, productIds: string[]) {
    // The snapshot of system stock at the moment counting starts (spec step 2).
    await tx.query(
      `INSERT INTO stock_count_lines (count_id, product_id, snapshot_qty)
         SELECT $1, p, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=p),0)::int FROM unnest($2::text[]) AS p`,
      [countId, productIds],
    );
  }

  async countStatus(tx: Tx, id: string, lock: boolean) {
    const [r] = await tx.query<{ status: string }>(`SELECT status FROM stock_counts WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
    return r?.status ?? null;
  }

  async setCounted(tx: Tx, countId: string, productId: string, qty: number) {
    await tx.query(`UPDATE stock_count_lines SET counted_qty=$3 WHERE count_id=$1 AND product_id=$2`, [countId, productId, qty]);
  }

  async countHeader(tx: Tx, id: string): Promise<CountHeader | null> {
    const [r] = await tx.query<{ id: string; scope: string; category_id: string | null; started_at: Date; status: string }>(`SELECT id, scope, category_id, started_at, status FROM stock_counts WHERE id=$1`, [id]);
    return r ? { id: r.id, scope: r.scope, categoryId: r.category_id, startedAt: r.started_at, status: r.status } : null;
  }

  async countLines(tx: Tx, countId: string, countedOnly: boolean): Promise<CountLine[]> {
    const rows = await tx.query<{ product_id: string; snapshot_qty: number; counted_qty: number | null; now_qty: number }>(
      `SELECT l.product_id, l.snapshot_qty, l.counted_qty, COALESCE((SELECT SUM(qty) FROM stock_movements m WHERE m.product_id=l.product_id),0)::int AS now_qty
         FROM stock_count_lines l WHERE l.count_id=$1 ${countedOnly ? 'AND l.counted_qty IS NOT NULL' : ''}`,
      [countId],
    );
    return rows.map((r) => ({ productId: r.product_id, snapshot: r.snapshot_qty, counted: r.counted_qty, balanceNow: r.now_qty }));
  }

  async closeCount(tx: Tx, id: string, status: 'approved' | 'cancelled', at: Date, by: string | null) {
    if (status === 'approved') await tx.query(`UPDATE stock_counts SET status='approved', approved_at=$2, approved_by=$3 WHERE id=$1`, [id, at, by]);
    else await tx.query(`UPDATE stock_counts SET status='cancelled' WHERE id=$1`, [id]);
  }
}
