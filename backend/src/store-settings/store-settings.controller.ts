import { Body, Controller, Get, Put } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { RequirePermissions } from '../common/permissions.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthorizationService } from '../access/authorization.service';
import { Public } from '../common/public.decorator';

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
}
