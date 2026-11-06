import { Inject, Injectable } from '@nestjs/common';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { bangkokDate } from '../common/utils/dates';
import { BACKUP_DIR, BACKUP_RETENTION } from '../common/constants/tokens';

const BANGKOK_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false });

/** Daily backup, kept 30 days (spec: "สำรองข้อมูลอัตโนมัติทุกวัน เก็บย้อนหลังอย่างน้อย 30 วัน"). */
@Injectable()
export class BackupService {
  private lastRunDate = '';

  constructor(
    private readonly uow: UnitOfWork,
    private readonly audit: AuditService,
    @Inject(BACKUP_DIR) readonly dir: string,
    @Inject(BACKUP_RETENTION) private readonly retentionDays: number,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run(actor = 'system'): Promise<{ file: string; removed: number }> {
    const now = this.clock();
    const file = await this.uow.backup(this.dir);
    const removed = await this.prune(now);
    this.lastRunDate = bangkokDate(now);
    await this.uow.run((tx) => this.audit.record(tx, now, { actor: actor === 'system' ? null : actor, action: 'backup.run', after: { file, removed } }));
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
    return Promise.all(names.map(async (name) => ({ name, bytes: (await stat(join(this.dir, name))).size, at: (await stat(join(this.dir, name))).mtime.toISOString() })));
  }

  /** Call every few minutes: runs once per Bangkok day, at 03:00 or the first call after it. */
  async tick(): Promise<boolean> {
    const now = this.clock();
    if (bangkokDate(now) === this.lastRunDate || Number(BANGKOK_HOUR.format(now)) < 3) return false;
    const existing = (await this.list()).some((f) => f.at.slice(0, 10) === bangkokDate(now));
    if (existing) {
      this.lastRunDate = bangkokDate(now);
      return false;
    }
    await this.run();
    return true;
  }
}
