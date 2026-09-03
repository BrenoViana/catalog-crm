import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth.guard';
import { LicenseService } from './license.service';
import { UpdateLicenseDto } from './dto/update-license.dto';

@UseGuards(JwtAuthGuard)
@Controller('settings')
export class LicenseController {
  constructor(private readonly licenseService: LicenseService) {}

  @Get('license')
  getLicense() {
    return this.licenseService.getCurrent();
  }

  @Put('license')
  update(@Body() dto: UpdateLicenseDto) {
    return this.licenseService.update(dto);
  }
}
