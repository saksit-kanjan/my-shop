import { Inject, Injectable } from '@nestjs/common';
import type { Employee, Permission } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork, type Tx } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { DomainError } from '../common/errors/domain-error';
import { CodeHasher } from './providers/credential-hasher';
import { IdentityRepository, toEmployee } from './repositories/identity.repository';
import { afterFailure, lockedFor } from './policies/login-attempt.policy';
import { PermissionService } from './permission.service';

/**
 * "การขออนุมัติ": a supervisor types their own code at the till to approve something the cashier
 * may not do alone (rule 8). Wrong codes are counted per terminal like a login.
 */
@Injectable()
export class ApprovalService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: IdentityRepository,
    private readonly codes: CodeHasher,
    private readonly permissions: PermissionService,
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
    const out = await this.uow.run((tx) => this.byCode(tx, args.approverCode as string, args.terminalId, args.permission));
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
    const attempt = await this.repo.attempt(tx, key, false);
    const wait = lockedFor(attempt, now);
    if (wait > 0) return new DomainError('locked', 'ใส่รหัสผิดหลายครั้ง รอสักครู่แล้วลองใหม่', { retryAfterSeconds: wait });
    const approver = await this.repo.employeeByCodeHash(tx, this.codes.hash(String(code)));
    if (!approver) {
      await this.repo.saveAttempt(tx, key, afterFailure(attempt, now));
      await this.audit.record(tx, now, { terminalId, action: 'approval.failed' });
      // 403, not 401: a wrong approver code must never look like an expired session to the till.
      return new DomainError('forbidden', 'รหัสอนุมัติไม่ถูกต้อง');
    }
    await this.repo.clearAttempt(tx, key);
    if (!(await this.permissions.can(approver.role, permission, tx))) return new DomainError('forbidden', 'รหัสนี้ไม่มีสิทธิ์อนุมัติรายการนี้', { needsApproval: permission });
    await this.audit.record(tx, now, { actor: approver.id, terminalId, action: 'approval.granted', after: { permission } });
    return toEmployee(approver);
  }
}
