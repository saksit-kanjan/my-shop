import { Inject, Injectable } from '@nestjs/common';
import { CLOCK } from '../tokens';
import type { Employee, Role } from '@my-shop/contracts';
import { DB, type Db } from '../db/db';
import { DomainError } from '../errors';
import { audit } from './audit';
import { hashPassword, AuthService } from './auth.service';
import type { Clock } from './util';

export interface UserRow extends Employee {
  username?: string;
  active: boolean;
}

const ROLES: Role[] = ['cashier', 'supervisor', 'manager', 'owner'];

@Injectable()
export class UserService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<UserRow[]> {
    const rows = await this.db.query<{ id: string; name: string; initials: string; role: Role; username: string | null; active: boolean }>(`SELECT id, name, initials, role, username, active FROM employees ORDER BY id`);
    return rows.map((r) => ({ id: r.id, code: '', name: r.name, initials: r.initials, role: r.role, active: r.active, ...(r.username ? { username: r.username } : {}) }));
  }

  /** `code` is the 6-digit till code; `username` + `password` give back-office access (manager and owner). */
  async create(input: { name: string; role: Role; code: string; username?: string; password?: string }, actor: string): Promise<UserRow> {
    this.validate(input);
    const id = `E${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 10)}`;
    await this.db.transaction(async (tx) => {
      const [dup] = await tx.query(`SELECT 1 FROM employees WHERE code_hash=$1`, [this.auth.hashCode(input.code)]);
      if (dup) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');
      if (input.username) {
        const [u] = await tx.query(`SELECT 1 FROM employees WHERE lower(username)=lower($1)`, [input.username]);
        if (u) throw new DomainError('conflict', 'ชื่อผู้ใช้นี้มีคนใช้แล้ว');
      }
      await tx.query(`INSERT INTO employees (id, code_hash, name, initials, role, username, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [
        id, this.auth.hashCode(input.code), input.name.trim(), initialsOf(input.name), input.role, input.username || null, input.password ? await hashPassword(input.password) : null,
      ]);
      await audit(tx, this.clock(), { actor, action: 'user.create', entity: 'employee', entityId: id, after: { name: input.name, role: input.role, username: input.username } });
    });
    return (await this.list()).find((u) => u.id === id) as UserRow;
  }

  async update(id: string, patch: { name?: string; role?: Role; active?: boolean; code?: string; password?: string; username?: string }, actor: string): Promise<void> {
    if (patch.role && !ROLES.includes(patch.role)) throw new DomainError('invalid', 'บทบาทไม่ถูกต้อง');
    if (patch.code !== undefined && !/^\d{6}$/.test(patch.code)) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    if (patch.password !== undefined && patch.password.length < 8) throw new DomainError('invalid', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    await this.db.transaction(async (tx) => {
      const [cur] = await tx.query<{ role: Role; active: boolean }>(`SELECT role, active FROM employees WHERE id=$1 FOR UPDATE`, [id]);
      if (!cur) throw new DomainError('not_found', 'ไม่พบผู้ใช้');
      const demotes = (patch.role && patch.role !== 'owner' && cur.role === 'owner') || (patch.active === false && cur.role === 'owner');
      if (demotes) {
        const [o] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM employees WHERE role='owner' AND active AND id<>$1`, [id]);
        if ((o?.n ?? 0) === 0) throw new DomainError('conflict', 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน');
      }
      if (patch.name !== undefined) await tx.query(`UPDATE employees SET name=$2, initials=$3 WHERE id=$1`, [id, patch.name.trim(), initialsOf(patch.name)]);
      if (patch.role) await tx.query(`UPDATE employees SET role=$2 WHERE id=$1`, [id, patch.role]);
      if (patch.active !== undefined) {
        await tx.query(`UPDATE employees SET active=$2 WHERE id=$1`, [id, patch.active]);
        if (!patch.active) await tx.query(`DELETE FROM sessions WHERE employee_id=$1`, [id]);
      }
      if (patch.code) {
        const [dup] = await tx.query(`SELECT 1 FROM employees WHERE code_hash=$1 AND id<>$2`, [this.auth.hashCode(patch.code), id]);
        if (dup) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');
        await tx.query(`UPDATE employees SET code_hash=$2 WHERE id=$1`, [id, this.auth.hashCode(patch.code)]);
      }
      if (patch.password) await tx.query(`UPDATE employees SET password_hash=$2 WHERE id=$1`, [id, await hashPassword(patch.password)]);
      if (patch.username !== undefined) await tx.query(`UPDATE employees SET username=$2 WHERE id=$1`, [id, patch.username || null]);
      // Secrets are never written to the audit log, only that they changed.
      await audit(tx, this.clock(), { actor, action: 'user.update', entity: 'employee', entityId: id, before: cur, after: { ...patch, code: patch.code ? '(changed)' : undefined, password: patch.password ? '(changed)' : undefined } });
    });
  }

  private validate(i: { name: string; role: Role; code: string; username?: string; password?: string }) {
    if (!i.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อพนักงาน');
    if (!ROLES.includes(i.role)) throw new DomainError('invalid', 'บทบาทไม่ถูกต้อง');
    if (!/^\d{6}$/.test(i.code ?? '')) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    if (i.username && (i.password ?? '').length < 8) throw new DomainError('invalid', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  }
}

function initialsOf(name: string): string {
  const t = [...name.trim()].filter((c) => c !== ' ');
  return t.slice(0, 2).join('') || '?';
}
