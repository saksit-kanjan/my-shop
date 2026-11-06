import { Inject, Injectable } from '@nestjs/common';
import type { Employee, Role } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CredentialsService } from '../auth/credentials.service';
import { CLOCK, type Clock } from '../common/clock';
import { DomainError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';

export interface UserRow extends Employee {
  username?: string;
  active: boolean;
}

const ROLES: Role[] = ['cashier', 'supervisor', 'manager', 'owner'];

const initialsOf = (name: string): string => [...name.trim()].filter((c) => c !== ' ').slice(0, 2).join('') || '?';

/** Staff accounts: a till code for everyone, a username and password for those who use the back office. */
@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly credentials: CredentialsService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<UserRow[]> {
    const rows = await this.db.query<{ id: string; name: string; initials: string; role: Role; username: string | null; active: boolean }>(`SELECT id, name, initials, role, username, active FROM employees ORDER BY id`);
    return rows.map((r) => ({ id: r.id, code: '', name: r.name, initials: r.initials, role: r.role, active: r.active, ...(r.username ? { username: r.username } : {}) }));
  }

  /** `code` is the 6-digit till code; `username` + `password` give back-office access. */
  async create(input: { name: string; role: Role; code: string; username?: string; password?: string }, actor: string): Promise<UserRow> {
    if (!input.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อพนักงาน');
    if (!/^\d{6}$/.test(input.code ?? '')) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    if (input.username && (input.password ?? '').length < 8) throw new DomainError('invalid', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    const id = `E${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 10)}`;
    const passwordHash = input.password ? await this.credentials.hashPassword(input.password) : null;
    const codeHash = this.credentials.hashCode(input.code);
    await this.db.transaction(async (tx) => {
      if ((await tx.query(`SELECT 1 FROM employees WHERE code_hash=$1`, [codeHash])).length) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');
      if (input.username && (await tx.query(`SELECT 1 FROM employees WHERE lower(username)=lower($1)`, [input.username])).length) throw new DomainError('conflict', 'ชื่อผู้ใช้นี้มีคนใช้แล้ว');
      await tx.query(`INSERT INTO employees (id, code_hash, name, initials, role, username, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [id, codeHash, input.name.trim(), initialsOf(input.name), input.role, input.username || null, passwordHash]);
      await this.audit.record(tx, this.clock(), { actor, action: 'user.create', entity: 'employee', entityId: id, after: { name: input.name, role: input.role, username: input.username } });
    });
    return (await this.list()).find((u) => u.id === id) as UserRow;
  }

  async update(id: string, patch: { name?: string; role?: Role; active?: boolean; code?: string; password?: string; username?: string }, actor: string): Promise<void> {
    if (patch.role && !ROLES.includes(patch.role)) throw new DomainError('invalid', 'บทบาทไม่ถูกต้อง');
    if (patch.code !== undefined && !/^\d{6}$/.test(patch.code)) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    if (patch.password !== undefined && patch.password.length < 8) throw new DomainError('invalid', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    const passwordHash = patch.password ? await this.credentials.hashPassword(patch.password) : undefined;
    const codeHash = patch.code ? this.credentials.hashCode(patch.code) : undefined;
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.query<{ role: Role; active: boolean }>(`SELECT role, active FROM employees WHERE id=$1 FOR UPDATE`, [id]);
      if (!cur) throw new DomainError('not_found', 'ไม่พบผู้ใช้');
      const losesOwner = (patch.role && patch.role !== 'owner' && cur.role === 'owner') || (patch.active === false && cur.role === 'owner');
      if (losesOwner) {
        const [o] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM employees WHERE role='owner' AND active AND id<>$1`, [id]);
        if ((o?.n ?? 0) === 0) throw new DomainError('conflict', 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน');
      }
      if (codeHash && (await tx.query(`SELECT 1 FROM employees WHERE code_hash=$1 AND id<>$2`, [codeHash, id])).length) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');

      const sets: string[] = [];
      const vals: unknown[] = [id];
      const set = (col: string, v: unknown) => {
        vals.push(v);
        sets.push(`${col}=$${vals.length}`);
      };
      if (patch.name !== undefined) {
        set('name', patch.name.trim());
        set('initials', initialsOf(patch.name));
      }
      if (patch.role) set('role', patch.role);
      if (patch.active !== undefined) set('active', patch.active);
      if (codeHash) set('code_hash', codeHash);
      if (passwordHash) set('password_hash', passwordHash);
      if (patch.username !== undefined) set('username', patch.username || null);
      if (sets.length) await tx.query(`UPDATE employees SET ${sets.join(', ')} WHERE id=$1`, vals);
      if (patch.active === false) await tx.query(`DELETE FROM sessions WHERE employee_id=$1`, [id]);
      // Secrets are never written to the audit log, only that they changed.
      await this.audit.record(tx, this.clock(), { actor, action: 'user.update', entity: 'employee', entityId: id, before: cur, after: { ...patch, code: patch.code ? '(changed)' : undefined, password: patch.password ? '(changed)' : undefined } });
    });
  }
}
