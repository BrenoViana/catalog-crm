import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { RequirePermissions } from '../common/permissions.decorator';
import { OpsService } from './ops.service';

/**
 * Alertas operacionais.
 *
 * Fica atras de `dashboard.view` porque e exatamente o publico do painel: quem
 * ja ve os indicadores da loja e quem precisa ver o que esta fora do lugar.
 * Nao ha modulo licenciado no caminho — alerta de caixa aberto e devolucao sem
 * pagamento nao e recurso opcional.
 */
@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @RequirePermissions('dashboard.view')
  @Get('alerts')
  alerts(@CurrentUser('userId') viewerId: string) {
    return this.ops.alerts(viewerId);
  }
}
