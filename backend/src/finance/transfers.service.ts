import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FinancialAccountsService } from './financial-accounts.service';
import { CreateTransferDto, PeriodQueryDto } from './dto/finance.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;
const MAX_PERIOD_DAYS = 366;

/**
 * Transferencia entre contas da propria loja. Nao e receita nem despesa: sai de
 * uma conta e entra na outra pelo mesmo valor, e o saldo das duas (que e
 * derivado) se ajusta sozinho. Nao precisa de lock — nao ha contador gravado
 * disputado, so uma linha nova.
 */
@Injectable()
export class TransfersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: FinancialAccountsService,
  ) {}

  async list(query: PeriodQueryDto) {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(now.getTime() - 90 * DAY);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Período inválido.');
    }
    to.setHours(23, 59, 59, 999);
    from.setHours(0, 0, 0, 0);
    if (to < from) throw new BadRequestException('A data final e anterior a inicial.');
    if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY) {
      throw new BadRequestException(
        `Período limitado a ${MAX_PERIOD_DAYS} dias. Estreite a janela.`,
      );
    }

    return this.prisma.accountTransfer.findMany({
      where: { date: { gte: from, lte: to } },
      orderBy: { date: 'desc' },
      take: 200,
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
        user: { select: { id: true, name: true } },
      },
    });
  }

  async create(dto: CreateTransferDto, userId: string) {
    if (dto.fromAccountId === dto.toAccountId) {
      throw new BadRequestException('Escolha duas contas diferentes.');
    }
    const amount = D(dto.amount);
    if (amount.lte(0)) {
      throw new BadRequestException('O valor da transferência deve ser positivo.');
    }
    await Promise.all([
      this.accounts.assertUsable(dto.fromAccountId),
      this.accounts.assertUsable(dto.toAccountId),
    ]);

    return this.prisma.accountTransfer.create({
      data: {
        fromAccountId: dto.fromAccountId,
        toAccountId: dto.toAccountId,
        amount,
        date: dto.date ? new Date(dto.date) : new Date(),
        note: dto.note?.trim() || null,
        userId,
      },
      include: {
        fromAccount: { select: { id: true, name: true } },
        toAccount: { select: { id: true, name: true } },
      },
    });
  }
}
