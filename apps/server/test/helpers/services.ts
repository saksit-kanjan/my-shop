import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppModule } from '../../src/app.module';
import { ApprovalsService } from '../../src/auth/approvals.service';
import { AuthService } from '../../src/auth/auth.service';
import { CredentialsService } from '../../src/auth/credentials.service';
import { PermissionsService } from '../../src/auth/permissions.service';
import { BackupService } from '../../src/backup/backup.service';
import { configureApp } from '../../src/common/app-setup';
import { CLOCK, type Clock } from '../../src/common/clock';
import { DatabaseService } from '../../src/database/database.service';
import { MembersService } from '../../src/members/members.service';
import { ProductsService } from '../../src/products/products.service';
import { ReportsService } from '../../src/reports/reports.service';
import { CreditNotesService } from '../../src/sales/credit-notes.service';
import { DayCloseService } from '../../src/sales/day-close.service';
import { DocumentsService } from '../../src/sales/documents.service';
import { SalesService } from '../../src/sales/sales.service';
import { ShiftsService } from '../../src/sales/shifts.service';
import { SettingsService } from '../../src/settings/settings.service';
import { ReceivingService } from '../../src/stock/receiving.service';
import { StockService } from '../../src/stock/stock.service';
import { StocktakeService } from '../../src/stock/stocktake.service';
import { UsersService } from '../../src/users/users.service';

export interface TestConfig {
  clock?: Clock;
  backupDir?: string;
}

/** The booted app and its services, for tests. The database and the clock are swapped with `overrideProvider`, as Nest intends. */
export interface Services {
  app: INestApplication;
  db: DatabaseService;
  auth: AuthService;
  approvals: ApprovalsService;
  credentials: CredentialsService;
  permissions: PermissionsService;
  settings: SettingsService;
  backup: BackupService;
  users: UsersService;
  products: ProductsService;
  members: MembersService;
  stock: StockService;
  receiving: ReceivingService;
  stocktake: StocktakeService;
  shifts: ShiftsService;
  sales: SalesService;
  creditNotes: CreditNotesService;
  documents: DocumentsService;
  dayClose: DayCloseService;
  reports: ReportsService;
}

const openApps = new Map<string, INestApplication[]>();

/** Closes every app a test opened on this database, so the database can be dropped. */
export async function closeApps(url: string): Promise<void> {
  for (const app of openApps.get(url) ?? []) await app.close();
  openApps.delete(url);
}

export async function createServices(databaseUrl: string, config: TestConfig = {}): Promise<Services> {
  process.env['CODE_SECRET'] = 'test-secret';
  process.env['BACKUP_DIR'] = config.backupDir ?? mkdtempSync(join(tmpdir(), 'myshop-bk-'));
  process.env['DATABASE_URL'] = databaseUrl;
  // The tests load their own data; first-run setup stays off.
  process.env['SEED_DEMO'] = '0';
  delete process.env['OWNER_USERNAME'];
  delete process.env['BUSINESS_DAY_CUTOFF_HOUR'];
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // The tests read their settings straight from process.env, which createServices has just set for this database.
    .overrideProvider(ConfigService).useValue({ get: (key: string, fallback?: unknown) => process.env[key] ?? fallback, getOrThrow: (key: string) => process.env[key] })
    .overrideProvider(CLOCK).useValue(config.clock ?? (() => new Date()))
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  configureApp(app);
  await app.init();
  openApps.set(databaseUrl, [...(openApps.get(databaseUrl) ?? []), app]);
  const get = <T>(token: abstract new (...args: never[]) => T): T => moduleRef.get(token, { strict: false });
  return {
    app, db: get(DatabaseService), auth: get(AuthService), approvals: get(ApprovalsService), credentials: get(CredentialsService), permissions: get(PermissionsService),
    settings: get(SettingsService), backup: get(BackupService), users: get(UsersService), products: get(ProductsService), members: get(MembersService), stock: get(StockService),
    receiving: get(ReceivingService), stocktake: get(StocktakeService), shifts: get(ShiftsService), sales: get(SalesService), creditNotes: get(CreditNotesService),
    documents: get(DocumentsService), dayClose: get(DayCloseService), reports: get(ReportsService),
  };
}
