import { Body, Controller, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { Requires } from '../common/decorators/auth.decorators';
import type { AuthedRequest } from '../common/interfaces/authed-request';
import { BackupService } from './backup.service';
import { SettingsService } from './settings.service';

@Controller('bo')
export class AdministrationController {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly backupService: BackupService,
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
