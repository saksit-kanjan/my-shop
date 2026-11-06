import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { Requires } from '../common/decorators';
import type { AuthedRequest } from '../common/session';
import { SettingsService } from './settings.service';

@Controller('bo/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @Requires('reports.all')
  get() {
    return this.settings.getAll();
  }

  /** Free-form on purpose: the service accepts only known keys of the right type and says which one is wrong. */
  @Put()
  @Requires('settings.manage')
  update(@Req() req: AuthedRequest, @Body() body: Record<string, unknown>) {
    return this.settings.change(req.session.employee.id, body);
  }
}
