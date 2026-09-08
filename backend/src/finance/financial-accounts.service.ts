import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFinancialAccountDto,
  UpdateFinancialAccountDto,
} from './dto/finance.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Contas financeiras: onde o dinheiro da loja fica (banco, caixa, carteira).
 *
 * O saldo de uma conta NUNCA e um contador gravado — e sempre derivado de
 * `openingBalance` mais as baixas de titulo que apontam para a conta mais as
 * transferencias. Guardar o saldo numa coluna cria dois numeros para a mesma
 * coisa, e o dia em que eles divergem ninguem sabe qual esta certo.
 *
 * So entram no calculo os settlements que carregam `accountId`. A baixa em
 * especie do balcao (sem `accountId`) segue no dominio do caixa (`CashSession`)
 * e do fechamento do dia: conta-la aqui tambem seria contar o mesmo dinheiro
 * duas vezes.
 */
@Injectable()
export class FinancialAccountsService {
  constructor(private readonly prisma: PrismaService) {}

  list(includeArchived = false) {
    return this.prisma.financialAccount.findMany({
      where: includeArchived ? undefined : { active: true },
      orderBy: [{ active: 'desc' }, { type: 'asc' }, { name: 'asc' }],
    });
  }

  /** Contas com o saldo calculado de cada uma. */
  async balances(): Promise<
    Array<{
      id: string;
      name: string;
      type: string;
      active: boolean;
      openingBalance: Prisma.Decimal;
      balance: Prisma.Decimal;
    }>
  > {
    const [accounts, ins, outs, transfersIn, transfersOut] = await Promise.all([
      this.prisma.financialAccount.findMany({
        orderBy: [{ active: 'desc' }, { type: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.receivableSettlement.groupBy({
        by: ['accountId'],
        where: { accountId: { not: null } },
        _sum: { amount: true },
      }),
      this.prisma.payableSettlement.groupBy({
        by: ['accountId'],
        where: { accountId: { not: null } },
        _sum: { amount: true },
      }),
      this.prisma.accountTransfer.groupBy({
        by: ['toAccountId'],
        _sum: { amount: true },
      }),
      this.prisma.accountTransfer.groupBy({
        by: ['fromAccountId'],
        _sum: { amount: true },
      }),
    ]);

    const sum = (
      rows: Array<{ _sum: { amount: Prisma.Decimal | null } }>,
      key: string,
      idField: string,
    ) => {
      const row = (rows as Array<Record<string, unknown>>).find(
        (r) => r[idField] === key,
      ) as { _sum: { amount: Prisma.Decimal | null } } | undefined;
      return D(row?._sum.amount ?? 0);
    };

    return accounts.map((acc) => {
      const entrada = sum(ins, acc.id, 'accountId').plus(
        sum(transfersIn, acc.id, 'toAccountId'),
      );
      const saida = sum(outs, acc.id, 'accountId').plus(
        sum(transfersOut, acc.id, 'fromAccountId'),
      );
      return {
        id: acc.id,
        name: acc.name,
        type: acc.type,
        active: acc.active,
        openingBalance: D(acc.openingBalance),
        balance: D(acc.openingBalance).plus(entrada).minus(saida),
      };
    });
  }

  create(dto: CreateFinancialAccountDto) {
    return this.prisma.financialAccount.create({
      data: {
        name: dto.name.trim(),
        type: dto.type,
        bankBranch: dto.bankBranch?.trim() || null,
        bankNumber: dto.bankNumber?.trim() || null,
        openingBalance: D(dto.openingBalance ?? 0),
        openingDate: dto.openingDate ? new Date(dto.openingDate) : new Date(),
      },
    });
  }

  /**
   * Devolve `{ before, after }` para o controller gravar de/para na trilha:
   * `openingBalance` e o piso de todo o saldo derivado, mexer nele sem registrar
   * o valor anterior apaga o rastro da posicao de caixa (SEC-098).
   */
  async update(id: string, dto: UpdateFinancialAccountDto) {
    const before = await this.get(id);
    const after = await this.prisma.financialAccount.update({
      where: { id },
      data: {
        ...(dto.name === undefined ? {} : { name: dto.name.trim() }),
        ...(dto.type === undefined ? {} : { type: dto.type }),
        ...(dto.bankBranch === undefined
          ? {}
          : { bankBranch: dto.bankBranch?.trim() || null }),
        ...(dto.bankNumber === undefined
          ? {}
          : { bankNumber: dto.bankNumber?.trim() || null }),
        ...(dto.openingBalance === undefined
          ? {}
          : { openingBalance: D(dto.openingBalance) }),
        ...(dto.openingDate === undefined
          ? {}
          : { openingDate: new Date(dto.openingDate) }),
      },
    });
    return { before, after };
  }

  /**
   * Arquiva em vez de apagar: uma conta com baixa ou transferencia e a
   * referencia de um movimento de dinheiro que ja aconteceu, e apagar sumiria
   * com o rastro. Arquivada, some das listas de escolha mas o historico fica.
   */
  async archive(id: string) {
    await this.get(id);
    return this.prisma.financialAccount.update({
      where: { id },
      data: { active: false, archivedAt: new Date() },
    });
  }

  async unarchive(id: string) {
    await this.get(id);
    return this.prisma.financialAccount.update({
      where: { id },
      data: { active: true, archivedAt: null },
    });
  }

  private async get(id: string) {
    const acc = await this.prisma.financialAccount.findUnique({ where: { id } });
    if (!acc) throw new NotFoundException('Conta financeira não encontrada.');
    return acc;
  }

  /** Garante que a conta existe e esta ativa — usado por quem referencia. */
  async assertUsable(id: string) {
    const acc = await this.get(id);
    if (!acc.active) {
      throw new BadRequestException('Conta financeira arquivada.');
    }
    return acc;
  }
}
