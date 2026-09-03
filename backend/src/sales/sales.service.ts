import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, SaleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

// Chave de advisory lock (transacional) que serializa a numeracao de vendas.
const SALE_NUMBER_LOCK = 727274;

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

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
      },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    return sale;
  }

  async create(dto: CreateSaleDto, operatorId: string) {
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

    const paid = dto.payments.reduce((acc, p) => acc.plus(D(p.amount)), D(0));
    if (paid.lt(total)) {
      throw new BadRequestException(
        `Pagamento (${paid}) menor que o total da venda (${total}).`,
      );
    }

    const cashPaid = dto.payments
      .filter((p) => p.method === 'DINHEIRO')
      .reduce((acc, p) => acc.plus(D(p.amount)), D(0));

    return this.prisma.$transaction(async (tx) => {
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
              installments: p.installments ?? null,
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

      // Documento fiscal fica pendente de emissao (Fase 3).
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

    return this.prisma.$transaction(async (tx) => {
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

      if (sale.fiscalDocument) {
        await tx.fiscalDocument.update({
          where: { saleId: sale.id },
          data: { status: 'CANCELADA', canceledAt: new Date() },
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
  }
}
