import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('shifts')
export class ShiftEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text') terminalId!: string;
  @Column('text') employeeId!: string;
  @Column('date') businessDate!: string;
  @Column('timestamptz') openedAt!: Date;
  @Column('int') float!: number;
  @Column('timestamptz', { nullable: true }) closedAt!: Date | null;
  @Column('int', { nullable: true }) counted!: number | null;
  @Column('text', { nullable: true }) note!: string | null;
}

@Entity('cash_moves')
export class CashMoveEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') shiftId!: string;
  @Column('timestamptz') at!: Date;
  @Column('text') type!: 'drop' | 'out' | 'in';
  @Column('int') amount!: number;
  @Column('text') reason!: string;
  @Column('text') employeeId!: string;
  @Column('text', { nullable: true }) approvedBy!: string | null;
}

/** Closed bill. Append-only. */
@Entity('sales')
export class SaleEntity {
  @PrimaryColumn('text') docNo!: string;
  @Column('text') shiftId!: string;
  @Column('text') employeeId!: string;
  @Column('timestamptz') at!: Date;
  @Column('date') businessDate!: string;
  @Column('text', { nullable: true }) memberPhone!: string | null;
  @Column('text', { nullable: true }) memberId!: string | null;
  @Column('int') gross!: number;
  @Column('int') discount!: number;
  @Column('int') net!: number;
  @Column('int') vat!: number;
  @Column('int') change!: number;
  @Column('jsonb') cart!: object;
  @Column('jsonb', { nullable: true }) pricing!: object | null;
  @Column('int', { default: 0 }) pointsEarned!: number;
  @Column('int', { default: 0 }) pointsRedeemed!: number;
  @Column('int', { default: 0 }) pointsValue!: number;
  @Column('text', { nullable: true }) exchangeFor!: string | null;
  @Column('int', { default: 0 }) manualDiscount!: number;
  @Column('text', { nullable: true }) manualReason!: string | null;
  @Column('text', { nullable: true }) manualApprovedBy!: string | null;
}

@Entity('sale_lines')
export class SaleLineEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') docNo!: string;
  @Column('text') productId!: string;
  @Column('text') name!: string;
  @Column('int') qty!: number;
  @Column('int') unitPrice!: number;
  @Column('int') gross!: number;
  @Column('int') discount!: number;
  @Column('int') net!: number;
  @Column('jsonb') applied!: object;
  @Column('text', { nullable: true }) giftOfProductId!: string | null;
  @Column('int', { default: 0 }) cost!: number;
}

@Entity('payments')
export class PaymentEntity {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') docNo!: string;
  @Column('text') method!: 'cash' | 'promptpay' | 'card' | 'transfer';
  @Column('int') amount!: number;
  @Column('int', { nullable: true }) tendered!: number | null;
  @Column('text', { nullable: true }) reference!: string | null;
}

@Entity('credit_notes')
export class CreditNoteEntity {
  @PrimaryColumn('text') docNo!: string;
  @Column('text') saleDocNo!: string;
  @Column('text') shiftId!: string;
  @Column('text') type!: 'void' | 'refund';
  @Column('timestamptz') at!: Date;
  @Column('date') businessDate!: string;
  @Column('int') amount!: number;
  @Column('text') reason!: string;
  @Column('boolean') restock!: boolean;
  @Column('text') employeeId!: string;
  @Column('text') approvedBy!: string;
}

@Entity('credit_note_lines')
export class CreditNoteLine {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') docNo!: string;
  @Column('text') productId!: string;
  @Column('text') name!: string;
  @Column('int') qty!: number;
  @Column('int') amount!: number;
  @Column('int', { default: 0 }) cost!: number;
}

@Entity('credit_note_payments')
export class CreditNotePayment {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') docNo!: string;
  @Column('text') method!: string;
  @Column('int') amount!: number;
}

@Entity('tax_invoices')
export class TaxInvoiceEntity {
  @PrimaryColumn('text') docNo!: string;
  @Column('text') saleDocNo!: string;
  @Column('timestamptz') at!: Date;
  @Column('text') buyerName!: string;
  @Column('text') buyerAddress!: string;
  @Column('text') buyerTaxId!: string;
  @Column('text') buyerBranch!: string;
  @Column('text') issuedBy!: string;
}

@Entity('reprints')
export class Reprint {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') docNo!: string;
  @Column('timestamptz') at!: Date;
  @Column('text') employeeId!: string;
}

@Entity('day_closes')
export class DayClose {
  @PrimaryColumn('date') businessDate!: string;
  @Column('timestamptz') closedAt!: Date;
  @Column('text') closedBy!: string;
  @Column('jsonb') summary!: object;
}
