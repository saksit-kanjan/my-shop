import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { Requires } from '../common/decorators';
import type { AuthedRequest } from '../common/session';
import { BackupService } from './backup.service';

@Controller('bo/backups')
export class BackupController {
  constructor(private readonly backups: BackupService) {}

  @Get()
  @Requires('settings.manage')
  list() {
    return this.backups.list();
  }

  @Post()
  @Requires('settings.manage')
  @HttpCode(200)
  run(@Req() req: AuthedRequest) {
    return this.backups.run(req.session.employee.id);
  }
}
