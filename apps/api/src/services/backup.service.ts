import { Inject, Injectable } from '@nestjs/common';
import { BACKUP_DIR, BACKUP_RETENTION, CLOCK } from '../tokens';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { DB, type Db } from '../db/db';
import { audit } from './audit';
import type { Clock } from './util';

const BANGKOK_HOUR = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false });
const BANGKOK_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' });

/** Daily backup, kept 30 days (spec: "สำรองข้อมูลอัตโนมัติทุกวัน เก็บย้อนหลังอย่างน้อย 30 วัน"). */
@Injectable()
export class BackupService {
  private lastRunDate = '';

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(BACKUP_DIR) readonly dir: string,
    @Inject(BACKUP_RETENTION) private readonly retentionDays: number,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async run(actor = 'system'): Promise<{ file: string; removed: number }> {
    const now = this.clock();
    const file = await this.db.backup(this.dir);
    const removed = await this.prune(now);
    this.lastRunDate = BANGKOK_DATE.format(now);
    await this.db.transaction((tx) => audit(tx, now, { actor: actor === 'system' ? null : actor, action: 'backup.run', after: { file, removed } }));
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
    if (BANGKOK_DATE.format(now) === this.lastRunDate || Number(BANGKOK_HOUR.format(now)) < 3) return false;
    const existing = (await this.list()).some((f) => f.at.slice(0, 10) === BANGKOK_DATE.format(now));
    if (existing) {
      this.lastRunDate = BANGKOK_DATE.format(now);
      return false;
    }
    await this.run();
    return true;
  }
}
