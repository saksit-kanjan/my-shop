import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { Member } from '@my-shop/contracts';
import { DB, type Db, type Queryable } from '../db/db';
import { DomainError } from '../errors';
import { audit } from './audit';
import { SettingsService } from './settings.service';
import { iso, type Clock } from './util';

interface MemberRow {
  id: string;
  phone: string | null;
  name: string;
  birthday: Date | string | null;
  tier: string;
  joined_at: Date;
  points: number | null;
}

const SELECT = `SELECT m.id, m.phone, m.name, m.birthday::text AS birthday, m.tier, m.joined_at,
  COALESCE((SELECT SUM(points) FROM points_ledger l WHERE l.member_id=m.id),0)::int AS points FROM members m`;

const normalizePhone = (p: string) => p.replace(/\D/g, '');

@Injectable()
export class MemberService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async findByPhone(phone: string, q: Queryable = this.db): Promise<Member | null> {
    const [row] = await q.query<MemberRow>(`${SELECT} WHERE m.phone=$1 AND m.anonymized_at IS NULL`, [normalizePhone(phone)]);
    return row ? toMember(row) : null;
  }

  async search(term: string): Promise<Member[]> {
    const like = `%${term.trim()}%`;
    const rows = await this.db.query<MemberRow>(`${SELECT} WHERE m.anonymized_at IS NULL AND (m.phone LIKE $1 OR m.name LIKE $1) ORDER BY m.joined_at DESC LIMIT 100`, [like]);
    return rows.map(toMember);
  }

  /** Register at the till. PDPA consent is required and its time is stored (spec). */
  async register(input: { phone: string; name: string; birthday?: string; consent: boolean }, actor: string, terminalId?: string): Promise<Member> {
    const phone = normalizePhone(input.phone ?? '');
    if (!/^0\d{8,9}$/.test(phone)) throw new DomainError('invalid', 'เบอร์โทรไม่ถูกต้อง ใส่เบอร์ 9-10 หลักที่ขึ้นต้นด้วย 0');
    if (!input.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อสมาชิก');
    if (input.consent !== true) throw new DomainError('invalid', 'ต้องได้รับความยินยอมเก็บข้อมูลจากลูกค้าก่อนสมัคร');
    const now = this.clock();
    return this.db.transaction(async (tx) => {
      if (await this.findByPhone(phone, tx)) throw new DomainError('conflict', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว');
      const id = crypto.randomUUID();
      await tx.query(`INSERT INTO members (id, phone, name, birthday, joined_at, pdpa_consent_at) VALUES ($1,$2,$3,$4,$5,$5)`, [id, phone, input.name.trim(), input.birthday || null, now]);
      await audit(tx, now, { actor, terminalId, action: 'member.register', entity: 'member', entityId: id });
      return (await this.findByPhone(phone, tx)) as Member;
    });
  }

  async update(id: string, patch: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [m] = await tx.query(`SELECT 1 FROM members WHERE id=$1 AND anonymized_at IS NULL`, [id]);
      if (!m) throw new DomainError('not_found', 'ไม่พบสมาชิก');
      if (patch.name !== undefined) await tx.query(`UPDATE members SET name=$2 WHERE id=$1`, [id, patch.name.trim()]);
      if (patch.birthday !== undefined) await tx.query(`UPDATE members SET birthday=$2 WHERE id=$1`, [id, patch.birthday]);
      if (patch.tier !== undefined) await tx.query(`UPDATE members SET tier=$2 WHERE id=$1`, [id, patch.tier]);
      if (patch.tax !== undefined) await tx.query(`UPDATE members SET tax=$2 WHERE id=$1`, [id, JSON.stringify(patch.tax)]);
      await audit(tx, this.clock(), { actor, action: 'member.update', entity: 'member', entityId: id, after: patch });
    });
  }

  /**
   * PDPA erasure: wipe the person, keep the bills. Sales point at the member id, not the phone,
   * so the closed documents stay untouched but no longer lead back to anyone.
   */
  async anonymize(id: string, actor: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [m] = await tx.query(`SELECT 1 FROM members WHERE id=$1 AND anonymized_at IS NULL`, [id]);
      if (!m) throw new DomainError('not_found', 'ไม่พบสมาชิก');
      await tx.query(`UPDATE members SET phone=NULL, name='(ลบตามคำขอ)', birthday=NULL, tax=NULL, pdpa_consent_at=NULL, anonymized_at=$2 WHERE id=$1`, [id, this.clock()]);
      await audit(tx, this.clock(), { actor, action: 'member.anonymize', entity: 'member', entityId: id });
    });
  }

  /** Earned points for a closed bill. Called inside the sale transaction. */
  async earn(tx: Queryable, memberId: string, net: number, docNo: string, now: Date): Promise<number> {
    const s = await this.settings.getAll(tx);
    const points = s.pointsEarnSatang > 0 ? Math.floor(net / s.pointsEarnSatang) : 0;
    if (points <= 0) return 0;
    const expires = s.pointsExpiryMonths > 0 ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + s.pointsExpiryMonths, now.getUTCDate())) : null;
    await tx.query(`INSERT INTO points_ledger (member_id, points, kind, doc_no, expires_at, at) VALUES ($1,$2,'earn',$3,$4,$5)`, [memberId, points, docNo, expires, now]);
    return points;
  }

  async balance(tx: Queryable, memberId: string): Promise<number> {
    const [r] = await tx.query<{ p: number }>(`SELECT COALESCE(SUM(points),0)::int AS p FROM points_ledger WHERE member_id=$1`, [memberId]);
    return r?.p ?? 0;
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
        await tx.query(`INSERT INTO points_ledger (member_id, points, kind, source_id, at) VALUES ($1,$2,'expire',$3,$4)`, [d.member_id, -left, d.id, now]);
        total += left;
      }
      if (due.length) await audit(tx, now, { actor, action: 'points.expire', after: { entries: due.length, points: total } });
      return total;
    });
  }

  async ledger(memberId: string) {
    const rows = await this.db.query<{ points: number; kind: string; doc_no: string | null; at: Date }>(`SELECT points, kind, doc_no, at FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 200`, [memberId]);
    return rows.map((r) => ({ points: r.points, kind: r.kind, docNo: r.doc_no, at: iso(r.at) }));
  }
}

function toMember(r: MemberRow): Member {
  return { id: r.id, phone: r.phone ?? '', name: r.name, ...(r.birthday ? { birthday: String(r.birthday) } : {}), tier: r.tier, joinedAt: iso(r.joined_at), points: r.points ?? 0 };
}
