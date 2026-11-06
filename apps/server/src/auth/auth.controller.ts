import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Public } from '../common/decorators';
import { DomainError } from '../common/domain-error';
import type { AuthedRequest } from '../common/session';
import { SettingsService } from '../settings/settings.service';
import { ApprovalsService } from './approvals.service';
import { AuthService } from './auth.service';
import { ApprovalDto, BackOfficeLoginDto, LoginDto } from './dto/auth.dto';
import { PermissionsService } from './permissions.service';

@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly approvals: ApprovalsService,
    private readonly permissions: PermissionsService,
    private readonly settings: SettingsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: LoginDto) {
    return this.auth.login(body.code, body.terminalId);
  }

  @Public()
  @Post('bo/login')
  @HttpCode(200)
  loginBackOffice(@Body() body: BackOfficeLoginDto) {
    return this.auth.loginBackOffice(body.username, body.password);
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest) {
    await this.auth.logout(req.session.token);
  }

  /** What the signed-in role may do, so screens can hide buttons. The server still checks every call. */
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const matrix = await this.permissions.matrix();
    return { employee: req.session.employee, permissions: matrix[req.session.employee.role], settings: await this.settings.getAll() };
  }

  @Get('employees/:id')
  async employee(@Param('id') id: string) {
    const e = await this.auth.findEmployee(id);
    if (!e) throw new DomainError('not_found', 'ไม่พบพนักงาน');
    return e;
  }

  /** The approval dialog: a supervisor types their code, the till learns who approved. */
  @Post('approvals')
  @HttpCode(200)
  approve(@Req() req: AuthedRequest, @Body() body: ApprovalDto) {
    return this.approvals.check(req.session.employee, body.permission, body.code, req.session.terminalId);
  }
}
