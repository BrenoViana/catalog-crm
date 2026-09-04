import { Body, Controller, Get, Put } from '@nestjs/common';
import { LicenseService } from './license.service';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { RequirePermissions } from '../common/permissions.decorator';

@RequirePermissions('settings.manage')
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
