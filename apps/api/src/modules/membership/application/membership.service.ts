import { Inject, Injectable } from '@nestjs/common';
import type { Member } from '@my-shop/contracts';
import { AuditLog } from '../../../shared/audit/audit-log';
import { UnitOfWork, type Tx } from '../../../shared/database/unit-of-work';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { iso } from '../../../shared/kernel/dates';
import { DomainError } from '../../../shared/kernel/domain-error';
import { SettingsService } from '../../administration/application/settings.service';
import { MemberRepository } from '../domain/member.repository';
import { isValidPhone, normalizePhone } from '../domain/phone';
import { expiryDate, pointsEarned, redemptionValue, refundAdjustment, type PointsRules } from '../domain/points-policy';

/** The membership context's public API: members, the points ledger, and what a bill or a refund does to it. */
@Injectable()
export class MembershipService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(MemberRepository) private readonly repo: MemberRepository,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async rules(tx: Tx): Promise<PointsRules> {
    const s = await this.settings.getAll(tx);
    return { earnSatang: s.pointsEarnSatang, valueSatang: s.pointsValueSatang, expiryMonths: s.pointsExpiryMonths };
  }

  findByPhone(phone: string, tx: Tx = this.uow.read): Promise<Member | null> {
    return this.repo.byPhone(tx, normalizePhone(phone));
  }

  phoneOf(memberId: string, tx: Tx = this.uow.read): Promise<string | null> {
    return this.repo.phoneOf(tx, memberId);
  }

  search(term: string): Promise<Member[]> {
    return this.repo.search(this.uow.read, term);
  }

  /** Register at the till. PDPA consent is required and its time is stored (spec). */
  async register(input: { phone: string; name: string; birthday?: string; consent: boolean }, actor: string, terminalId?: string): Promise<Member> {
    const phone = normalizePhone(input.phone ?? '');
    if (!isValidPhone(phone)) throw new DomainError('invalid', 'เบอร์โทรไม่ถูกต้อง ใส่เบอร์ 9-10 หลักที่ขึ้นต้นด้วย 0');
    if (!input.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อสมาชิก');
    if (input.consent !== true) throw new DomainError('invalid', 'ต้องได้รับความยินยอมเก็บข้อมูลจากลูกค้าก่อนสมัคร');
    const now = this.clock();
    return this.uow.run(async (tx) => {
      if (await this.repo.byPhone(tx, phone)) throw new DomainError('conflict', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว');
      const id = crypto.randomUUID();
      await this.repo.insert(tx, { id, phone, name: input.name.trim(), birthday: input.birthday || null, at: now });
      await this.audit.record(tx, now, { actor, terminalId, action: 'member.register', entity: 'member', entityId: id });
      return (await this.repo.byPhone(tx, phone)) as Member;
    });
  }

  async update(id: string, patch: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }, actor: string): Promise<void> {
    await this.uow.run(async (tx) => {
      if (!(await this.repo.isActive(tx, id))) throw new DomainError('not_found', 'ไม่พบสมาชิก');
      await this.repo.update(tx, id, { ...patch, name: patch.name?.trim() });
      await this.audit.record(tx, this.clock(), { actor, action: 'member.update', entity: 'member', entityId: id, after: patch });
    });
  }

  /**
   * PDPA erasure: wipe the person, keep the bills. Sales point at the member id, not the phone,
   * so the closed documents stay untouched but no longer lead back to anyone.
   */
  async anonymize(id: string, actor: string): Promise<void> {
    await this.uow.run(async (tx) => {
      if (!(await this.repo.isActive(tx, id))) throw new DomainError('not_found', 'ไม่พบสมาชิก');
      await this.repo.erase(tx, id, this.clock());
      await this.audit.record(tx, this.clock(), { actor, action: 'member.anonymize', entity: 'member', entityId: id });
    });
  }

  balance(tx: Tx, memberId: string): Promise<number> {
    return this.repo.balance(tx, memberId);
  }

  /** Points a bill earns, written inside the sale transaction. Returns the points. */
  async earn(tx: Tx, memberId: string, netPaid: number, docNo: string, now: Date): Promise<number> {
    const rules = await this.rules(tx);
    const points = pointsEarned(netPaid, rules);
    if (points <= 0) return 0;
    await this.repo.append(tx, { memberId, points, kind: 'earn', docNo, expiresAt: expiryDate(now, rules), at: now });
    return points;
  }

  /** Spends points against a bill: validates balance and cap, writes the ledger row, returns the value taken off (satang). */
  async redeem(tx: Tx, memberId: string, points: number, billNet: number, docNo: string, now: Date): Promise<number> {
    const value = redemptionValue(points, await this.repo.balance(tx, memberId), billNet, await this.rules(tx));
    if (points > 0) await this.repo.append(tx, { memberId, points: -points, kind: 'redeem', docNo, at: now });
    return value;
  }

  /** Checks a redemption without writing anything (the bill is validated before its number is issued). */
  async quoteRedemption(tx: Tx, memberId: string, points: number, billNet: number): Promise<number> {
    return redemptionValue(points, await this.repo.balance(tx, memberId), billNet, await this.rules(tx));
  }

  /** A void or refund takes back earned points and returns spent ones in proportion to the share refunded. */
  async adjustForCredit(tx: Tx, args: { memberId: string; kind: 'void' | 'refund'; creditDocNo: string; priorCreditDocNos: string[]; earned: number; redeemed: number; saleNet: number; refundedAfter: number; now: Date }): Promise<void> {
    const prior = await this.repo.pointsOfDocs(tx, args.memberId, args.priorCreditDocNos);
    const { claw, back } = refundAdjustment({ earned: args.earned, redeemed: args.redeemed, saleNet: args.saleNet, refundedAfter: args.refundedAfter }, prior);
    if (claw > 0) await this.repo.append(tx, { memberId: args.memberId, points: -claw, kind: args.kind, docNo: args.creditDocNo, at: args.now });
    if (back > 0) await this.repo.append(tx, { memberId: args.memberId, points: back, kind: args.kind, docNo: args.creditDocNo, at: args.now });
  }

  /** Writes an expiry row for each earn entry past its date, capped by what the member still has. */
  async expireDue(actor = 'system'): Promise<number> {
    const now = this.clock();
    return this.uow.run(async (tx) => {
      const due = await this.repo.dueEarnings(tx, now);
      let total = 0;
      for (const d of due) {
        const left = Math.max(0, Math.min(d.points, await this.repo.balance(tx, d.memberId)));
        // A zero row still marks the earn entry as handled.
        await this.repo.append(tx, { memberId: d.memberId, points: -left, kind: 'expire', sourceId: d.id, at: now });
        total += left;
      }
      if (due.length) await this.audit.record(tx, now, { actor, action: 'points.expire', after: { entries: due.length, points: total } });
      return total;
    });
  }

  async ledger(memberId: string) {
    return (await this.repo.ledger(this.uow.read, memberId)).map((r) => ({ points: r.points, kind: r.kind, docNo: r.docNo, at: iso(r.at) }));
  }
}
