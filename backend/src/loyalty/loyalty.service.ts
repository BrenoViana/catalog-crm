import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../settings/app-settings.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Cliente Prisma dentro ou fora de transacao — o servico serve aos dois. */
type Db = Prisma.TransactionClient;

export interface LoyaltyConfig {
  enabled: boolean;
  cashbackPercent: number;
  minRedeem: number;
  maxRedeemPercent: number;
}

/**
 * Fidelidade por cashback em REAIS.
 *
 * A escolha por R$ em vez de pontos e deliberada: ponto exige uma taxa de
 * conversao que o lojista muda com o tempo, e a primeira mudanca desvaloriza o
 * saldo de quem ja juntou — o cliente percebe e o programa perde a graca.
 * Saldo em R$ vale hoje o que valia ontem.
 *
 * Duas regras de integridade que valem para sempre:
 *
 * 1. **Saldo nunca fica negativo.** O debito e um `updateMany` condicional
 *    (`balance >= amount`), nao um read-modify-write: duas vendas simultaneas
 *    do mesmo cliente em dois terminais leriam o mesmo saldo e gastariam o
 *    dobro.
 * 2. **Resgate nao gera cashback.** O acumulo incide sobre o dinheiro NOVO que
 *    entrou. Sem isso, um saldo de R$ 10 com 10% de cashback vira uma maquina
 *    de moer margem: resgata, ganha, resgata de novo.
 */
@Injectable()
export class LoyaltyService {
  private readonly log = new Logger(LoyaltyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
  ) {}

  async config(): Promise<LoyaltyConfig> {
    return {
      enabled: await this.settings.getBoolean('loyalty.enabled'),
      cashbackPercent: await this.settings.getNumber('loyalty.cashbackPercent'),
      minRedeem: await this.settings.getNumber('loyalty.minRedeem'),
      maxRedeemPercent: await this.settings.getNumber('loyalty.maxRedeemPercent'),
    };
  }

