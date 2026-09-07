import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { MetricsService } from '../common/metrics.service';
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
  constructor(
    private readonly ops: OpsService,
    private readonly metrics: MetricsService,
  ) {}

  @RequirePermissions('dashboard.view')
  @Get('alerts')
  alerts(@CurrentUser('userId') viewerId: string) {
    return this.ops.alerts(viewerId);
  }

  /**
   * Metricas do processo: latencia e taxa de erro por rota, mais os contadores
   * de negocio. Permissao propria (`ops.metrics`), separada do dashboard: a
   * resposta desenha o mapa de rotas da API e mostra onde ela esta falhando —
   * util para quem sustenta o sistema, informacao de reconhecimento para quem
   * nao sustenta. O gerente que ve o painel da loja nao precisa disso.
   */
  @RequirePermissions('ops.metrics')
  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
