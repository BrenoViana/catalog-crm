import { Injectable, Logger } from '@nestjs/common';
import type { ReportChannel } from '@prisma/client';
import type {
  DeliveryChannel,
  DeliveryContext,
  DeliveryResult,
} from './delivery-channel';
import { maskRecipient } from './delivery-channel';

/**
 * Canal de REGISTRO: nao envia nada para fora.
 *
 * E o equivalente do provedor fiscal fake — existe para o agendamento inteiro
 * (calculo da proxima execucao, geracao do CSV, trilha de entrega, falha e
 * repique) ficar exercitavel e auditavel ANTES de a loja contratar SMTP ou uma
 * API de WhatsApp. Quando a credencial chegar, entra um canal irmao e este
 * continua sendo o padrao seguro para quem nao configurou nada.
 *
 * O conteudo do relatorio nao vai para o log: e exatamente o dado sensivel
 * (custo, margem, desempenho por operador) que a exportacao ja audita. O que
 * fica registrado e o fato do envio, com o destinatario mascarado.
 */
@Injectable()
export class RegistroChannel implements DeliveryChannel {
  readonly channel: ReportChannel = 'REGISTRO';
  private readonly log = new Logger(RegistroChannel.name);

  async send(ctx: DeliveryContext): Promise<DeliveryResult> {
    this.log.log(
      `Relatorio "${ctx.report}" (${ctx.period.from}..${ctx.period.to}, ` +
        `${ctx.attachment.rows} linhas) registrado para ${maskRecipient(ctx.recipient)}.`,
    );
    return { ok: true };
  }
}
