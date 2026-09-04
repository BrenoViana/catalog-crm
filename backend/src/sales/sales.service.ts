import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';
import { CreateReturnDto } from './dto/create-return.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// Chaves de advisory lock (transacional) que serializam numeracoes concorrentes.
const SALE_NUMBER_LOCK = 727274;
const RETURN_NUMBER_LOCK = 727275;

@Injectable()
export class SalesService {
  private readonly log = new Logger(SalesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fiscal: FiscalService,
  ) {}

  list(params: { status?: string; take?: number }) {
    const status =
      params.status && params.status in SaleStatus
        ? (params.status as SaleStatus)
        : undefined;

    return this.prisma.sale.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: params.take ?? 100,
      include: {
        customer: true,
        operator: { select: { id: true, name: true } },
        _count: { select: { items: true } },
        payments: true,
        fiscalDocument: true,
      },
    });
  }

  async findOne(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        customer: true,
        operator: { select: { id: true, name: true } },
        items: { include: { product: true } },
        payments: true,
        fiscalDocument: true,
        returns: {
          orderBy: { createdAt: 'desc' },
          include: {
            items: true,
            operator: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    return sale;
  }

  async create(
    dto: CreateSaleDto,
    operatorId: string,
    operatorRole: Role = Role.OPERADOR,
  ) {
    if (!operatorId) throw new BadRequestException('Operador nao identificado.');

    const productIds = [...new Set(dto.items.map((i) => i.productId))];
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { stock: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    // O preco unitario e SEMPRE o cadastrado no produto — nunca vem do cliente.
    const lines = dto.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Produto ${item.productId} nao encontrado.`);
      }
      if (!product.active) {
        throw new BadRequestException(`Produto "${product.name}" esta inativo.`);
      }
      const qty = D(item.quantity);
      const unitPrice = D(product.price);
      const gross = unitPrice.mul(qty);
      const discount = D(item.discount ?? 0);
      if (discount.gt(gross)) {
        throw new BadRequestException(
          `Desconto do item "${product.name}" maior que o valor do item.`,
        );
      }
      return { product, qty, unitPrice, discount, total: gross.minus(discount) };
    });

    const subtotal = lines.reduce((acc, l) => acc.plus(l.total), D(0));
    const saleDiscount = D(dto.discount ?? 0);
    const total = subtotal.minus(saleDiscount);
    if (total.lt(0)) throw new BadRequestException('Desconto maior que o total.');

    // Politica de desconto: um OPERADOR nao pode ultrapassar o teto (em %) da
    // loja no desconto total da venda (itens + venda). GERENTE/ADMIN sem teto.
    if (operatorRole === Role.OPERADOR) {
      const gross = lines.reduce((acc, l) => acc.plus(l.unitPrice.mul(l.qty)), D(0));
      if (gross.gt(0)) {
        const settings = await this.prisma.storeSettings.findFirst({
          select: { maxDiscountPercentOperator: true },
        });
        const limit = D(settings?.maxDiscountPercentOperator ?? 100);
        const pct = gross.minus(total).div(gross).mul(100);
        if (pct.gt(limit)) {
          throw new BadRequestException(
            `Desconto de ${pct.toFixed(1)}% excede o limite de ${limit.toFixed(
              0,
            )}% do operador. Peca liberacao a um gerente.`,
          );
        }
      }
    }

    const paid = dto.payments.reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    if (paid.lt(total)) {
      throw new BadRequestException(
        `Pagamento (${paid}) menor que o total da venda (${total}).`,
      );
    }

    // Troco so existe em dinheiro: a soma dos pagamentos eletronicos nao pode
    // ultrapassar o total da venda.
    const nonCashPaid = dto.payments
      .filter((p) => p.method !== 'DINHEIRO')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    if (nonCashPaid.gt(total)) {
      throw new BadRequestException(
        `Pagamento eletronico (${nonCashPaid}) excede o total da venda (${total}) — nao ha troco.`,
      );
    }

    const cashPaid = dto.payments
      .filter((p) => p.method === 'DINHEIRO')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));

    const sale = await this.prisma.$transaction(async (tx) => {
      // Serializa a alocacao de numero de venda entre transacoes concorrentes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SALE_NUMBER_LOCK})`;

      const openSession = await tx.cashSession.findFirst({
        where: { operatorId, status: 'ABERTA' },
        select: { id: true },
      });

      const last = await tx.sale.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      // Baixa de estoque atomica e condicional (impede venda a descoberto sob concorrencia).
      for (const l of lines) {
        const updated = await tx.stockItem.updateMany({
          where: { productId: l.product.id, quantity: { gte: l.qty } },
          data: { quantity: { decrement: l.qty } },
        });
        if (updated.count !== 1) {
          throw new BadRequestException(
            `Estoque insuficiente para "${l.product.name}".`,
          );
        }
      }

      const sale = await tx.sale.create({
        data: {
          number,
          status: 'CONCLUIDA',
          subtotal,
          discount: saleDiscount,
          total,
          note: dto.note,
          terminal: dto.terminal?.trim() || null,
          customerId: dto.customerId ?? null,
          operatorId,
          cashSessionId: openSession?.id ?? null,
          completedAt: new Date(),
          items: {
            create: lines.map((l) => ({
              productId: l.product.id,
              description: l.product.name,
              quantity: l.qty,
              unitPrice: l.unitPrice,
              discount: l.discount,
              total: l.total,
            })),
          },
          payments: {
            create: dto.payments.map((p) => ({
              method: p.method,
              amount: D(p.amount),
              // Parcelamento so faz sentido no credito.
              installments: p.method === 'CREDITO' ? p.installments ?? 1 : null,
            })),
          },
        },
        include: { items: true, payments: true },
      });

      for (const l of lines) {
        await tx.stockMovement.create({
          data: {
            productId: l.product.id,
            type: 'VENDA',
            quantity: l.qty.negated(),
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      if (openSession && cashPaid.gt(0)) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: openSession.id,
            type: 'VENDA',
            amount: cashPaid.gt(total) ? total : cashPaid, // ignora troco
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // Cria o documento fiscal PENDENTE dentro da transacao (numeracao da
      // NFC-e). A emissao junto ao provedor acontece fora da transacao, logo
      // apos o commit, para nao segurar o PDV.
      const store = await tx.storeSettings.findFirst({
        select: { id: true, nfceSeries: true, nfceEnvironment: true },
      });
      if (store) {
        const bumped = await tx.storeSettings.update({
          where: { id: store.id },
          data: { nfceNextNumber: { increment: 1 } },
          select: { nfceNextNumber: true },
        });
        await tx.fiscalDocument.create({
          data: {
            saleId: sale.id,
            model: 65,
            series: store.nfceSeries,
            number: bumped.nfceNextNumber - 1,
            status: 'PENDENTE',
            environment: store.nfceEnvironment,
          },
        });
      }

      return sale;
    });

    // Emissao fiscal assincrona: o resultado (AUTORIZADA/REJEITADA) fica no
    // proprio documento; uma falha aqui nunca invalida a venda ja concluida.
    void this.fiscal.emitForSale(sale.id).catch((err) => {
      this.log.error(
        `Falha ao disparar emissao fiscal da venda ${sale.id}: ${
          err instanceof Error ? err.message : err
        }`,
      );
    });

    return sale;
  }

  async cancel(id: string, dto: CancelSaleDto, operatorId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: {
        items: true,
        payments: true,
        fiscalDocument: true,
        cashSession: true,
      },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    if (sale.status !== 'CONCLUIDA') {
      throw new BadRequestException(
        'Somente vendas concluidas podem ser canceladas.',
      );
    }
    if (sale.cashSession && sale.cashSession.status === 'FECHADA') {
      throw new BadRequestException(
        'O caixa desta venda ja foi fechado. Faca o estorno contabil manualmente.',
      );
    }

    const cashBooked = sale.payments
      .filter((p) => p.method === 'DINHEIRO')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    const cashToReverse = cashBooked.gt(sale.total) ? D(sale.total) : cashBooked;

    const canceled = await this.prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        await tx.stockItem.updateMany({
          where: { productId: item.productId },
          data: { quantity: { increment: D(item.quantity) } },
        });
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            type: 'DEVOLUCAO',
            quantity: D(item.quantity),
            reason: `Cancelamento da venda #${sale.number}`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // Estorna a entrada de dinheiro no caixa, para a conciliacao do
      // fechamento nao acusar sobra/falta indevida.
      if (sale.cashSessionId && cashToReverse.gt(0)) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: sale.cashSessionId,
            type: 'SANGRIA',
            amount: cashToReverse,
            reason: `Estorno da venda #${sale.number} (cancelamento)`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      return tx.sale.update({
        where: { id },
        data: {
          status: 'CANCELADA',
          canceledAt: new Date(),
          cancelReason: dto.reason,
        },
      });
    });

    // Cancela a NFC-e junto ao provedor (se ja autorizada) ou apenas marca o
    // documento; roda apos o commit para nao misturar chamada externa com a tx.
    if (sale.fiscalDocument) {
      await this.fiscal
        .cancelForSale(sale.id, `Cancelamento da venda #${sale.number}: ${dto.reason}`)
        .catch((err) => {
          this.log.error(
            `Falha ao cancelar documento fiscal da venda ${sale.id}: ${
              err instanceof Error ? err.message : err
            }`,
          );
        });
    }

    return canceled;
  }

  listReturns(saleId: string) {
    return this.prisma.saleReturn.findMany({
      where: { saleId },
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        operator: { select: { id: true, name: true } },
      },
    });
  }

  /**
   * Devolucao parcial (ou total) de itens de uma venda concluida. Nao mexe na
   * venda original: repoe estoque, registra o SaleReturn e, se o reembolso for
   * em dinheiro e houver caixa aberto do operador, langa uma sangria.
   */
  async createReturn(saleId: string, dto: CreateReturnDto, operatorId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: { items: true, returns: { include: { items: true } } },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    if (sale.status !== 'CONCLUIDA') {
      throw new BadRequestException(
        'So e possivel devolver itens de vendas concluidas.',
      );
    }

    const itemById = new Map(sale.items.map((i) => [i.id, i]));
    const returnedByItem = new Map<string, Prisma.Decimal>();
    for (const r of sale.returns) {
      for (const ri of r.items) {
        returnedByItem.set(
          ri.saleItemId,
          (returnedByItem.get(ri.saleItemId) ?? D(0)).plus(ri.quantity),
        );
      }
    }

    // Consolida quantidades repetidas do mesmo item na requisicao.
    const requested = new Map<string, Prisma.Decimal>();
    for (const it of dto.items) {
      requested.set(
        it.saleItemId,
        (requested.get(it.saleItemId) ?? D(0)).plus(D(it.quantity)),
      );
    }

    const lines = [...requested.entries()].map(([saleItemId, qty]) => {
      const original = itemById.get(saleItemId);
      if (!original) {
        throw new BadRequestException('Item informado nao pertence a esta venda.');
      }
      const remaining = D(original.quantity).minus(
        returnedByItem.get(saleItemId) ?? D(0),
      );
      if (qty.gt(remaining)) {
        throw new BadRequestException(
          `Quantidade a devolver de "${original.description}" (${qty}) maior que o disponivel (${remaining}).`,
        );
      }
      // Reembolso proporcional ao que foi efetivamente cobrado (liquido de desconto).
      const total = D(original.total).div(original.quantity).mul(qty);
      return { original, qty, unitPrice: D(original.unitPrice), total };
    });

    const total = lines.reduce((acc, l) => acc.plus(l.total), D(0));

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${RETURN_NUMBER_LOCK})`;

      const openSession = await tx.cashSession.findFirst({
        where: { operatorId, status: 'ABERTA' },
        select: { id: true },
      });
      const last = await tx.saleReturn.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      const number = (last?.number ?? 0) + 1;

      for (const l of lines) {
        await tx.stockItem.updateMany({
          where: { productId: l.original.productId },
          data: { quantity: { increment: l.qty } },
        });
        await tx.stockMovement.create({
          data: {
            productId: l.original.productId,
            type: 'DEVOLUCAO',
            quantity: l.qty,
            reason: `Devolucao #${number} da venda #${sale.number}`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      const saleReturn = await tx.saleReturn.create({
        data: {
          number,
          saleId: sale.id,
          operatorId,
          cashSessionId: openSession?.id ?? null,
          reason: dto.reason,
          refundMethod: dto.refundMethod,
          total,
          items: {
            create: lines.map((l) => ({
              saleItemId: l.original.id,
              productId: l.original.productId,
              description: l.original.description,
              quantity: l.qty,
              unitPrice: l.unitPrice,
              total: l.total,
            })),
          },
        },
        include: { items: true },
      });

      if (openSession && dto.refundMethod === 'DINHEIRO' && total.gt(0)) {
        await tx.cashMovement.create({
          data: {
            cashSessionId: openSession.id,
            type: 'SANGRIA',
            amount: total,
            reason: `Devolucao #${number} da venda #${sale.number}`,
            userId: operatorId,
            saleId: sale.id,
          },
        });
      }

      // NFC-e: a devolucao parcial exige NF-e de devolucao (modelo 55), fora do
      // escopo do provedor atual. O documento da venda original nao muda.
      return saleReturn;
    });
  }
}
