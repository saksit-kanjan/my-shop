import { Injectable } from '@nestjs/common';
import type { Member } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import { iso } from '../../../shared/kernel/dates';
import { MemberRepository, type LedgerEntry } from '../domain/member.repository';

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

@Injectable()
export class PgMemberRepository extends MemberRepository {
  async byPhone(tx: Tx, phone: string) {
    const [r] = await tx.query<Row>(`${SELECT} WHERE m.phone=$1 AND m.anonymized_at IS NULL`, [phone]);
    return r ? toMember(r) : null;
  }

  async phoneOf(tx: Tx, memberId: string) {
    const [r] = await tx.query<{ phone: string | null }>(`SELECT phone FROM members WHERE id=$1`, [memberId]);
    return r?.phone ?? null;
  }

  async search(tx: Tx, term: string) {
    const like = `%${term.trim()}%`;
    return (await tx.query<Row>(`${SELECT} WHERE m.anonymized_at IS NULL AND (m.phone LIKE $1 OR m.name LIKE $1) ORDER BY m.joined_at DESC LIMIT 100`, [like])).map(toMember);
  }

  async insert(tx: Tx, m: { id: string; phone: string; name: string; birthday: string | null; at: Date }) {
    await tx.query(`INSERT INTO members (id, phone, name, birthday, joined_at, pdpa_consent_at) VALUES ($1,$2,$3,$4,$5,$5)`, [m.id, m.phone, m.name, m.birthday, m.at]);
  }

  async isActive(tx: Tx, id: string) {
    return (await tx.query(`SELECT 1 FROM members WHERE id=$1 AND anonymized_at IS NULL`, [id])).length > 0;
  }

  async update(tx: Tx, id: string, p: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }) {
    if (p.name !== undefined) await tx.query(`UPDATE members SET name=$2 WHERE id=$1`, [id, p.name]);
    if (p.birthday !== undefined) await tx.query(`UPDATE members SET birthday=$2 WHERE id=$1`, [id, p.birthday]);
    if (p.tier !== undefined) await tx.query(`UPDATE members SET tier=$2 WHERE id=$1`, [id, p.tier]);
    if (p.tax !== undefined) await tx.query(`UPDATE members SET tax=$2 WHERE id=$1`, [id, JSON.stringify(p.tax)]);
  }

  async erase(tx: Tx, id: string, at: Date) {
    await tx.query(`UPDATE members SET phone=NULL, name='(ลบตามคำขอ)', birthday=NULL, tax=NULL, pdpa_consent_at=NULL, anonymized_at=$2 WHERE id=$1`, [id, at]);
  }

  async balance(tx: Tx, memberId: string) {
    const [r] = await tx.query<{ p: number }>(`SELECT COALESCE(SUM(points),0)::int AS p FROM points_ledger WHERE member_id=$1`, [memberId]);
    return r?.p ?? 0;
  }

  async append(tx: Tx, e: LedgerEntry) {
    await tx.query(`INSERT INTO points_ledger (member_id, points, kind, doc_no, source_id, expires_at, at) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [e.memberId, e.points, e.kind, e.docNo ?? null, e.sourceId ?? null, e.expiresAt ?? null, e.at]);
  }

  async pointsOfDocs(tx: Tx, memberId: string, docNos: string[]) {
    if (docNos.length === 0) return { clawed: 0, returned: 0 };
    const [r] = await tx.query<{ claw: number; back: number }>(
      `SELECT COALESCE(SUM(points) FILTER (WHERE points<0),0)::int AS claw, COALESCE(SUM(points) FILTER (WHERE points>0),0)::int AS back FROM points_ledger WHERE member_id=$1 AND doc_no = ANY($2)`,
      [memberId, docNos],
    );
    return { clawed: r?.claw ?? 0, returned: r?.back ?? 0 };
  }

  async dueEarnings(tx: Tx, now: Date) {
    const rows = await tx.query<{ id: number; member_id: string; points: number }>(
      `SELECT id, member_id, points FROM points_ledger e WHERE kind='earn' AND expires_at IS NOT NULL AND expires_at <= $1
         AND NOT EXISTS (SELECT 1 FROM points_ledger x WHERE x.kind='expire' AND x.source_id=e.id) ORDER BY expires_at, id`,
      [now],
    );
    return rows.map((r) => ({ id: r.id, memberId: r.member_id, points: r.points }));
  }

  ledger(tx: Tx, memberId: string) {
    return tx.query<{ points: number; kind: string; docNo: string | null; at: Date }>(`SELECT points, kind, doc_no AS "docNo", at FROM points_ledger WHERE member_id=$1 ORDER BY id DESC LIMIT 200`, [memberId]);
  }
}
