import { Injectable, Logger } from '@nestjs/common';
import type { PaymentMethod } from '@prisma/client';
import type {
  PaymentAuthorizeContext,
  PaymentAuthorizeResult,
  PaymentGateway,
  PaymentRefundContext,
  PaymentRefundResult,
} from './payment-gateway';

/**
 * Provedor eletronico simulado — o equivalente ao FakeFiscalProvider.
 *
 * Serve para exercitar a porta ponta a ponta sem credencial de adquirente:
 * devolve NSU, codigo de autorizacao e, no Pix, um payload de QR com a
 * estrutura do BR Code. NAO fala com ninguem e NAO deve ir para producao —
 * a troca por PayGo/SiTef/Stone/PSP e so mudar o provider no modulo.
 *
 * Captura imediata (CONFIRMADO) de proposito: e o comportamento que o
 * sistema ja tinha, entao introduzir a costura nao muda relatorio nem
 * fechamento de caixa. Um provedor real devolve AUTORIZADO (cartao, espera
 * captura) ou PROCESSANDO (Pix, espera webhook) e o PaymentsService cuida
 * do resto.
 */
@Injectable()
export class FakeElectronicProvider implements PaymentGateway {
  readonly name = 'fake-eletronico';
  private readonly log = new Logger(FakeElectronicProvider.name);

  private static readonly METHODS: PaymentMethod[] = ['PIX', 'DEBITO', 'CREDITO'];

  supports(method: PaymentMethod): boolean {
    return FakeElectronicProvider.METHODS.includes(method);
  }

  async authorize(ctx: PaymentAuthorizeContext): Promise<PaymentAuthorizeResult> {
    const { payment, sale } = ctx;

    const amount = Number(payment.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      return { status: 'NEGADO', rejectionReason: 'Valor inválido.' };
    }

    const externalId = `SIM-${Date.now().toString(36).toUpperCase()}-${payment.id.slice(0, 8)}`;
    const authorizationCode = String(
      Math.abs(hash(`${payment.id}${sale.number}`)) % 1_000_000,
    ).padStart(6, '0');

    this.log.debug(
      `Autorizacao simulada ${payment.method} de ${payment.amount} na venda #${sale.number}.`,
    );

    return {
      status: 'CONFIRMADO',
      externalId,
      authorizationCode,
      qrCode:
        payment.method === 'PIX'
          ? buildFakeBrCode(amount, externalId)
          : undefined,
    };
  }

  async refund(ctx: PaymentRefundContext): Promise<PaymentRefundResult> {
    this.log.debug(
      `Estorno simulado do pagamento ${ctx.payment.id}: ${ctx.reason}`,
    );
    return { status: 'ESTORNADO' };
  }
}

/** Hash estavel e barato — so para gerar um NSU reproduzivel na simulacao. */
function hash(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) {
    h = (h << 5) - h + value.charCodeAt(i);
    h |= 0;
  }
  return h;
}

/**
 * Monta um payload no formato do BR Code (EMV) apenas o suficiente para o
 * PDV ter o que exibir. Sem CRC real: e simulacao, nao paga nada.
 */
function buildFakeBrCode(amount: number, txid: string): string {
  const field = (id: string, value: string) =>
    `${id}${String(value.length).padStart(2, '0')}${value}`;
  const merchant =
    field('00', 'BR.GOV.BCB.PIX') + field('01', 'simulado@catalog-crm.local');
  return [
    field('00', '01'),
    field('26', merchant),
    field('52', '0000'),
    field('53', '986'),
    field('54', amount.toFixed(2)),
    field('58', 'BR'),
    field('59', 'SIMULADO'),
    field('60', 'SAO PAULO'),
    field('62', field('05', txid.slice(0, 25))),
    '6304SIMU',
  ].join('');
}
