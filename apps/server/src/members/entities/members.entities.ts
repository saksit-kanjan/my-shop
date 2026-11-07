import { Column, Entity, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';

@Entity('members')
export class MemberEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text', { nullable: true, unique: true }) phone!: string | null;
  @Column('text') name!: string;
  @Column('date', { nullable: true }) birthday!: string | null;
  @Column('text', { default: 'Standard' }) tier!: string;
  @Column('timestamptz') joinedAt!: Date;
  @Column('timestamptz', { nullable: true }) pdpaConsentAt!: Date | null;
  @Column('jsonb', { nullable: true }) tax!: object | null;
  @Column('timestamptz', { nullable: true }) anonymizedAt!: Date | null;
}

/** Append-only. */
@Entity('points_ledger')
export class PointsLedger {
  @PrimaryGeneratedColumn({ type: 'bigint' }) id!: number;
  @Column('text') memberId!: string;
  @Column('int') points!: number;
  @Column('text') kind!: 'earn' | 'redeem' | 'refund' | 'void' | 'expire' | 'adjust';
  @Column('text', { nullable: true }) docNo!: string | null;
  @Column('bigint', { nullable: true }) sourceId!: number | null;
  @Column('timestamptz', { nullable: true }) expiresAt!: Date | null;
  @Column('timestamptz') at!: Date;
}
