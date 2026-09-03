import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/** Saldo esperado em dinheiro: abertura + vendas/suprimentos - sangrias. */
function expectedCash(session: {
  openingAmount: Prisma.Decimal;
  movements: { type: string; amount: Prisma.Decimal }[];
}) {
  return session.movements.reduce((acc, m) => {
    if (m.type === 'VENDA' || m.type === 'SUPRIMENTO') return acc.plus(m.amount);
    if (m.type === 'SANGRIA') return acc.minus(m.amount);
    return acc;
  }, D(session.openingAmount));
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [
      salesToday,
      itemsAgg,
      activeProducts,
      stockItems,
      last7,
      topProducts,
      paymentsToday,
      openSessions,
    ] = await Promise.all([
      this.prisma.sale.findMany({
        where: { status: 'CONCLUIDA', completedAt: { gte: startOfToday } },
        select: { total: true },
      }),
      this.prisma.saleItem.aggregate({
        _sum: { quantity: true },
        where: {
          sale: { status: 'CONCLUIDA', completedAt: { gte: startOfToday } },
        },
      }),
      this.prisma.product.count({ where: { active: true } }),
      this.prisma.stockItem.findMany({
        select: { quantity: true, minQuantity: true },
      }),
      this.salesLast7Days(),
      this.topProducts(),
      this.prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        where: {
          sale: { status: 'CONCLUIDA', completedAt: { gte: startOfToday } },
        },
      }),
      this.prisma.cashSession.findMany({
        where: { status: 'ABERTA' },
        orderBy: { openedAt: 'asc' },
        include: {
          operator: { select: { id: true, name: true } },
          movements: { select: { type: true, amount: true } },
        },
      }),
    ]);

    const revenueToday = salesToday.reduce((acc, s) => acc.plus(s.total), D(0));
    const count = salesToday.length;
    const lowStock = stockItems.filter((s) =>
      D(s.quantity).lte(s.minQuantity),
    ).length;

    // Indicador de caixa da loja inteira: uma linha por turno aberto, com o
    // mesmo saldo esperado que a tela de Caixa mostra ao operador.
    const openCashSessions = openSessions.map((s) => ({
      id: s.id,
      operatorId: s.operatorId,
      operatorName: s.operator?.name ?? '—',
      openedAt: s.openedAt,
      expectedAmount: expectedCash(s).toNumber(),
    }));

    return {
      revenueToday: revenueToday.toNumber(),
      salesToday: count,
      averageTicket: count ? revenueToday.div(count).toNumber() : 0,
      itemsSoldToday: Number(itemsAgg._sum.quantity ?? 0),
      activeProducts,
      lowStockCount: lowStock,
      cashOpen: openCashSessions.length > 0,
      openCashCount: openCashSessions.length,
      openCashSessions,
      salesLast7Days: last7,
      topProducts,
      paymentsByMethod: paymentsToday.map((p) => ({
        method: p.method,
        value: Number(p._sum.amount ?? 0),
      })),
    };
  }

  private async salesLast7Days() {
    const days: { date: string; label: string; value: number }[] = [];
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    for (let i = 6; i >= 0; i--) {
      const from = new Date(today);
      from.setDate(from.getDate() - i);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);

      const sales = await this.prisma.sale.findMany({
        where: { status: 'CONCLUIDA', completedAt: { gte: from, lt: to } },
        select: { total: true },
      });
      const value = sales.reduce((acc, s) => acc.plus(s.total), D(0));
      days.push({
        date: from.toISOString().slice(0, 10),
        label: from
          .toLocaleDateString('pt-BR', { weekday: 'short' })
          .replace('.', ''),
        value: value.toNumber(),
      });
    }
    return days;
  }

  private async topProducts() {
    const from = new Date();
    from.setDate(from.getDate() - 30);

    const grouped = await this.prisma.saleItem.groupBy({
      by: ['productId', 'description'],
      _sum: { quantity: true, total: true },
      where: { sale: { status: 'CONCLUIDA', completedAt: { gte: from } } },
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    });

    return grouped.map((g) => ({
      name: g.description,
      quantity: Number(g._sum.quantity ?? 0),
      value: Number(g._sum.total ?? 0),
    }));
  }
}
