import { Inject, Injectable } from '@nestjs/common';
import type { Member as MemberView } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { SettingsService } from '../settings/settings.service';
import { Member } from './domain/member';
import { MemberRepository } from './domain/member.repository';
import { PointsLedger } from './entities/members.entities';
import { normalizePhone } from './phone';
import type { PointsRules } from './points-policy';

const toView = (m: Member): MemberView => {
  const s = m.snapshot();
  return { id: s.id, phone: s.phone ?? '', name: s.name, ...(s.birthday ? { birthday: String(s.birthday) } : {}), tier: s.tier, joinedAt: iso(s.joinedAt), points: m.balance };
};

/**
 * Application service for members and points. The rules live in the `Member` aggregate; this loads it, calls it, saves it
 * and audits. Sales asks it to earn, redeem and adjust points; it knows nothing about bills.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly members: MemberRepository,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async rules(tx: Tx): Promise<PointsRules> {
    const s = await this.settings.getAll(tx);
    return { earnSatang: s.pointsEarnSatang, valueSatang: s.pointsValueSatang, expiryMonths: s.pointsExpiryMonths };
  }

  private async must(id: string): Promise<Member> {
    const m = await this.members.findById(id);
    if (!m) throw new DomainError('not_found', 'ไม่พบสมาชิก');
    return m;
  }

  /** Active members only, and the same transaction as the caller (the repository joins it). */
  async findByPhone(phone: string, _tx?: Tx): Promise<MemberView | null> {
    const m = await this.members.findByPhone(normalizePhone(phone));
    return m ? toView(m) : null;
  }

  async phoneOf(memberId: string, _tx?: Tx): Promise<string | null> {
    return (await this.members.findById(memberId))?.phone ?? null;
  }

  async search(term: string): Promise<MemberView[]> {
    return (await this.members.search(term, 100)).map(toView);
  }

  async register(input: { phone: string; name: string; birthday?: string; consent: boolean }, actor: string, terminalId?: string): Promise<MemberView> {
    const now = this.clock();
    const member = Member.register({ id: crypto.randomUUID(), ...input, now });
    return this.db.transaction(async (tx) => {
      if (await this.members.findByPhone(member.phone as string)) throw new DomainError('conflict', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว');
      await this.members.add(member);
      await this.audit.record(tx, now, { actor, terminalId, action: 'member.register', entity: 'member', entityId: member.id });
      return toView(member);
    });
  }

  async update(id: string, patch: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const member = await this.must(id);
      member.update({ ...patch, tax: patch.tax as object | undefined });
      await this.members.save(member);
      await this.audit.record(tx, this.clock(), { actor, action: 'member.update', entity: 'member', entityId: id, after: patch });
    });
  }

  /**
   * PDPA erasure: wipe the person, keep the bills. Sales point at the member id, not the phone,
   * so the closed documents stay untouched but no longer lead back to anyone.
   */
  async anonymize(id: string, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const member = await this.must(id);
      member.anonymize(this.clock());
      await this.members.save(member);
      await this.audit.record(tx, this.clock(), { actor, action: 'member.anonymize', entity: 'member', entityId: id });
    });
  }

  /* ---------- points, used by sales ---------- */

  async balance(_tx: Tx, memberId: string): Promise<number> {
    return (await this.must(memberId)).balance;
  }

  /** Points a bill earns, written inside the sale transaction. Returns the points. */
  async earn(tx: Tx, memberId: string, netPaid: number, docNo: string, now: Date): Promise<number> {
    const member = await this.must(memberId);
    const points = member.earn(netPaid, docNo, await this.rules(tx), now);
    await this.members.save(member);
    return points;
  }

  /** Checks a redemption without writing (the bill is validated before its number is issued). Returns the value taken off, in satang. */
  async quoteRedemption(tx: Tx, memberId: string, points: number, billNet: number): Promise<number> {
    return (await this.must(memberId)).quoteRedemption(points, billNet, await this.rules(tx));
  }

  /** Spends points against a bill: validates balance and cap, writes the ledger row, returns the value taken off. */
  async redeem(tx: Tx, memberId: string, points: number, billNet: number, docNo: string, now: Date): Promise<number> {
    const member = await this.must(memberId);
    const value = member.redeem(points, billNet, docNo, await this.rules(tx), now);
    await this.members.save(member);
    return value;
  }

  async adjustForCredit(_tx: Tx, a: { memberId: string; kind: 'void' | 'refund'; creditDocNo: string; priorCreditDocNos: string[]; earned: number; redeemed: number; saleNet: number; refundedAfter: number; now: Date }): Promise<void> {
    const member = await this.must(a.memberId);
    member.adjustForCredit(a);
    await this.members.save(member);
  }

  /** Writes an expiry row for each earn entry past its date, capped by what the member still has. */
  async expireDue(actor = 'system'): Promise<number> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const due = await this.members.findWithDueExpiry(now);
      let total = 0;
      for (const member of due) {
        total += member.expireDue(now);
        await this.members.save(member);
      }
      if (due.length) await this.audit.record(tx, now, { actor, action: 'points.expire', after: { members: due.length, points: total } });
      return total;
    });
  }

  async ledger(memberId: string) {
    const rows = await this.db.manager.find(PointsLedger, { where: { memberId }, order: { id: 'DESC' }, take: 200 });
    return rows.map((r) => ({ points: r.points, kind: r.kind, docNo: r.docNo, at: iso(r.at) }));
  }
}
