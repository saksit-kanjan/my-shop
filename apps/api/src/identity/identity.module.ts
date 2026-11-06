import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { ApprovalService } from './approval.service';
import { AuthService } from './auth.service';
import { PermissionService } from './permission.service';
import { UserService } from './user.service';
import { CodeHasher, PasswordHasher } from './providers/credential-hasher';
import { IdentityRepository } from './repositories/identity.repository';
import { HmacCodeHasher, ScryptPasswordHasher } from './providers/crypto-hashers';
import { PgIdentityRepository } from './repositories/pg-identity.repository';
import { IdentityController } from './identity.controller';
import { UsersController } from './users.controller';

/**
 * Identity: who is signed in and what they may do. Other contexts use `AuthService`, `ApprovalService`,
 * `PermissionService` and `CodeHasher` (for seeding); the repository and hashers stay private to this module.
 */
@Module({
  imports: [AdministrationModule],
  controllers: [IdentityController, UsersController],
  providers: [
    AuthService,
    ApprovalService,
    PermissionService,
    UserService,
    { provide: IdentityRepository, useClass: PgIdentityRepository },
    { provide: CodeHasher, useClass: HmacCodeHasher },
    { provide: PasswordHasher, useClass: ScryptPasswordHasher },
  ],
  exports: [AuthService, ApprovalService, PermissionService, UserService, CodeHasher, PasswordHasher],
})
export class IdentityModule {}
