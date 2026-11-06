import { Module } from '@nestjs/common';
import { BackupService } from './backup.service';
import { SettingsService } from './settings.service';
import { SettingsRepository } from './repositories/settings.repository';
import { PgSettingsRepository } from './repositories/pg-settings.repository';
import { AdministrationController } from './administration.controller';

/** Store settings and backups. Upstream of the other contexts: they read `SettingsService`, it reads nothing of theirs. */
@Module({
  controllers: [AdministrationController],
  providers: [SettingsService, BackupService, { provide: SettingsRepository, useClass: PgSettingsRepository }],
  exports: [SettingsService, BackupService],
})
export class AdministrationModule {}
