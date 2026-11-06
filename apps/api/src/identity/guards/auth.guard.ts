import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@my-shop/contracts';
import { DomainError } from '../../common/errors/domain-error';
import { AuthService } from '../auth.service';
import { PermissionService } from '../permission.service';
import type { AuthedRequest } from '../../common/interfaces/authed-request';
import { IS_PUBLIC, REQUIRES } from '../../common/decorators/auth.decorators';

/** Global guard: every route needs a session unless `@Public()`, and `@Requires(...)` is checked against the role matrix. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly permissions: PermissionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const where = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, where)) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const session = await this.auth.authenticate(token);
    if (!session) throw new DomainError('unauthorized', 'หมดเวลาการใช้งาน กรุณาใส่รหัสพนักงานอีกครั้ง');
    req.session = session;
    for (const p of this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRES, where) ?? []) {
      if (!(await this.permissions.can(session.employee.role, p))) throw new DomainError('forbidden', 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้', { needs: p });
    }
    return true;
  }
}
