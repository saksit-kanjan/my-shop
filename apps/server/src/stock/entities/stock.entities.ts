import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only ledger: stock on hand is the sum of qty. */
@Entity('stock_movements')
export class StockMovement {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text', { nullable: true }) productId!: string | null;
  @Column('text', { nullable: true }) premiumId!: string | null;
  @Column('int') qty!: number;
  @Column('text') kind!: string;
  @Column('text', { nullable: true }) docNo!: string | null;
  @Column('timestamptz') at!: Date;
  @Column('int', { nullable: true }) unitCost!: number | null;
}

@Entity('suppliers')
export class SupplierEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text') name!: string;
  @Column('text', { nullable: true }) contact!: string | null;
  @Column('text', { nullable: true }) terms!: string | null;
  @Column('boolean', { default: true }) active!: boolean;
}

@Entity('receipts')
export class ReceiptEntity {
  @PrimaryColumn('text') docNo!: string;
  @Column('text') supplierId!: string;
  @Column('timestamptz') at!: Date;
  @Column('text', { nullable: true }) ref!: string | null;
  @Column('text', { nullable: true }) note!: string | null;
  @Column('text') employeeId!: string;
}

@Entity('receipt_lines')
export class ReceiptLine {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') docNo!: string;
  @Column('text') productId!: string;
  @Column('int') qty!: number;
  @Column('int') unitCost!: number;
}

@Entity('stock_counts')
export class StockCount {
  @PrimaryColumn('text') id!: string;
  @Column('text') scope!: string;
  @Column('text', { nullable: true }) categoryId!: string | null;
  @Column('timestamptz') startedAt!: Date;
  @Column('text') startedBy!: string;
  @Column('text', { default: 'open' }) status!: 'open' | 'approved' | 'cancelled';
  @Column('timestamptz', { nullable: true }) approvedAt!: Date | null;
  @Column('text', { nullable: true }) approvedBy!: string | null;
}

@Entity('stock_count_lines')
export class StockCountLine {
  @PrimaryColumn('text') countId!: string;
  @PrimaryColumn('text') productId!: string;
  @Column('int') snapshotQty!: number;
  @Column('int', { nullable: true }) countedQty!: number | null;
}
