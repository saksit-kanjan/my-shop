import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_PERMISSIONS, PERMISSIONS, type Permission, type Role } from '@my-shop/contracts';
import { DB, type Queryable } from '../db/db';

/** The spec's matrix, with the owner's per-cell overrides on top. */
@Injectable()
export class PermissionService {
  constructor(
    @Inject(DB) private readonly db: Queryable,
  ) {}

  async matrix(q: Queryable = this.db): Promise<Record<Role, Permission[]>> {
    const overrides = await q.query<{ role: Role; permission: Permission; allowed: boolean }>(`SELECT role, permission, allowed FROM role_permissions`);
    const out = {} as Record<Role, Permission[]>;
    for (const role of Object.keys(DEFAULT_PERMISSIONS) as Role[]) {
      const set = new Set<Permission>(DEFAULT_PERMISSIONS[role]);
      for (const o of overrides.filter((x) => x.role === role)) {
        if (o.allowed) set.add(o.permission);
        else set.delete(o.permission);
      }
      out[role] = PERMISSIONS.filter((p) => set.has(p));
    }
    return out;
  }

  async can(role: Role, permission: Permission, q: Queryable = this.db): Promise<boolean> {
    const [o] = await q.query<{ allowed: boolean }>(`SELECT allowed FROM role_permissions WHERE role=$1 AND permission=$2`, [role, permission]);
    return o ? o.allowed : DEFAULT_PERMISSIONS[role].includes(permission);
  }

  async set(q: Queryable, role: Role, permission: Permission, allowed: boolean): Promise<void> {
    // The owner keeps users.manage so a stray click cannot lock everyone out of the back office.
    if (role === 'owner' && permission === 'users.manage' && !allowed) throw new Error('เจ้าของต้องมีสิทธิ์จัดการผู้ใช้เสมอ');
    await q.query(`INSERT INTO role_permissions (role, permission, allowed) VALUES ($1,$2,$3) ON CONFLICT (role, permission) DO UPDATE SET allowed=EXCLUDED.allowed`, [role, permission, allowed]);
  }
}
