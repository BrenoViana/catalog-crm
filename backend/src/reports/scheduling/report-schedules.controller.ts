import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../../common/current-user.decorator';
import { RequirePermissions } from '../../common/permissions.decorator';
import { RequireModule } from '../../license/module.guard';
import { EXPORTABLE } from '../report-csv.service';
import {
  CreateReportScheduleDto,
  UpdateReportScheduleDto,
} from './dto/report-schedule.dto';
import { ReportSchedulesService } from './report-schedules.service';

/**
 * Agendamento de relatorios.
 *
 * Permissao propria (`reports.schedule`), acima de `reports.view`: agendar e
 * criar uma saida CONTINUA de custo, margem e desempenho por operador para um
 * endereco fora do sistema — e ela continua saindo depois que quem criou perdeu
 * o acesso. E outra decisao que "ver o relatorio na tela".
 *
 * Atras do mesmo modulo licenciado dos relatorios, e o runner confere a licenca
 * de novo a cada varredura: sem o gate no envio, um agendamento sobreviveria ao
 * vencimento do modulo.
 */
@RequireModule('relatorios')
@Controller('reports/schedules')
export class ReportSchedulesController {
  constructor(private readonly schedules: ReportSchedulesService) {}

  /** Relatorios que podem ser agendados — a tela monta o seletor com isto. */
  @RequirePermissions('reports.schedule')
  @Get('available')
  available() {
    return { relatorios: EXPORTABLE };
  }

  @RequirePermissions('reports.schedule')
  @Get()
  list() {
    return this.schedules.list();
  }

  @RequirePermissions('reports.schedule')
  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedules.findOne(id);
  }

  @RequirePermissions('reports.schedule')
  @Post()
  create(
    @Body() dto: CreateReportScheduleDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.schedules.create(dto, userId);
  }

  @RequirePermissions('reports.schedule')
  @Patch(':id')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportScheduleDto,
    @CurrentUser('userId') userId: string,
  ) {
    return this.schedules.update(id, dto, userId);
  }

  @RequirePermissions('reports.schedule')
  @Delete(':id')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('userId') userId: string,
  ) {
    return this.schedules.remove(id, userId);
  }

  /** "Enviar agora": confere o agendamento sem esperar o horario, sem gastar a
   * ocorrencia programada do dia. */
  @RequirePermissions('reports.schedule')
  @Post(':id/run')
  run(@Param('id', ParseUUIDPipe) id: string, @CurrentUser('userId') userId: string) {
    return this.schedules.runNow(id, userId);
  }
}
