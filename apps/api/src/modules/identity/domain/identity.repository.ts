import type { Employee, Permission, Role } from '@my-shop/contracts';
import type { Tx } from '../../../shared/database/unit-of-work';
import type { AttemptState } from './login-attempt.policy';
import type { PermissionOverride } from './permission-matrix';

export interface EmployeeRecord {
  id: string;
  name: string;
  initials: string;
  role: Role;
}

export interface StaffRow extends EmployeeRecord {
  username: string | null;
  active: boolean;
}

export interface SessionRecord extends EmployeeRecord {
  terminalId: string;
  lastSeen: Date;
}

export interface NewEmployee {
  id: string;
  codeHash: string;
  name: string;
  initials: string;
  role: Role;
  username: string | null;
  passwordHash: string | null;
}

/** Port: how the identity context stores staff, sessions, lockout counters and permission overrides. */
export abstract class IdentityRepository {
  abstract employeeByCodeHash(tx: Tx, hash: string): Promise<EmployeeRecord | null>;
  abstract employeeById(tx: Tx, id: string): Promise<EmployeeRecord | null>;
  abstract credentialsByUsername(tx: Tx, username: string): Promise<(EmployeeRecord & { passwordHash: string | null }) | null>;

  abstract attempt(tx: Tx, key: string, lockRow: boolean): Promise<AttemptState | null>;
  abstract saveAttempt(tx: Tx, key: string, state: AttemptState): Promise<void>;
  abstract clearAttempt(tx: Tx, key: string): Promise<void>;

  abstract insertSession(tx: Tx, token: string, employeeId: string, terminalId: string, now: Date): Promise<void>;
  abstract sessionWithEmployee(tx: Tx, token: string): Promise<SessionRecord | null>;
  abstract touchSession(tx: Tx, token: string, now: Date): Promise<void>;
  abstract deleteSession(tx: Tx, token: string): Promise<void>;
  abstract deleteSessionsOf(tx: Tx, employeeId: string): Promise<void>;

  abstract overrides(tx: Tx): Promise<PermissionOverride[]>;
  abstract override(tx: Tx, role: Role, permission: Permission): Promise<boolean | null>;
  abstract setOverride(tx: Tx, role: Role, permission: Permission, allowed: boolean): Promise<void>;

  abstract listStaff(tx: Tx): Promise<StaffRow[]>;
  abstract staffForUpdate(tx: Tx, id: string): Promise<{ role: Role; active: boolean } | null>;
  abstract otherActiveOwners(tx: Tx, exceptId: string): Promise<number>;
  abstract codeTaken(tx: Tx, hash: string, exceptId?: string): Promise<boolean>;
  abstract usernameTaken(tx: Tx, username: string): Promise<boolean>;
  abstract insertEmployee(tx: Tx, e: NewEmployee): Promise<void>;
  abstract updateEmployee(tx: Tx, id: string, patch: { name?: string; initials?: string; role?: Role; active?: boolean; codeHash?: string; passwordHash?: string; username?: string | null }): Promise<void>;
}

export const toEmployee = (r: EmployeeRecord): Employee => ({ id: r.id, code: '', name: r.name, initials: r.initials, role: r.role });
