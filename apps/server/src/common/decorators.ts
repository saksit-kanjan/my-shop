import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@my-shop/contracts';

export const IS_PUBLIC = 'isPublic';
/** The route needs no sign-in (login, and the read-only catalog the till loads first). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRES = 'requires';
/** The route needs this permission from the signed-in user's role (role matrix from the spec, owner overrides apply). */
export const Requires = (...permissions: Permission[]) => SetMetadata(REQUIRES, permissions);