  /** Saldo do cliente. Conta inexistente vale zero — nao criamos por leitura. */
  async balanceOf(customerId: string) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      select: { balance: true, earned: true, redeemed: true, updatedAt: true },
    });
    return {
      balance: account?.balance ?? D(0),
      earned: account?.earned ?? D(0),
      redeemed: account?.redeemed ?? D(0),
      updatedAt: account?.updatedAt ?? null,
    };
  }

  /** Extrato: o que o cliente pede no balcao quando duvida do saldo. */
  async statement(customerId: string, take = 50) {
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      include: {
        entries: {
          orderBy: { createdAt: 'desc' },
          take,
          select: {
            id: true,
            type: true,
            amount: true,
            balanceAfter: true,
            reason: true,
            createdAt: true,
            sale: { select: { id: true, number: true } },
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
    return {
      balance: account?.balance ?? D(0),
      earned: account?.earned ?? D(0),
      redeemed: account?.redeemed ?? D(0),
      entries: account?.entries ?? [],
    };
  }

  /** Cria a conta na primeira movimentacao. Idempotente sob concorrencia. */
  private ensureAccount(db: Db, customerId: string) {
    return db.loyaltyAccount.upsert({
      where: { customerId },
      create: { customerId },
      update: {},
      select: { id: true, balance: true },
    });
  }

  /**
   * Debita saldo DENTRO da transacao da venda. Devolve o saldo resultante.
   * Lanca se o saldo nao cobrir — a venda inteira volta atras, que e o
   * comportamento certo: o cliente ainda nao levou a mercadoria.
   */
  async redeem(
    db: Db,
    params: {
      customerId: string;
      amount: Prisma.Decimal;
      saleId?: string;
      userId: string;
      reason?: string;
    },
  ) {
    const amount = params.amount;
    if (amount.lte(0)) throw new BadRequestException('Resgate precisa ser positivo.');

    const account = await this.ensureAccount(db, params.customerId);
    const claimed = await db.loyaltyAccount.updateMany({
      where: { id: account.id, balance: { gte: amount } },
      data: { balance: { decrement: amount }, redeemed: { increment: amount } },
    });
    if (claimed.count !== 1) {
      throw new BadRequestException(
        'Saldo de fidelidade insuficiente para o resgate solicitado.',
      );
    }

    const after = await db.loyaltyAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { balance: true },
    });
    await db.loyaltyEntry.create({
      data: {
        accountId: account.id,
        type: 'RESGATE',
        amount: amount.negated(),
        balanceAfter: after.balance,
        saleId: params.saleId ?? null,
        userId: params.userId,
        reason: params.reason ?? null,
      },
    });
    return after.balance;
  }

  /**
   * Credita o cashback da venda. `base` e o dinheiro NOVO — o total menos o que
   * foi pago com saldo. Valor zero nao vira lancamento: extrato cheio de linha
   * de R$ 0,00 e ruido.
   */
  async accrue(
    db: Db,
    params: {
      customerId: string;
      base: Prisma.Decimal;
      percent: number;
      saleId: string;
      userId: string;
    },
  ) {
    if (params.percent <= 0 || params.base.lte(0)) return D(0);
    const amount = params.base
      .mul(params.percent)
      .div(100)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    if (amount.lte(0)) return D(0);

    const account = await this.ensureAccount(db, params.customerId);
    const updated = await db.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: { increment: amount }, earned: { increment: amount } },
      select: { balance: true },
    });
    await db.loyaltyEntry.create({
      data: {
        accountId: account.id,
        type: 'ACUMULO',
        amount,
        balanceAfter: updated.balance,
        saleId: params.saleId,
        userId: params.userId,
        reason: 'Cashback da venda',
      },
    });
    return amount;
  }

  /**
   * Desfaz o que a venda mexeu no saldo, no cancelamento.
   *
   * Trabalha sobre o EFEITO LIQUIDO da venda na conta — a soma de tudo que ela
   * lancou (acumulo, resgate e o que uma devolucao parcial ja tenha estornado).
   * Reverter lancamento a lancamento parecia mais direto, mas devolvia duas
   * vezes o mesmo dinheiro quando a venda ja tinha sofrido devolucao antes do
   * cancelamento; e, como o liquido fica zero depois de aplicado, a operacao
   * tambem passa a ser idempotente sem precisar de uma trava separada.
   *
   * A retirada e limitada ao saldo disponivel: se o cliente ja gastou o
   * cashback daquela venda, deixar o saldo negativo transformaria um
   * cancelamento numa divida que ele nao contraiu.
   */
  async reverseSale(saleId: string, userId: string) {
    const entries = await this.prisma.loyaltyEntry.findMany({
      where: { saleId },
      select: { accountId: true, amount: true },
    });
    if (entries.length === 0) return;

    const porConta = new Map<string, Prisma.Decimal>();
    for (const e of entries) {
      porConta.set(e.accountId, (porConta.get(e.accountId) ?? D(0)).plus(e.amount));
    }

    for (const [accountId, liquido] of porConta) {
      const delta = liquido.negated();
      if (delta.isZero()) continue;
      await this.prisma
        .$transaction(async (tx) => {
          const account = await tx.loyaltyAccount.findUniqueOrThrow({
            where: { id: accountId },
            select: { balance: true },
          });
          const applied =
            delta.lt(0) && account.balance.lt(delta.abs())
              ? account.balance.negated()
              : delta;
          if (applied.isZero()) return;
          const updated = await tx.loyaltyAccount.update({
            where: { id: accountId },
            data: { balance: { increment: applied } },
            select: { balance: true },
          });
          await tx.loyaltyEntry.create({
            data: {
              accountId,
              type: 'ESTORNO',
              amount: applied,
              balanceAfter: updated.balance,
              saleId,
              userId,
              reason: 'Venda cancelada: saldo devolvido e cashback retirado',
            },
          });
        })
        .catch((err) => {
          this.log.error(
            `Falha ao estornar fidelidade da venda ${saleId}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        });
    }
  }

  /**
   * Devolucao parcial: devolve o saldo resgatado naquela fatia da venda e
   * retira o cashback proporcional, tudo dentro da transacao da devolucao.
   *
   * Sem isto, devolver em dinheiro uma venda paga com saldo transformava
   * cashback em saque: saia dinheiro da gaveta por um valor que nunca entrou
   * (SEC-061). A retirada do cashback e limitada ao saldo disponivel, pela
   * mesma razao de `reverseSale`: uma devolucao nunca vira divida.
   */
  async refundForReturn(
    db: Db,
    params: {
      customerId: string;
      saleId: string;
      /** Parte do resgate que volta para o cliente. */
      redeemed: Prisma.Decimal;
      /** Cashback proporcional a retirar. */
      clawback: Prisma.Decimal;
      userId: string;
      reason: string;
    },
  ) {
    const delta = params.redeemed.minus(params.clawback);
    if (delta.isZero()) return D(0);

    const account = await this.ensureAccount(db, params.customerId);
    const current = await db.loyaltyAccount.findUniqueOrThrow({
      where: { id: account.id },
      select: { balance: true },
    });
    const applied =
      delta.lt(0) && current.balance.lt(delta.abs())
        ? current.balance.negated()
        : delta;
    if (applied.isZero()) return D(0);

    const updated = await db.loyaltyAccount.update({
      where: { id: account.id },
      data: { balance: { increment: applied } },
      select: { balance: true },
    });
    await db.loyaltyEntry.create({
      data: {
        accountId: account.id,
        type: 'ESTORNO',
        amount: applied,
        balanceAfter: updated.balance,
        saleId: params.saleId,
        userId: params.userId,
        reason: params.reason,
      },
    });
    return applied;
  }

  /**
   * Cashback que esta venda gerou. A devolucao retira a fatia proporcional ao
   * que foi devolvido; como as fracoes devolvidas somam no maximo a venda
   * inteira, a soma das retiradas nunca passa do que foi creditado.
   */
  async accruedForSale(db: Db, saleId: string) {
    const rows = await db.loyaltyEntry.findMany({
      where: { saleId, type: 'ACUMULO' },
      select: { amount: true },
    });
    return rows.reduce((acc, r) => acc.plus(r.amount), D(0));
  }

  /** Ajuste manual de gerente: bonus, cortesia ou correcao de erro. */
  async adjust(params: {
    customerId: string;
    amount: number;
    reason: string;
    userId: string;
  }) {
    const amount = D(params.amount).toDecimalPlaces(2);
    if (amount.isZero()) {
      throw new BadRequestException('Informe um valor diferente de zero.');
    }

    return this.prisma.$transaction(async (tx) => {
      const account = await this.ensureAccount(tx, params.customerId);
      if (amount.lt(0) && account.balance.lt(amount.abs())) {
        throw new BadRequestException(
          `Saldo atual (R$ ${account.balance.toFixed(2)}) menor que o debito solicitado.`,
        );
      }
      const updated = await tx.loyaltyAccount.update({
        where: { id: account.id },
        data: {
          balance: { increment: amount },
          ...(amount.gt(0)
            ? { earned: { increment: amount } }
            : { redeemed: { increment: amount.abs() } }),
        },
        select: { balance: true },
      });
      await tx.loyaltyEntry.create({
        data: {
          accountId: account.id,
          type: 'AJUSTE',
          amount,
          balanceAfter: updated.balance,
          userId: params.userId,
          reason: params.reason,
        },
      });
      return { balance: updated.balance };
    });
  }
}
