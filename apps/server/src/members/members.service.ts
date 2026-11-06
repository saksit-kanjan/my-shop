import { Inject, Injectable } from '@nestjs/common';
import type { Member } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { iso } from '../common/dates';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { SettingsService } from '../settings/settings.service';
import { isValidPhone, normalizePhone } from './phone';
import { expiryDate, pointsEarned, redemptionValue, refundAdjustment, type PointsRules } from './points-policy';

interface Row {
  id: string;
  phone: string | null;
  name: string;
  birthday: string | null;
  tier: string;
  joined_at: Date;
  points: number | null;
}

const SELECT = `SELECT m.id, m.phone, m.name, m.birthday::text AS birthday, m.tier, m.joined_at,
  COALESCE((SELECT SUM(points) FROM points_ledger l WHERE l.member_id=m.id),0)::int AS points FROM members m`;

const toMember = (r: Row): Member => ({ id: r.id, phone: r.phone ?? '', name: r.name, ...(r.birthday ? { birthday: String(r.birthday) } : {}), tier: r.tier, joinedAt: iso(r.joined_at), points: r.points ?? 0 });

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

  async findByPhone(phone: string, tx: Tx = this.db): Promise<Member | null> {
    const [r] = await tx.query<Row>(`${SELECT} WHERE m.phone=$1 AND m.anonymized_at IS NULL`, [normalizePhone(phone)]);
    return r ? toMember(r) : null;
  }

  async phoneOf(memberId: string, tx: Tx = this.db): Promise<string | null> {
    const [r] = await tx.query<{ phone: string | null }>(`SELECT phone FROM members WHERE id=$1`, [memberId]);
    return r?.phone ?? null;
  }

  async search(term: string): Promise<Member[]> {
    const like = `%${term.trim()}%`;
    return (await this.db.query<Row>(`${SELECT} WHERE m.anonymized_at IS NULL AND (m.phone LIKE $1 OR m.name LIKE $1) ORDER BY m.joined_at DESC LIMIT 100`, [like])).map(toMember);
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
      await tx.query(`INSERT INTO members (id, phone, name, birthday, joined_at, pdpa_consent_at) VALUES ($1,$2,$3,$4,$5,$5)`, [id, phone, input.name.trim(), input.birthday || null, now]);
      await this.audit.record(tx, now, { actor, terminalId, action: 'member.register', entity: 'member', entityId: id });
      return (await this.findByPhone(phone, tx)) as Member;
    });
  }

  async update(id: string, patch: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await this.mustBeActive(tx, id);
      if (patch.name !== undefined) await tx.query(`UPDATE members SET name=$2 WHERE id=$1`, [id, patch.name.trim()]);
      if (patch.birthday !== undefined) await tx.query(`UPDATE members SET birthday=$2 WHERE id=$1`, [id, patch.birthday]);
      if (patch.tier !== undefined) await tx.query(`UPDATE members SET tier=$2 WHERE id=$1`, [id, patch.tier]);
      if (patch.tax !== undefined) await tx.query(`UPDATE members SET tax=$2 WHERE id=$1`, [id, JSON.stringify(patch.tax)]);
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
      await tx.query(`UPDATE members SET phone=NULL, name='(ลบตามคำขอ)', birthday=NULL, tax=NULL, pdpa_consent_at=NULL, anonymized_at=$2 WHERE id=$1`, [id, this.clock()]);
      await this.audit.record(tx, this.clock(), { actor, action: 'member.anonymize', entity: 'member', entityId: id });
    });
  }

  private async mustBeActive(tx: Tx, id: string) {
    if (!(await tx.query(`SELECT 1 FROM members WHERE id=$1 AND anonymized_at IS NULL`, [id])).length) throw new DomainError('not_found', 'ไม่พบสมาชิก');
  }

  /* ---------- points, used by sales ---------- */

  async balance(tx: Tx, memberId: string): Promise<number> {
    const [r] = await tx.query<{ p: number }>(`SELECT COALESCE(SUM(points),0)::int AS p FROM points_ledger WHERE member_id=$1`, [memberId]);
    return r?.p ?? 0;
  }

  private async append(tx: Tx, e: { memberId: string; points: number; kind: LedgerKind; docNo?: string; sourceId?: number; expiresAt?: Date | null; at: Date }) {
    await tx.query(`INSERT INTO points_ledger (member_id, points, kind, doc_no, source_id, expires_at, at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [e.memberId, e.points, e.kind, e.docNo ?? null, e.sourceId ?? null, e.expiresAt ?? null, e.at]);
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
      const [r] = await tx.query<{ claw: number; back: number }>(
        `SELECT COALESCE(SUM(points) FILTER (WHERE points<0),0)::int AS claw, COALESCE(SUM(points) FILTER (WHERE points>0),0)::int AS back FROM points_ledger WHERE member_id=$1 AND doc_no = ANY($2)`,
        [a.memberId, a.priorCreditDocNos],
      );
      prior = { clawed: r?.claw ?? 0, returned: r?.back ?? 0 };
    }
    const { claw, back } = refundAdjustment({ earned: a.earned, redeemed: a.redeemed, saleNet: a.saleNet, refundedAfter: a.refundedAfter }, prior);
    if (claw > 0) await this.append(tx, { memberId: a.memberId, points: -claw, kind: a.kind, docNo: a.creditDocNo, at: a.now });
    if (back > 0) await this.append(tx, { memberId: a.memberId, points: back, kind: a.kind, docNo: a.creditDocNo, at: a.now });
  }

  /** Writes an expiry row for each earn entry past its date, capped by what the member still has. */
  async expireDue(actor = 'system'): Promise<number> {
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      const due = await tx.query<{ id: number; member_id: string; points: number }>(
        `SELECT id, member_id, points FROM points_ledger e WHERE kind='earn' AND expires_at IS NOT NULL AND expires_at <= $1
           AND NOT EXISTS (SELECT 1 FROM points_ledger x WHERE x.kind='expire' AND x.source_id=e.id) ORDER BY expires_at, id`,
        [now],
      );
      let total = 0;
      for (const d of due) {
        const left = Math.max(0, Math.min(d.points, await this.balance(tx, d.member_id)));
        // A zero row still marks the earn entry as handled.
        await this.append(tx, { memberId: d.member_id, points: -left, kind: 'expire', sourceId: d.id, at: now });
        total += left;
      }
      if (due.length) await this.audit.record(tx, now, { actor, action: 'points.expire', after: { entries: due.length, points: total } });
      return total;
    });
  }

  async ledger(memberId: string) {
    const rows = await this.db.query<{ points: number; kind: string; doc_no: string | null; at: Date }>(`SELECT points, kind, doc_no, at FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 200`, [memberId]);
    return rows.map((r) => ({ points: r.points, kind: r.kind, docNo: r.doc_no, at: iso(r.at) }));
  }
}
