import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { Requires } from '../common/decorators';
import type { AuthedRequest } from '../common/session';
import { RegisterMemberDto, UpdateMemberDto } from './dto/members.dto';
import { MembersService } from './members.service';

/** Members at the till (look up, register) and in the back office (edit, erase, points ledger). */
@Controller()
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get('members/:phone')
  async byPhone(@Param('phone') phone: string) {
    return (await this.members.findByPhone(phone)) ?? null;
  }

  @Post('members')
  register(@Req() req: AuthedRequest, @Body() body: RegisterMemberDto) {
    return this.members.register(body, req.session.employee.id, req.session.terminalId);
  }

  @Get('bo/members')
  @Requires('members.manage')
  search(@Query('term') term = '') {
    return this.members.search(term);
  }

  @Put('bo/members/:id')
  @Requires('members.manage')
  @HttpCode(204)
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: UpdateMemberDto) {
    await this.members.update(id, body, req.session.employee.id);
  }

  @Post('bo/members/:id/anonymize')
  @Requires('members.manage')
  @HttpCode(204)
  async anonymize(@Req() req: AuthedRequest, @Param('id') id: string) {
    await this.members.anonymize(id, req.session.employee.id);
  }

  @Get('bo/members/:id/points')
  @Requires('members.manage')
  points(@Param('id') id: string) {
    return this.members.ledger(id);
  }
}
