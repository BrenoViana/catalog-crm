import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  businessDateUtc,
  dayLabel,
  dayLockKey,
  parseDayLabel,
  todayLabel,
} from '../common/business-date';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../settings/app-settings.service';
import {
  CashMovementDto,
  CloseCashDto,
  ConsolidatedQueryDto,
  OpenCashDto,
} from './dto/cash.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY_MS = 86_400_000;

/**
 * Teto da janela do consolidado. Uma loja com tres caixas abre ~90 turnos por
 * mes; um ano ainda cabe, mas `?from=2000-01-01` carregaria todos os
 * movimentos de todos os turnos ja registrados para a memoria do processo que
 * atende o balcao — o mesmo motivo do teto dos relatorios.
 */
const MAX_CONSOLIDATED_DAYS = 92;



/** Janela resolvida do consolidado: dias inteiros, `to` exclusivo. */
export interface ResolvedCashRange {
  from: Date;
  to: Date;
  fromLabel: string;
  toLabel: string;
  days: number;
}

/** Um recorte do consolidado (por terminal ou por operador). */
export interface ConsolidatedGroup {
  key: string;
  sessions: number;
  openSessions: number;
  salesCount: number;
  salesTotal: Prisma.Decimal;
  expected: Prisma.Decimal;
  counted: Prisma.Decimal;
  difference: Prisma.Decimal;
}

/** Um turno dentro do consolidado. */
export interface ConsolidatedSession {
  id: string;
  terminal: string | null;
  operator: { id: string; name: string };
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  opening: Prisma.Decimal;
  cashSales: Prisma.Decimal;
  suprimentos: Prisma.Decimal;
  sangrias: Prisma.Decimal;
  expected: Prisma.Decimal;
  counted: Prisma.Decimal | null;
  difference: Prisma.Decimal | null;
  salesCount: number;
  salesTotal: Prisma.Decimal;
  canceledCount: number;
}

