import { Body, Controller, Get, Put } from '@nestjs/common';
import { LicenseService } from './license.service';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { Role } from '@prisma/client';
import { Roles } from '../common/roles.decorator';

@Roles(Role.ADMIN)
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
