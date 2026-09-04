import { Body, Controller, Get, Put } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';
import { Public } from '../common/public.decorator';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

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

  @Roles(Role.ADMIN)
  @Put()
  update(@Body() dto: UpdateStoreSettingsDto) {
    return this.storeSettingsService.update(dto);
  }
}
