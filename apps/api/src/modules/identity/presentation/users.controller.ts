import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Req } from '@nestjs/common';
import type { Permission, Role } from '@my-shop/contracts';
import { PermissionService } from '../application/permission.service';
import { UserService } from '../application/user.service';
import { Requires } from '../../../shared/http/auth.decorators';
import type { AuthedRequest } from '../../../shared/http/authed-request';

@Controller('bo')
export class UsersController {
  constructor(
    @Inject(UserService) private readonly userService: UserService,
    @Inject(PermissionService) private readonly permissionService: PermissionService,
  ) {}

  @Get('users')
  @Requires('users.manage')
  users() {
    return this.userService.list();
  }

  @Post('users')
  @Requires('users.manage')
  createUser(@Req() req: AuthedRequest, @Body() body: { name: string; role: Role; code: string; username?: string; password?: string }) {
    return this.userService.create(body, req.session.employee.id);
  }

  @Put('users/:id')
  @Requires('users.manage')
  @HttpCode(204)
  async updateUser(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: { name?: string; role?: Role; active?: boolean; code?: string; password?: string; username?: string }) {
    await this.userService.update(id, body, req.session.employee.id);
  }

  @Get('permissions')
  @Requires('users.manage')
  permissions() {
    return this.permissionService.matrix();
  }

  @Put('permissions')
  @Requires('users.manage')
  @HttpCode(204)
  async setPermission(@Req() req: AuthedRequest, @Body() body: { role: Role; permission: Permission; allowed: boolean }) {
    await this.permissionService.change(req.session.employee.id, body.role, body.permission, body.allowed);
  }
}
