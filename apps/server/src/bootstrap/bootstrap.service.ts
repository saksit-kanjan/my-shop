import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialsService } from '../auth/credentials.service';
import { DatabaseService } from '../database/database.service';
import { SettingsService } from '../settings/settings.service';
import { bootstrapOwner, seedDemo } from './demo.seed';

/**
 * First-run setup, after the tables exist (module init runs the migrations before this):
 *  - SEED_DEMO (default on, set it to 0 in production): load the demo catalog and staff into an empty database
 *  - OWNER_USERNAME / OWNER_PASSWORD / OWNER_CODE: create the first owner while there is none
 *  - BUSINESS_DAY_CUTOFF_HOUR: set the hour the business date rolls over
 */
@Injectable()
export class BootstrapService implements OnApplicationBootstrap {
  private readonly log = new Logger(BootstrapService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly db: DatabaseService,
    private readonly credentials: CredentialsService,
    private readonly settings: SettingsService,
  ) {}

  async onApplicationBootstrap() {
    if (this.config.get('SEED_DEMO') !== '0' && (await seedDemo(this.db, this.credentials))) this.log.log('Seeded the demo catalog and staff.');
    if (await bootstrapOwner(this.db, this.credentials, process.env)) this.log.log('Created the owner account from OWNER_* settings.');
    const cutoff = this.config.get<string>('BUSINESS_DAY_CUTOFF_HOUR');
    if (cutoff) await this.db.transaction((tx) => this.settings.update(tx, { cutoffHour: Number(cutoff) }));
  }
}
