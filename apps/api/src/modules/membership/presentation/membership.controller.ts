import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Requires } from '../../../shared/http/auth.decorators';
import type { AuthedRequest } from '../../../shared/http/authed-request';
import { MembershipService } from '../application/membership.service';

/** Members at the till (look up, register) and in the back office (edit, erase, points ledger). */
@Controller()
export class MembershipController {
  constructor(@Inject(MembershipService) private readonly membership: MembershipService) {}

  @Get('members/:phone')
  async member(@Param('phone') phone: string) {
    return (await this.membership.findByPhone(phone)) ?? null;
  }

  @Post('members')
  register(@Req() req: AuthedRequest, @Body() body: { phone: string; name: string; birthday?: string; consent: boolean }) {
    return this.membership.register(body, req.session.employee.id, req.session.terminalId);
  }

  @Get('bo/members')
  @Requires('members.manage')
  search(@Query('term') term = '') {
    return this.membership.search(term);
  }

  @Put('bo/members/:id')
  @Requires('members.manage')
  @HttpCode(204)
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name?: string; birthday?: string | null; tier?: string; tax?: unknown }) {
    await this.membership.update(id, body, req.session.employee.id);
  }

  @Post('bo/members/:id/anonymize')
  @Requires('members.manage')
  @HttpCode(204)
  async anonymize(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.membership.anonymize(id, req.session.employee.id);
  }

  @Get('bo/members/:id/points')
  @Requires('members.manage')
  points(@Param('id') id: string) {
    return this.membership.ledger(id);
  }
}
