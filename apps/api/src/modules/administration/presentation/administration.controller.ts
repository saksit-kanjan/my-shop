import { Body, Controller, Get, HttpCode, Inject, Post, Put, Req } from '@nestjs/common';
import { Requires } from '../../../shared/http/auth.decorators';
import type { AuthedRequest } from '../../../shared/http/authed-request';
import { BackupService } from '../application/backup.service';
import { SettingsService } from '../application/settings.service';

@Controller('bo')
export class AdministrationController {
  constructor(
    @Inject(SettingsService) private readonly settingsService: SettingsService,
    @Inject(BackupService) private readonly backupService: BackupService,
  ) {}

  @Get('settings')
  @Requires('reports.all')
  settings() {
    return this.settingsService.getAll();
  }

  @Put('settings')
  @Requires('settings.manage')
  updateSettings(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    return this.settingsService.change(req.session.employee.id, body);
  }

  @Get('backups')
  @Requires('settings.manage')
  backups() {
    return this.backupService.list();
  }

  @Post('backups')
  @Requires('settings.manage')
  @HttpCode(200)
  runBackup(@Req() req: AuthedRequest) {
    return this.backupService.run(req.session.employee.id);
  }
}
