import { Injectable } from '@nestjs/common';
import { In, IsNull, Like } from 'typeorm';
import { DatabaseService } from '../../database/database.service';
import { Member } from '../domain/member';
import { MemberRepository } from '../domain/member.repository';
import { MemberEntity, PointsLedger } from '../entities/members.entities';

@Injectable()
export class TypeOrmMemberRepository extends MemberRepository {
  constructor(private readonly db: DatabaseService) {
    super();
  }

  private async restoreAll(rows: MemberEntity[]): Promise<Member[]> {
    if (rows.length === 0) return [];
    const entries = await this.db.manager.find(PointsLedger, { where: { memberId: In(rows.map((r) => r.id)) }, order: { id: 'ASC' } });
    return rows.map((r) =>
      Member.restore({
        id: r.id, phone: r.phone, name: r.name, birthday: r.birthday, tier: r.tier, joinedAt: r.joinedAt, pdpaConsentAt: r.pdpaConsentAt, tax: r.tax as object | null, anonymizedAt: r.anonymizedAt,
        ledger: entries.filter((e) => e.memberId === r.id).map((e) => ({ id: e.id, points: e.points, kind: e.kind, docNo: e.docNo, sourceId: e.sourceId, expiresAt: e.expiresAt, at: e.at })),
      }),
    );
  }

  async findById(id: string) {
    const row = await this.db.manager.findOneBy(MemberEntity, { id });
    return (await this.restoreAll(row ? [row] : []))[0] ?? null;
  }

  async findByPhone(phone: string) {
    const row = await this.db.manager.findOneBy(MemberEntity, { phone, anonymizedAt: IsNull() });
    return (await this.restoreAll(row ? [row] : []))[0] ?? null;
  }

  async findWithDueExpiry(now: Date) {
    const due = await this.db.manager
      .createQueryBuilder(PointsLedger, 'e')
      .select('DISTINCT e.member_id', 'memberId')
      .where(`e.kind = 'earn' AND e.expires_at IS NOT NULL AND e.expires_at <= :now`, { now })
      .andWhere((qb) => `NOT EXISTS ${qb.subQuery().select('1').from(PointsLedger, 'x').where(`x.kind = 'expire' AND x.source_id = e.id`).getQuery()}`)
      .getRawMany<{ memberId: string }>();
    return this.restoreAll(await this.db.manager.findBy(MemberEntity, { id: In(due.map((d) => d.memberId)) }));
  }

  async search(term: string, limit: number) {
    const like = Like(`%${term.trim()}%`);
    const rows = await this.db.manager.find(MemberEntity, { where: [{ anonymizedAt: IsNull(), phone: like }, { anonymizedAt: IsNull(), name: like }], order: { joinedAt: 'DESC' }, take: limit });
    return this.restoreAll(rows);
  }

  async add(member: Member): Promise<void> {
    const s = member.snapshot();
    await this.db.manager.insert(MemberEntity, { id: s.id, phone: s.phone, name: s.name, birthday: s.birthday, tier: s.tier, joinedAt: s.joinedAt, pdpaConsentAt: s.pdpaConsentAt });
    await this.writeEntries(member);
  }

  async save(member: Member): Promise<void> {
    const s = member.snapshot();
    await this.db.manager.update(MemberEntity, { id: s.id }, { phone: s.phone, name: s.name, birthday: s.birthday, tier: s.tier, tax: s.tax, pdpaConsentAt: s.pdpaConsentAt, anonymizedAt: s.anonymizedAt });
    await this.writeEntries(member);
  }

  private async writeEntries(member: Member) {
    const entries = member.takeNewLedgerEntries();
    if (entries.length) await this.db.manager.insert(PointsLedger, entries.map((e) => ({ memberId: member.id, points: e.points, kind: e.kind, docNo: e.docNo, sourceId: e.sourceId, expiresAt: e.expiresAt, at: e.at })));
  }
}
