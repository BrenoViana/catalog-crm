import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { IsBoolean } from 'class-validator';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { RequirePermissions } from '../common/permissions.decorator';
import { RequireModule } from '../license/module.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthorizationService } from '../access/authorization.service';
import { Public } from '../common/public.decorator';

class SetContingencyDto {
  @IsBoolean()
  active: boolean;
}

@Controller('store-settings')
export class StoreSettingsController {
  constructor(
    private readonly storeSettingsService: StoreSettingsService,
    private readonly authorization: AuthorizationService,
  ) {}

  @RequirePermissions('settings.manage')
  @Get()
  get() {
    return this.storeSettingsService.get();
  }

  /** Marca da loja (nome + logos) — publico, para a tela de login. */
  @Public()
  @Get('branding')
  branding() {
    return this.storeSettingsService.branding();
  }

  /**
   * Muda dados do emitente, identidade visual e politica de desconto — inclui
   * o teto que o PDV usa para barrar desconto. Vai para a trilha com a lista de
   * campos alterados (nunca os valores: aqui passam token fiscal e CSC).
   */
  @RequirePermissions('settings.manage')
  @Put()
  async update(
    @Body() dto: UpdateStoreSettingsDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const result = await this.storeSettingsService.update(dto);
    await this.authorization.record({
      action: 'storeSettings.update',
      actorId,
      targetType: 'StoreSettings',
      detail: { campos: Object.keys(dto ?? {}).sort() },
    });
    return result;
  }

  /**
   * Liga/desliga o modo de contingencia da NFC-e. Decisao sensivel e auditada:
   * enquanto ligado, toda venda emite direto na serie de contingencia.
   */
  @RequireModule('fiscal')
  @RequirePermissions('fiscal.contingency')
  @Post('contingency')
  async setContingency(
    @Body() dto: SetContingencyDto,
    @CurrentUser('userId') actorId: string,
  ) {
    const result = await this.storeSettingsService.setContingency(dto.active);
    await this.authorization.record({
      action: 'fiscal.contingency',
      permissionKey: 'fiscal.contingency',
      actorId,
      targetType: 'StoreSettings',
      detail: { active: dto.active },
    });
    return result;
  }
}
