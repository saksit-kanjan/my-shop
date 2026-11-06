import type { Member } from '@my-shop/contracts';
import type { Tx } from '../../database/unit-of-work';

export type LedgerKind = 'earn' | 'redeem' | 'refund' | 'void' | 'expire' | 'adjust';

export interface LedgerEntry {
  memberId: string;
  points: number;
  kind: LedgerKind;
  docNo?: string;
  sourceId?: number;
  expiresAt?: Date | null;
  at: Date;
}

/** Port: how the membership context stores members and the points ledger (append-only). */
export abstract class MemberRepository {
  abstract byPhone(tx: Tx, phone: string): Promise<Member | null>;
  abstract phoneOf(tx: Tx, memberId: string): Promise<string | null>;
  abstract search(tx: Tx, term: string): Promise<Member[]>;
  abstract insert(tx: Tx, m: { id: string; phone: string; name: string; birthday: string | null; at: Date }): Promise<void>;
  abstract isActive(tx: Tx, id: string): Promise<boolean>;
  abstract update(tx: Tx, id: string, patch: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }): Promise<void>;
  abstract erase(tx: Tx, id: string, at: Date): Promise<void>;

  abstract balance(tx: Tx, memberId: string): Promise<number>;
  abstract append(tx: Tx, e: LedgerEntry): Promise<void>;
  abstract pointsOfDocs(tx: Tx, memberId: string, docNos: string[]): Promise<{ clawed: number; returned: number }>;
  abstract dueEarnings(tx: Tx, now: Date): Promise<{ id: number; memberId: string; points: number }[]>;
  abstract ledger(tx: Tx, memberId: string): Promise<{ points: number; kind: string; docNo: string | null; at: Date }[]>;
}
