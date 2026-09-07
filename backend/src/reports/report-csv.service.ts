import { Injectable } from '@nestjs/common';
import { csvNumber, toCsv, type CsvColumn } from './csv';
import { ReportQueryDto } from './dto/report-query.dto';
import { ReportsService } from './reports.service';

/**
 * Relatorio -> planilha.
 *
 * Estava dentro do controller e saiu de la quando o agendamento apareceu: o
 * envio automatico precisa exatamente do mesmo CSV que a exportacao manual
 * devolve. Duplicar as colunas garantiria que um dia as duas divergissem — e o
 * gestor compararia a planilha que baixou com a que recebeu por e-mail sem
 * entender por que os numeros nao batem.
 */

/** Relatorios que podem virar planilha — lista branca de rota E de agendamento. */
export const EXPORTABLE = [
  'vendas',
  'pagamentos',
  'produtos',
  'categorias',
  'operadores',
  'estoque',
] as const;
export type ExportKey = (typeof EXPORTABLE)[number];

export const isExportable = (v: string): v is ExportKey =>
  (EXPORTABLE as readonly string[]).includes(v);

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : csvNumber(v * 100, 1);

@Injectable()
export class ReportCsvService {
  constructor(private readonly reports: ReportsService) {}

  async build(key: ExportKey, query: ReportQueryDto) {
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
