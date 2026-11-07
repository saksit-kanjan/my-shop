import { Injectable } from '@nestjs/common';
import { Setting } from './entities/setting.entity';
import { AuditService } from '../audit/audit.service';
import { CLOCK, type Clock } from '../common/clock';
import type { Tx } from '../database/database.types';
import { DatabaseService } from '../database/database.service';
import { changesFor, withOverrides, type SettingChange, type Settings } from './settings.defaults';
import { Inject } from '@nestjs/common';

/** Store settings. Other features read them with `getAll`; only the back office writes. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getAll(tx: Tx = this.db.manager): Promise<Settings> {
    return withOverrides(await tx.find(Setting));
  }

  /** Writes the changed keys inside the caller's transaction and returns what changed. */
  async update(tx: Tx, patch: Record<string, unknown>): Promise<SettingChange[]> {
    const changes = changesFor(await this.getAll(tx), patch);
    for (const c of changes) await tx.save(Setting, { key: c.key, value: c.after as Setting['value'] });
    return changes;
  }

  /** The back-office edit: validates, saves and audits in one transaction, then returns the settings now in force. */
  async change(actor: string, patch: Record<string, unknown>): Promise<Settings> {
    await this.db.transaction(async (tx) => {
      const changes = await this.update(tx, patch);
      await this.audit.record(tx, this.clock(), { actor, action: 'settings.change', after: changes });
    });
    return this.getAll();
  }
}
