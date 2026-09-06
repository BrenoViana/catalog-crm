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
import { csvNumber, safeFilename, toCsv, type CsvColumn } from './csv';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/** Relatorios que podem ser exportados, e como cada um vira planilha. */
const EXPORTABLE = [
  'vendas',
  'pagamentos',
  'produtos',
  'categorias',
  'operadores',
  'estoque',
] as const;
type ExportKey = (typeof EXPORTABLE)[number];

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : csvNumber(v * 100, 1);

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
    if (!EXPORTABLE.includes(report as ExportKey)) {
      throw new BadRequestException(
        `Relatório desconhecido: ${report}. Disponíveis: ${EXPORTABLE.join(', ')}.`,
      );
    }
    const key = report as ExportKey;
    const { csv, periodo, linhas } = await this.buildCsv(key, query);

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

  private async buildCsv(key: ExportKey, query: ReportQueryDto) {
    switch (key) {
      case 'vendas': {
        const data = await this.reports.sales(query);
        const cols: CsvColumn<(typeof data.serie)[number]>[] = [
          { header: 'Período', value: (r) => r.label },
          { header: 'Início', value: (r) => r.key },
          { header: 'Vendas', value: (r) => r.vendas, numeric: true },
          { header: 'Receita', value: (r) => csvNumber(r.receita), numeric: true },
          { header: 'Descontos', value: (r) => csvNumber(r.descontos), numeric: true },
          { header: 'Devoluções', value: (r) => csvNumber(r.devolucoes), numeric: true },
        ];
        return {
          csv: toCsv(cols, data.serie),
          periodo: `${data.periodo.from}_${data.periodo.to}`,
          linhas: data.serie.length,
        };
      }
      case 'pagamentos': {
        const data = await this.reports.payments(query);
        const cols: CsvColumn<(typeof data.linhas)[number]>[] = [
          { header: 'Forma de pagamento', value: (r) => r.method },
          { header: 'Recebimentos', value: (r) => r.quantidade, numeric: true },
          { header: 'Valor', value: (r) => csvNumber(r.valor), numeric: true },
          { header: 'Participação (%)', value: (r) => pct(r.participacao), numeric: true },
          { header: 'Ticket médio', value: (r) => csvNumber(r.ticketMedio), numeric: true },
        ];
        return {
          csv: toCsv(cols, data.linhas),
          periodo: `${data.periodo.from}_${data.periodo.to}`,
          linhas: data.linhas.length,
        };
      }
      case 'produtos': {
        const data = await this.reports.products(query);
        const cols: CsvColumn<(typeof data.linhas)[number]>[] = [
          { header: 'Curva', value: (r) => r.curva },
          { header: 'SKU', value: (r) => r.sku },
          { header: 'Produto', value: (r) => r.nome },
          { header: 'Categoria', value: (r) => r.categoria },
          { header: 'Quantidade', value: (r) => csvNumber(r.quantidade, 3), numeric: true },
          { header: 'Receita', value: (r) => csvNumber(r.receita), numeric: true },
          { header: 'Descontos', value: (r) => csvNumber(r.descontos), numeric: true },
          { header: 'Custo (estimado)', value: (r) => (r.custo === null ? '' : csvNumber(r.custo)), numeric: true },
          { header: 'Margem (estimada)', value: (r) => (r.margem === null ? '' : csvNumber(r.margem)), numeric: true },
          { header: 'Margem (%)', value: (r) => pct(r.margemPercentual), numeric: true },
          { header: 'Participação (%)', value: (r) => pct(r.participacao), numeric: true },
          { header: 'Acumulado (%)', value: (r) => pct(r.participacaoAcumulada), numeric: true },
        ];
        return {
          csv: toCsv(cols, data.linhas),
          periodo: `${data.periodo.from}_${data.periodo.to}`,
          linhas: data.linhas.length,
        };
      }
      case 'categorias': {
        const data = await this.reports.categories(query);
        const cols: CsvColumn<(typeof data.linhas)[number]>[] = [
          { header: 'Categoria', value: (r) => r.categoria },
          { header: 'Produtos', value: (r) => r.produtos, numeric: true },
          { header: 'Quantidade', value: (r) => csvNumber(r.quantidade, 3), numeric: true },
          { header: 'Receita', value: (r) => csvNumber(r.receita), numeric: true },
          { header: 'Margem (estimada)', value: (r) => csvNumber(r.margem), numeric: true },
          { header: 'Margem (%)', value: (r) => pct(r.margemPercentual), numeric: true },
          { header: 'Participação (%)', value: (r) => pct(r.participacao), numeric: true },
        ];
        return {
          csv: toCsv(cols, data.linhas),
          periodo: `${data.periodo.from}_${data.periodo.to}`,
          linhas: data.linhas.length,
        };
      }
      case 'operadores': {
        const data = await this.reports.operators(query);
        const cols: CsvColumn<(typeof data.linhas)[number]>[] = [
          { header: 'Operador', value: (r) => r.nome },
          { header: 'Vendas', value: (r) => r.vendas, numeric: true },
          { header: 'Receita', value: (r) => csvNumber(r.receita), numeric: true },
          { header: 'Ticket médio', value: (r) => csvNumber(r.ticketMedio), numeric: true },
          { header: 'Descontos concedidos', value: (r) => csvNumber(r.descontos), numeric: true },
          { header: 'Vendas canceladas', value: (r) => r.canceladas, numeric: true },
          { header: 'Participação (%)', value: (r) => pct(r.participacao), numeric: true },
        ];
        return {
          csv: toCsv(cols, data.linhas),
          periodo: `${data.periodo.from}_${data.periodo.to}`,
          linhas: data.linhas.length,
        };
      }
      case 'estoque': {
        const data = await this.reports.inventory();
        const cols: CsvColumn<(typeof data.linhas)[number]>[] = [
          { header: 'SKU', value: (r) => r.sku },
          { header: 'Produto', value: (r) => r.nome },
          { header: 'Categoria', value: (r) => r.categoria },
          { header: 'Saldo', value: (r) => csvNumber(r.quantidade, 3), numeric: true },
          { header: 'Mínimo', value: (r) => csvNumber(r.minimo, 3), numeric: true },
          { header: 'Preço de venda', value: (r) => csvNumber(r.precoVenda), numeric: true },
          {
            header: 'Custo unitário',
            value: (r) => (r.custoUnitario === null ? '' : csvNumber(r.custoUnitario)),
          },
          {
            header: 'Valor a custo',
            value: (r) => (r.valorCusto === null ? '' : csvNumber(r.valorCusto)),
          },
          { header: 'Valor a venda', value: (r) => csvNumber(r.valorVenda), numeric: true },
          { header: 'Em ruptura', value: (r) => (r.ruptura ? 'sim' : 'não') },
          { header: 'Sem giro (90d)', value: (r) => (r.semGiro90d ? 'sim' : 'não') },
        ];
        return {
          csv: toCsv(cols, data.linhas),
          periodo: data.geradoEm.slice(0, 10),
          linhas: data.linhas.length,
        };
      }
    }
  }
}
