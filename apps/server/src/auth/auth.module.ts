import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { SettingsModule } from '../settings/settings.module';
import { ApprovalsService } from './approvals.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { CredentialsService } from './credentials.service';
import { PermissionsService } from './permissions.service';

/** Sign-in, sessions, supervisor approvals and the permission matrix. Other features inject the services; the guard protects every route. */
@Module({
  imports: [SettingsModule],
  controllers: [AuthController],
  providers: [AuthService, ApprovalsService, PermissionsService, CredentialsService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService, ApprovalsService, PermissionsService, CredentialsService],
})
export class AuthModule {}
