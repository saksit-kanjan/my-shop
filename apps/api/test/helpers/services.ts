import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule, type AppOptions } from '../../src/app.module';
import type { Db } from '../../src/database/database';
import { BackupService } from '../../src/administration/backup.service';
import { SettingsService } from '../../src/administration/settings.service';
import { CatalogAdminService } from '../../src/catalog/catalog-admin.service';
import { CatalogService } from '../../src/catalog/catalog.service';
import { ApprovalService } from '../../src/identity/approval.service';
import { AuthService } from '../../src/identity/auth.service';
import { PermissionService } from '../../src/identity/permission.service';
import { UserService } from '../../src/identity/user.service';
import { CodeHasher, PasswordHasher } from '../../src/identity/providers/credential-hasher';
import { ReceivingService } from '../../src/inventory/receiving.service';
import { StockService } from '../../src/inventory/stock.service';
import { StocktakeService } from '../../src/inventory/stocktake.service';
import { MembershipService } from '../../src/membership/membership.service';
import { ReportService } from '../../src/reporting/report.service';
import { CreditNoteService } from '../../src/sales/credit-note.service';
import { DayCloseService } from '../../src/sales/day-close.service';
import { PosCatalogService } from '../../src/sales/pos-catalog.service';
import { SaleService } from '../../src/sales/sale.service';
import { SalesDocumentService } from '../../src/sales/sales-document.service';
import { ShiftService } from '../../src/sales/shift.service';

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
