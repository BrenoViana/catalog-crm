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
