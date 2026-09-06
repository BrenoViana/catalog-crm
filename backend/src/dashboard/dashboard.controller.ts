import { Controller, Get } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.decorator';
import { RequireModule } from '../license/module.guard';
import { DashboardService } from './dashboard.service';

@RequirePermissions('dashboard.view')
@RequireModule('relatorios')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  summary() {
    return this.dashboardService.summary();
  }
}
