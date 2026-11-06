import { Inject, Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { UnitOfWork, type Tx } from '../database/unit-of-work';
import { CLOCK, type Clock } from '../common/clock/clock';
import { changesFor, withOverrides, type SettingChange, type Settings } from './entities/settings.entity';
import { SettingsRepository } from './repositories/settings.repository';

/** Store settings. Other contexts read them through `getAll`; only the back office writes. */
@Injectable()
export class SettingsService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly repo: SettingsRepository,
    private readonly audit: AuditService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async getAll(tx: Tx = this.uow.read): Promise<Settings> {
    return withOverrides(await this.repo.all(tx));
  }

  /** Writes the changed keys inside the caller's transaction and returns what changed, for the audit row. */
  async update(tx: Tx, patch: Record<string, unknown>): Promise<SettingChange[]> {
    const changes = changesFor(await this.getAll(tx), patch);
    for (const c of changes) await this.repo.save(tx, c.key, c.after);
    return changes;
  }

  /** The back-office edit: validates, saves and audits in one transaction, then returns the settings now in force. */
  async change(actor: string, patch: Record<string, unknown>): Promise<Settings> {
    await this.uow.run(async (tx) => {
      const changes = await this.update(tx, patch);
      await this.audit.record(tx, this.clock(), { actor, action: 'settings.change', after: changes });
    });
    return this.getAll();
  }
}
