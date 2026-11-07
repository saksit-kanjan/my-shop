import { Column, Entity, PrimaryColumn } from 'typeorm';

export type Role = 'cashier' | 'supervisor' | 'manager' | 'owner';

@Entity('employees')
export class EmployeeEntity {
  @PrimaryColumn('text') id!: string;
  @Column('text', { unique: true }) codeHash!: string;
  @Column('text') name!: string;
  @Column('text') initials!: string;
  @Column('text') role!: Role;
  @Column('boolean', { default: true }) active!: boolean;
  @Column('text', { nullable: true, unique: true }) username!: string | null;
  @Column('text', { nullable: true }) passwordHash!: string | null;
}

@Entity('login_attempts')
export class LoginAttempt {
  @PrimaryColumn('text') terminalId!: string;
  @Column('int', { default: 0 }) fails!: number;
  @Column('timestamptz', { nullable: true }) lockedUntil!: Date | null;
}

@Entity('sessions')
export class SessionEntity {
  @PrimaryColumn('text') token!: string;
  @Column('text') employeeId!: string;
  @Column('text') terminalId!: string;
  @Column('timestamptz') createdAt!: Date;
  @Column('timestamptz') lastSeen!: Date;
}

@Entity('role_permissions')
export class RolePermission {
  @PrimaryColumn('text') role!: string;
  @PrimaryColumn('text') permission!: string;
  @Column('boolean') allowed!: boolean;
}

@Entity('terminals')
export class Terminal {
  @PrimaryColumn('text') id!: string;
  @Column('text') name!: string;
}
