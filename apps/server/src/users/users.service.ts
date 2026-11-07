import { Inject, Injectable } from '@nestjs/common';
import type { Employee, Role } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CredentialsService } from '../auth/credentials.service';
import { EmployeeEntity, SessionEntity } from '../auth/entities/auth.entities';
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
    const rows = await this.db.manager.find(EmployeeEntity, { order: { id: 'ASC' } });
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
      if (await tx.existsBy(EmployeeEntity, { codeHash })) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');
      if (input.username && (await tx.createQueryBuilder(EmployeeEntity, 'e').where('lower(e.username) = lower(:u)', { u: input.username }).getExists())) throw new DomainError('conflict', 'ชื่อผู้ใช้นี้มีคนใช้แล้ว');
      await tx.insert(EmployeeEntity, { id, codeHash, name: input.name.trim(), initials: initialsOf(input.name), role: input.role, username: input.username || null, passwordHash });
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
      const found = await tx.findOne(EmployeeEntity, { where: { id }, lock: { mode: 'pessimistic_write' } });
      if (!found) throw new DomainError('not_found', 'ไม่พบผู้ใช้');
      const cur = { role: found.role, active: found.active };
      const losesOwner = (patch.role && patch.role !== 'owner' && cur.role === 'owner') || (patch.active === false && cur.role === 'owner');
      if (losesOwner) {
        const others = await tx.createQueryBuilder(EmployeeEntity, 'e').where(`e.role = 'owner' AND e.active AND e.id <> :id`, { id }).getCount();
        if (others === 0) throw new DomainError('conflict', 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน');
      }
      if (codeHash && (await tx.createQueryBuilder(EmployeeEntity, 'e').where('e.code_hash = :codeHash AND e.id <> :id', { codeHash, id }).getExists())) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');

      const changes: Partial<EmployeeEntity> = {};
      if (patch.name !== undefined) {
        changes.name = patch.name.trim();
        changes.initials = initialsOf(patch.name);
      }
      if (patch.role) changes.role = patch.role;
      if (patch.active !== undefined) changes.active = patch.active;
      if (codeHash) changes.codeHash = codeHash;
      if (passwordHash) changes.passwordHash = passwordHash;
      if (patch.username !== undefined) changes.username = patch.username || null;
      if (Object.keys(changes).length) await tx.update(EmployeeEntity, { id }, changes);
      if (patch.active === false) await tx.delete(SessionEntity, { employeeId: id });
      // Secrets are never written to the audit log, only that they changed.
      await this.audit.record(tx, this.clock(), { actor, action: 'user.update', entity: 'employee', entityId: id, before: cur, after: { ...patch, code: patch.code ? '(changed)' : undefined, password: patch.password ? '(changed)' : undefined } });
    });
  }
}
