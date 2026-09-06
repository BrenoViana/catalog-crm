import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  businessDateLabel,
  businessDateUtc,
  dayLockKey,
  parseDayLabel,
  todayLabel,
} from '../common/business-date';
import { AccessService } from '../access/access.service';
import { CashService } from '../cash/cash.service';
import { PrismaService } from '../prisma/prisma.service';
import { CloseDayDto, ReopenDayDto } from './dto/finance.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

const snapshotIsObject = (v: Prisma.JsonValue): boolean =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** O que `forViewer` precisa enxergar da previa para poder podar o recorte. */
interface DayPreviewShape {
  byOperator: unknown[];
  sessions: unknown[];
  divergences: unknown[];
}

/**
 * Fechamento financeiro do dia.
 *
 * O X/Z fecha um TURNO; isto fecha o DIA. Numa loja com tres caixas, tres
 * leituras Z sao tres papeis que ninguem soma — e a diferenca de gaveta de um
 * operador se dilui no meio das outras duas. O fechamento junta os turnos, as
 * formas de pagamento, as sangrias, as devolucoes e as despesas pagas no dia
 * num unico numero conferido, e trava o dia.
 *
 * Tres decisoes que dao o formato ao resto:
 *
 * 1. **O dia nao fecha com turno aberto.** Fechar por cima de uma gaveta que
 *    ninguem contou produz um numero que parece conferido e nao e. O servico
 *    recusa e diz quais turnos faltam.
 * 2. **O retrato e gravado, nao recalculado.** Uma devolucao lancada amanha
 *    mudaria o total de ontem se ele fosse recalculado na leitura, e o
 *    fechamento deixaria de ser prova do que foi conferido. `snapshot` guarda
 *    os numeros; a tela mostra o snapshot e, quando pedido, a diferenca contra
 *    o estado atual.
 * 3. **Reabrir e permitido e auditado.** Bloquear reabertura leva o lojista a
 *    corrigir por fora, no banco. Reabrir exige motivo, vai para o
 *    `AuditLog` e mantem o retrato anterior ate o proximo fechamento.
 */
