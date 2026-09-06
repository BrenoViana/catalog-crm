import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Payment, PaymentMethod, PaymentStatus } from '@prisma/client';
import { AuthorizationService } from '../access/authorization.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  PAYMENT_GATEWAYS,
  type PaymentGateway,
} from './providers/payment-gateway';

/** Estados a partir dos quais ainda ha dinheiro a devolver. */
const REFUNDABLE: PaymentStatus[] = ['AUTORIZADO', 'CONFIRMADO'];

/**
 * Orquestra a porta de pagamento: escolhe o provedor pela forma, move o
 * estado do Payment e registra o que mexe em dinheiro na trilha.
 *
 * Nenhuma chamada a provedor acontece dentro da transacao da venda — mesma
 * regra da emissao fiscal. A venda fecha primeiro; a autorizacao vem logo
 * depois, e uma recusa deixa o pagamento NEGADO em vez de derrubar a venda
 * inteira (que ja baixou estoque e ja tem numero).
 */
@Injectable()
export class PaymentsService {
  private readonly log = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: AuthorizationService,
    @Inject(PAYMENT_GATEWAYS)
    private readonly gateways: PaymentGateway[],
  ) {}

  gatewayFor(method: PaymentMethod): PaymentGateway {
    const gateway = this.gateways.find((g) => g.supports(method));
    if (!gateway) {
      throw new BadRequestException(
        `Nenhum provedor de pagamento atende a forma "${method}".`,
      );
    }
    return gateway;
  }

  /**
   * Estado com que o pagamento nasce, decidido DENTRO da transacao da venda.
   * Quem liquida no balcao ja nasce confirmado; quem depende de terceiro
   * nasce PENDENTE e espera `settleSale`.
   */
  initialStatus(method: PaymentMethod): PaymentStatus {
    return this.gatewayFor(method).name === 'balcao' ? 'CONFIRMADO' : 'PENDENTE';
  }

  /** Provedor gravado no pagamento, para conciliacao posterior. */
  providerName(method: PaymentMethod): string {
    return this.gatewayFor(method).name;
  }

  /**
   * Autoriza os pagamentos ainda PENDENTES de uma venda. Roda apos o commit.
   * Nunca lanca: uma falha do provedor vira NEGADO com o motivo gravado.
   */
  async settleSale(saleId: string): Promise<void> {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      select: {
        id: true,
        number: true,
        total: true,
        payments: { where: { status: 'PENDENTE' } },
      },
    });
    if (!sale || sale.payments.length === 0) return;

    for (const payment of sale.payments) {
      await this.authorizeOne(payment, {
        id: sale.id,
        number: sale.number,
        total: sale.total,
      });
    }
  }

  private async authorizeOne(
    payment: Payment,
    sale: { id: string; number: number; total: unknown },
  ) {
    const gateway = this.gatewayFor(payment.method);

    // Trava otimista: so sai de PENDENTE quem ainda esta PENDENTE, para
    // duas chamadas concorrentes nao autorizarem o mesmo pagamento duas vezes.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: 'PENDENTE' },
      data: { status: 'PROCESSANDO', provider: gateway.name },
    });
    if (claimed.count !== 1) return;

    try {
      const result = await gateway.authorize({
        payment,
        sale: sale as never,
      });
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: result.status,
          externalId: result.externalId ?? null,
          authorizationCode: result.authorizationCode ?? null,
          qrCode: result.qrCode ?? null,
          rejectionReason: result.rejectionReason ?? null,
          authorizedAt:
            result.status === 'AUTORIZADO' || result.status === 'CONFIRMADO'
              ? new Date()
              : null,
        },
      });
      if (result.status === 'NEGADO') {
        this.log.warn(
          `Pagamento ${payment.id} (${payment.method}) negado por ${gateway.name}: ${
            result.rejectionReason ?? 'sem motivo'
          }`,
        );
      }
    } catch (err) {
      // O detalhe da excecao vai SO para o log. `rejectionReason` e devolvido
      // pela API e impresso no PDV: a mensagem de erro de um cliente HTTP
      // costuma trazer URL, corpo e ate header de autorizacao do provedor.
      this.log.error(
        `Falha ao autorizar o pagamento ${payment.id} em ${gateway.name}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      await this.prisma.payment
        .update({
          where: { id: payment.id },
          data: {
            status: 'NEGADO',
            rejectionReason: 'Falha de comunicacao com o provedor de pagamento.',
          },
        })
        .catch(() => undefined);
    }
  }

  /**
   * Estorna todos os pagamentos estornaveis de uma venda (cancelamento).
   * O dinheiro em especie ja e devolvido na gaveta pelo CashMovement do
   * cancelamento; aqui o efeito e marcar o pagamento e deixar rastro.
   */
  async refundSale(saleId: string, reason: string, actorId: string) {
    const payments = await this.prisma.payment.findMany({
      where: { saleId, status: { in: REFUNDABLE } },
    });

    // Devolve quem NAO foi estornado, para quem chamou registrar. Estorno que
    // falha em silencio e dinheiro que nao voltou ao cliente e nao aparece em
    // relatorio nenhum — a venda cancelada sai do escopo do X/Z.
    const failed: Array<{ id: string; method: string; amount: string }> = [];
    for (const payment of payments) {
      const ok = await this.refundOne(payment, reason, actorId);
      if (!ok) {
        failed.push({
          id: payment.id,
          method: payment.method,
          amount: String(payment.amount),
        });
      }
    }
    return failed;
  }

  /** true quando o pagamento foi efetivamente estornado. */
  private async refundOne(
    payment: Payment,
    reason: string,
    actorId: string,
  ): Promise<boolean> {
    const gateway = this.gatewayFor(payment.method);

    // Mesma trava otimista da autorizacao: reivindica antes de falar com o
    // provedor, para um retry ou duplo clique nao estornar duas vezes.
    const claimed = await this.prisma.payment.updateMany({
      where: { id: payment.id, status: { in: REFUNDABLE } },
      data: { status: 'PROCESSANDO' },
    });
    // Perdeu a corrida: outro estorno ja esta em curso — nao e falha.
    if (claimed.count !== 1) return true;

    const restore = () =>
      this.prisma.payment
        .updateMany({
          where: { id: payment.id, status: 'PROCESSANDO' },
          data: { status: payment.status },
        })
        .catch(() => undefined);

    // Trilha da tentativa que NAO devolveu o dinheiro. Vale para os dois
    // desfechos ruins — recusa do provedor e excecao —, senao a falha mais
    // comum na pratica (queda de rede com o PSP) some sem rastro.
    const recordFailure = (detail: string) =>
      this.authorization
        .record({
          action: 'payments.refund.failed',
          actorId,
          targetType: 'Payment',
          targetId: payment.id,
          detail: {
            saleId: payment.saleId,
            method: payment.method,
            amount: String(payment.amount),
            provider: gateway.name,
            reason,
            failure: detail,
          },
        })
        .catch(() => undefined);

    try {
      const result = await gateway.refund({ payment, reason });
      if (result.status !== 'ESTORNADO') {
        this.log.error(
          `Provedor ${gateway.name} recusou o estorno do pagamento ${payment.id}: ${
            result.rejectionReason ?? 'sem motivo'
          }`,
        );
        await restore();
        await recordFailure(result.rejectionReason ?? 'recusado pelo provedor');
        return false;
      }
      await this.prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'ESTORNADO', refundedAt: new Date() },
      });
      // Estorno mexe em dinheiro: entra na trilha mesmo quando o provedor e
      // o balcao, para o fechamento ter a quem perguntar.
      await this.authorization.record({
        action: 'payments.refund',
        actorId,
        targetType: 'Payment',
        targetId: payment.id,
        detail: {
          saleId: payment.saleId,
          method: payment.method,
          amount: String(payment.amount),
          provider: gateway.name,
          reason,
        },
      });
      return true;
    } catch (err) {
      this.log.error(
        `Falha ao estornar o pagamento ${payment.id} em ${gateway.name}: ${
          err instanceof Error ? err.message : err
        }`,
      );
      await restore();
      // Detalhe da excecao NAO vai para a trilha (mesma razao de SEC-024):
      // mensagem de cliente HTTP carrega URL e credencial do provedor.
      await recordFailure('falha de comunicacao com o provedor');
      return false;
    }
  }

  /**
   * Pagamentos de uma venda, com `select` explicito.
   *
   * O `qrCode` so sai enquanto a cobranca esta viva (PENDENTE/PROCESSANDO):
   * depois de liquidada, um payload de cobranca recuperavel indefinidamente
   * por qualquer `sales.view` e superficie sem utilidade. `externalId` fica
   * fora — e mapa da integracao, serve a conciliacao, nao ao balcao.
   */
  async listForSale(saleId: string) {
    const rows = await this.prisma.payment.findMany({
      where: { saleId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        saleId: true,
        method: true,
        amount: true,
        installments: true,
        status: true,
        provider: true,
        authorizationCode: true,
        qrCode: true,
        rejectionReason: true,
        authorizedAt: true,
        refundedAt: true,
        createdAt: true,
      },
    });
    return rows.map((p) => ({
      ...p,
      qrCode:
        p.status === 'PENDENTE' || p.status === 'PROCESSANDO' ? p.qrCode : null,
    }));
  }

  /**
   * Versao para o fechamento da venda: mantem o `qrCode` mesmo ja liquidado,
   * porque e o unico momento em que o PDV precisa mostra-lo ao cliente. Nao
   * expoe `externalId` — conciliacao nao e assunto do balcao.
   */
  listForCheckout(saleId: string) {
    return this.prisma.payment.findMany({
      where: { saleId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        saleId: true,
        method: true,
        amount: true,
        installments: true,
        status: true,
        provider: true,
        authorizationCode: true,
        qrCode: true,
        rejectionReason: true,
        authorizedAt: true,
        refundedAt: true,
        createdAt: true,
      },
    });
  }

  /** Provedores ativos — util para diagnostico e para a tela de configuracoes. */
  describeGateways() {
    return this.gateways.map((g) => ({
      name: g.name,
      methods: (
        [
          'DINHEIRO',
          'PIX',
          'DEBITO',
          'CREDITO',
          'CREDIARIO',
          'OUTRO',
          'FIDELIDADE',
        ] as PaymentMethod[]
      ).filter((m) => g.supports(m)),
    }));
  }
}
