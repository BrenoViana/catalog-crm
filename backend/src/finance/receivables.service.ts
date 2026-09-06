import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TitleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppSettingsService } from '../settings/app-settings.service';
import {
  CancelTitleDto,
  CreateReceivableDto,
  ListTitlesQueryDto,
  SettleTitleDto,
} from './dto/finance.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;

/** Serializa a sequencia global de numero de titulo a receber. */
export const RECEIVABLE_NUMBER_LOCK = 727276;

/** Estados em que o titulo ainda representa dinheiro a entrar. */
const OPEN_STATUSES: TitleStatus[] = ['ABERTO', 'PARCIAL'];

/**
 * Contas a receber — o crediario deixando de ser um rotulo.
 *
 * Ate aqui, escolher "Crediário" no PDV apenas nomeava a forma de pagamento: a
 * venda fechava, o Z batia e nao sobrava nenhum registro de que alguem devia
 * alguma coisa. Agora cada parcela vira um titulo com vencimento, e o limite do
 * cliente e consumido pelo que esta em aberto.
 *
 * Regras que sustentam o resto do modulo:
 *
 * - O titulo nasce DENTRO da transacao da venda. Criar depois abriria a janela
 *   em que a venda existe e a divida nao — exatamente o buraco que este item
 *   veio fechar.
 * - Baixa e sempre incremental e conferida contra o saldo, com trava
 *   condicional: duas baixas simultaneas do mesmo titulo nao podem somar mais
 *   que o valor devido.
 * - Cancelar a venda cancela os titulos em aberto dela. Titulo ja baixado NAO e
 *   apagado: o dinheiro entrou de verdade e some do caixa se sumir daqui.
 */
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: AppSettingsService,
  ) {}

  // ---------------------------------------------------------------- Limite

  /**
   * Quanto o cliente ainda pode comprar a prazo.
   *
   * O limite e consumido pelo SALDO em aberto (valor menos o ja baixado), nao
   * pelo valor de face: quem pagou metade das parcelas tem metade do limite de
   * volta, que e como o lojista raciocina no balcao.
   */
  creditStatus(customerId: string) {
    return this.creditStatusWith(this.prisma, customerId);
  }

  private async creditStatusWith(
    db: Prisma.TransactionClient | PrismaService,
    customerId: string,
  ) {
    const [customer, open] = await Promise.all([
      db.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true, creditLimit: true },
      }),
      db.receivable.findMany({
        where: { customerId, status: { in: OPEN_STATUSES } },
        select: { amount: true, paidAmount: true, dueDate: true },
      }),
    ]);
    if (!customer) throw new NotFoundException('Cliente nao encontrado.');

    const now = new Date();
    let used = D(0);
    let overdue = D(0);
    let overdueCount = 0;
    for (const t of open) {
      const saldo = D(t.amount).minus(t.paidAmount);
      used = used.plus(saldo);
      if (t.dueDate < now) {
        overdue = overdue.plus(saldo);
        overdueCount += 1;
      }
    }
    const limit = D(customer.creditLimit);
    const available = limit.minus(used);

    return {
      customerId: customer.id,
      customerName: customer.name,
      limit,
      used,
      available: available.lt(0) ? D(0) : available,
      overdue,
      overdueCount,
    };
  }

  /**
   * Porteiro da venda a prazo.
   *
   * Roda DENTRO da transacao da venda, precedida de um advisory lock por
   * CLIENTE. Antes a checagem acontecia sobre um retrato lido fora da
   * transacao: duas vendas simultaneas do mesmo cliente em dois terminais liam
   * o mesmo limite disponivel e passavam as duas, e ele saia com o dobro do
   * credito aprovado (SEC-067). O lock e por cliente — vendas a prazo de
   * clientes diferentes nao esperam umas pelas outras, entao a fila do PDV nao
   * para.
   */
  async assertCreditAvailable(
    tx: Prisma.TransactionClient,
    customerId: string,
    amount: Prisma.Decimal,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'credito:' + customerId}))`;
    const status = await this.creditStatusWith(tx, customerId);

    if (status.limit.lte(0)) {
      throw new BadRequestException(
        `${status.customerName} nao tem limite de crediario liberado. ` +
          'Defina o limite no financeiro antes de vender a prazo.',
      );
    }

    const blockOverdue = await this.settings.getBoolean(
      'finance.blockCreditWhenOverdue',
    );
    if (blockOverdue && status.overdueCount > 0) {
      throw new BadRequestException(
        `${status.customerName} tem ${status.overdueCount} parcela(s) vencida(s), ` +
          `somando R$ ${status.overdue.toFixed(2)}. Regularize antes de vender a prazo.`,
      );
    }

    if (amount.gt(status.available)) {
      throw new BadRequestException(
        `Limite de crediario insuficiente: disponivel R$ ${status.available.toFixed(
          2,
        )}, venda a prazo de R$ ${amount.toFixed(2)}.`,
      );
    }
  }

  async setCreditLimit(customerId: string, creditLimit: number) {
    await this.prisma.customer.findUniqueOrThrow({ where: { id: customerId } });
    await this.prisma.customer.update({
      where: { id: customerId },
      data: { creditLimit: D(creditLimit) },
    });
    return this.creditStatus(customerId);
  }

  // ------------------------------------------------------------ Criacao

  /**
   * Gera as parcelas de uma venda a prazo, dentro da transacao da venda.
   *
   * O resto da divisao vai para a PRIMEIRA parcela, nao para a ultima: e a que
   * o cliente confere na hora, com a mercadoria na mao, e a que evita a
   * reclamacao de "paguei tudo e ficaram R$ 0,02".
   */
  async createForSale(
    tx: Prisma.TransactionClient,
    params: {
      customerId: string;
      saleId: string;
      saleNumber: number;
      total: Prisma.Decimal;
      installments: number;
      intervalDays: number;
      firstDueDate?: Date;
    },
  ) {
    const count = Math.max(1, Math.floor(params.installments));
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECEIVABLE_NUMBER_LOCK})`;
    const last = await tx.receivable.findFirst({
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    let number = (last?.number ?? 0) + 1;

    const base = params.total
      .div(count)
      .toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
    const remainder = params.total.minus(base.mul(count));

    const created: { id: string; number: number; dueDate: Date; amount: Prisma.Decimal }[] =
      [];
    for (let i = 0; i < count; i += 1) {
      const amount = i === 0 ? base.plus(remainder) : base;
      const dueDate =
        params.firstDueDate && i === 0
          ? params.firstDueDate
          : new Date(Date.now() + params.intervalDays * (i + 1) * DAY);
      const row = await tx.receivable.create({
        data: {
          number,
          customerId: params.customerId,
          saleId: params.saleId,
          description: `Venda #${params.saleNumber} — parcela ${i + 1}/${count}`,
          installment: i + 1,
          installments: count,
          amount,
          dueDate,
        },
        select: { id: true, number: true, dueDate: true, amount: true },
      });
      created.push(row);
      number += 1;
    }
    return created;
  }

  /** Titulo avulso: renegociacao, acerto ou divida trazida de outro sistema. */
  async createManual(dto: CreateReceivableDto) {
    const count = Math.max(1, dto.installments ?? 1);
    const total = D(dto.amount);
    const interval = await this.settings.getNumber(
      'finance.installmentIntervalDays',
    );
    const first = new Date(dto.dueDate);
    if (Number.isNaN(first.getTime())) {
      throw new BadRequestException('Vencimento invalido.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RECEIVABLE_NUMBER_LOCK})`;
      const last = await tx.receivable.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      let number = (last?.number ?? 0) + 1;

      const base = total.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
      const remainder = total.minus(base.mul(count));
      const rows: Prisma.ReceivableGetPayload<object>[] = [];
      for (let i = 0; i < count; i += 1) {
        rows.push(
          await tx.receivable.create({
            data: {
              number: number + i,
              customerId: dto.customerId,
              description:
                count > 1
                  ? `${dto.description} — parcela ${i + 1}/${count}`
                  : dto.description,
              installment: i + 1,
              installments: count,
              amount: i === 0 ? base.plus(remainder) : base,
              dueDate: new Date(first.getTime() + interval * i * DAY),
              note: dto.note ?? null,
            },
          }),
        );
      }
      return rows;
    });
  }

  // ------------------------------------------------------------ Consulta

  async list(query: ListTitlesQueryDto) {
    const where: Prisma.ReceivableWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.customerId) where.customerId = query.customerId;
    if (query.overdue === 'true') {
      where.status = { in: OPEN_STATUSES };
      where.dueDate = { lt: new Date() };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { customer: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.receivable.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: Math.min(query.take ?? 200, 500),
      include: {
        // Telefone NAO entra na listagem: uma lista de inadimplentes com
        // contato e exportacao de dado pessoal alem da finalidade da tela
        // (SEC-071). Quem vai cobrar abre o cliente.
        customer: { select: { id: true, name: true } },
        sale: { select: { id: true, number: true } },
        settlements: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: {
            id: true,
            amount: true,
            method: true,
            note: true,
            createdAt: true,
            user: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  /** Painel: total em aberto, vencido e a vencer por faixa de prazo. */
  async summary() {
    const open = await this.prisma.receivable.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: { amount: true, paidAmount: true, dueDate: true, customerId: true },
    });

    const now = Date.now();
    const buckets = {
      vencido: D(0),
      ate7: D(0),
      ate30: D(0),
      acima30: D(0),
    };
    let total = D(0);
    const devedores = new Set<string>();
    for (const t of open) {
      const saldo = D(t.amount).minus(t.paidAmount);
      total = total.plus(saldo);
      devedores.add(t.customerId);
      const days = Math.floor((t.dueDate.getTime() - now) / DAY);
      if (days < 0) buckets.vencido = buckets.vencido.plus(saldo);
      else if (days <= 7) buckets.ate7 = buckets.ate7.plus(saldo);
      else if (days <= 30) buckets.ate30 = buckets.ate30.plus(saldo);
      else buckets.acima30 = buckets.acima30.plus(saldo);
    }

    return {
      totalOpen: total,
      titles: open.length,
      customers: devedores.size,
      aging: buckets,
    };
  }

  // --------------------------------------------------------------- Baixa

  /**
   * Baixa total ou parcial.
   *
   * Em dinheiro, o valor entra na gaveta do turno aberto de quem recebeu: o
   * cliente pagou a parcela no balcao e a nota do Z tem de bater com o que esta
   * la dentro. Nas demais formas nao ha lancamento de caixa — o dinheiro vai
   * para a conta, nao para a gaveta.
   */
  async settle(id: string, dto: SettleTitleDto, userId: string) {
    const amount = D(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      // Lock por titulo: duas baixas simultaneas do mesmo titulo liam o mesmo
      // saldo e podiam somar mais que o devido.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

      const title = await tx.receivable.findUnique({ where: { id } });
      if (!title) throw new NotFoundException('Titulo nao encontrado.');
      if (title.status === 'CANCELADO') {
        throw new BadRequestException('Titulo cancelado nao aceita baixa.');
      }
      if (title.status === 'PAGO') {
        throw new BadRequestException('Titulo ja esta quitado.');
      }

      const saldo = D(title.amount).minus(title.paidAmount);
      if (amount.gt(saldo)) {
        throw new BadRequestException(
          `Baixa de R$ ${amount.toFixed(2)} maior que o saldo do titulo (R$ ${saldo.toFixed(2)}).`,
        );
      }

      // Recebimento em especie sem turno aberto some da conferencia: o titulo
      // fica PAGO e nenhuma gaveta acusa a entrada (SEC-066). Mesma regra do
      // PDV — dinheiro so entra em caixa aberto.
      const openSession =
        dto.method === 'DINHEIRO'
          ? await tx.cashSession.findFirst({
              where: { operatorId: userId, status: 'ABERTA' },
              select: { id: true },
            })
          : null;
      if (dto.method === 'DINHEIRO' && !openSession) {
        throw new BadRequestException(
          'Abra o caixa para receber em especie — senao o dinheiro entra sem par no fechamento.',
        );
      }

      await tx.receivableSettlement.create({
        data: {
          receivableId: id,
          amount,
          method: dto.method,
          cashSessionId: openSession?.id ?? null,
          userId,
          note: dto.note ?? null,
        },
      });

      if (openSession) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: openSession.id,
            type: 'SUPRIMENTO',
            amount,
            reason: `Recebimento do titulo #${title.number} — ${title.description}`,
            userId,
          },
        });
      }

      const paid = D(title.paidAmount).plus(amount);
      const quitado = paid.gte(title.amount);
      return tx.receivable.update({
        where: { id },
        data: {
          paidAmount: paid,
          status: quitado ? 'PAGO' : 'PARCIAL',
          paidAt: quitado ? new Date() : null,
        },
        include: { customer: { select: { id: true, name: true } } },
      });
    });
  }

  async cancel(id: string, dto: CancelTitleDto) {
    const title = await this.prisma.receivable.findUnique({ where: { id } });
    if (!title) throw new NotFoundException('Titulo nao encontrado.');
    if (title.status === 'PAGO') {
      throw new BadRequestException(
        'Titulo quitado nao pode ser cancelado — o dinheiro ja entrou. ' +
          'Use uma devolucao ou um titulo de acerto.',
      );
    }
    if (title.status === 'CANCELADO') return title;

    return this.prisma.receivable.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        canceledAt: new Date(),
        note: [title.note, `Cancelado: ${dto.reason}`].filter(Boolean).join(' | '),
      },
    });
  }

  /**
   * Devolucao parcial: abate `amount` do que a venda ainda deve.
   *
   * A devolucao nao pode pagar em dinheiro uma parcela que a loja nunca
   * recebeu — antes disso, devolver uma venda a prazo tirava o valor cheio da
   * gaveta e deixava o titulo em aberto, como se o cliente ainda devesse
   * (SEC-061). Aqui a parte da devolucao que corresponde ao crediario abate a
   * divida, comecando pelo vencimento MAIS DISTANTE: quem devolve metade da
   * compra continua devendo as parcelas proximas, que e o que o cliente
   * entende quando olha o carne.
   *
   * Titulo ja baixado nao e tocado — o dinheiro entrou de verdade; o que
   * sobrar sem parcela em aberto para abater e devolvido em `remaining`, para
   * quem chamou reembolsar de outra forma.
   */
  async reduceForSale(
    tx: Prisma.TransactionClient,
    saleId: string,
    amount: Prisma.Decimal,
    reason: string,
  ) {
    let restante = amount;
    const abertos = await tx.receivable.findMany({
      where: { saleId, status: { in: OPEN_STATUSES } },
      orderBy: { dueDate: 'desc' },
      select: { id: true, amount: true, paidAmount: true, note: true, status: true },
    });

    for (const titulo of abertos) {
      if (restante.lte(0)) break;
      const saldo = D(titulo.amount).minus(titulo.paidAmount);
      if (saldo.lte(0)) continue;
      const abatido = restante.gte(saldo) ? saldo : restante;
      const novoValor = D(titulo.amount).minus(abatido);
      const quitado = novoValor.lte(titulo.paidAmount);
      await tx.receivable.update({
        where: { id: titulo.id },
        data: {
          amount: novoValor,
          status: quitado ? 'CANCELADO' : titulo.status,
          canceledAt: quitado ? new Date() : null,
          note: [titulo.note, reason].filter(Boolean).join(' | '),
        },
      });
      restante = restante.minus(abatido);
    }

    return { applied: amount.minus(restante), remaining: restante };
  }

  /**
   * Cancelamento da venda: derruba os titulos que ainda nao foram tocados.
   *
   * Titulo com baixa parcial NAO e cancelado automaticamente — parte do
   * dinheiro entrou e sumir com o titulo esconderia essa entrada. Ele fica em
   * aberto para o gerente resolver a mao, e devolvemos quantos ficaram assim
   * para quem cancelou saber que sobrou trabalho.
   */
  async cancelForSale(
    tx: Prisma.TransactionClient,
    saleId: string,
    saleNumber: number,
  ) {
    const canceled = await tx.receivable.updateMany({
      where: { saleId, status: 'ABERTO', paidAmount: 0 },
      data: {
        status: 'CANCELADO',
        canceledAt: new Date(),
        note: `Cancelado com a venda #${saleNumber}`,
      },
    });
    const pending = await tx.receivable.count({
      where: { saleId, status: { in: OPEN_STATUSES } },
    });
    return { canceled: canceled.count, pending };
  }
}
