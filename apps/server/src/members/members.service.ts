import { Inject, Injectable } from '@nestjs/common';
import { In, IsNull, Like } from 'typeorm';
import type { Member } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import { MemberEntity, PointsLedger } from './entities/members.entities';
import type { Tx } from '../database/database.types';
import { SettingsService } from '../settings/settings.service';
import { isValidPhone, normalizePhone } from './phone';
import { expiryDate, pointsEarned, redemptionValue, refundAdjustment, type PointsRules } from './points-policy';

const toMember = (r: MemberEntity, points: number): Member => ({ id: r.id, phone: r.phone ?? '', name: r.name, ...(r.birthday ? { birthday: String(r.birthday) } : {}), tier: r.tier, joinedAt: iso(r.joinedAt), points });

type LedgerKind = 'earn' | 'redeem' | 'refund' | 'void' | 'expire' | 'adjust';

/** Members, PDPA consent and the points ledger. Sales asks it to earn, redeem and adjust points; it knows nothing about bills. */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private async rules(tx: Tx): Promise<PointsRules> {
    const s = await this.settings.getAll(tx);
    return { earnSatang: s.pointsEarnSatang, valueSatang: s.pointsValueSatang, expiryMonths: s.pointsExpiryMonths };
  }

  /* ---------- members ---------- */

  async findByPhone(phone: string, tx: Tx = this.db.manager): Promise<Member | null> {
    const r = await tx.findOneBy(MemberEntity, { phone: normalizePhone(phone), anonymizedAt: IsNull() });
    return r ? toMember(r, await this.balance(tx, r.id)) : null;
  }

  async phoneOf(memberId: string, tx: Tx = this.db.manager): Promise<string | null> {
    return (await tx.findOneBy(MemberEntity, { id: memberId }))?.phone ?? null;
  }

  async search(term: string): Promise<Member[]> {
    const like = Like(`%${term.trim()}%`);
    const found = await this.db.manager.find(MemberEntity, { where: [{ anonymizedAt: IsNull(), phone: like }, { anonymizedAt: IsNull(), name: like }], order: { joinedAt: 'DESC' }, take: 100 });
    const balances = await this.balances(this.db.manager, found.map((m) => m.id));
    return found.map((m) => toMember(m, balances.get(m.id) ?? 0));
  }

  /** Register at the till. PDPA consent is required and its time is stored (spec). */
  async register(input: { phone: string; name: string; birthday?: string; consent: boolean }, actor: string, terminalId?: string): Promise<Member> {
    const phone = normalizePhone(input.phone ?? '');
    if (!isValidPhone(phone)) throw new DomainError('invalid', 'เบอร์โทรไม่ถูกต้อง ใส่เบอร์ 9-10 หลักที่ขึ้นต้นด้วย 0');
    if (!input.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อสมาชิก');
    if (input.consent !== true) throw new DomainError('invalid', 'ต้องได้รับความยินยอมเก็บข้อมูลจากลูกค้าก่อนสมัคร');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      if (await this.findByPhone(phone, tx)) throw new DomainError('conflict', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว');
      const id = crypto.randomUUID();
      await tx.insert(MemberEntity, { id, phone, name: input.name.trim(), birthday: input.birthday || null, joinedAt: now, pdpaConsentAt: now });
      await this.audit.record(tx, now, { actor, terminalId, action: 'member.register', entity: 'member', entityId: id });
      return (await this.findByPhone(phone, tx)) as Member;
    });
  }

  async update(id: string, patch: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.mustBeActive(tx, id);
      const changes: Partial<MemberEntity> = {};
      if (patch.name !== undefined) changes.name = patch.name.trim();
      if (patch.birthday !== undefined) changes.birthday = patch.birthday;
      if (patch.tier !== undefined) changes.tier = patch.tier;
      if (patch.tax !== undefined) changes.tax = patch.tax as object;
      if (Object.keys(changes).length) await tx.update(MemberEntity, { id }, changes);
      await this.audit.record(tx, this.clock(), { actor, action: 'member.update', entity: 'member', entityId: id, after: patch });
    });
  }

  /**
   * PDPA erasure: wipe the person, keep the bills. Sales point at the member id, not the phone,
   * so the closed documents stay untouched but no longer lead back to anyone.
   */
  async anonymize(id: string, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.mustBeActive(tx, id);
      await tx.update(MemberEntity, { id }, { phone: null, name: '(ลบตามคำขอ)', birthday: null, tax: null, pdpaConsentAt: null, anonymizedAt: this.clock() });
      await this.audit.record(tx, this.clock(), { actor, action: 'member.anonymize', entity: 'member', entityId: id });
    });
  }

  private async mustBeActive(tx: Tx, id: string) {
    if (!(await tx.existsBy(MemberEntity, { id, anonymizedAt: IsNull() }))) throw new DomainError('not_found', 'ไม่พบสมาชิก');
  }

  /* ---------- points, used by sales ---------- */

  async balance(tx: Tx, memberId: string): Promise<number> {
    return (await this.balances(tx, [memberId])).get(memberId) ?? 0;
  }

  private async balances(tx: Tx, memberIds: string[]): Promise<Map<string, number>> {
    if (memberIds.length === 0) return new Map();
    const sums = await tx.createQueryBuilder(PointsLedger, 'l').select('l.member_id', 'memberId').addSelect('SUM(l.points)', 'points').where('l.member_id IN (:...memberIds)', { memberIds }).groupBy('l.member_id').getRawMany<{ memberId: string; points: number }>();
    return new Map(sums.map((r) => [r.memberId, Number(r.points)]));
  }

  private async append(tx: Tx, e: { memberId: string; points: number; kind: LedgerKind; docNo?: string; sourceId?: number; expiresAt?: Date | null; at: Date }) {
    await tx.insert(PointsLedger, { memberId: e.memberId, points: e.points, kind: e.kind, docNo: e.docNo ?? null, sourceId: e.sourceId ?? null, expiresAt: e.expiresAt ?? null, at: e.at });
  }

  /** Points a bill earns, written inside the sale transaction. Returns the points. */
  async earn(tx: Tx, memberId: string, netPaid: number, docNo: string, now: Date): Promise<number> {
    const rules = await this.rules(tx);
    const points = pointsEarned(netPaid, rules);
    if (points <= 0) return 0;
    await this.append(tx, { memberId, points, kind: 'earn', docNo, expiresAt: expiryDate(now, rules), at: now });
    return points;
  }

  /** Checks a redemption without writing (the bill is validated before its number is issued). Returns the value taken off, in satang. */
  async quoteRedemption(tx: Tx, memberId: string, points: number, billNet: number): Promise<number> {
    return redemptionValue(points, await this.balance(tx, memberId), billNet, await this.rules(tx));
  }

  /** Spends points against a bill: validates balance and cap, writes the ledger row, returns the value taken off. */
  async redeem(tx: Tx, memberId: string, points: number, billNet: number, docNo: string, now: Date): Promise<number> {
    const value = await this.quoteRedemption(tx, memberId, points, billNet);
    if (points > 0) await this.append(tx, { memberId, points: -points, kind: 'redeem', docNo, at: now });
    return value;
  }

  /** A void or refund takes back earned points and returns spent ones in proportion to the share refunded. */
  async adjustForCredit(tx: Tx, a: { memberId: string; kind: 'void' | 'refund'; creditDocNo: string; priorCreditDocNos: string[]; earned: number; redeemed: number; saleNet: number; refundedAfter: number; now: Date }): Promise<void> {
    let prior = { clawed: 0, returned: 0 };
    if (a.priorCreditDocNos.length) {
      const entries = await tx.find(PointsLedger, { where: { memberId: a.memberId, docNo: In(a.priorCreditDocNos) }, select: { points: true } });
      prior = { clawed: entries.filter((e) => e.points < 0).reduce((n, e) => n + e.points, 0), returned: entries.filter((e) => e.points > 0).reduce((n, e) => n + e.points, 0) };
    }
    const { claw, back } = refundAdjustment({ earned: a.earned, redeemed: a.redeemed, saleNet: a.saleNet, refundedAfter: a.refundedAfter }, prior);
    if (claw > 0) await this.append(tx, { memberId: a.memberId, points: -claw, kind: a.kind, docNo: a.creditDocNo, at: a.now });
    if (back > 0) await this.append(tx, { memberId: a.memberId, points: back, kind: a.kind, docNo: a.creditDocNo, at: a.now });
  }

  /** Writes an expiry row for each earn entry past its date, capped by what the member still has. */
  async expireDue(actor = 'system'): Promise<number> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const due = await tx
        .createQueryBuilder(PointsLedger, 'e')
        .where(`e.kind = 'earn' AND e.expires_at IS NOT NULL AND e.expires_at <= :now`, { now })
        .andWhere((qb) => `NOT EXISTS ${qb.subQuery().select('1').from(PointsLedger, 'x').where(`x.kind = 'expire' AND x.source_id = e.id`).getQuery()}`)
        .orderBy('e.expires_at').addOrderBy('e.id')
        .getMany();
      let total = 0;
      for (const d of due) {
        const left = Math.max(0, Math.min(d.points, await this.balance(tx, d.memberId)));
        // A zero row still marks the earn entry as handled.
        await this.append(tx, { memberId: d.memberId, points: -left, kind: 'expire', sourceId: d.id, at: now });
        total += left;
      }
      if (due.length) await this.audit.record(tx, now, { actor, action: 'points.expire', after: { entries: due.length, points: total } });
      return total;
    });
  }

  async ledger(memberId: string) {
    const rows = await this.db.manager.find(PointsLedger, { where: { memberId }, order: { id: 'DESC' }, take: 200 });
    return rows.map((r) => ({ points: r.points, kind: r.kind, docNo: r.docNo, at: iso(r.at) }));
  }
}
