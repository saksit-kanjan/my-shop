import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { PermissionsService } from '../auth/permissions.service';
import { Requires } from '../common/decorators';
import type { AuthedRequest } from '../common/session';
import { CreateUserDto, SetPermissionDto, UpdateUserDto } from './dto/users.dto';
import { UsersService } from './users.service';

@Controller('bo')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('users')
  @Requires('users.manage')
  list() {
    return this.users.list();
  }

  @Post('users')
  @Requires('users.manage')
  create(@Req() req: AuthedRequest, @Body() body: CreateUserDto) {
    return this.users.create(body, req.session.employee.id);
  }

  @Put('users/:id')
  @Requires('users.manage')
  @HttpCode(204)
  async update(@Req() req: AuthedRequest, @Param('id') id: string, @Body() body: UpdateUserDto) {
    await this.users.update(id, body, req.session.employee.id);
  }

  @Get('permissions')
  @Requires('users.manage')
  matrix() {
    return this.permissions.matrix();
  }

  @Put('permissions')
  @Requires('users.manage')
  @HttpCode(204)
  async setPermission(@Req() req: AuthedRequest, @Body() body: SetPermissionDto) {
    await this.permissions.change(req.session.employee.id, body.role, body.permission, body.allowed);
  }
}
