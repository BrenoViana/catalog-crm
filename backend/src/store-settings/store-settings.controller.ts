import { Body, Controller, Get, Put } from '@nestjs/common';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Get()
  get() {
    return this.storeSettingsService.get();
  }

  @Roles(Role.ADMIN)
  @Put()
  update(@Body() dto: UpdateStoreSettingsDto) {
    return this.storeSettingsService.update(dto);
  }
}
