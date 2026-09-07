import type { ReportChannel } from '@prisma/client';

/** O anexo pronto: o CSV do relatorio e como ele deve se chamar. */
export interface ReportAttachment {
  filename: string;
  /** Conteudo ja serializado em CSV (separador `;`, com BOM). */
  content: string;
  rows: number;
}

export interface DeliveryContext {
  scheduleName: string;
  report: string;
  /** Destinatario CRU. Nunca o registre: use `maskRecipient` na trilha. */
  recipient: string;
  period: { from: string; to: string };
  attachment: ReportAttachment;
}

export interface DeliveryResult {
  ok: boolean;
  /** Motivo da falha, curto e sem dado pessoal — vai para a trilha. */
  error?: string;
}

/**
 * Porta de saida do relatorio agendado.
 *
 * Existe pela mesma razao que `FiscalProvider` e `PaymentGateway`: o
 * agendamento e a regra ("todo dia 7h, vendas de ontem, para o gerente") e nao
 * deve saber se o envio sai por SMTP, por API de WhatsApp ou por nada. Enquanto
 * a loja nao traz credencial de canal, o provedor de REGISTRO fecha o ciclo.
 */
export interface DeliveryChannel {
  readonly channel: ReportChannel;
  send(ctx: DeliveryContext): Promise<DeliveryResult>;
}

/**
 * Mascara o destinatario para a trilha de entregas.
 *
 * A trilha e consultada por qualquer um com `reports.schedule`, e guardar
 * e-mail e telefone em claro numa tabela de log espalha dado pessoal por um
 * lugar que ninguem trata como cadastro (LGPD, art. 6, VII — necessidade). O
 * que a trilha precisa provar e "saiu para o destinatario certo", e o suficiente
 * para isso e reconhecer o endereco, nao reconstitui-lo.
 */
export function maskRecipient(recipient: string): string {
  const value = recipient.trim();
  const at = value.indexOf('@');
  if (at > 0) {
    const user = value.slice(0, at);
    const visible = user.slice(0, Math.min(2, user.length));
    return `${visible}${'*'.repeat(Math.max(user.length - visible.length, 1))}${value.slice(at)}`;
  }
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  return '****';
}
