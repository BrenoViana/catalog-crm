import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { AccessService } from './access.service';
import { AuthorizationService } from './authorization.service';
import {
  AuthorizeDto,
  CreateRoleDto,
  SetUserActiveDto,
  SetUserOverridesDto,
  SetUserRoleDto,
  UpdateRoleDto,
} from './dto/access.dto';

@Controller('access')
export class AccessController {
  constructor(
    private readonly access: AccessService,
    private readonly authorization: AuthorizationService,
  ) {}

  /** Conjunto efetivo do proprio usuario — o frontend usa para montar a UI. */
  @Get('me')
  async me(@CurrentUser('userId') userId: string) {
    return { permissions: [...(await this.access.effectivePermissions(userId))].sort() };
  }

  /**
   * Liberacao de supervisor no balcao: o operador manda as credenciais de quem
   * esta autorizando e recebe um vale de uso unico para a permissao pedida.
   */
  @Post('authorize')
  authorize(@CurrentUser('userId') userId: string, @Body() dto: AuthorizeDto) {
    return this.authorization.requestGrant({
      operatorId: userId,
      username: dto.username,
      password: dto.password,
      permission: dto.permission,
      reason: dto.reason,
    });
  }

  @RequirePermissions('users.manage')
  @Get('audit')
  audit(@Query('action') action?: string, @Query('take') take?: string) {
    return this.authorization.listAudit({ action, take: take ? Number(take) : undefined });
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
