import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

/** Append-only (a database trigger refuses UPDATE and DELETE). */
@Entity('audit_log')
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('timestamptz') at!: Date;
  @Column('text', { nullable: true }) actor!: string | null;
  @Column('text', { nullable: true }) approver!: string | null;
  @Column('text', { nullable: true }) terminalId!: string | null;
  @Column('text') action!: string;
  @Column('text', { nullable: true }) entity!: string | null;
  @Column('text', { nullable: true }) entityId!: string | null;
  @Column('jsonb', { nullable: true }) before!: object | null;
  @Column('jsonb', { nullable: true }) after!: object | null;
}
