import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { docPeriod, iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { ReceiptEntity, ReceiptLine, SupplierEntity } from './entities/stock.entities';
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
    return this.db.manager.find(SupplierEntity, { order: { name: 'ASC' } });
  }

  async saveSupplier(s: { name: string; contact?: string; terms?: string }, actor: Employee): Promise<string> {
    if (!s.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อผู้ขาย');
    const id = `S${Date.now().toString(36)}`;
    await this.db.transaction(async (tx) => {
      await tx.insert(SupplierEntity, { id, name: s.name.trim(), contact: s.contact ?? null, terms: s.terms ?? null, active: true });
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'supplier.save', entity: 'supplier', entityId: id, after: s });
    });
    return id;
  }

  async receive(input: ReceiptInput, actor: Employee, canSeeCost: boolean): Promise<{ docNo: string }> {
    if (!input.lines?.length) throw new DomainError('invalid', 'เพิ่มสินค้าที่รับอย่างน้อย 1 รายการ');
    for (const l of input.lines) if (!Number.isInteger(l.qty) || l.qty <= 0 || !Number.isInteger(l.unitCost) || l.unitCost < 0) throw new DomainError('invalid', 'จำนวนและต้นทุนต่อหน่วยไม่ถูกต้อง');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      if (!(await tx.existsBy(SupplierEntity, { id: input.supplierId }))) throw new DomainError('invalid', 'เลือกผู้ขาย');
      const known = new Map((await this.products.directory(tx)).map((p) => [p.id, p]));
      const docNo = await this.numbering.next(tx, `GR-${docPeriod(now)}`);
      await tx.insert(ReceiptEntity, { docNo, supplierId: input.supplierId, at: now, ref: input.ref ?? null, note: input.note ?? null, employeeId: actor.id });
      for (const l of input.lines) {
        const product = known.get(l.productId);
        if (!product) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ', { productId: l.productId });
        const onHand = await this.stock.balanceOf(tx, l.productId);
        const cost = weightedAverageCost(onHand, product.cost, l.qty, l.unitCost);
        await tx.insert(ReceiptLine, { docNo, productId: l.productId, qty: l.qty, unitCost: l.unitCost });
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
    const rows = await this.db.manager
      .createQueryBuilder(ReceiptEntity, 'r')
      .innerJoin(SupplierEntity, 's', 's.id = r.supplier_id')
      .select('r.doc_no', 'docNo').addSelect('r.at', 'at').addSelect('s.name', 'supplier').addSelect('r.ref', 'ref')
      .addSelect((qb) => qb.subQuery().select('COALESCE(SUM(l.qty), 0)').from(ReceiptLine, 'l').where('l.doc_no = r.doc_no'), 'qty')
      .orderBy('r.at', 'DESC').limit(limit)
      .getRawMany<{ docNo: string; at: Date; supplier: string; ref: string | null; qty: number }>();
    return rows.map((r) => ({ ...r, qty: Number(r.qty), at: iso(r.at) }));
  }
}
