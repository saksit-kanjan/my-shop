import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from '@nestjs/common';
import type { Permission } from '@my-shop/contracts';
import { DomainError } from '../../../shared/kernel/domain-error';
import { SettingsService } from '../../administration/application/settings.service';
import { ApprovalService } from '../application/approval.service';
import { AuthService } from '../application/auth.service';
import { PermissionService } from '../application/permission.service';
import { Public } from '../../../shared/http/auth.decorators';
import type { AuthedRequest } from '../../../shared/http/authed-request';

/** Sign-in, who am I, and the approval dialog. Thin: every rule lives in the application services. */
@Controller()
export class IdentityController {
  constructor(
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(ApprovalService) private readonly approvalsService: ApprovalService,
    @Inject(PermissionService) private readonly permissionsService: PermissionService,
    @Inject(SettingsService) private readonly settingsService: SettingsService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  login(@Body() body: { code: string; terminalId: string }) {
    return this.authService.login(String(body?.code ?? ''), String(body?.terminalId ?? ''));
  }

  @Public()
  @Post('bo/login')
  @HttpCode(200)
  loginBackOffice(@Body() body: { username: string; password: string }) {
    return this.authService.loginBackOffice(String(body?.username ?? ''), String(body?.password ?? ''));
  }

  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: AuthedRequest) {
    await this.authService.logout(req.session.token);
  }

  /** What the signed-in role may do, so screens can hide buttons. The server still checks every call. */
  @Get('me')
  async me(@Req() req: AuthedRequest) {
    const matrix = await this.permissionsService.matrix();
    return { employee: req.session.employee, permissions: matrix[req.session.employee.role], settings: await this.settingsService.getAll() };
  }

  @Get('employees/:id')
  async employee(@Param('id') id: string) {
    const e = await this.authService.findEmployee(id);
    if (!e) throw new DomainError('not_found', 'ไม่พบพนักงาน');
    return e;
  }

  /** The approval dialog: a supervisor types their code, the till learns who approved. */
  @Post('approvals')
  @HttpCode(200)
  approve(@Req() req: AuthedRequest, @Body() body: { permission: Permission; code: string }) {
    return this.approvalsService.check(req.session.employee, body.permission, String(body.code ?? ''), req.session.terminalId);
  }
}
