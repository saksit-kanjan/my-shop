import { DomainError } from '../../common/domain-error';
import { isValidPhone, normalizePhone } from '../phone';
import { expiryDate, pointsEarned, redemptionValue, refundAdjustment, type PointsRules } from '../points-policy';

export type LedgerKind = 'earn' | 'redeem' | 'refund' | 'void' | 'expire' | 'adjust';

export interface LedgerEntry {
  /** Absent until the repository has stored it. */
  id?: number;
  points: number;
  kind: LedgerKind;
  docNo: string | null;
  sourceId: number | null;
  expiresAt: Date | null;
  at: Date;
}

export interface MemberState {
  id: string;
  phone: string | null;
  name: string;
  birthday: string | null;
  tier: string;
  joinedAt: Date;
  pdpaConsentAt: Date | null;
  tax: object | null;
  anonymizedAt: Date | null;
  ledger: LedgerEntry[];
}

/**
 * Aggregate root: a person in the loyalty programme and their points ledger. Points are only ever added as ledger rows, so the
 * balance is the sum of the rows; an erased member (PDPA) keeps the rows but no longer leads back to anyone.
 */
export class Member {
  private pending: LedgerEntry[] = [];

  private constructor(private readonly state: MemberState) {}

  /** Registration needs a valid phone, a name and the customer's PDPA consent, whose time is stored (spec). */
  static register(input: { id: string; phone: string; name: string; birthday?: string; consent: boolean; now: Date }): Member {
    const phone = normalizePhone(input.phone ?? '');
    if (!isValidPhone(phone)) throw new DomainError('invalid', 'เบอร์โทรไม่ถูกต้อง ใส่เบอร์ 9-10 หลักที่ขึ้นต้นด้วย 0');
    if (!input.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อสมาชิก');
    if (input.consent !== true) throw new DomainError('invalid', 'ต้องได้รับความยินยอมเก็บข้อมูลจากลูกค้าก่อนสมัคร');
    return new Member({ id: input.id, phone, name: input.name.trim(), birthday: input.birthday || null, tier: 'Standard', joinedAt: input.now, pdpaConsentAt: input.now, tax: null, anonymizedAt: null, ledger: [] });
  }

  static restore(state: MemberState): Member {
    return new Member({ ...state, ledger: [...state.ledger] });
  }

  get id() { return this.state.id; }
  get phone() { return this.state.phone; }
  get isActive() { return this.state.anonymizedAt === null; }

  snapshot(): Readonly<MemberState> {
    return this.state;
  }

  takeNewLedgerEntries(): LedgerEntry[] {
    const entries = this.pending;
    this.pending = [];
    return entries;
  }

  get balance(): number {
    return this.state.ledger.reduce((n, e) => n + e.points, 0);
  }

  private assertActive() {
    if (!this.isActive) throw new DomainError('not_found', 'ไม่พบสมาชิก');
  }

  update(patch: { name?: string; birthday?: string | null; tier?: string; tax?: object }): void {
    this.assertActive();
    if (patch.name !== undefined) this.state.name = patch.name.trim();
    if (patch.birthday !== undefined) this.state.birthday = patch.birthday;
    if (patch.tier !== undefined) this.state.tier = patch.tier;
    if (patch.tax !== undefined) this.state.tax = patch.tax;
  }

  /** PDPA erasure: wipe the person, keep the points rows (and so the bills' links by id). */
  anonymize(now: Date): void {
    this.assertActive();
    Object.assign(this.state, { phone: null, name: '(ลบตามคำขอ)', birthday: null, tax: null, pdpaConsentAt: null, anonymizedAt: now });
  }

  /* ---------- points ---------- */

  private append(entry: Omit<LedgerEntry, 'docNo' | 'sourceId' | 'expiresAt'> & Partial<Pick<LedgerEntry, 'docNo' | 'sourceId' | 'expiresAt'>>) {
    const full: LedgerEntry = { docNo: null, sourceId: null, expiresAt: null, ...entry };
    this.state.ledger.push(full);
    this.pending.push(full);
  }

  /** Points a bill earns. Returns the points (0 writes nothing). */
  earn(netPaid: number, docNo: string, rules: PointsRules, now: Date): number {
    const points = pointsEarned(netPaid, rules);
    if (points > 0) this.append({ points, kind: 'earn', docNo, expiresAt: expiryDate(now, rules), at: now });
    return points;
  }

  /** What `points` are worth against a bill of `billNet`; throws when the balance or the bill cannot cover it. Writes nothing. */
  quoteRedemption(points: number, billNet: number, rules: PointsRules): number {
    return redemptionValue(points, this.balance, billNet, rules);
  }

  redeem(points: number, billNet: number, docNo: string, rules: PointsRules, now: Date): number {
    const value = this.quoteRedemption(points, billNet, rules);
    if (points > 0) this.append({ points: -points, kind: 'redeem', docNo, at: now });
    return value;
  }

  /** A void or refund takes back earned points and returns spent ones in proportion to the share refunded (cumulative over credit notes). */
  adjustForCredit(a: { kind: 'void' | 'refund'; creditDocNo: string; priorCreditDocNos: string[]; earned: number; redeemed: number; saleNet: number; refundedAfter: number; now: Date }): void {
    const prior = this.state.ledger.filter((e) => e.docNo !== null && a.priorCreditDocNos.includes(e.docNo));
    const { claw, back } = refundAdjustment(
      { earned: a.earned, redeemed: a.redeemed, saleNet: a.saleNet, refundedAfter: a.refundedAfter },
      { clawed: prior.filter((e) => e.points < 0).reduce((n, e) => n + e.points, 0), returned: prior.filter((e) => e.points > 0).reduce((n, e) => n + e.points, 0) },
    );
    if (claw > 0) this.append({ points: -claw, kind: a.kind, docNo: a.creditDocNo, at: a.now });
    if (back > 0) this.append({ points: back, kind: a.kind, docNo: a.creditDocNo, at: a.now });
  }

  /** Expires each earn row past its date, capped by what the member still has. Returns the points removed. */
  expireDue(now: Date): number {
    const handled = new Set(this.state.ledger.filter((e) => e.kind === 'expire').map((e) => e.sourceId));
    const due = this.state.ledger.filter((e) => e.kind === 'earn' && e.id !== undefined && e.expiresAt !== null && e.expiresAt <= now && !handled.has(e.id));
    let total = 0;
    for (const d of due) {
      const left = Math.max(0, Math.min(d.points, this.balance));
      // A zero row still marks the earn entry as handled.
      this.append({ points: -left, kind: 'expire', sourceId: d.id as number, at: now });
      total += left;
    }
    return total;
  }
}
