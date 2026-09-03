import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { StoreSettingsService } from './store-settings.service';
import { UpdateStoreSettingsDto } from './dto/update-store-settings.dto';

@UseGuards(JwtAuthGuard)
@Controller('store-settings')
export class StoreSettingsController {
  constructor(private readonly storeSettingsService: StoreSettingsService) {}

  @Get()
  get() {
    return this.storeSettingsService.get();
  }

  @Put()
  update(@Body() dto: UpdateStoreSettingsDto) {
    return this.storeSettingsService.update(dto);
  }
}
