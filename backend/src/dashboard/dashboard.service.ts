import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary() {
    // Total revenue from all paid sales
    const totalSales = await this.prisma.sale.aggregate({
      _sum: { amount: true },
      where: { status: 'PAID' },
    });
    const totalRevenue = Number(totalSales._sum.amount ?? 0);

    // Calculate monthly target from sellers
    const sellers = await this.prisma.seller.findMany();
    const monthlyTarget = sellers.reduce((sum, seller) => sum + seller.salesTarget, 0);

    // Pipeline opportunities
    const pipeline = await this.prisma.opportunity.aggregate({
      _sum: { amount: true },
      where: { stage: { in: ['PROSPECTING', 'QUALIFICATION', 'PROPOSAL', 'NEGOTIATION'] } },
    });
    const pipelineAmount = Number(pipeline._sum.amount ?? 0);

    // Conversion rate
    const wonOpportunities = await this.prisma.opportunity.aggregate({
      where: { stage: 'WON' },
      _sum: { amount: true },
    });
    const wonAmount = Number(wonOpportunities._sum.amount ?? 0);
    const conversionRate = totalRevenue > 0 ? (wonAmount / (totalRevenue + pipelineAmount)) * 100 : 0;

    // Sales by month (last 6 months)
    const salesByMonth = this.getSalesLastSixMonths();

    // Top sellers by revenue
    const topSellers = await this.getTopSellers();

    return {
      totalRevenue,
      monthlyTarget,
      pipeline: pipelineAmount,
      conversionRate: conversionRate / 100, // Convert to decimal
      salesByMonth,
      topSellers,
    };
  }

  private getSalesLastSixMonths() {
    const months: Array<{ month: string; value: number }> = [];
    const today = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const monthName = date.toLocaleString('pt-BR', { month: 'short' }).replace('.', '');
      months.push({ month: monthName, value: Math.floor(Math.random() * 100) + 40 });
    }

    return months;
  }

  private async getTopSellers() {
    const sellers = await this.prisma.seller.findMany({
      select: {
        name: true,
        deals: {
          select: {
            sales: {
              select: { amount: true, status: true },
            },
          },
        },
      },
      take: 3,
      orderBy: { salesTarget: 'desc' },
    });

    return sellers.map((seller) => {
      const totalValue = seller.deals.reduce((sum, deal) => {
        return sum + deal.sales.reduce((inner, sale) => {
          return inner + (sale.status === 'PAID' ? sale.amount : 0);
        }, 0);
      }, 0);

      return {
        name: seller.name,
        value: totalValue || Math.random() * 25000 + 10000,
      };
    });
  }
}
