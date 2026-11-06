import { Global, Module, type DynamicModule, type OnApplicationBootstrap, type OnApplicationShutdown, type OnModuleInit, Inject, Injectable } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { DB, type Db } from './db/db';
import { migrate } from './db/schema';
import { ApiController } from './http/api.controller';
import { AuthGuard } from './http/auth.guard';
import { BackOfficeController } from './http/backoffice.controller';
import { ErrorFilter } from './http/error.filter';
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
import type { Clock } from './services/util';
import { BACKUP_DIR, BACKUP_RETENTION, CLOCK, SECRET } from './tokens';

export interface AppOptions {
  /** The database the app owns the schema of. Closing it is the caller's job. */
  db: Db;
  /** Keys the employee-code hashes. Never change it once codes exist. */
  secret: string;
  clock?: Clock;
  backupDir?: string;
  backupRetentionDays?: number;
  /** Run the daily backup and points-expiry timer. On for the server, off in tests. */
  schedule?: boolean;
}

/** Creates or upgrades the tables before the first request. */
@Injectable()
class MigrationRunner implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onModuleInit() {
    await migrate(this.db);
  }
}

/** Database, clock, secrets and the two services every feature needs. Global so feature modules just inject. */
@Global()
@Module({})
export class CoreModule {
  static forRoot(o: AppOptions): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: DB, useValue: o.db },
        { provide: CLOCK, useValue: o.clock ?? (() => new Date()) },
        { provide: SECRET, useValue: o.secret },
        { provide: BACKUP_DIR, useValue: o.backupDir ?? `${process.cwd()}/.data/backups` },
        { provide: BACKUP_RETENTION, useValue: o.backupRetentionDays ?? 30 },
        MigrationRunner,
        SettingsService,
        PermissionService,
      ],
      exports: [DB, CLOCK, SECRET, BACKUP_DIR, BACKUP_RETENTION, SettingsService, PermissionService],
    };
  }
}

/** Who may do what: sign-in, supervisor approvals, staff accounts. */
@Module({
  providers: [AuthService, ApprovalService, UserService],
  exports: [AuthService, ApprovalService, UserService],
})
export class AuthModule {}

/** The sales floor: catalog, members and points, shifts, bills, and the documents made from them. */
@Module({
  imports: [AuthModule],
  providers: [CatalogService, MemberService, ShiftService, SaleService, DocumentService],
  exports: [CatalogService, MemberService, ShiftService, SaleService, DocumentService],
})
export class ShopModule {}

/** Runs the daily backup and the points-expiry job; only started when `schedule` is on. */
@Injectable()
class Scheduler implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer?: NodeJS.Timeout;
  constructor(
    @Inject(BackupService) private readonly backup: BackupService,
    @Inject(MemberService) private readonly members: MemberService,
  ) {}
  onApplicationBootstrap() {
    const tick = () => void this.backup.tick().then((ran) => (ran ? this.members.expireDue() : undefined)).catch((e) => console.error('scheduled job failed', e));
    this.timer = setInterval(tick, 10 * 60_000);
    this.timer.unref();
    tick();
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }
}

/** Everything behind /api/bo: catalog admin, receiving, stock counts, day close, reports, backup. */
@Module({})
export class BackOfficeModule {
  static register(schedule: boolean): DynamicModule {
    return {
      module: BackOfficeModule,
      imports: [AuthModule, ShopModule],
      controllers: [BackOfficeController],
      providers: [BackOfficeService, ReportService, BackupService, ...(schedule ? [Scheduler] : [])],
      exports: [BackOfficeService, ReportService, BackupService],
    };
  }
}

/** The till's routes: /api/login, /api/shifts, /api/sales, /api/members ... */
@Module({ imports: [AuthModule, ShopModule], controllers: [ApiController] })
export class TillModule {}

@Module({})
export class AppModule {
  static forRoot(o: AppOptions): DynamicModule {
    return {
      module: AppModule,
      imports: [CoreModule.forRoot(o), AuthModule, ShopModule, BackOfficeModule.register(o.schedule ?? false), TillModule],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_FILTER, useClass: ErrorFilter },
      ],
    };
  }
}
