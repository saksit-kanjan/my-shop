import { Injectable } from '@nestjs/common';
import type { Permission, Role } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import { IdentityRepository, type EmployeeRecord, type NewEmployee, type SessionRecord, type StaffRow } from '../domain/identity.repository';
import type { AttemptState } from '../domain/login-attempt.policy';
import type { PermissionOverride } from '../domain/permission-matrix';

const COLS = 'id, name, initials, role';

@Injectable()
export class PgIdentityRepository extends IdentityRepository {
  async employeeByCodeHash(tx: Tx, hash: string) {
    const [r] = await tx.query<EmployeeRecord>(`SELECT ${COLS} FROM employees WHERE code_hash=$1 AND active`, [hash]);
    return r ?? null;
  }

  async employeeById(tx: Tx, id: string) {
    const [r] = await tx.query<EmployeeRecord>(`SELECT ${COLS} FROM employees WHERE id=$1`, [id]);
    return r ?? null;
  }

  async credentialsByUsername(tx: Tx, username: string) {
    const [r] = await tx.query<EmployeeRecord & { password_hash: string | null }>(`SELECT ${COLS}, password_hash FROM employees WHERE lower(username)=lower($1) AND active`, [username]);
    return r ? { id: r.id, name: r.name, initials: r.initials, role: r.role, passwordHash: r.password_hash } : null;
  }

  async attempt(tx: Tx, key: string, lockRow: boolean): Promise<AttemptState | null> {
    const [r] = await tx.query<{ fails: number; locked_until: Date | null }>(`SELECT fails, locked_until FROM login_attempts WHERE terminal_id=$1${lockRow ? ' FOR UPDATE' : ''}`, [key]);
    return r ? { fails: r.fails, lockedUntil: r.locked_until } : null;
  }

  async saveAttempt(tx: Tx, key: string, s: AttemptState) {
    await tx.query(`INSERT INTO login_attempts (terminal_id, fails, locked_until) VALUES ($1,$2,$3) ON CONFLICT (terminal_id) DO UPDATE SET fails=EXCLUDED.fails, locked_until=EXCLUDED.locked_until`, [key, s.fails, s.lockedUntil]);
  }

  async clearAttempt(tx: Tx, key: string) {
    await tx.query(`DELETE FROM login_attempts WHERE terminal_id=$1`, [key]);
  }

  async insertSession(tx: Tx, token: string, employeeId: string, terminalId: string, now: Date) {
    await tx.query(`INSERT INTO sessions (token, employee_id, terminal_id, created_at, last_seen) VALUES ($1,$2,$3,$4,$4)`, [token, employeeId, terminalId, now]);
  }

  async sessionWithEmployee(tx: Tx, token: string): Promise<SessionRecord | null> {
    const [r] = await tx.query<EmployeeRecord & { terminal_id: string; last_seen: Date }>(
      `SELECT e.id, e.name, e.initials, e.role, s.terminal_id, s.last_seen FROM sessions s JOIN employees e ON e.id=s.employee_id WHERE s.token=$1 AND e.active`,
      [token],
    );
    return r ? { id: r.id, name: r.name, initials: r.initials, role: r.role, terminalId: r.terminal_id, lastSeen: r.last_seen } : null;
  }

  async touchSession(tx: Tx, token: string, now: Date) {
    await tx.query(`UPDATE sessions SET last_seen=$2 WHERE token=$1`, [token, now]);
  }

  async deleteSession(tx: Tx, token: string) {
    await tx.query(`DELETE FROM sessions WHERE token=$1`, [token]);
  }

  async deleteSessionsOf(tx: Tx, employeeId: string) {
    await tx.query(`DELETE FROM sessions WHERE employee_id=$1`, [employeeId]);
  }

  overrides(tx: Tx): Promise<PermissionOverride[]> {
    return tx.query<PermissionOverride>(`SELECT role, permission, allowed FROM role_permissions`);
  }

  async override(tx: Tx, role: Role, permission: Permission) {
    const [r] = await tx.query<{ allowed: boolean }>(`SELECT allowed FROM role_permissions WHERE role=$1 AND permission=$2`, [role, permission]);
    return r ? r.allowed : null;
  }

  async setOverride(tx: Tx, role: Role, permission: Permission, allowed: boolean) {
    await tx.query(`INSERT INTO role_permissions (role, permission, allowed) VALUES ($1,$2,$3) ON CONFLICT (role, permission) DO UPDATE SET allowed=EXCLUDED.allowed`, [role, permission, allowed]);
  }

  listStaff(tx: Tx): Promise<StaffRow[]> {
    return tx.query<StaffRow>(`SELECT ${COLS}, username, active FROM employees ORDER BY id`);
  }

  async staffForUpdate(tx: Tx, id: string) {
    const [r] = await tx.query<{ role: Role; active: boolean }>(`SELECT role, active FROM employees WHERE id=$1 FOR UPDATE`, [id]);
    return r ?? null;
  }

  async otherActiveOwners(tx: Tx, exceptId: string) {
    const [r] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM employees WHERE role='owner' AND active AND id<>$1`, [exceptId]);
    return r?.n ?? 0;
  }

  async codeTaken(tx: Tx, hash: string, exceptId?: string) {
    const [r] = await tx.query(`SELECT 1 FROM employees WHERE code_hash=$1 AND ($2::text IS NULL OR id<>$2)`, [hash, exceptId ?? null]);
    return !!r;
  }

  async usernameTaken(tx: Tx, username: string) {
    const [r] = await tx.query(`SELECT 1 FROM employees WHERE lower(username)=lower($1)`, [username]);
    return !!r;
  }

  async insertEmployee(tx: Tx, e: NewEmployee) {
    await tx.query(`INSERT INTO employees (id, code_hash, name, initials, role, username, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [e.id, e.codeHash, e.name, e.initials, e.role, e.username, e.passwordHash]);
  }

  async updateEmployee(tx: Tx, id: string, p: { name?: string; initials?: string; role?: Role; active?: boolean; codeHash?: string; passwordHash?: string; username?: string | null }) {
    const sets: string[] = [];
    const vals: unknown[] = [id];
    const add = (col: string, v: unknown) => {
      vals.push(v);
      sets.push(`${col}=$${vals.length}`);
    };
    if (p.name !== undefined) add('name', p.name);
    if (p.initials !== undefined) add('initials', p.initials);
    if (p.role !== undefined) add('role', p.role);
    if (p.active !== undefined) add('active', p.active);
    if (p.codeHash !== undefined) add('code_hash', p.codeHash);
    if (p.passwordHash !== undefined) add('password_hash', p.passwordHash);
    if (p.username !== undefined) add('username', p.username);
    if (sets.length) await tx.query(`UPDATE employees SET ${sets.join(', ')} WHERE id=$1`, vals);
  }
}
