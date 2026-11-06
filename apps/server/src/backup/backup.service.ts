import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import { bangkokDate } from '../common/dates';
import { DatabaseService } from '../database/database.service';

const BANGKOK_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false });

/** Daily backup, kept 30 days (spec: "สำรองข้อมูลอัตโนมัติทุกวัน เก็บย้อนหลังอย่างน้อย 30 วัน"). */
@Injectable()
export class BackupService {
  private lastRunDate = '';
  readonly dir: string;
  private readonly retentionDays: number;

  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    config: ConfigService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {
    this.dir = config.get<string>('BACKUP_DIR') ?? join(process.cwd(), '.data', 'backups');
    this.retentionDays = Number(config.get('BACKUP_RETENTION_DAYS') ?? 30);
  }

  async run(actor = 'system'): Promise<{ file: string; removed: number }> {
    const now = this.clock();
    const file = await this.db.backup(this.dir);
    const removed = await this.prune(now);
    this.lastRunDate = bangkokDate(now);
    await this.db.transaction((tx) => this.audit.record(tx, now, { actor: actor === 'system' ? null : actor, action: 'backup.run', after: { file, removed } }));
    return { file, removed };
  }

  /** Deletes backups older than the retention window; never touches the newest file. */
  async prune(now = this.clock()): Promise<number> {
    let removed = 0;
    const names = (await readdir(this.dir).catch(() => [])).filter((n) => n.startsWith('myshop-')).sort();
    for (const n of names.slice(0, -1)) {
      const st = await stat(join(this.dir, n));
      if (now.getTime() - st.mtimeMs > this.retentionDays * 86_400_000) {
        await unlink(join(this.dir, n));
        removed += 1;
      }
    }
    return removed;
  }

  async list() {
    const names = (await readdir(this.dir).catch(() => [])).filter((n) => n.startsWith('myshop-')).sort().reverse();
    return Promise.all(names.map(async (name) => {
      const st = await stat(join(this.dir, name));
      return { name, bytes: st.size, at: st.mtime.toISOString() };
    }));
  }

  /** Call every few minutes: runs once per Bangkok day, at 03:00 or the first call after it. */
  async tick(): Promise<boolean> {
    const now = this.clock();
    if (bangkokDate(now) === this.lastRunDate || Number(BANGKOK_HOUR.format(now)) < 3) return false;
    const done = (await this.list()).some((f) => f.at.slice(0, 10) === bangkokDate(now));
    if (done) {
      this.lastRunDate = bangkokDate(now);
      return false;
    }
    await this.run();
    return true;
  }
}
