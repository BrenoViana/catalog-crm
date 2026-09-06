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
  Req,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { GrantRateLimitGuard } from '../common/grant-rate-limit.guard';
import { clientIp } from '../common/fixed-window-limiter';
import {
  UsedAuthorizationGrant,
  type UsedGrant,
} from '../common/grant.decorator';
import { AccessService } from './access.service';
import { AuthorizationService } from './authorization.service';
import {
  AuthorizeDto,
  CreateRoleDto,
  CreateUserDto,
  SetPasswordDto,
  SetUserActiveDto,
  SetUserOverridesDto,
  SetUserRoleDto,
  UpdateRoleDto,
  UpdateUserDto,
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
  @UseGuards(GrantRateLimitGuard)
  @Post('authorize')
  authorize(
    @CurrentUser('userId') userId: string,
    @Body() dto: AuthorizeDto,
    @Req() req: { ip?: string; socket?: { remoteAddress?: string } },
  ) {
    return this.authorization.requestGrant({
      operatorId: userId,
      username: dto.username,
      password: dto.password,
      permission: dto.permission,
      reason: dto.reason,
      ip: clientIp(req),
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
  @Post('users')
  async createUser(@CurrentUser('userId') actorId: string, @Body() dto: CreateUserDto) {
    const user = await this.access.createUser(dto);
    await this.authorization.record({
      action: 'users.create',
      actorId,
      targetType: 'user',
      targetId: user.id,
      detail: { username: user.username, roleId: user.roleId },
    });
    return user;
  }

  @RequirePermissions('users.manage')
  @Patch('users/:id')
  async updateUser(
    @CurrentUser('userId') actorId: string,
    @Param('id') id: string,
    @Body() dto: UpdateUserDto,
  ) {
    const user = await this.access.updateUser(id, dto);
    await this.authorization.record({
      action: 'users.update',
      actorId,
      targetType: 'user',
      targetId: id,
      detail: { name: dto.name ?? null, username: dto.username ?? null },
    });
    return user;
  }

  /** Redefinicao de senha por quem administra usuarios. */
  @RequirePermissions('users.manage')
  @Put('users/:id/password')
  async setUserPassword(
    @CurrentUser('userId') actorId: string,
    @Param('id') id: string,
    @Body() dto: SetPasswordDto,
  ) {
    const result = await this.access.setUserPassword(id, dto, actorId);
    await this.authorization.record({
      action: 'users.password',
      actorId,
      targetType: 'user',
      targetId: id,
      detail: { self: id === actorId },
    });
    return result;
  }

  /**
   * Troca da propria senha. Nao exige users.manage — qualquer pessoa logada
   * pode fazer, desde que informe a senha atual.
   */
  @Put('me/password')
  async setOwnPassword(
    @CurrentUser('userId') actorId: string,
    @Body() dto: SetPasswordDto,
  ) {
    const result = await this.access.setUserPassword(actorId, dto, actorId);
    await this.authorization.record({
      action: 'users.password',
      actorId,
      targetType: 'user',
      targetId: actorId,
      detail: { self: true },
    });
    return result;
  }

  /**
   * As tres rotas abaixo mudam QUEM PODE O QUE. Todas gravam antes/depois na
   * trilha: promover alguem a Administrador, conceder a si mesmo uma excecao ou
   * desativar o dono da loja precisa ter dono e horario.
   */
  @RequirePermissions('users.manage')
  @Put('users/:id/role')
  async setUserRole(
    @CurrentUser('userId') actorId: string,
    @Param('id') id: string,
    @Body() dto: SetUserRoleDto,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const before = await this.access.accessSnapshot(id);
    const result = await this.access.setUserRole(id, dto.roleId);
    await this.authorization.record({
      action: 'users.role',
      actorId,
      approverId: grant?.approverId,
      permissionKey: grant?.permission,
      targetType: 'user',
      targetId: id,
      detail: { de: before?.roleId ?? null, para: result.roleId },
    });
    return result;
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/overrides')
  async setUserOverrides(
    @CurrentUser('userId') actorId: string,
    @Param('id') id: string,
    @Body() dto: SetUserOverridesDto,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const before = await this.access.accessSnapshot(id);
    const result = await this.access.setUserOverrides(id, dto.overrides);
    await this.authorization.record({
      action: 'users.overrides',
      actorId,
      approverId: grant?.approverId,
      permissionKey: grant?.permission,
      targetType: 'user',
      targetId: id,
      // O PUT substitui o conjunto inteiro: sem o "antes", uma revogacao
      // silenciosa some junto com a excecao que ela apagou.
      detail: { antes: before?.overrides ?? [], depois: result.overrides },
    });
    return result;
  }

  @RequirePermissions('users.manage')
  @Put('users/:id/active')
  async setUserActive(
    @CurrentUser('userId') actorId: string,
    @Param('id') id: string,
    @Body() dto: SetUserActiveDto,
    @UsedAuthorizationGrant() grant?: UsedGrant,
  ) {
    const result = await this.access.setUserActive(id, dto.active);
    await this.authorization.record({
      action: dto.active ? 'users.activate' : 'users.deactivate',
      actorId,
      approverId: grant?.approverId,
      permissionKey: grant?.permission,
      targetType: 'user',
      targetId: id,
      detail: { active: result.active },
    });
    return result;
  }
}
