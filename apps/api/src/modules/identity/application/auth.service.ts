import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Employee } from '@my-shop/contracts';
import { AuditLog } from '../../../shared/audit/audit-log';
import { UnitOfWork } from '../../../shared/database/unit-of-work';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { DomainError } from '../../../shared/kernel/domain-error';
import { CodeHasher, PasswordHasher } from '../domain/credential-hasher';
import { IdentityRepository, toEmployee } from '../domain/identity.repository';
import { LOCK_SECONDS, afterFailure, lockedFor } from '../domain/login-attempt.policy';
import { BACK_OFFICE_TERMINAL, isIdle, type Session } from '../domain/session';

/** Sign-in at the till (6-digit code) and in the back office (username and password), and the sessions that follow. */
@Injectable()
export class AuthService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(IdentityRepository) private readonly repo: IdentityRepository,
    @Inject(CodeHasher) private readonly codes: CodeHasher,
    @Inject(PasswordHasher) private readonly passwords: PasswordHasher,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  hashCode(code: string): string {
    return this.codes.hash(code);
  }

  async login(code: string, terminalId: string): Promise<Session> {
    const now = this.clock();
    if (!/^\d{6}$/.test(code)) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    // A wrong code must still be COUNTED, so the transaction commits and the error is thrown after it.
    const outcome = await this.uow.run(async (tx): Promise<Session | DomainError> => {
      const attempt = await this.repo.attempt(tx, terminalId, true);
      const wait = lockedFor(attempt, now);
      if (wait > 0) return new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${wait} วินาที`, { retryAfterSeconds: wait });
      const employee = await this.repo.employeeByCodeHash(tx, this.codes.hash(code));
      if (!employee) {
        const next = afterFailure(attempt, now);
        await this.repo.saveAttempt(tx, terminalId, next);
        await this.audit.record(tx, now, { terminalId, action: 'login.failed' });
        return next.lockedUntil
          ? new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${LOCK_SECONDS} วินาที`, { retryAfterSeconds: LOCK_SECONDS })
          : new DomainError('unauthorized', 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง');
      }
      await this.repo.clearAttempt(tx, terminalId);
      const token = randomBytes(24).toString('hex');
      await this.repo.insertSession(tx, token, employee.id, terminalId, now);
      await this.audit.record(tx, now, { actor: employee.id, terminalId, action: 'login' });
      return { token, terminalId, employee: toEmployee(employee) };
    });
    if (outcome instanceof DomainError) throw outcome;
    return outcome;
  }

  /** Back-office sign-in. Wrong tries lock the username for 30 s too. */
  async loginBackOffice(username: string, password: string): Promise<Session> {
    const now = this.clock();
    const key = `bo:${String(username).toLowerCase()}`;
    const read = this.uow.read;
    const attempt = await this.repo.attempt(read, key, false);
    const wait = lockedFor(attempt, now);
    if (wait > 0) throw new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${wait} วินาที`, { retryAfterSeconds: wait });
    const staff = await this.repo.credentialsByUsername(read, String(username));
    const ok = staff?.passwordHash ? await this.passwords.verify(String(password), staff.passwordHash) : false;
    if (!ok || !staff) {
      await this.uow.run(async (tx) => {
        await this.repo.saveAttempt(tx, key, afterFailure(attempt, now));
        await this.audit.record(tx, now, { terminalId: BACK_OFFICE_TERMINAL, action: 'login.failed', after: { username } });
      });
      throw new DomainError('unauthorized', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const token = randomBytes(24).toString('hex');
    await this.uow.run(async (tx) => {
      await this.repo.clearAttempt(tx, key);
      await this.repo.insertSession(tx, token, staff.id, BACK_OFFICE_TERMINAL, now);
      await this.audit.record(tx, now, { actor: staff.id, terminalId: BACK_OFFICE_TERMINAL, action: 'login' });
    });
    return { token, terminalId: BACK_OFFICE_TERMINAL, employee: toEmployee(staff) };
  }

  /** Resolves a bearer token and refreshes its idle timer. Null when unknown or idle too long. */
  async authenticate(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    const now = this.clock();
    const s = await this.repo.sessionWithEmployee(this.uow.read, token);
    if (!s || isIdle(s.lastSeen, now)) return null;
    await this.repo.touchSession(this.uow.read, token, now);
    return { token, terminalId: s.terminalId, employee: toEmployee(s) };
  }

  async logout(token: string): Promise<void> {
    const s = await this.authenticate(token);
    await this.uow.run(async (tx) => {
      await this.repo.deleteSession(tx, token);
      if (s) await this.audit.record(tx, this.clock(), { actor: s.employee.id, terminalId: s.terminalId, action: 'logout' });
    });
  }

  async findEmployee(id: string): Promise<Employee | null> {
    const e = await this.repo.employeeById(this.uow.read, id);
    return e ? toEmployee(e) : null;
  }
}
