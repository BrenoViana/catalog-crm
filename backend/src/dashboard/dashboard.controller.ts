import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.decorator';
import { DashboardService } from './dashboard.service';

@RequirePermissions('dashboard.view')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboardService.summary();
  }
}
