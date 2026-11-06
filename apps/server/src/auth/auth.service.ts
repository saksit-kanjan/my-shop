import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Employee, Role } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { DomainError } from '../common/domain-error';
import { BACK_OFFICE_TERMINAL, type Session } from '../common/session';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';
import { CredentialsService } from './credentials.service';
import { LOCK_SECONDS, afterFailure, lockedFor, type AttemptState } from './login-attempts';

/** A till session ends after this long with no request. */
const IDLE_LOGOUT_MS = 8 * 3_600_000;

interface EmployeeRow {
  id: string;
  name: string;
  initials: string;
  role: Role;
}

/** The code is write-only: the API never sends it back. */
export const toEmployee = (r: EmployeeRow): Employee => ({ id: r.id, code: '', name: r.name, initials: r.initials, role: r.role });

/** Sign-in at the till (6-digit code) and in the back office (username and password), and the sessions that follow. */
@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly credentials: CredentialsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  /** Wrong-code counter for a key (a terminal, an approval dialog, a username). */
  async attempt(tx: Tx, key: string, lockRow = false): Promise<AttemptState | null> {
    const [r] = await tx.query<{ fails: number; locked_until: Date | null }>(`SELECT fails, locked_until FROM login_attempts WHERE terminal_id=$1${lockRow ? ' FOR UPDATE' : ''}`, [key]);
    return r ? { fails: r.fails, lockedUntil: r.locked_until } : null;
  }

  async saveAttempt(tx: Tx, key: string, s: AttemptState) {
    await tx.query(`INSERT INTO login_attempts (terminal_id, fails, locked_until) VALUES ($1,$2,$3) ON CONFLICT (terminal_id) DO UPDATE SET fails=EXCLUDED.fails, locked_until=EXCLUDED.locked_until`, [key, s.fails, s.lockedUntil]);
  }

  async clearAttempt(tx: Tx, key: string) {
    await tx.query(`DELETE FROM login_attempts WHERE terminal_id=$1`, [key]);
  }

  async employeeByCode(tx: Tx, code: string): Promise<EmployeeRow | null> {
    const [r] = await tx.query<EmployeeRow>(`SELECT id, name, initials, role FROM employees WHERE code_hash=$1 AND active`, [this.credentials.hashCode(code)]);
    return r ?? null;
  }

  private async createSession(tx: Tx, employeeId: string, terminalId: string, now: Date): Promise<string> {
    const token = randomBytes(24).toString('hex');
    await tx.query(`INSERT INTO sessions (token, employee_id, terminal_id, created_at, last_seen) VALUES ($1,$2,$3,$4,$4)`, [token, employeeId, terminalId, now]);
    return token;
  }

  async login(code: string, terminalId: string): Promise<Session> {
    const now = this.clock();
    if (!/^\d{6}$/.test(code)) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    // A wrong code must still be COUNTED, so the transaction commits and the error is thrown after it.
    const outcome = await this.db.transaction(async (tx): Promise<Session | DomainError> => {
      const state = await this.attempt(tx, terminalId, true);
      const wait = lockedFor(state, now);
      if (wait > 0) return new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${wait} วินาที`, { retryAfterSeconds: wait });
      const employee = await this.employeeByCode(tx, code);
      if (!employee) {
        const next = afterFailure(state, now);
        await this.saveAttempt(tx, terminalId, next);
        await this.audit.record(tx, now, { terminalId, action: 'login.failed' });
        return next.lockedUntil
          ? new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${LOCK_SECONDS} วินาที`, { retryAfterSeconds: LOCK_SECONDS })
          : new DomainError('unauthorized', 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง');
      }
      await this.clearAttempt(tx, terminalId);
      const token = await this.createSession(tx, employee.id, terminalId, now);
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
    const state = await this.attempt(this.db, key);
    const wait = lockedFor(state, now);
    if (wait > 0) throw new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${wait} วินาที`, { retryAfterSeconds: wait });
    const [staff] = await this.db.query<EmployeeRow & { password_hash: string | null }>(`SELECT id, name, initials, role, password_hash FROM employees WHERE lower(username)=lower($1) AND active`, [String(username)]);
    const ok = staff?.password_hash ? await this.credentials.verifyPassword(String(password), staff.password_hash) : false;
    if (!ok || !staff) {
      await this.db.transaction(async (tx) => {
        await this.saveAttempt(tx, key, afterFailure(state, now));
        await this.audit.record(tx, now, { terminalId: BACK_OFFICE_TERMINAL, action: 'login.failed', after: { username } });
      });
      throw new DomainError('unauthorized', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    const token = await this.db.transaction(async (tx) => {
      await this.clearAttempt(tx, key);
      const t = await this.createSession(tx, staff.id, BACK_OFFICE_TERMINAL, now);
      await this.audit.record(tx, now, { actor: staff.id, terminalId: BACK_OFFICE_TERMINAL, action: 'login' });
      return t;
    });
    return { token, terminalId: BACK_OFFICE_TERMINAL, employee: toEmployee(staff) };
  }

  /** Resolves a bearer token and refreshes its idle timer. Null when unknown or idle too long. */
  async authenticate(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    const now = this.clock();
    const [s] = await this.db.query<EmployeeRow & { terminal_id: string; last_seen: Date }>(
      `SELECT e.id, e.name, e.initials, e.role, s.terminal_id, s.last_seen FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=$1 AND e.active`,
      [token],
    );
    if (!s || now.getTime() - s.last_seen.getTime() > IDLE_LOGOUT_MS) return null;
    await this.db.query(`UPDATE sessions SET last_seen=$2 WHERE token=$1`, [token, now]);
    return { token, terminalId: s.terminal_id, employee: toEmployee(s) };
  }

  async logout(token: string): Promise<void> {
    const s = await this.authenticate(token);
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM sessions WHERE token=$1`, [token]);
      if (s) await this.audit.record(tx, this.clock(), { actor: s.employee.id, terminalId: s.terminalId, action: 'logout' });
    });
  }

  async findEmployee(id: string): Promise<Employee | null> {
    const [r] = await this.db.query<EmployeeRow>(`SELECT id, name, initials, role FROM employees WHERE id=$1`, [id]);
    return r ? toEmployee(r) : null;
  }

  hashCode(code: string): string {
    return this.credentials.hashCode(code);
  }
}
