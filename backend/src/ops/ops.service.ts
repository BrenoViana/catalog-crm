import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AccessService } from '../access/access.service';
import { businessDateUtc, dayLabel } from '../common/business-date';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../settings/app-settings.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Quanto pesa cada alerta. `alto` e o que custa dinheiro se ficar sem resposta. */
export type AlertLevel = 'alto' | 'medio' | 'baixo';

export interface OpsAlert {
  /** Chave estavel do tipo de alerta — a tela agrupa e o teste referencia. */
  code: string;
  level: AlertLevel;
  title: string;
  detail: string;
  /** Para onde a tela manda quem for resolver. */
  link?: string;
  /** Numeros do alerta, quando fazem sentido (valor, contagem, horas). */
  data?: Record<string, string | number>;
}

/**
 * Alertas operacionais.
 *
 * A loja nao tem quem fique olhando graficos: o que ela precisa e de uma lista
 * curta do que esta fora do lugar AGORA. Cada alerta aqui nasceu de um jeito
 * conhecido de perder dinheiro no balcao:
 *
 * - **Caixa aberto ha horas** — gaveta que troca de mao sem ninguem assinar a
 *   contagem. Quando aparece a diferenca, ninguem sabe de qual turno veio.
 * - **Divergencia recorrente por operador** — uma diferenca e erro de troco;
 *   a mesma pessoa com diferenca toda semana e outra coisa.
 * - **Dia anterior sem fechamento** — o consolidado so vira prova se alguem
 *   fechar; dia que passa sem fechar vira dia que ninguem conferiu.
 * - **Pagamento sem desfecho** — venda entregue cujo cartao ficou PROCESSANDO
 *   ou voltou NEGADO: mercadoria que saiu sem pagamento.
 * - **Titulos vencidos** — crediario esquecido e o dinheiro que a loja acha
 *   que tem e nao tem.
 *
 * Tudo aqui e leitura agregada e barata: a lista e consultada com frequencia
 * pela tela inicial e nao pode competir com o PDV pelo banco.
 */
