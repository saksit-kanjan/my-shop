import { Global, Inject, Injectable, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { AuditLog } from './audit/audit-log';
import { DB, type Db } from './database/database';
import { migrate } from './database/schema';
import { UnitOfWork } from './database/unit-of-work';
import { CLOCK, type Clock } from './kernel/clock';
import { BACKUP_DIR, BACKUP_RETENTION, SECRET } from './kernel/tokens';
import { DocumentNumbers } from './numbering/document-numbers';

export interface SharedOptions {
  /** The database the app owns the schema of. Closing it is the caller's job. */
  db: Db;
  /** Keys the employee-code hashes. Never change it once codes exist. */
  secret: string;
  clock?: Clock;
  backupDir?: string;
  backupRetentionDays?: number;
}

/** Creates or upgrades the tables before the first request. */
@Injectable()
class MigrationRunner implements OnModuleInit {
  constructor(@Inject(DB) private readonly db: Db) {}
  async onModuleInit() {
    await migrate(this.db);
  }
}

/** The shared kernel: database, unit of work, clock, secrets, audit log and document numbers. Global, so contexts just inject. */
@Global()
@Module({})
export class SharedModule {
  static forRoot(o: SharedOptions): DynamicModule {
    return {
      module: SharedModule,
      providers: [
        { provide: DB, useValue: o.db },
        { provide: CLOCK, useValue: o.clock ?? (() => new Date()) },
        { provide: SECRET, useValue: o.secret },
        { provide: BACKUP_DIR, useValue: o.backupDir ?? `${process.cwd()}/.data/backups` },
        { provide: BACKUP_RETENTION, useValue: o.backupRetentionDays ?? 30 },
        MigrationRunner,
        UnitOfWork,
        AuditLog,
        DocumentNumbers,
      ],
      exports: [DB, CLOCK, SECRET, BACKUP_DIR, BACKUP_RETENTION, UnitOfWork, AuditLog, DocumentNumbers],
    };
  }
}
