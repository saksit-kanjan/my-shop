import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, type AppOptions } from '../app.module';
import type { Db } from '../shared/database/database';
import { BackupService } from '../modules/administration/application/backup.service';
import { SettingsService } from '../modules/administration/application/settings.service';
import { CatalogAdminService } from '../modules/catalog/application/catalog-admin.service';
import { CatalogService } from '../modules/catalog/application/catalog.service';
import { ApprovalService } from '../modules/identity/application/approval.service';
import { AuthService } from '../modules/identity/application/auth.service';
import { PermissionService } from '../modules/identity/application/permission.service';
import { UserService } from '../modules/identity/application/user.service';
import { CodeHasher, PasswordHasher } from '../modules/identity/domain/credential-hasher';
import { ReceivingService } from '../modules/inventory/application/receiving.service';
import { StockService } from '../modules/inventory/application/stock.service';
import { StocktakeService } from '../modules/inventory/application/stocktake.service';
import { MembershipService } from '../modules/membership/application/membership.service';
import { ReportService } from '../modules/reporting/application/report.service';
import { CreditNoteService } from '../modules/sales/application/credit-note.service';
import { DayCloseService } from '../modules/sales/application/day-close.service';
import { PosCatalogService } from '../modules/sales/application/pos-catalog.service';
import { SaleService } from '../modules/sales/application/sale.service';
import { SalesDocumentService } from '../modules/sales/application/sales-document.service';
import { ShiftService } from '../modules/sales/application/shift.service';

export type AppConfig = Omit<AppOptions, 'db' | 'schedule'>;

/** The application services pulled out of a booted Nest context. Used by the tests; there is no HTTP server. */
export interface Services {
  auth: AuthService;
  approvals: ApprovalService;
  users: UserService;
  permissions: PermissionService;
  codes: CodeHasher;
  passwords: PasswordHasher;
  settings: SettingsService;
  backup: BackupService;
  catalog: CatalogService;
  catalogAdmin: CatalogAdminService;
  posCatalog: PosCatalogService;
  members: MembershipService;
  stock: StockService;
  receiving: ReceivingService;
  stocktake: StocktakeService;
  shifts: ShiftService;
  sales: SaleService;
  creditNotes: CreditNoteService;
  documents: SalesDocumentService;
  dayClose: DayCloseService;
  reports: ReportService;
  /** The options the context was built with, so a test can start an HTTP app over the same database and clock. */
  options: AppOptions;
  close(): Promise<void>;
}

/** Boots the real module graph (migrations run, no timers). */
export async function createServices(db: Db, config: AppConfig): Promise<Services> {
  const options: AppOptions = { ...config, db, schedule: false };
  const ctx = await NestFactory.createApplicationContext(AppModule.forRoot(options), { logger: false });
  const get = <T>(token: abstract new (...args: never[]) => T): T => ctx.get(token, { strict: false });
  return {
    auth: get(AuthService), approvals: get(ApprovalService), users: get(UserService), permissions: get(PermissionService), codes: get(CodeHasher), passwords: get(PasswordHasher),
    settings: get(SettingsService), backup: get(BackupService), catalog: get(CatalogService), catalogAdmin: get(CatalogAdminService), posCatalog: get(PosCatalogService),
    members: get(MembershipService), stock: get(StockService), receiving: get(ReceivingService), stocktake: get(StocktakeService), shifts: get(ShiftService),
    sales: get(SaleService), creditNotes: get(CreditNoteService), documents: get(SalesDocumentService), dayClose: get(DayCloseService), reports: get(ReportService),
    options, close: () => ctx.close(),
  };
}
