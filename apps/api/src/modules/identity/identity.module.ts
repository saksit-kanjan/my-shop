import { Module } from '@nestjs/common';
import { AdministrationModule } from '../administration/administration.module';
import { ApprovalService } from './application/approval.service';
import { AuthService } from './application/auth.service';
import { PermissionService } from './application/permission.service';
import { UserService } from './application/user.service';
import { CodeHasher, PasswordHasher } from './domain/credential-hasher';
import { IdentityRepository } from './domain/identity.repository';
import { HmacCodeHasher, ScryptPasswordHasher } from './infrastructure/crypto-hashers';
import { PgIdentityRepository } from './infrastructure/pg-identity.repository';
import { IdentityController } from './presentation/identity.controller';
import { UsersController } from './presentation/users.controller';

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
