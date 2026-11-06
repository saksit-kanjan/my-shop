import { Module } from '@nestjs/common';
import { BackupService } from './application/backup.service';
import { SettingsService } from './application/settings.service';
import { SettingsRepository } from './domain/settings.repository';
import { PgSettingsRepository } from './infrastructure/pg-settings.repository';
import { AdministrationController } from './presentation/administration.controller';

/** Store settings and backups. Upstream of the other contexts: they read `SettingsService`, it reads nothing of theirs. */
@Module({
  controllers: [AdministrationController],
  providers: [SettingsService, BackupService, { provide: SettingsRepository, useClass: PgSettingsRepository }],
  exports: [SettingsService, BackupService],
})
export class AdministrationModule {}
