import { Inject, Injectable } from '@nestjs/common';
import type { Permission, Role } from '@my-shop/contracts';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork, type Tx } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { DomainError } from '../common/errors/domain-error';
import { IdentityRepository } from './repositories/identity.repository';
import { isAllowed, isProtectedCell, resolveMatrix } from './policies/permission-matrix';

/** Who may do what: the spec's role matrix, with the owner's per-cell overrides. */
@Injectable()
export class PermissionService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: IdentityRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async matrix(tx: Tx = this.uow.read): Promise<Record<Role, Permission[]>> {
    return resolveMatrix(await this.repo.overrides(tx));
  }

  async can(role: Role, permission: Permission, tx: Tx = this.uow.read): Promise<boolean> {
    return isAllowed(role, permission, await this.repo.override(tx, role, permission));
  }

  async set(tx: Tx, role: Role, permission: Permission, allowed: boolean): Promise<void> {
    if (isProtectedCell(role, permission, allowed)) throw new DomainError('conflict', 'เจ้าของต้องมีสิทธิ์จัดการผู้ใช้เสมอ');
    await this.repo.setOverride(tx, role, permission, allowed);
  }

  /** The owner's edit of one cell, audited. */
  async change(actor: string, role: Role, permission: Permission, allowed: boolean): Promise<void> {
    await this.uow.run(async (tx) => {
      await this.set(tx, role, permission, allowed);
      await this.audit.record(tx, this.clock(), { actor, action: 'permission.set', after: { role, permission, allowed } });
    });
  }
}
