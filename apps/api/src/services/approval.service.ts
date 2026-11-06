import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { Employee, Permission } from '@my-shop/contracts';
import { DB, type Db, type Queryable } from '../db/db';
import { DomainError } from '../errors';
import { audit } from './audit';
import { LOCK_SECONDS, MAX_FAILS, AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import type { Clock } from './util';

/**
 * "การขออนุมัติ": a supervisor types their own code at the till to approve something the cashier
 * may not do alone (rule 8). Wrong codes are counted per terminal like a login.
 */
@Injectable()
export class ApprovalService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Returns who approves, or throws. When `actor` already holds the permission no code is needed.
   * Runs in its own transaction BEFORE the caller's, so a wrong code is counted even though the caller then aborts.
   */
  async resolve(args: { actor: Employee; permission: Permission; approverCode?: string; terminalId: string }): Promise<Employee> {
    if (await this.permissions.can(args.actor.role, args.permission)) return args.actor;
    if (!args.approverCode) throw new DomainError('forbidden', 'ต้องให้หัวหน้ากะใส่รหัสอนุมัติ', { needsApproval: args.permission });
    const out = await this.db.transaction((tx) => this.byCode(tx, args.approverCode as string, args.terminalId, args.permission));
    if (out instanceof DomainError) throw out;
    return out;
  }

  /** Stand-alone check for the approval dialog, so the till can say "ok" before the cashier finishes the form. */
  async check(actor: Employee, permission: Permission, approverCode: string, terminalId: string): Promise<{ approverId: string; name: string }> {
    const approver = await this.resolve({ actor, permission, approverCode, terminalId });
    return { approverId: approver.id, name: approver.name };
  }

  private async byCode(q: Queryable, code: string, terminalId: string, permission: Permission): Promise<Employee | DomainError> {
    const key = `approve:${terminalId}`;
    const now = this.clock();
    const [attempt] = await q.query<{ fails: number; locked_until: Date | null }>(`SELECT fails, locked_until FROM login_attempts WHERE terminal_id=$1`, [key]);
    if (attempt?.locked_until && attempt.locked_until > now) return new DomainError('locked', 'ใส่รหัสผิดหลายครั้ง รอสักครู่แล้วลองใหม่', { retryAfterSeconds: Math.ceil((attempt.locked_until.getTime() - now.getTime()) / 1000) });
    const [row] = await q.query<{ id: string; name: string; initials: string; role: Employee['role'] }>(`SELECT id, name, initials, role FROM employees WHERE code_hash=$1 AND active`, [this.auth.hashCode(String(code))]);
    if (!row) {
      const fails = (attempt && !(attempt.locked_until && attempt.locked_until <= now) ? attempt.fails : 0) + 1;
      await q.query(`INSERT INTO login_attempts (terminal_id, fails, locked_until) VALUES ($1,$2,$3) ON CONFLICT (terminal_id) DO UPDATE SET fails=EXCLUDED.fails, locked_until=EXCLUDED.locked_until`, [key, fails, fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_SECONDS * 1000) : null]);
      await audit(q, now, { terminalId, action: 'approval.failed' });
      // 403, not 401: a wrong approver code must never look like an expired session to the till.
      return new DomainError('forbidden', 'รหัสอนุมัติไม่ถูกต้อง');
    }
    await q.query(`DELETE FROM login_attempts WHERE terminal_id=$1`, [key]);
    if (!(await this.permissions.can(row.role, permission, q))) return new DomainError('forbidden', 'รหัสนี้ไม่มีสิทธิ์อนุมัติรายการนี้', { needsApproval: permission });
    await audit(q, now, { actor: row.id, terminalId, action: 'approval.granted', after: { permission } });
    return { id: row.id, code: '', name: row.name, initials: row.initials, role: row.role };
  }
}
