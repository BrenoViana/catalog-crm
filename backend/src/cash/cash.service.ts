import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashMovementDto, CloseCashDto, OpenCashDto } from './dto/cash.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class CashService {
  constructor(private readonly prisma: PrismaService) {}

  async current(operatorId: string) {
    const session = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
      include: { movements: { orderBy: { createdAt: 'desc' } } },
    });
    if (!session) return null;
    return { ...session, expectedAmount: this.expected(session) };
  }

  async open(dto: OpenCashDto, operatorId: string) {
    const existing = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
    });
    if (existing) throw new BadRequestException('Ja existe um caixa aberto.');

    return this.prisma.cashSession.create({
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
    const [sales, canceledCount, itemDiscount, byMethod] = await Promise.all([
      this.prisma.sale.aggregate({
        _count: true,
        _sum: { subtotal: true, discount: true, total: true },
        where: { cashSessionId: session.id, status: 'CONCLUIDA' },
      }),
      this.prisma.sale.count({
        where: { cashSessionId: session.id, status: 'CANCELADA' },
      }),
      this.prisma.saleItem.aggregate({ _sum: { discount: true }, where: scope }),
      this.prisma.payment.groupBy({
        by: ['method'],
        _count: true,
        _sum: { amount: true },
        where: scope,
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
      cash: {
        opening: session.openingAmount,
        sales: sumByType('VENDA'),
        suprimentos: sumByType('SUPRIMENTO'),
        sangrias: sumByType('SANGRIA'),
        expected: this.expected(session),
        counted: session.closingCountedAmount,
        difference: session.difference,
      },
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
