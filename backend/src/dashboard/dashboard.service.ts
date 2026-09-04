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

    // O dashboard junta ~10 consultas. Disparar todas de uma vez estoura o
    // limite de conexoes do Postgres de desenvolvimento (P1017
    // ConnectionClosed -> 500), entao vao em lotes pequenos: a tela e
    // atualizada a cada 30s, alguns milissegundos a mais nao pesam.
    const today = { status: 'CONCLUIDA' as const, completedAt: { gte: startOfToday } };

    const [salesToday, itemsAgg, activeProducts] = await Promise.all([
      this.prisma.sale.findMany({ where: today, select: { total: true } }),
      this.prisma.saleItem.aggregate({
        _sum: { quantity: true },
        where: { sale: today },
      }),
      this.prisma.product.count({ where: { active: true } }),
    ]);

    const [stockItems, paymentsToday, openSessions] = await Promise.all([
      this.prisma.stockItem.findMany({
        select: { quantity: true, minQuantity: true },
      }),
      this.prisma.payment.groupBy({
        by: ['method'],
        _sum: { amount: true },
        where: { sale: today },
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

    const last7 = await this.salesLast7Days();
    const topProducts = await this.topProducts();
    const relationship = await this.customerRelationship();

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
      relationship,
      paymentsByMethod: paymentsToday.map((p) => ({
        method: p.method,
        value: Number(p._sum.amount ?? 0),
      })),
    };
  }

  /** Indicadores de relacionamento com o cliente na janela de 30 dias. */
  private async customerRelationship() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const from30 = new Date();
    from30.setDate(from30.getDate() - 30);

    // Em serie, pelo mesmo motivo do summary(): nao somar concorrencia.
    const newThisMonth = await this.prisma.customer.count({
      where: { createdAt: { gte: startOfMonth } },
    });
    const salesWindow = await this.prisma.sale.findMany({
      where: { status: 'CONCLUIDA', completedAt: { gte: from30 } },
      select: { customerId: true },
    });
    const activeCustomers = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: {
        status: 'CONCLUIDA',
        completedAt: { gte: from30 },
        customerId: { not: null },
      },
    });

    const totalSales = salesWindow.length;
    const identifiedSales = salesWindow.filter((s) => s.customerId).length;

    return {
      newCustomersThisMonth: newThisMonth,
      activeCustomers30d: activeCustomers.length,
      identifiedSalesShare30d: totalSales ? identifiedSales / totalSales : 0,
      salesInWindow30d: totalSales,
    };
  }

  private async salesLast7Days() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const start = new Date(today);
    start.setDate(start.getDate() - 6);

    // Chave de dia no fuso local (evita o deslocamento de toISOString em UTC-3).
    const dayKey = (d: Date) => {
      const x = new Date(d);
      x.setHours(0, 0, 0, 0);
      return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(
        x.getDate(),
      ).padStart(2, '0')}`;
    };

    // Uma unica consulta na janela toda; o balde por dia e feito em memoria.
    const sales = await this.prisma.sale.findMany({
      where: { status: 'CONCLUIDA', completedAt: { gte: start } },
      select: { total: true, completedAt: true },
    });

    const days = Array.from({ length: 7 }, (_, i) => {
      const from = new Date(today);
      from.setDate(from.getDate() - (6 - i));
      return {
        date: dayKey(from),
        label: from
          .toLocaleDateString('pt-BR', { weekday: 'short' })
          .replace('.', ''),
        value: D(0),
      };
    });
    const idx = new Map(days.map((d, i) => [d.date, i]));

    for (const s of sales) {
      if (!s.completedAt) continue;
      const i = idx.get(dayKey(s.completedAt));
      if (i !== undefined) days[i].value = days[i].value.plus(s.total);
    }

    return days.map((d) => ({ ...d, value: d.value.toNumber() }));
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