@Injectable()
export class DailyClosingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cash: CashService,
    private readonly access: AccessService,
  ) {}

  /**
   * Estado de um dia: o retrato gravado (se ja foi fechado) e sempre a previa
   * calculada agora — e a previa que o gerente confere antes de fechar, e
   * depois do fechamento e o que denuncia movimento posterior.
   */
  async status(viewerId: string, dateLabel?: string) {
    const label = this.normalize(dateLabel ?? todayLabel());
    const [closing, preview, canSeeOperators] = await Promise.all([
      this.findClosing(label),
      this.preview(label),
      this.canConsolidate(viewerId),
    ]);
    return {
      date: label,
      closing: closing ? this.present(closing, canSeeOperators) : null,
      preview: this.forViewer(preview, canSeeOperators),
      /** O dia esta travado: nao aceita turno novo enquanto nao for reaberto. */
      locked: closing?.status === 'FECHADO',
      blockers: preview.openSessions,
      /** O chamador pode ver o recorte por operador e as divergencias alheias. */
      canSeeOperators,
    };
  }

  /**
   * O recorte por operador e a lista de divergencias sao o dado que
   * `cash.consolidate` existe para proteger: e avaliacao de conduta de
   * funcionario, com nome e valor. `finance.view` autoriza a fechar as contas
   * do dia, nao a ler isso — entao a resposta sai sem esses campos para quem
   * nao tem a permissao especifica (SEC-070). Os totais, os bloqueadores e o
   * movimento do dia continuam, que e o que o fechamento precisa.
   */
  private forViewer<T extends DayPreviewShape>(preview: T, canSeeOperators: boolean): T {
    if (canSeeOperators) return preview;
    return { ...preview, byOperator: [], sessions: [], divergences: [] };
  }

  private canConsolidate(userId: string) {
    return this.access.can(userId, 'cash.consolidate');
  }

  /**
   * Ultimos fechamentos, para a tela listar sem abrir o JSON de cada um.
   *
   * O snapshot sai podado para TODO MUNDO aqui, inclusive para quem tem
   * `cash.consolidate`: a lista mostra totais, e carregar N retratos completos
   * so para desenhar N linhas seria payload que ninguem le. Quem quer o detalhe
   * de um dia abre aquele dia.
   */
  async list(limit = 30) {
    const rows = await this.prisma.dailyClosing.findMany({
      orderBy: { businessDate: 'desc' },
      take: Math.min(Math.max(limit, 1), 180),
      include: {
        closedBy: { select: { id: true, name: true } },
        reopenedBy: { select: { id: true, name: true } },
      },
    });
    return rows.map((r) => this.present(r, false));
  }

  /**
   * Consolida o dia e trava. Idempotente por dia pelo indice unico em
   * `businessDate`: dois gerentes clicando ao mesmo tempo nao produzem dois
   * fechamentos com numeros diferentes — o segundo recebe conflito.
   */
  async close(dto: CloseDayDto, actorId: string) {
    const label = this.normalize(dto.date ?? todayLabel());
    if (label > todayLabel()) {
      throw new BadRequestException('Nao da para fechar um dia que ainda nao aconteceu.');
    }

    const existing = await this.findClosing(label);
    if (existing?.status === 'FECHADO') {
      throw new ConflictException(`O dia ${label} ja esta fechado.`);
    }

    const snapshot = await this.preview(label);
    // Mesma janela do consolidado: avanca o DIA do calendario, nao 24 horas.
    // Em dia de mudanca de horario de verao o dia tem 23 ou 25 horas, e somar
    // milissegundos deixaria um turno de fora (ou incluiria um do dia seguinte).
    const dayStart = parseDayLabel(label);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const window = { gte: dayStart, lt: dayEnd };
    if (snapshot.openSessions.length > 0) {
      throw new BadRequestException(
        `Ha ${snapshot.openSessions.length} turno(s) ainda aberto(s) neste dia. ` +
          'Feche o caixa de cada operador antes de fechar o dia.',
      );
    }
    if (snapshot.totals.sessions === 0) {
      throw new BadRequestException(
        `Nenhum turno de caixa em ${label} — nao ha dia para fechar.`,
      );
    }

    // A conferencia do gerente vale mais que a soma do sistema: quando ele
    // informa o total contado, uma divergencia contra o esperado barra o
    // fechamento. Fechar por cima seria assinar um numero que ele mesmo viu
    // que nao bate.
    if (dto.countedCash != null) {
      const counted = D(dto.countedCash);
      const expected = D(snapshot.totals.counted);
      if (!counted.equals(expected)) {
        throw new BadRequestException(
          `A contagem informada (${counted.toFixed(2)}) nao bate com a soma das ` +
            `contagens dos turnos (${expected.toFixed(2)}). Confira os turnos antes de fechar.`,
        );
      }
    }

    const data = {
      businessDate: businessDateUtc(label),
      status: 'FECHADO' as const,
      closedAt: new Date(),
      closedById: actorId,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      totalSales: D(snapshot.totals.salesTotal),
      totalCashIn: D(snapshot.totals.cashSales),
      cashDifference: D(snapshot.totals.difference),
      sessionCount: snapshot.totals.sessions,
      notes: dto.notes ?? null,
    };

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Serializa contra a abertura de turno, que toma o mesmo lock. Sem
        // isso, um caixa aberto entre a previa acima e esta gravacao ficaria
        // fora do retrato assinado e o dia travaria por cima dele (SEC-071).
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dayLockKey(label)}))`;

        const stillOpen = await tx.cashSession.count({
          where: { status: 'ABERTA', openedAt: window },
        });
        if (stillOpen > 0) {
          throw new ConflictException(
            `Um turno foi aberto durante o fechamento. Feche o caixa e tente de novo.`,
          );
        }

        return existing
          ? tx.dailyClosing.update({
              where: { id: existing.id },
              data: {
                ...data,
                // Fechar de novo depois de reabrir e um fechamento novo: a
                // contagem de versoes e o que mostra que aquele dia foi mexido.
                version: { increment: 1 },
                reopenedAt: null,
                reopenedById: null,
                reopenReason: null,
              },
              include: this.withUsers,
            })
          : tx.dailyClosing.create({ data, include: this.withUsers });
      });
      return this.present(row, await this.canConsolidate(actorId));
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException(
          `O dia ${label} acabou de ser fechado por outro usuario.`,
        );
      }
      throw e;
    }
  }

  /** Reabre um dia fechado. Exige motivo — quem reabre responde pelo numero. */
  async reopen(dateLabel: string, dto: ReopenDayDto, actorId: string) {
    const label = this.normalize(dateLabel);
    const existing = await this.findClosing(label);
    if (!existing) throw new NotFoundException(`O dia ${label} nao foi fechado.`);
    if (existing.status === 'REABERTO') {
      throw new ConflictException(`O dia ${label} ja esta reaberto.`);
    }

    const row = await this.prisma.dailyClosing.update({
      where: { id: existing.id },
      data: {
        status: 'REABERTO',
        reopenedAt: new Date(),
        reopenedById: actorId,
        reopenReason: dto.reason,
      },
      include: this.withUsers,
    });
    return this.present(row, await this.canConsolidate(actorId));
  }

  // ------------------------------------------------------------- Internos

  private readonly withUsers = {
    closedBy: { select: { id: true, name: true } },
    reopenedBy: { select: { id: true, name: true } },
  };

  private findClosing(label: string) {
    return this.prisma.dailyClosing.findUnique({
      where: { businessDate: businessDateUtc(label) },
      include: this.withUsers,
    });
  }

  /**
   * Valida o rotulo do dia. Usa o parser compartilhado porque a regex sozinha
   * aceita `2026-02-31`, que viraria `Invalid Date` no caminho do banco
   * (SEC-075).
   */
  private normalize(label: string) {
    parseDayLabel(label);
    return label;
  }

  /**
   * Os numeros do dia calculados agora.
   *
   * O caixa vem do consolidado multi-caixa — a MESMA conta que alimenta a tela
   * de caixa, de proposito: se o fechamento somasse por conta propria, o dia
   * fechado e o consolidado discordariam sobre o mesmo dia e ninguem saberia
   * qual dos dois esta certo. Aqui entram tambem as pontas que o turno nao ve:
   * devolucoes, recebimento de crediario e despesas pagas no dia.
   */
  private async preview(label: string) {
    const consolidated = await this.cash.consolidated({ from: label, to: label });
    const window = { gte: consolidated.period.from, lt: consolidated.period.to };

    const [returns, receivables, payables] = await Promise.all([
      this.prisma.saleReturn.aggregate({
        _count: true,
        _sum: { total: true, cashRefunded: true },
        where: { createdAt: window },
      }),
      this.prisma.receivableSettlement.aggregate({
        _count: true,
        _sum: { amount: true },
        where: { createdAt: window },
      }),
      this.prisma.payableSettlement.aggregate({
        _count: true,
        _sum: { amount: true },
        where: { createdAt: window },
      }),
    ]);

    const salesTotal = D(consolidated.totals.salesTotal);
    const devolucoes = D(returns._sum.total ?? 0);
    const recebimentos = D(receivables._sum.amount ?? 0);
    const despesas = D(payables._sum.amount ?? 0);

    return {
      date: label,
      generatedAt: new Date(),
      totals: consolidated.totals,
      byPaymentMethod: consolidated.byPaymentMethod,
      unsettledPayments: consolidated.unsettledPayments,
      byTerminal: consolidated.byTerminal,
      byOperator: consolidated.byOperator,
      sessions: consolidated.sessions,
      divergences: consolidated.divergences,
      /** Turnos que ainda impedem o fechamento. */
      openSessions: consolidated.sessions
        .filter((s) => s.status === 'ABERTA')
        .map((s) => ({
          id: s.id,
          terminal: s.terminal,
          operator: s.operator.name,
          openedAt: s.openedAt,
        })),
      movimento: {
        devolucoes,
        devolucoesCount: returns._count,
        devolucoesEmDinheiro: D(returns._sum.cashRefunded ?? 0),
        recebimentos,
        recebimentosCount: receivables._count,
        despesas,
        despesasCount: payables._count,
        /**
         * Resultado de caixa do dia: o que a loja vendeu, mais o crediario que
         * entrou, menos o que devolveu e o que pagou. Nao e lucro — e o que
         * passou pelo caixa no dia.
         */
        liquido: salesTotal.plus(recebimentos).minus(devolucoes).minus(despesas),
      },
    };
  }

  /** Serializa o fechamento com o rotulo do dia em vez do `Date` da coluna. */
  private present(row: {
    id: string;
    businessDate: Date;
    status: string;
    closedAt: Date;
    closedBy?: { id: string; name: string } | null;
    snapshot: Prisma.JsonValue;
    totalSales: Prisma.Decimal;
    totalCashIn: Prisma.Decimal;
    cashDifference: Prisma.Decimal;
    sessionCount: number;
    notes: string | null;
    version: number;
    reopenedAt: Date | null;
    reopenedBy?: { id: string; name: string } | null;
    reopenReason: string | null;
  }, canSeeOperators: boolean) {
    const snapshot =
      canSeeOperators || snapshotIsObject(row.snapshot) === false
        ? row.snapshot
        : {
            ...(row.snapshot as Record<string, unknown>),
            byOperator: [],
            sessions: [],
            divergences: [],
          };
    return {
      id: row.id,
      date: businessDateLabel(row.businessDate),
      status: row.status,
      closedAt: row.closedAt,
      closedBy: row.closedBy ?? null,
      snapshot,
      totalSales: row.totalSales,
      totalCashIn: row.totalCashIn,
      cashDifference: row.cashDifference,
      sessionCount: row.sessionCount,
      notes: row.notes,
      version: row.version,
      reopenedAt: row.reopenedAt,
      reopenedBy: row.reopenedBy ?? null,
      reopenReason: row.reopenReason,
    };
  }
}
