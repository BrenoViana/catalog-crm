import {
  BadRequestException,
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthorizationService } from '../access/authorization.service';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { RequireModule } from '../license/module.guard';
import { safeFilename } from './csv';
import { isExportable, ReportCsvService } from './report-csv.service';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/**
 * Relatorios gerenciais.
 *
 * Fica atras do modulo licenciado `relatorios` (mesmo do dashboard) e exige
 * `reports.view`. A exportacao pede `reports.export` a mais de proposito: o CSV
 * leva custo, margem e desempenho individual por operador para fora do sistema,
 * onde nao ha mais controle de acesso nenhum. Por isso toda exportacao tambem
 * vira linha no AuditLog.
 */
@RequireModule('relatorios')
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly authorization: AuthorizationService,
    private readonly csv: ReportCsvService,
  ) {}

  @RequirePermissions('reports.view')
  @Get('sales')
  sales(@Query() query: ReportQueryDto) {
    return this.reports.sales(query);
  }

  @RequirePermissions('reports.view')
  @Get('payments')
  payments(@Query() query: ReportQueryDto) {
    return this.reports.payments(query);
  }

  @RequirePermissions('reports.view')
  @Get('products')
  async products(@Query() query: ReportQueryDto, @CurrentUser('userId') userId: string) {
    const data = await this.reports.products(query);
    await this.auditRead('produtos', userId, data.periodo, data.linhas.length);
    return data;
  }

  @RequirePermissions('reports.view')
  @Get('categories')
  async categories(@Query() query: ReportQueryDto, @CurrentUser('userId') userId: string) {
    const data = await this.reports.categories(query);
    await this.auditRead('categorias', userId, data.periodo, data.linhas.length);
    return data;
  }

  @RequirePermissions('reports.view')
  @Get('operators')
  async operators(@Query() query: ReportQueryDto, @CurrentUser('userId') userId: string) {
    const data = await this.reports.operators(query);
    await this.auditRead('operadores', userId, data.periodo, data.linhas.length);
    return data;
  }

  @RequirePermissions('reports.view')
  @Get('inventory')
  async inventory(@CurrentUser('userId') userId: string) {
    const data = await this.reports.inventory();
    await this.auditRead(
      'estoque',
      userId,
      { from: data.geradoEm.slice(0, 10), to: data.geradoEm.slice(0, 10) },
      data.linhas.length,
    );
    return data;
  }

  /**
   * Trilha de LEITURA dos relatorios que carregam dado sensivel.
   *
   * `reports.export` separa o formato, nao o dado: quem tem so `reports.view`
   * ve os mesmos custo, margem e desempenho individual por operador no JSON e
   * monta a planilha por fora. Sem esta linha, olhar custo e desempenho de
   * pessoa identificada nao deixava rastro nenhum (LGPD, art. 37).
   */
  private auditRead(
    relatorio: string,
    userId: string,
    periodo: { from: string; to: string },
    linhas: number,
  ) {
    return this.authorization.record({
      action: 'reports.view',
      actorId: userId,
      targetType: 'Report',
      targetId: relatorio,
      detail: { periodo: `${periodo.from}_${periodo.to}`, linhas: String(linhas) },
    });
  }

  /**
   * Exportacao em CSV. O `report` vem da rota e e conferido contra a lista
   * branca antes de qualquer coisa: e ele que compoe o nome do arquivo devolvido
   * no Content-Disposition.
   */
  @RequirePermissions('reports.view', 'reports.export')
  @Get('export/:report')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async export(
    @Param('report') report: string,
    @Query() query: ReportQueryDto,
    @CurrentUser('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<string> {
    if (!isExportable(report)) {
      throw new BadRequestException(`Relatório desconhecido: ${report}.`);
    }
    const key = report;
    const { csv, periodo, linhas } = await this.csv.build(key, query);

    const nome = safeFilename(`${key}-${periodo}.csv`);
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);

    await this.authorization.record({
      action: 'reports.export',
      actorId: userId,
      targetType: 'Report',
      targetId: key,
      detail: { periodo, linhas: String(linhas) },
    });

    return csv;
  }
}
