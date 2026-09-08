import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { CashflowService } from './cashflow.service';
import { CostCentersService } from './cost-centers.service';
import { DailyClosingService } from './daily-closing.service';
import { FinanceController } from './finance.controller';
import { FinanceDashboardService } from './dashboard.service';
import { FinancialAccountsService } from './financial-accounts.service';
import { FinancialCategoriesService } from './financial-categories.service';
import { PayablesService } from './payables.service';
import { ReceivablesService } from './receivables.service';
import { TransfersService } from './transfers.service';

/**
 * Financeiro: contas a receber (crediario), contas a pagar e o fluxo de caixa
 * que costura os dois com o que ja passou pela gaveta; mais o nucleo de contas
 * financeiras, plano de contas, centros de custo e o dashboard.
 *
 * `ReceivablesService` e exportado porque o titulo de crediario nasce dentro da
 * transacao da venda — quem cria e o PDV, nao uma tela do financeiro.
 *
 * `CashModule` entra como dependencia porque o fechamento do dia consolida os
 * turnos com a MESMA conta do consolidado multi-caixa: somar por conta propria
 * aqui produziria dois numeros para o mesmo dia.
 */
@Module({
  imports: [CashModule],
  controllers: [FinanceController],
  providers: [
    ReceivablesService,
    PayablesService,
    CashflowService,
    DailyClosingService,
    FinancialAccountsService,
    FinancialCategoriesService,
    CostCentersService,
    TransfersService,
    FinanceDashboardService,
  ],
  exports: [ReceivablesService],
})
export class FinanceModule {}
