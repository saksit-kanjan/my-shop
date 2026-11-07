import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_PERMISSIONS, PERMISSIONS, type Permission, type Role } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { DomainError } from '../common/domain-error';
import { RolePermission } from './entities/auth.entities';
import { DatabaseService } from '../database/database.service';
import type { Tx } from '../database/database.types';

/** Who may do what: the spec's role matrix with the owner's per-cell overrides on top. */
@Injectable()
export class PermissionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async matrix(tx: Tx = this.db.manager): Promise<Record<Role, Permission[]>> {
    const overrides = await tx.find(RolePermission);
    const out = {} as Record<Role, Permission[]>;
    for (const role of Object.keys(DEFAULT_PERMISSIONS) as Role[]) {
      const set = new Set<Permission>(DEFAULT_PERMISSIONS[role]);
      for (const o of overrides.filter((x) => x.role === role)) {
        if (o.allowed) set.add(o.permission as Permission);
        else set.delete(o.permission as Permission);
      }
      out[role] = PERMISSIONS.filter((p) => set.has(p));
    }
    return out;
  }

  async can(role: Role, permission: Permission, tx: Tx = this.db.manager): Promise<boolean> {
    const o = await tx.findOneBy(RolePermission, { role, permission });
    return o ? o.allowed : DEFAULT_PERMISSIONS[role].includes(permission);
  }

  /** The owner's edit of one cell, audited. The owner always keeps users.manage so one stray click cannot lock everyone out. */
  async change(actor: string, role: Role, permission: Permission, allowed: boolean): Promise<void> {
    if (role === 'owner' && permission === 'users.manage' && !allowed) throw new DomainError('conflict', 'เจ้าของต้องมีสิทธิ์จัดการผู้ใช้เสมอ');
    await this.db.transaction(async (tx) => {
      await tx.save(RolePermission, { role, permission, allowed });
      await this.audit.record(tx, this.clock(), { actor, action: 'permission.set', after: { role, permission, allowed } });
    });
  }
}
