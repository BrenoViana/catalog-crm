import { Controller, Get, Param } from '@nestjs/common';
import { RequirePermissions } from '../common/permissions.decorator';
import { PaymentsService } from './payments.service';

/**
 * Consulta da porta de pagamento. Somente leitura.
 *
 * NAO ha rota de estorno avulso aqui de proposito: estorno e dinheiro saindo
 * e precisa das mesmas guardas do cancelamento de venda (turno aberto, venda
 * concluida, posse, lancamento na gaveta, registro de quem liberou). Enquanto
 * essas guardas nao existirem, o unico caminho de estorno e o cancelamento da
 * venda, que ja as tem — ver SEC-018/019/020 no baseline.
 */
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Provedores ativos e as formas que cada um atende. */
  @RequirePermissions('sales.view')
  @Get('gateways')
  gateways() {
    return this.payments.describeGateways();
  }

  @RequirePermissions('sales.view')
  @Get('sale/:saleId')
  listForSale(@Param('saleId') saleId: string) {
    return this.payments.listForSale(saleId);
  }
}
