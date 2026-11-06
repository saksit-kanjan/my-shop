import { Global, Module, type DynamicModule } from '@nestjs/common';
import { CLOCK, type Clock } from './clock/clock';
import { BACKUP_DIR, BACKUP_RETENTION, SECRET } from './constants/tokens';

export interface CommonOptions {
  clock?: Clock;
  /** Keys the employee-code hashes. Never change it once codes exist. */
  secret: string;
  backupDir?: string;
  backupRetentionDays?: number;
}

/** Cross-cutting values every feature may inject. Global, so features just inject `CLOCK` and the like. */
@Global()
@Module({})
export class CommonModule {
  static forRoot(o: CommonOptions): DynamicModule {
    return {
      module: CommonModule,
      providers: [
        { provide: CLOCK, useValue: o.clock ?? (() => new Date()) },
        { provide: SECRET, useValue: o.secret },
        { provide: BACKUP_DIR, useValue: o.backupDir ?? `${process.cwd()}/.data/backups` },
        { provide: BACKUP_RETENTION, useValue: o.backupRetentionDays ?? 30 },
      ],
      exports: [CLOCK, SECRET, BACKUP_DIR, BACKUP_RETENTION],
    };
  }
}
