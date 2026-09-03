import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StockAdjustDto } from './dto/stock-adjust.dto';

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const items = await this.prisma.stockItem.findMany({
      include: { product: { include: { category: true } } },
      orderBy: { product: { name: 'asc' } },
    });
    return items.map((it) => ({
      productId: it.productId,
      name: it.product.name,
      sku: it.product.sku,
      unit: it.product.unit,
      category: it.product.category?.name ?? null,
      quantity: it.quantity,
      minQuantity: it.minQuantity,
      low: new Prisma.Decimal(it.quantity).lte(it.minQuantity),
      updatedAt: it.updatedAt,
    }));
  }

  async lowStock() {
    const all = await this.list();
    return all.filter((i) => i.low);
  }

  movements(productId?: string) {
    return this.prisma.stockMovement.findMany({
      where: { productId: productId || undefined },
      include: { product: true, user: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  async adjust(dto: StockAdjustDto, userId?: string) {
    const stock = await this.prisma.stockItem.findUnique({
      where: { productId: dto.productId },
    });
    if (!stock) throw new NotFoundException('Produto sem registro de estoque.');

    const current = new Prisma.Decimal(stock.quantity);
    const qty = new Prisma.Decimal(dto.quantity);

    let newQty: Prisma.Decimal;
    let movementQty: Prisma.Decimal;
    if (dto.type === 'ENTRADA') {
      newQty = current.plus(qty);
      movementQty = qty;
    } else if (dto.type === 'PERDA') {
      newQty = current.minus(qty);
      movementQty = qty.negated();
    } else {
      // AJUSTE: quantity e o novo saldo absoluto
      newQty = qty;
      movementQty = qty.minus(current);
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.stockItem.update({
        where: { productId: dto.productId },
        data: { quantity: newQty },
      });
      await tx.stockMovement.create({
        data: {
          productId: dto.productId,
          type: dto.type,
          quantity: movementQty,
          reason: dto.reason,
          userId: userId ?? null,
        },
      });
      return updated;
    });
  }
}