@Injectable()
export class OpsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
    private readonly access: AccessService,
  ) {}

  async alerts(viewerId: string): Promise<{ generatedAt: Date; alerts: OpsAlert[] }> {
    const [maxShiftHours, divergenceAlert, canSeeOperators] = await Promise.all([
      this.settings.getNumber('ops.maxShiftHours'),
      this.settings.getNumber('ops.divergenceAlert'),
      // Divergencia acumulada com nome e valor e avaliacao de conduta de
      // funcionario: quem le o painel nao herda esse acesso por tabela, ele sai
      // da permissao criada para isso (SEC-070).
      this.access.can(viewerId, 'cash.consolidate'),
    ]);

    const now = new Date();
    const shiftCutoff = new Date(now.getTime() - maxShiftHours * HOUR_MS);
    const last30 = new Date(now.getTime() - 30 * DAY_MS);

    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayLabel = dayLabel(yesterday);

    const [
      staleSessions,
      surplusByOperator,
      shortageByOperator,
      yesterdayClosing,
      unsettled,
      overdue,
    ] = await Promise.all([
        this.prisma.cashSession.findMany({
          where: { status: 'ABERTA', openedAt: { lt: shiftCutoff } },
          orderBy: { openedAt: 'asc' },
          take: 20,
          select: {
            id: true,
            terminal: true,
            openedAt: true,
            operator: { select: { id: true, name: true } },
          },
        }),
        // Agrega no BANCO, sem teto de linhas. Um `findMany` com `take` devolve
        // uma fatia arbitraria: passando do teto, a acumulacao por operador
        // ficaria incompleta em silencio — e um controle de deteccao que falha
        // sem avisar e pior que nenhum (SEC-074). Sobra e falta entram
        // separadas para o valor absoluto nao se cancelar.
        this.prisma.cashSession.groupBy({
          by: ['operatorId'],
          _count: true,
          _sum: { difference: true },
          where: {
            status: 'FECHADA',
            closedAt: { gte: last30 },
            difference: { gt: 0 },
          },
        }),
        this.prisma.cashSession.groupBy({
          by: ['operatorId'],
          _count: true,
          _sum: { difference: true },
          where: {
            status: 'FECHADA',
            closedAt: { gte: last30 },
            difference: { lt: 0 },
          },
        }),
        this.prisma.dailyClosing.findFirst({
          where: { businessDate: businessDateUtc(yesterdayLabel) },
          select: { status: true },
        }),
        this.prisma.payment.groupBy({
          by: ['status'],
          _count: true,
          _sum: { amount: true },
          where: {
            status: { in: ['PENDENTE', 'PROCESSANDO', 'NEGADO'] },
            sale: { status: 'CONCLUIDA', completedAt: { gte: last30 } },
          },
        }),
        this.prisma.receivable.aggregate({
          _count: true,
          _sum: { amount: true, paidAmount: true },
          where: { status: { in: ['ABERTO', 'PARCIAL'] }, dueDate: { lt: now } },
        }),
      ]);

    const alerts: OpsAlert[] = [];

    for (const s of staleSessions) {
      const hours = Math.floor((now.getTime() - s.openedAt.getTime()) / HOUR_MS);
      alerts.push({
        code: 'cash.staleSession',
        level: 'alto',
        title: `Caixa aberto ha ${hours}h`,
        detail:
          `${s.operator.name} abriu ${s.terminal ?? 'um caixa'} ha ${hours} horas e ainda ` +
          'nao fechou. Sem a contagem, a diferenca do turno some no do proximo.',
        link: '/caixa',
        data: { turno: s.id, operador: s.operator.name, horas: hours },
      });
    }

    // Divergencia por operador: acumula os fechamentos dos ultimos 30 dias. Uma
    // diferenca isolada nao vira alerta; o que vira e o acumulado passar do
    // limite configurado — e o padrao, nao o evento, que interessa.
    const byOperator = new Map<
      string,
      { total: Prisma.Decimal; occurrences: number }
    >();
    for (const row of [...surplusByOperator, ...shortageByOperator]) {
      const acc = byOperator.get(row.operatorId) ?? { total: D(0), occurrences: 0 };
      acc.total = acc.total.plus(D(row._sum.difference ?? 0).abs());
      acc.occurrences += row._count;
      byOperator.set(row.operatorId, acc);
    }

    const flagged = canSeeOperators
      ? [...byOperator.entries()].filter(([, row]) => !row.total.lt(divergenceAlert))
      : [];
    // O nome so e resolvido para quem entrou na lista: quem consulta o painel
    // nao precisa da folha inteira de operadores para ver um alerta.
    const names = new Map(
      flagged.length === 0
        ? []
        : (
            await this.prisma.user.findMany({
              where: { id: { in: flagged.map(([id]) => id) } },
              select: { id: true, name: true },
            })
          ).map((u) => [u.id, u.name] as const),
    );

    for (const [id, row] of flagged) {
      const name = names.get(id) ?? 'operador removido';
      alerts.push({
        code: 'cash.operatorDivergence',
        level: row.occurrences >= 3 ? 'alto' : 'medio',
        title: `Divergencia de caixa: ${name}`,
        detail:
          `${row.occurrences} fechamento(s) com diferenca nos ultimos 30 dias, somando ` +
          `R$ ${row.total.toFixed(2)} em valor absoluto.`,
        link: '/caixa',
        data: {
          operador: id,
          ocorrencias: row.occurrences,
          total: row.total.toFixed(2),
        },
      });
    }

    // Dia anterior sem fechamento — so alerta se houve movimento, senao a loja
    // que nao abriu no domingo receberia um alerta todo domingo.
    if (!yesterdayClosing || yesterdayClosing.status === 'REABERTO') {
      const start = businessDateUtc(yesterdayLabel);
      const sessionsYesterday = await this.prisma.cashSession.count({
        where: {
          openedAt: {
            gte: new Date(
              yesterday.getFullYear(),
              yesterday.getMonth(),
              yesterday.getDate(),
            ),
            lt: new Date(
              yesterday.getFullYear(),
              yesterday.getMonth(),
              yesterday.getDate() + 1,
            ),
          },
        },
      });
      if (sessionsYesterday > 0) {
        alerts.push({
          code: 'finance.dayNotClosed',
          level: 'medio',
          title: `O dia ${yesterdayLabel} nao foi fechado`,
          detail: yesterdayClosing
            ? `O dia foi reaberto e ainda nao voltou a ser fechado. Foram ${sessionsYesterday} turno(s).`
            : `Houve ${sessionsYesterday} turno(s) de caixa e nenhum fechamento consolidado.`,
          link: '/financeiro',
          data: { dia: yesterdayLabel, turnos: sessionsYesterday, iso: start.toISOString() },
        });
      }
    }

    for (const u of unsettled) {
      const amount = D(u._sum.amount ?? 0);
      if (amount.isZero()) continue;
      alerts.push({
        code: 'payments.unsettled',
        level: u.status === 'NEGADO' ? 'alto' : 'medio',
        title: `Pagamento ${u.status.toLowerCase()} em venda concluida`,
        detail:
          `${u._count} pagamento(s) somando R$ ${amount.toFixed(2)} em vendas ja concluidas ` +
          'nos ultimos 30 dias. Mercadoria saiu; o dinheiro nao entrou.',
        link: '/vendas',
        data: { situacao: u.status, quantidade: u._count, valor: amount.toFixed(2) },
      });
    }

    const overdueBalance = D(overdue._sum.amount ?? 0).minus(overdue._sum.paidAmount ?? 0);
    if (overdue._count > 0 && overdueBalance.gt(0)) {
      alerts.push({
        code: 'finance.overdueReceivables',
        level: 'medio',
        title: 'Crediario vencido',
        detail:
          `${overdue._count} titulo(s) vencido(s), saldo de R$ ${overdueBalance.toFixed(2)}.`,
        link: '/financeiro',
        data: { titulos: overdue._count, saldo: overdueBalance.toFixed(2) },
      });
    }

    const weight: Record<AlertLevel, number> = { alto: 0, medio: 1, baixo: 2 };
    alerts.sort((a, b) => weight[a.level] - weight[b.level]);

    return { generatedAt: now, alerts };
  }
}
