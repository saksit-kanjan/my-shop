import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@my-shop/contracts';
import { AuthService, type Session } from '../services/auth.service';
import { PermissionService } from '../services/permission.service';
import { DomainError } from '../errors';

export const IS_PUBLIC = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRES = 'requires';
/** The route needs this permission from the signed-in user's role (matrix in the spec, owner overrides apply). */
export const Requires = (...permissions: Permission[]) => SetMetadata(REQUIRES, permissions);

export interface AuthedRequest {
  headers: Record<string, string | string[] | undefined>;
  session: Session;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PermissionService) private readonly permissions: PermissionService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers['authorization'];
    const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const session = await this.auth.authenticate(token);
    if (!session) throw new DomainError('unauthorized', 'หมดเวลาการใช้งาน กรุณาใส่รหัสพนักงานอีกครั้ง');
    req.session = session;
    const needs = this.reflector.getAllAndOverride<Permission[] | undefined>(REQUIRES, [ctx.getHandler(), ctx.getClass()]) ?? [];
    for (const p of needs) {
      if (!(await this.permissions.can(session.employee.role, p))) throw new DomainError('forbidden', 'บทบาทของคุณไม่มีสิทธิ์ทำรายการนี้', { needs: p });
    }
    return true;
  }
}
