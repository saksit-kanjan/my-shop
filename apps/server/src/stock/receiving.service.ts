import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { docPeriod, iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import { NumberingService } from '../database/numbering.service';
import { ProductsService } from '../products/products.service';
import { StockService } from './stock.service';
import { weightedAverageCost } from './stock-rules';

export interface ReceiptInput {
  supplierId: string;
  ref?: string;
  note?: string;
  lines: { productId: string; qty: number; unitCost: number }[];
}

/** Goods in: suppliers and receipts. Stock goes up through the ledger and the product's average cost moves with it (spec). */
@Injectable()
export class ReceivingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly products: ProductsService,
    private readonly stock: StockService,
    private readonly numbering: NumberingService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  suppliers() {
    return this.db.query<{ id: string; name: string; contact: string | null; terms: string | null; active: boolean }>(`SELECT id, name, contact, terms, active FROM suppliers ORDER BY name`);
  }

  async saveSupplier(s: { name: string; contact?: string; terms?: string }, actor: Employee): Promise<string> {
    if (!s.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อผู้ขาย');
    const id = `S${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO suppliers (id, name, contact, terms, active) VALUES ($1,$2,$3,$4,true)`, [id, s.name.trim(), s.contact ?? null, s.terms ?? null]);
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'supplier.save', entity: 'supplier', entityId: id, after: s });
    });
    return id;
  }

  async receive(input: ReceiptInput, actor: Employee, canSeeCost: boolean): Promise<{ docNo: string }> {
    if (!input.lines?.length) throw new DomainError('invalid', 'เพิ่มสินค้าที่รับอย่างน้อย 1 รายการ');
    for (const l of input.lines) if (!Number.isInteger(l.qty) || l.qty <= 0 || !Number.isInteger(l.unitCost) || l.unitCost < 0) throw new DomainError('invalid', 'จำนวนและต้นทุนต่อหน่วยไม่ถูกต้อง');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      if (!(await tx.query(`SELECT 1 FROM suppliers WHERE id=$1`, [input.supplierId])).length) throw new DomainError('invalid', 'เลือกผู้ขาย');
      const known = new Map((await this.products.directory(tx)).map((p) => [p.id, p]));
      const docNo = await this.numbering.next(tx, `GR-${docPeriod(now)}`);
      await tx.query(`INSERT INTO receipts (doc_no, supplier_id, at, ref, note, employee_id) VALUES ($1,$2,$3,$4,$5,$6)`, [docNo, input.supplierId, now, input.ref ?? null, input.note ?? null, actor.id]);
      for (const l of input.lines) {
        const product = known.get(l.productId);
        if (!product) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ', { productId: l.productId });
        const onHand = await this.stock.balanceOf(tx, l.productId);
        const cost = weightedAverageCost(onHand, product.cost, l.qty, l.unitCost);
        await tx.query(`INSERT INTO receipt_lines (doc_no, product_id, qty, unit_cost) VALUES ($1,$2,$3,$4)`, [docNo, l.productId, l.qty, l.unitCost]);
        await this.stock.record(tx, [{ productId: l.productId, qty: l.qty, kind: 'receive', docNo, unitCost: l.unitCost, at: now }]);
        await this.products.updateCost(tx, l.productId, cost);
        // A product received twice in one document sees the first line's cost.
        known.set(l.productId, { ...product, cost });
      }
      await this.audit.record(tx, now, { actor: actor.id, action: 'stock.receive', entity: 'receipt', entityId: docNo, after: { supplierId: input.supplierId, lines: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(canSeeCost ? { unitCost: l.unitCost } : {}) })) } });
      return { docNo };
    });
  }

  async receipts(limit = 50) {
    const rows = await this.db.query<{ docNo: string; at: Date; supplier: string; ref: string | null; qty: number }>(
      `SELECT r.doc_no AS "docNo", r.at, s.name AS supplier, r.ref, COALESCE((SELECT SUM(qty) FROM receipt_lines l WHERE l.doc_no=r.doc_no),0)::int AS qty FROM receipts r JOIN suppliers s ON s.id=r.supplier_id ORDER BY r.at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({ ...r, at: iso(r.at) }));
  }
}
