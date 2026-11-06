import { Inject, Injectable } from '@nestjs/common';
import type { Employee, Role } from '@my-shop/contracts';
import { AuditLog } from '../../../shared/audit/audit-log';
import { UnitOfWork } from '../../../shared/database/unit-of-work';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { DomainError } from '../../../shared/kernel/domain-error';
import { CodeHasher, PasswordHasher } from '../domain/credential-hasher';
import { IdentityRepository } from '../domain/identity.repository';

export interface UserRow extends Employee {
  username?: string;
  active: boolean;
}

const ROLES: Role[] = ['cashier', 'supervisor', 'manager', 'owner'];

function initialsOf(name: string): string {
  const t = [...name.trim()].filter((c) => c !== ' ');
  return t.slice(0, 2).join('') || '?';
}

/** Staff accounts: till code for everyone, username and password for those who use the back office. */
@Injectable()
export class UserService {
  constructor(
    @Inject(UnitOfWork) private readonly uow: UnitOfWork,
    @Inject(IdentityRepository) private readonly repo: IdentityRepository,
    @Inject(CodeHasher) private readonly codes: CodeHasher,
    @Inject(PasswordHasher) private readonly passwords: PasswordHasher,
    @Inject(AuditLog) private readonly audit: AuditLog,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async list(): Promise<UserRow[]> {
    const rows = await this.repo.listStaff(this.uow.read);
    return rows.map((r) => ({ id: r.id, code: '', name: r.name, initials: r.initials, role: r.role, active: r.active, ...(r.username ? { username: r.username } : {}) }));
  }

  /** `code` is the 6-digit till code; `username` + `password` give back-office access (manager and owner). */
  async create(input: { name: string; role: Role; code: string; username?: string; password?: string }, actor: string): Promise<UserRow> {
    this.validate(input);
    const id = `E${String(Date.now()).slice(-7)}${Math.floor(Math.random() * 10)}`;
    const passwordHash = input.password ? await this.passwords.hash(input.password) : null;
    await this.uow.run(async (tx) => {
      if (await this.repo.codeTaken(tx, this.codes.hash(input.code))) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');
      if (input.username && (await this.repo.usernameTaken(tx, input.username))) throw new DomainError('conflict', 'ชื่อผู้ใช้นี้มีคนใช้แล้ว');
      await this.repo.insertEmployee(tx, { id, codeHash: this.codes.hash(input.code), name: input.name.trim(), initials: initialsOf(input.name), role: input.role, username: input.username || null, passwordHash });
      await this.audit.record(tx, this.clock(), { actor, action: 'user.create', entity: 'employee', entityId: id, after: { name: input.name, role: input.role, username: input.username } });
    });
    return (await this.list()).find((u) => u.id === id) as UserRow;
  }

  async update(id: string, patch: { name?: string; role?: Role; active?: boolean; code?: string; password?: string; username?: string }, actor: string): Promise<void> {
    if (patch.role && !ROLES.includes(patch.role)) throw new DomainError('invalid', 'บทบาทไม่ถูกต้อง');
    if (patch.code !== undefined && !/^\d{6}$/.test(patch.code)) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    if (patch.password !== undefined && patch.password.length < 8) throw new DomainError('invalid', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
    const passwordHash = patch.password ? await this.passwords.hash(patch.password) : undefined;
    await this.uow.run(async (tx) => {
      const cur = await this.repo.staffForUpdate(tx, id);
      if (!cur) throw new DomainError('not_found', 'ไม่พบผู้ใช้');
      const loosesOwner = (patch.role && patch.role !== 'owner' && cur.role === 'owner') || (patch.active === false && cur.role === 'owner');
      if (loosesOwner && (await this.repo.otherActiveOwners(tx, id)) === 0) throw new DomainError('conflict', 'ต้องมีเจ้าของที่ใช้งานอยู่อย่างน้อย 1 คน');
      if (patch.code && (await this.repo.codeTaken(tx, this.codes.hash(patch.code), id))) throw new DomainError('conflict', 'รหัสนี้มีคนใช้แล้ว เลือกรหัสอื่น');
      await this.repo.updateEmployee(tx, id, {
        ...(patch.name !== undefined ? { name: patch.name.trim(), initials: initialsOf(patch.name) } : {}),
        role: patch.role,
        active: patch.active,
        codeHash: patch.code ? this.codes.hash(patch.code) : undefined,
        passwordHash,
        username: patch.username !== undefined ? patch.username || null : undefined,
      });
      if (patch.active === false) await this.repo.deleteSessionsOf(tx, id);
      // Secrets are never written to the audit log, only that they changed.
      await this.audit.record(tx, this.clock(), { actor, action: 'user.update', entity: 'employee', entityId: id, before: cur, after: { ...patch, code: patch.code ? '(changed)' : undefined, password: patch.password ? '(changed)' : undefined } });
    });
  }

  private validate(i: { name: string; role: Role; code: string; username?: string; password?: string }) {
    if (!i.name?.trim()) throw new DomainError('invalid', 'ใส่ชื่อพนักงาน');
    if (!ROLES.includes(i.role)) throw new DomainError('invalid', 'บทบาทไม่ถูกต้อง');
    if (!/^\d{6}$/.test(i.code ?? '')) throw new DomainError('invalid', 'รหัสพนักงานต้องเป็นตัวเลข 6 หลัก');
    if (i.username && (i.password ?? '').length < 8) throw new DomainError('invalid', 'รหัสผ่านต้องยาวอย่างน้อย 8 ตัวอักษร');
  }
}
