import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, SECRET } from '../tokens';
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { Employee } from '@my-shop/contracts';
import { DB, type Db } from '../db/db';
import { DomainError } from '../errors';
import { audit } from './audit';
import { iso, type Clock } from './util';

export const MAX_FAILS = 5;
export const LOCK_SECONDS = 30;
const IDLE_LOGOUT_MS = 8 * 3_600_000;
const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt, 32)).toString('hex')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'hex'), 32);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

export const BACK_OFFICE_TERMINAL = 'BO';

export interface Session {
  token: string;
  employee: Employee;
  terminalId: string;
}

interface EmployeeRow {
  id: string;
  name: string;
  initials: string;
  role: Employee['role'];
}

/**
 * Employee codes are secret 6-digit numbers (rule 8). They are stored as an HMAC keyed by a server
 * secret so the table never holds them in clear and a login is one indexed lookup. A 6-digit space is
 * small, so the real protection is the lockout below plus keeping the database private.
 */
@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(SECRET) private readonly secret: string,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  hashCode(code: string): string {
    return createHmac('sha256', this.secret).update(code).digest('hex');
  }

  async login(code: string, terminalId: string): Promise<Session> {
    const now = this.clock();
    if (!/^\d{6}$/.test(code)) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    // A wrong code must still be COUNTED, so the transaction commits and the error is thrown after it.
    const outcome = await this.db.transaction(async (tx): Promise<Session | DomainError> => {
      const [attempt] = await tx.query<{ fails: number; locked_until: Date | null }>(`SELECT fails, locked_until FROM login_attempts WHERE terminal_id=$1 FOR UPDATE`, [terminalId]);
      if (attempt?.locked_until && attempt.locked_until > now) {
        const wait = Math.ceil((attempt.locked_until.getTime() - now.getTime()) / 1000);
        return new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${wait} วินาที`, { retryAfterSeconds: wait });
      }
      const [row] = await tx.query<EmployeeRow>(`SELECT id, name, initials, role FROM employees WHERE code_hash=$1 AND active`, [this.hashCode(code)]);
      if (!row) {
        const fails = (attempt && !(attempt.locked_until && attempt.locked_until <= now) ? attempt.fails : 0) + 1;
        const lockedUntil = fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_SECONDS * 1000) : null;
        await tx.query(
          `INSERT INTO login_attempts (terminal_id, fails, locked_until) VALUES ($1,$2,$3)
           ON CONFLICT (terminal_id) DO UPDATE SET fails=EXCLUDED.fails, locked_until=EXCLUDED.locked_until`,
          [terminalId, fails, lockedUntil],
        );
        await audit(tx, now, { terminalId, action: 'login.failed' });
        return lockedUntil
          ? new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${LOCK_SECONDS} วินาที`, { retryAfterSeconds: LOCK_SECONDS })
          : new DomainError('unauthorized', 'รหัสไม่ถูกต้อง ลองใหม่อีกครั้ง');
      }
      await tx.query(`DELETE FROM login_attempts WHERE terminal_id=$1`, [terminalId]);
      const token = randomBytes(24).toString('hex');
      await tx.query(`INSERT INTO sessions (token, employee_id, terminal_id, created_at, last_seen) VALUES ($1,$2,$3,$4,$4)`, [token, row.id, terminalId, now]);
      await audit(tx, now, { actor: row.id, terminalId, action: 'login' });
      return { token, terminalId, employee: toEmployee(row) };
    });
    if (outcome instanceof DomainError) throw outcome;
    return outcome;
  }

  /** Back-office sign-in: username and password (the till uses the 6-digit code). Wrong tries lock the username for 30 s too. */
  async loginBackOffice(username: string, password: string): Promise<Session> {
    const now = this.clock();
    const key = `bo:${String(username).toLowerCase()}`;
    const bad = new DomainError('unauthorized', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    const [lock] = await this.db.query<{ fails: number; locked_until: Date | null }>(`SELECT fails, locked_until FROM login_attempts WHERE terminal_id=$1`, [key]);
    if (lock?.locked_until && lock.locked_until > now) {
      const wait = Math.ceil((lock.locked_until.getTime() - now.getTime()) / 1000);
      throw new DomainError('locked', `ใส่รหัสผิดหลายครั้ง รออีก ${wait} วินาที`, { retryAfterSeconds: wait });
    }
    const [row] = await this.db.query<EmployeeRow & { password_hash: string | null }>(`SELECT id, name, initials, role, password_hash FROM employees WHERE lower(username)=lower($1) AND active`, [String(username)]);
    const ok = row?.password_hash ? await verifyPassword(String(password), row.password_hash) : false;
    if (!ok || !row) {
      const fails = (lock && !(lock.locked_until && lock.locked_until <= now) ? lock.fails : 0) + 1;
      await this.db.transaction(async (tx) => {
        await tx.query(`INSERT INTO login_attempts (terminal_id, fails, locked_until) VALUES ($1,$2,$3) ON CONFLICT (terminal_id) DO UPDATE SET fails=EXCLUDED.fails, locked_until=EXCLUDED.locked_until`, [key, fails, fails >= MAX_FAILS ? new Date(now.getTime() + LOCK_SECONDS * 1000) : null]);
        await audit(tx, now, { terminalId: BACK_OFFICE_TERMINAL, action: 'login.failed', after: { username } });
      });
      throw bad;
    }
    const token = randomBytes(24).toString('hex');
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM login_attempts WHERE terminal_id=$1`, [key]);
      await tx.query(`INSERT INTO sessions (token, employee_id, terminal_id, created_at, last_seen) VALUES ($1,$2,$3,$4,$4)`, [token, row.id, BACK_OFFICE_TERMINAL, now]);
      await audit(tx, now, { actor: row.id, terminalId: BACK_OFFICE_TERMINAL, action: 'login' });
    });
    return { token, terminalId: BACK_OFFICE_TERMINAL, employee: toEmployee(row) };
  }

  /** Resolves a bearer token, refreshing its idle timer. Null when unknown or idle too long. */
  async authenticate(token: string | undefined): Promise<Session | null> {
    if (!token) return null;
    const now = this.clock();
    const [row] = await this.db.query<EmployeeRow & { terminal_id: string; last_seen: Date }>(
      `SELECT e.id, e.name, e.initials, e.role, s.terminal_id, s.last_seen FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=$1 AND e.active`,
      [token],
    );
    if (!row || now.getTime() - row.last_seen.getTime() > IDLE_LOGOUT_MS) return null;
    await this.db.query(`UPDATE sessions SET last_seen=$2 WHERE token=$1`, [token, now]);
    return { token, terminalId: row.terminal_id, employee: toEmployee(row) };
  }

  async logout(token: string): Promise<void> {
    const s = await this.authenticate(token);
    await this.db.transaction(async (tx) => {
      await tx.query(`DELETE FROM sessions WHERE token=$1`, [token]);
      if (s) await audit(tx, this.clock(), { actor: s.employee.id, terminalId: s.terminalId, action: 'logout' });
    });
  }

  async findEmployee(id: string): Promise<Employee | null> {
    const [row] = await this.db.query<EmployeeRow>(`SELECT id, name, initials, role FROM employees WHERE id=$1`, [id]);
    return row ? toEmployee(row) : null;
  }
}

function toEmployee(r: EmployeeRow): Employee {
  // `code` is write-only: the API never sends it back.
  return { id: r.id, code: '', name: r.name, initials: r.initials, role: r.role };
}

export { iso };
