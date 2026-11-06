import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { Db } from './db/db';
import { AppModule, type AppOptions } from './modules';
import { ApprovalService } from './services/approval.service';
import { AuthService } from './services/auth.service';
import { BackOfficeService } from './services/backoffice.service';
import { BackupService } from './services/backup.service';
import { CatalogService } from './services/catalog.service';
import { DocumentService } from './services/document.service';
import { MemberService } from './services/member.service';
import { PermissionService } from './services/permission.service';
import { ReportService } from './services/report.service';
import { SaleService } from './services/sale.service';
import { SettingsService } from './services/settings.service';
import { ShiftService } from './services/shift.service';
import { UserService } from './services/user.service';

export type AppConfig = Omit<AppOptions, 'db' | 'schedule'>;

/** The providers of the app, pulled out of a Nest application context. Used by tests and one-off scripts. */
export interface Services {
  auth: AuthService;
  catalog: CatalogService;
  settings: SettingsService;
  permissions: PermissionService;
  approvals: ApprovalService;
  members: MemberService;
  shifts: ShiftService;
  sales: SaleService;
  documents: DocumentService;
  backoffice: BackOfficeService;
  reports: ReportService;
  users: UserService;
  backup: BackupService;
  /** The options the context was built with, so a test can start an HTTP app over the same database and clock. */
  options: AppOptions;
  close(): Promise<void>;
}

/** Boots the real Nest module graph without an HTTP server (migrations run, no timers). */
export async function createServices(db: Db, config: AppConfig): Promise<Services> {
  const options: AppOptions = { ...config, db, schedule: false };
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(options), { logger: false });
  return {
    auth: ctx.get(AuthService),
    catalog: ctx.get(CatalogService),
    settings: ctx.get(SettingsService),
    permissions: ctx.get(PermissionService),
    approvals: ctx.get(ApprovalService),
    members: ctx.get(MemberService),
    shifts: ctx.get(ShiftService),
    sales: ctx.get(SaleService),
    documents: ctx.get(DocumentService),
    backoffice: ctx.get(BackOfficeService),
    reports: ctx.get(ReportService),
    users: ctx.get(UserService),
    backup: ctx.get(BackupService),
    options,
    close: () => ctx.close(),
  };
}
