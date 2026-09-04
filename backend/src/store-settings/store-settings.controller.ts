import { Body, Controller, Get, Put } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { RequirePermissions } from '../common/permissions.decorator';
import { Public } from '../common/public.decorator';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

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

  @RequirePermissions('settings.manage')
  @Put()
  update(@Body() dto: UpdateStoreSettingsDto) {
    return this.storeSettingsService.update(dto);
  }
}
