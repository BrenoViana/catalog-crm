import { Module } from '@nestjs/common';
import { ReportCsvService } from './report-csv.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { RegistroChannel } from './scheduling/channels/registro.channel';
import { ReportSchedulesController } from './scheduling/report-schedules.controller';
import { ReportSchedulesService } from './scheduling/report-schedules.service';

@Module({
  controllers: [ReportsController, ReportSchedulesController],
  providers: [
    ReportsService,
    ReportCsvService,
    RegistroChannel,
    ReportSchedulesService,
  ],
})
export class ReportsModule {}
