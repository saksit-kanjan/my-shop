import { DEFAULT_PERMISSIONS, PERMISSIONS, type Permission, type Role } from '@my-shop/contracts';

export interface PermissionOverride {
  role: Role;
  permission: Permission;
  allowed: boolean;
}

/** The spec's matrix with the owner's per-cell overrides on top. */
export function resolveMatrix(overrides: PermissionOverride[]): Record<Role, Permission[]> {
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

export const isAllowed = (role: Role, permission: Permission, override: boolean | null): boolean => (override === null ? DEFAULT_PERMISSIONS[role].includes(permission) : override);

/** The owner keeps users.manage so one stray click cannot lock everyone out of the back office. */
export const isProtectedCell = (role: Role, permission: Permission, allowed: boolean): boolean => role === 'owner' && permission === 'users.manage' && !allowed;