@Injectable()
export class CashService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
  ) {}

  async current(operatorId: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
      include: { movements: { orderBy: { createdAt: 'desc' } } },
    });
    if (!session) return null;
    const expectedAmount = this.expected(session);
    return {
      ...session,
      expectedAmount,
      drawer: await this.drawerStatus(expectedAmount),
    };
  }

  /**
   * Teto de dinheiro na gaveta (AppSetting `cash.drawerLimit`).
   *
   * Nao bloqueia a venda: dinheiro parado no caixa e risco operacional, nao
   * erro de operacao. O PDV usa isto para sugerir a sangria, e o valor
   * sugerido leva a gaveta de volta ao teto — nao a zero, senao o caixa fica
   * sem troco.
   */
  private async drawerStatus(cashOnHand: Prisma.Decimal) {
    const limit = D(await this.settings.getNumber('cash.drawerLimit'));
    if (limit.lte(0)) {
      return { limit: D(0), cashOnHand, exceeded: false, suggestedWithdrawal: D(0) };
    }
    const exceeded = cashOnHand.gt(limit);
    return {
      limit,
      cashOnHand,
      exceeded,
      suggestedWithdrawal: exceeded ? cashOnHand.minus(limit) : D(0),
    };
  }

  async open(dto: OpenCashDto, operatorId: string) {
    const existing = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
    });
    if (existing) throw new BadRequestException('Ja existe um caixa aberto.');

    // Dia fechado no financeiro nao recebe turno novo: o fechamento e um
    // retrato assinado, e um caixa aberto depois dele deixaria vendas fora do
    // numero que o gerente conferiu. A trava vale so para o dia de HOJE —
    // dia antigo fechado nunca impede o balcao de operar. Reabrir desfaz, e a
    // reabertura fica fora do gate de licenca de proposito (SEC-073).
    //
    // Verificacao e criacao vao na MESMA transacao, sob o advisory lock do dia
    // — o mesmo que o fechamento toma. Sem isso as duas operacoes leem antes de
    // qualquer uma escrever, e o turno recem-aberto ficaria fora do retrato
    // enquanto o dia trava por cima dele (SEC-071).
    const today = todayLabel();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dayLockKey(today)}))`;

      const closed = await tx.dailyClosing.findFirst({
        where: { businessDate: businessDateUtc(today), status: 'FECHADO' },
        select: { id: true },
      });
      if (closed) {
        throw new BadRequestException(
          'O dia ja foi fechado no financeiro. Peca a reabertura do dia para abrir um novo turno.',
        );
      }

      return tx.cashSession.create({
        data: {
          operatorId,
          openingAmount: D(dto.openingAmount),
          notes: dto.notes,
          terminal: dto.terminal?.trim() || null,
          movements: {
            create: { type: 'ABERTURA', amount: D(dto.openingAmount), userId: operatorId },
          },
        },
        include: { movements: true },
      });
    });
  }

  async addMovement(dto: CashMovementDto, operatorId: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
    });
    if (!session) throw new BadRequestException('Nenhum caixa aberto.');

    await this.prisma.cashMovement.create({
      data: {
        cashSessionId: session.id,
        type: dto.type,
        amount: D(dto.amount),
        reason: dto.reason,
        userId: operatorId,
      },
    });
    return this.current(operatorId);
  }

  async close(dto: CloseCashDto, operatorId: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
      include: { movements: true },
    });
    if (!session) throw new BadRequestException('Nenhum caixa aberto.');

    const expected = this.expected(session);
    const counted = D(dto.countedAmount);

    return this.prisma.$transaction(async (tx) => {
      await tx.cashMovement.create({
        data: {
          cashSessionId: session.id,
          type: 'FECHAMENTO',
          amount: counted,
          userId: operatorId,
        },
      });
      return tx.cashSession.update({
        where: { id: session.id },
        data: {
          status: 'FECHADA',
          closedAt: new Date(),
          closingCountedAmount: counted,
          closingExpectedAmount: expected,
          difference: counted.minus(expected),
          notes: dto.notes ?? session.notes,
        },
        include: { movements: true },
      });
    });
  }

  history(operatorId: string) {
    return this.prisma.cashSession.findMany({
      where: { operatorId },
      orderBy: { openedAt: 'desc' },
      take: 30,
    });
  }

  /**
   * Resumo de turno. Sem sessionId, usa o turno aberto do operador (leitura X);
   * com sessionId, um turno especifico ja fechado (relatorio Z / reimpressao).
   */
  async report(operatorId: string, sessionId?: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: sessionId
        ? { id: sessionId, operatorId }
        : { operatorId, status: 'ABERTA' },
      include: {
        movements: { orderBy: { createdAt: 'asc' } },
        operator: { select: { id: true, name: true } },
      },
    });
    if (!session) {
      throw new NotFoundException(
        sessionId ? 'Turno nao encontrado.' : 'Nenhum caixa aberto.',
      );
    }

    const scope = {
      sale: { cashSessionId: session.id, status: 'CONCLUIDA' as const },
    };
    const [sales, canceledCount, itemDiscount, byMethod, unsettled] = await Promise.all([
      this.prisma.sale.aggregate({
        _count: true,
        _sum: { subtotal: true, discount: true, total: true },
        where: { cashSessionId: session.id, status: 'CONCLUIDA' },
      }),
      this.prisma.sale.count({
        where: { cashSessionId: session.id, status: 'CANCELADA' },
      }),
      this.prisma.saleItem.aggregate({ _sum: { discount: true }, where: scope }),
      // So conta o que efetivamente entrou. Pagamento NEGADO pelo gateway ou
      // ja ESTORNADO nao e dinheiro recebido — somar tudo faria o X/Z afirmar
      // que o cartao entrou quando ele foi recusado.
      this.prisma.payment.groupBy({
        by: ['method'],
        _count: true,
        _sum: { amount: true },
        where: { ...scope, status: { in: ['AUTORIZADO', 'CONFIRMADO'] } },
      }),
      // Pagamentos sem desfecho ou recusados, para o fechamento nao passar
      // batido por uma venda concluida que ninguem pagou.
      this.prisma.payment.groupBy({
        by: ['status'],
        _count: true,
        _sum: { amount: true },
        where: {
          ...scope,
          status: { in: ['PENDENTE', 'PROCESSANDO', 'NEGADO'] },
        },
      }),
    ]);

    const sumByType = (t: string) =>
      session.movements
        .filter((m) => m.type === t)
        .reduce((acc, m) => acc.plus(m.amount), D(0));

    const discountTotal = D(sales._sum.discount ?? 0).plus(
      itemDiscount._sum.discount ?? 0,
    );

    return {
      kind: session.status === 'ABERTA' ? 'X' : 'Z',
      generatedAt: new Date(),
      session: {
        id: session.id,
        status: session.status,
        terminal: session.terminal,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        openingAmount: session.openingAmount,
        notes: session.notes,
      },
      operator: session.operator,
      sales: {
        count: sales._count,
        total: sales._sum.total ?? D(0),
        discountTotal,
        canceledCount,
      },
      byPaymentMethod: byMethod
        .map((m) => ({
          method: m.method,
          count: m._count,
          amount: m._sum.amount ?? D(0),
        }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      unsettledPayments: unsettled.map((u) => ({
        status: u.status,
        count: u._count,
        amount: u._sum.amount ?? D(0),
      })),
      cash: {
        opening: session.openingAmount,
        sales: sumByType('VENDA'),
        suprimentos: sumByType('SUPRIMENTO'),
        sangrias: sumByType('SANGRIA'),
        expected: this.expected(session),
        counted: session.closingCountedAmount,
        difference: session.difference,
      },
      // So faz sentido no turno aberto (leitura X): num turno ja fechado a
      // gaveta foi contada e esvaziada.
      drawer:
        session.status === 'ABERTA'
          ? await this.drawerStatus(this.expected(session))
          : null,
    };
  }

  /**
   * Consolidado multi-caixa: todos os turnos de todos os terminais numa janela.
   *
   * A leitura X/Z responde por UM turno de UM operador. Numa loja com tres
   * caixas isso deixa o gerente com tres papeis que ninguem soma — e a
   * diferenca de gaveta de um operador some no meio dos outros dois. Aqui os
   * mesmos numeros aparecem agregados e, de proposito, tambem abertos por
   * terminal e por operador: o total serve para conferir a loja, o recorte
   * serve para achar de onde veio a diferenca.
   *
   * Recorte pela ABERTURA do turno: e o dia em que o operador assumiu a gaveta.
   * Um turno que vira a meia-noite conta inteiro no dia em que comecou, que e
   * como o Z e assinado.
   */
  async consolidated(query: ConsolidatedQueryDto) {
    const range = this.resolveRange(query);
    const window = { gte: range.from, lt: range.to };

    const sessions = await this.prisma.cashSession.findMany({
      where: { openedAt: window },
      orderBy: { openedAt: 'asc' },
      include: {
        movements: { select: { type: true, amount: true } },
        operator: { select: { id: true, name: true } },
      },
    });
    const ids = sessions.map((s) => s.id);

    // Sem turno no periodo nao ha o que agregar — e sem esta saida os groupBy
    // abaixo rodariam com `in: []` so para devolver vazio.
    if (ids.length === 0) return this.emptyConsolidated(range);

    const scope = { cashSessionId: { in: ids } };
    const [salesBySession, canceledBySession, byMethod, unsettled, itemDiscount] =
      await Promise.all([
        this.prisma.sale.groupBy({
          by: ['cashSessionId'],
          _count: true,
          _sum: { total: true, discount: true },
          where: { ...scope, status: 'CONCLUIDA' },
        }),
        this.prisma.sale.groupBy({
          by: ['cashSessionId'],
          _count: true,
          where: { ...scope, status: 'CANCELADA' },
        }),
        // Mesmo criterio do X/Z: NEGADO e ESTORNADO nao sao dinheiro recebido.
        this.prisma.payment.groupBy({
          by: ['method'],
          _count: true,
          _sum: { amount: true },
          where: {
            sale: { ...scope, status: 'CONCLUIDA' },
            status: { in: ['AUTORIZADO', 'CONFIRMADO'] },
          },
        }),
        this.prisma.payment.groupBy({
          by: ['status'],
          _count: true,
          _sum: { amount: true },
          where: {
            sale: { ...scope, status: 'CONCLUIDA' },
            status: { in: ['PENDENTE', 'PROCESSANDO', 'NEGADO'] },
          },
        }),
        this.prisma.saleItem.aggregate({
          _sum: { discount: true },
          where: { sale: { ...scope, status: 'CONCLUIDA' } },
        }),
      ]);

    const salesOf = new Map(salesBySession.map((r) => [r.cashSessionId, r]));
    const canceledOf = new Map(
      canceledBySession.map((r) => [r.cashSessionId, r._count]),
    );

    const rows = sessions.map((session) => {
      const agg = salesOf.get(session.id);
      const sumByType = (t: string) =>
        session.movements
          .filter((m) => m.type === t)
          .reduce((acc, m) => acc.plus(m.amount), D(0));
      return {
        id: session.id,
        terminal: session.terminal,
        operator: session.operator,
        status: session.status,
        openedAt: session.openedAt,
        closedAt: session.closedAt,
        opening: D(session.openingAmount),
        cashSales: sumByType('VENDA'),
        suprimentos: sumByType('SUPRIMENTO'),
        sangrias: sumByType('SANGRIA'),
        expected: this.expected(session),
        counted: session.closingCountedAmount,
        // Turno aberto ainda nao tem diferenca: a gaveta nao foi contada.
        difference: session.status === 'FECHADA' ? session.difference : null,
        salesCount: agg?._count ?? 0,
        salesTotal: D(agg?._sum.total ?? 0),
        canceledCount: canceledOf.get(session.id) ?? 0,
      };
    });

    type Row = (typeof rows)[number];
    const sum = (pick: (r: Row) => Prisma.Decimal | null) =>
      rows.reduce((acc, r) => acc.plus(pick(r) ?? 0), D(0));

    const groupBy = (key: (r: Row) => string | null) => {
      const map = new Map<string, ConsolidatedGroup>();
      for (const r of rows) {
        const k = key(r) ?? 'sem identificacao';
        const row: ConsolidatedGroup = map.get(k) ?? {
          key: k,
          sessions: 0,
          openSessions: 0,
          salesCount: 0,
          salesTotal: D(0),
          expected: D(0),
          counted: D(0),
          difference: D(0),
        };
        row.sessions += 1;
        row.salesCount += r.salesCount;
        row.salesTotal = row.salesTotal.plus(r.salesTotal);
        row.expected = row.expected.plus(r.expected);
        row.counted = row.counted.plus(r.counted ?? 0);
        row.difference = row.difference.plus(r.difference ?? 0);
        if (r.status === 'ABERTA') row.openSessions += 1;
        map.set(k, row);
      }
      return [...map.values()].sort(
        (a, b) => Number(b.salesTotal) - Number(a.salesTotal),
      );
    };

    const discountTotal = rows
      .reduce((acc, r) => acc.plus(salesOf.get(r.id)?._sum.discount ?? 0), D(0))
      .plus(itemDiscount._sum.discount ?? 0);

    const openSessions = rows.filter((r) => r.status === 'ABERTA');

    return {
      period: range,
      totals: {
        sessions: rows.length,
        openSessions: openSessions.length,
        closedSessions: rows.length - openSessions.length,
        terminals: new Set(rows.map((r) => r.terminal ?? 'sem identificacao')).size,
        operators: new Set(rows.map((r) => r.operator.id)).size,
        salesCount: rows.reduce((acc, r) => acc + r.salesCount, 0),
        salesTotal: sum((r) => r.salesTotal),
        canceledCount: rows.reduce((acc, r) => acc + r.canceledCount, 0),
        discountTotal,
        opening: sum((r) => r.opening),
        cashSales: sum((r) => r.cashSales),
        suprimentos: sum((r) => r.suprimentos),
        sangrias: sum((r) => r.sangrias),
        expected: sum((r) => r.expected),
        counted: sum((r) => r.counted),
        // So turno fechado entra na diferenca: somar turno aberto acusaria
        // falta de caixa que e apenas gaveta ainda nao contada.
        difference: sum((r) => r.difference),
      },
      byPaymentMethod: byMethod
        .map((m) => ({ method: m.method, count: m._count, amount: m._sum.amount ?? D(0) }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      unsettledPayments: unsettled.map((u) => ({
        status: u.status,
        count: u._count,
        amount: u._sum.amount ?? D(0),
      })),
      byTerminal: groupBy((r) => r.terminal),
      byOperator: groupBy((r) => r.operator.name),
      sessions: rows,
      /**
       * Turnos fechados com sobra ou falta. E a lista que o gerente olha
       * primeiro: divergencia recorrente do mesmo operador e o sinal que separa
       * erro de troco de desvio.
       */
      divergences: rows
        .filter((r) => r.difference != null && !D(r.difference).isZero())
        .sort((a, b) => Math.abs(Number(b.difference)) - Math.abs(Number(a.difference))),
      /** Turnos ainda abertos na janela: o dia nao fecha enquanto houver um. */
      openSessionIds: openSessions.map((r) => r.id),
    };
  }

  private emptyConsolidated(range: ResolvedCashRange) {
    return {
      period: range,
      totals: {
        sessions: 0,
        openSessions: 0,
        closedSessions: 0,
        terminals: 0,
        operators: 0,
        salesCount: 0,
        salesTotal: D(0),
        canceledCount: 0,
        discountTotal: D(0),
        opening: D(0),
        cashSales: D(0),
        suprimentos: D(0),
        sangrias: D(0),
        expected: D(0),
        counted: D(0),
        difference: D(0),
      },
      byPaymentMethod: [] as { method: string; count: number; amount: Prisma.Decimal }[],
      unsettledPayments: [] as { status: string; count: number; amount: Prisma.Decimal }[],
      byTerminal: [] as ConsolidatedGroup[],
      byOperator: [] as ConsolidatedGroup[],
      sessions: [] as ConsolidatedSession[],
      divergences: [] as ConsolidatedSession[],
      openSessionIds: [] as string[],
    };
  }

  /** Janela de dias inteiros no fuso do servidor; `to` e exclusivo. */
  resolveRange(query: ConsolidatedQueryDto): ResolvedCashRange {
    const parse = parseDayLabel;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const toStart = query.to ? parse(query.to) : query.from ? parse(query.from) : today;
    const fromStart = query.from ? parse(query.from) : toStart;

    if (fromStart > toStart) {
      throw new BadRequestException('A data inicial nao pode ser maior que a final.');
    }
    const days = Math.round((toStart.getTime() - fromStart.getTime()) / DAY_MS) + 1;
    if (days > MAX_CONSOLIDATED_DAYS) {
      throw new BadRequestException(
        `Periodo limitado a ${MAX_CONSOLIDATED_DAYS} dias. Estreite a janela.`,
      );
    }
    const to = new Date(toStart);
    to.setDate(to.getDate() + 1);
    return {
      from: fromStart,
      to,
      fromLabel: dayLabel(fromStart),
      toLabel: dayLabel(toStart),
      days,
    };
  }

  /** Saldo esperado em dinheiro: abertura + vendas em dinheiro + suprimentos - sangrias. */
  private expected(session: {
    openingAmount: Prisma.Decimal;
    movements: { type: string; amount: Prisma.Decimal }[];
  }) {
    return session.movements.reduce((acc, m) => {
      if (m.type === 'VENDA' || m.type === 'SUPRIMENTO') return acc.plus(m.amount);
      if (m.type === 'SANGRIA') return acc.minus(m.amount);
      return acc;
    }, D(session.openingAmount));
  }
}
