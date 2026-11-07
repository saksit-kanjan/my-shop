import type { Member } from './member';

export abstract class MemberRepository {
  abstract findById(id: string): Promise<Member | null>;
  /** Active members only (an erased member cannot be found by phone). */
  abstract findByPhone(phone: string): Promise<Member | null>;
  /** Members with a points row that has passed its expiry date and is not yet handled. */
  abstract findWithDueExpiry(now: Date): Promise<Member[]>;
  abstract search(term: string, limit: number): Promise<Member[]>;
  abstract add(member: Member): Promise<void>;
  /** Profile fields and new ledger rows. */
  abstract save(member: Member): Promise<void>;
}
