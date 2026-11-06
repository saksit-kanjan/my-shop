import { Inject, Injectable } from '@nestjs/common';
import type { Employee } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { docPeriod, iso } from '../common/utils/dates';
import { DomainError } from '../common/errors/domain-error';
import { DocumentNumbersService } from '../numbering/document-numbers.service';
import { ProductDirectory } from './providers/product-directory';
import { StockRepository } from './repositories/stock.repository';
import { weightedAverageCost } from './policies/stock-rules';

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
    private readonly uow: UnitOfWork,
    private readonly repo: StockRepository,
    private readonly products: ProductDirectory,
    private readonly numbers: DocumentNumbersService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  suppliers() {
    return this.repo.suppliers(this.uow.read);
  }

  async saveSupplier(id: string | null, s: { name: string; contact?: string; terms?: string; active?: boolean }, actor: Employee): Promise<string> {
    if (!s.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อผู้ขาย');
    const sid = id ?? `S${Date.now().toString(36)}`;
    await this.uow.run(async (tx) => {
      await this.repo.saveSupplier(tx, { id: sid, name: s.name.trim(), contact: s.contact ?? null, terms: s.terms ?? null, active: s.active ?? true });
      await this.audit.record(tx, this.clock(), { actor: actor.id, action: 'supplier.save', entity: 'supplier', entityId: sid, after: s });
    });
    return sid;
  }

  async receive(input: ReceiptInput, actor: Employee, canSeeCost: boolean): Promise<{ docNo: string }> {
    if (!input.lines?.length) throw new DomainError('invalid', 'เพิ่มสินค้าที่รับอย่างน้อย 1 รายการ');
    for (const l of input.lines) if (!Number.isInteger(l.qty) || l.qty <= 0 || !Number.isInteger(l.unitCost) || l.unitCost < 0) throw new DomainError('invalid', 'จำนวนและต้นทุนต่อหน่วยไม่ถูกต้อง');
    const now = this.clock();
    return this.uow.run(async (tx) => {
      if (!(await this.repo.supplierExists(tx, input.supplierId))) throw new DomainError('invalid', 'เลือกผู้ขาย');
      const known = new Map((await this.products.all(tx)).map((p) => [p.id, p]));
      const docNo = await this.numbers.format(tx, `GR-${docPeriod(now)}`);
      await this.repo.insertReceipt(tx, { docNo, supplierId: input.supplierId, at: now, ref: input.ref ?? null, note: input.note ?? null, employeeId: actor.id });
      for (const l of input.lines) {
        const product = known.get(l.productId);
        if (!product) throw new DomainError('invalid', 'มีสินค้าที่ไม่อยู่ในระบบ', { productId: l.productId });
        const onHand = await this.repo.balanceOf(tx, l.productId);
        await this.repo.insertReceiptLine(tx, docNo, l.productId, l.qty, l.unitCost);
        await this.repo.append(tx, { productId: l.productId, qty: l.qty, kind: 'receive', docNo, unitCost: l.unitCost, at: now });
        await this.products.setCost(tx, l.productId, weightedAverageCost(onHand, product.cost, l.qty, l.unitCost));
        // A product received twice in one document sees the first line's cost.
        known.set(l.productId, { ...product, cost: weightedAverageCost(onHand, product.cost, l.qty, l.unitCost) });
      }
      await this.audit.record(tx, now, { actor: actor.id, action: 'stock.receive', entity: 'receipt', entityId: docNo, after: { supplierId: input.supplierId, lines: input.lines.map((l) => ({ productId: l.productId, qty: l.qty, ...(canSeeCost ? { unitCost: l.unitCost } : {}) })) } });
      return { docNo };
    });
  }

  async receipts(limit = 50) {
    return (await this.repo.receipts(this.uow.read, limit)).map((r) => ({ ...r, at: iso(r.at) }));
  }
}
