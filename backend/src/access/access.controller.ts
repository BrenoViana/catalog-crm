import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { AccessService } from './access.service';
import {
  CreateRoleDto,
  SetUserActiveDto,
  SetUserOverridesDto,
  SetUserRoleDto,
  UpdateRoleDto,
} from './dto/access.dto';

@Controller('access')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  /** Conjunto efetivo do proprio usuario — o frontend usa para montar a UI. */
  @Get('me')
  async me(@CurrentUser('userId') userId: string) {
    return { permissions: [...(await this.access.effectivePermissions(userId))].sort() };
  }

  @RequirePermissions('users.manage')
  @Get('permissions')
  permissions() {
    return this.access.listPermissions();
  }

  @RequirePermissions('users.manage')
  @Get('roles')
  roles() {
    return this.access.listRoles();
  }

  @RequirePermissions('users.manage')
  @Post('roles')
  createRole(@Body() dto: CreateRoleDto) {
    return this.access.createRole(dto);
  }

  @RequirePermissions('users.manage')
  @Patch('roles/:id')
  updateRole(@Param('id') id: string, @Body() dto: UpdateRoleDto) {
    return this.access.updateRole(id, dto);
  }

  @RequirePermissions('users.manage')
  @Delete('roles/:id')
  removeRole(@Param('id') id: string) {
    return this.access.removeRole(id);
  }

  @RequirePermissions('users.manage')
  @Get('users')
  users() {
    return this.access.listUsers();
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/role')
  setUserRole(@Param('id') id: string, @Body() dto: SetUserRoleDto) {
    return this.access.setUserRole(id, dto.roleId);
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/overrides')
  setUserOverrides(@Param('id') id: string, @Body() dto: SetUserOverridesDto) {
    return this.access.setUserOverrides(id, dto.overrides);
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/active')
  setUserActive(@Param('id') id: string, @Body() dto: SetUserActiveDto) {
    return this.access.setUserActive(id, dto.active);
  }
}
