import { Inject, Injectable } from '@nestjs/common';
import type { Employee, Permission } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { AuthService, toEmployee } from './auth.service';
import { afterFailure, lockedFor } from './login-attempts';
import { PermissionsService } from './permissions.service';

/**
 * "การขออนุมัติ": a supervisor types their own code at the till to approve something the cashier
 * may not do alone (CLAUDE.md rule 8). Wrong codes are counted per terminal like a login.
 */
@Injectable()
export class ApprovalsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly auth: AuthService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /**
   * Returns who approves, or throws. When `actor` already holds the permission no code is needed.
   * Runs in its own transaction BEFORE the caller's, so a wrong code is counted even when the caller then aborts.
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

  private async byCode(tx: Tx, code: string, terminalId: string, permission: Permission): Promise<Employee | DomainError> {
    const key = `approve:${terminalId}`;
    const now = this.clock();
    const state = await this.auth.attempt(tx, key);
    const wait = lockedFor(state, now);
    if (wait > 0) return new DomainError('locked', 'ใส่รหัสผิดหลายครั้ง รอสักครู่แล้วลองใหม่', { retryAfterSeconds: wait });
    const approver = await this.auth.employeeByCode(tx, String(code));
    if (!approver) {
      await this.auth.saveAttempt(tx, key, afterFailure(state, now));
      await this.audit.record(tx, now, { terminalId, action: 'approval.failed' });
      // 403, not 401: a wrong approver code must never look like an expired session to the till.
      return new DomainError('forbidden', 'รหัสอนุมัติไม่ถูกต้อง');
    }
    await this.auth.clearAttempt(tx, key);
    if (!(await this.permissions.can(approver.role, permission, tx))) return new DomainError('forbidden', 'รหัสนี้ไม่มีสิทธิ์อนุมัติรายการนี้', { needsApproval: permission });
    await this.audit.record(tx, now, { actor: approver.id, terminalId, action: 'approval.granted', after: { permission } });
    return toEmployee(approver);
  }
}
