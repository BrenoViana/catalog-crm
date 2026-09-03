import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateSaleDto } from './dto/create-sale.dto';
import { CancelSaleDto } from './dto/cancel-sale.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

@Injectable()
export class SalesService {
  constructor(private readonly prisma: PrismaService) {}

  list(params: { status?: string; take?: number }) {
    return this.prisma.sale.findMany({
      where: { status: params.status as never },
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

    const productIds = dto.items.map((i) => i.productId);
    const products = await this.prisma.product.findMany({
      where: { id: { in: productIds } },
      include: { stock: true },
    });
    const byId = new Map(products.map((p) => [p.id, p]));

    const lines = dto.items.map((item) => {
      const product = byId.get(item.productId);
      if (!product) {
        throw new BadRequestException(`Produto ${item.productId} nao encontrado.`);
      }
      if (!product.active) {
        throw new BadRequestException(`Produto "${product.name}" esta inativo.`);
      }
      const qty = D(item.quantity);
      const available = D(product.stock?.quantity ?? 0);
      if (available.lt(qty)) {
        throw new BadRequestException(
          `Estoque insuficiente para "${product.name}" (disponivel: ${available}).`,
        );
      }
      const unitPrice = D(item.unitPrice ?? product.price);
      const discount = D(item.discount ?? 0);
      const total = unitPrice.mul(qty).minus(discount);
      return { product, qty, unitPrice, discount, total };
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

    const openSession = await this.prisma.cashSession.findFirst({
      where: { operatorId, status: 'ABERTA' },
    });

    const last = await this.prisma.sale.findFirst({
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    const number = (last?.number ?? 0) + 1;

    const store = await this.prisma.storeSettings.findFirst();

    return this.prisma.$transaction(async (tx) => {
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
        await tx.stockItem.update({
          where: { productId: l.product.id },
          data: { quantity: D(l.product.stock?.quantity ?? 0).minus(l.qty) },
        });
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

      const cashPaid = dto.payments
        .filter((p) => p.method === 'DINHEIRO')
        .reduce((acc, p) => acc.plus(D(p.amount)), D(0));
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
      const series = store?.nfceSeries ?? 1;
      const fiscalNumber = store?.nfceNextNumber ?? number;
      await tx.fiscalDocument.create({
        data: {
          saleId: sale.id,
          model: 65,
          series,
          number: fiscalNumber,
          status: 'PENDENTE',
          environment: store?.nfceEnvironment ?? 'homologacao',
        },
      });
      if (store) {
        await tx.storeSettings.update({
          where: { id: store.id },
          data: { nfceNextNumber: fiscalNumber + 1 },
        });
      }

      return sale;
    });
  }

  async cancel(id: string, dto: CancelSaleDto, operatorId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { items: true, fiscalDocument: true },
    });
    if (!sale) throw new NotFoundException('Venda nao encontrada.');
    if (sale.status !== 'CONCLUIDA') {
      throw new BadRequestException('Somente vendas concluidas podem ser canceladas.');
    }

    return this.prisma.$transaction(async (tx) => {
      for (const item of sale.items) {
        const stock = await tx.stockItem.findUnique({
          where: { productId: item.productId },
        });
        if (stock) {
          await tx.stockItem.update({
            where: { productId: item.productId },
            data: { quantity: D(stock.quantity).plus(item.quantity) },
          });
        }
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
