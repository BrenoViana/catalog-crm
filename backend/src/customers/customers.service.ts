import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;

/** Segmentacao leve por recencia/valor — orienta o atendimento no balcao. */
export type CustomerSegment = 'NOVO' | 'VIP' | 'ATIVO' | 'EM_RISCO' | 'INATIVO';

const VIP_MIN_SPENT = 1000;
const VIP_MIN_VISITS = 8;

function segmentOf(params: {
  salesCount: number;
  totalSpent: number;
  lastPurchase: Date | null;
}): CustomerSegment {
  if (params.salesCount === 0 || !params.lastPurchase) return 'NOVO';
  const days = Math.floor((Date.now() - params.lastPurchase.getTime()) / DAY);
  if (days > 120) return 'INATIVO';
  if (
    params.totalSpent >= VIP_MIN_SPENT ||
    params.salesCount >= VIP_MIN_VISITS
  ) {
    return 'VIP';
  }
  if (days > 60) return 'EM_RISCO';
  return 'ATIVO';
}

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GERENTE/ADMIN veem a lista completa, enriquecida com o resumo de compras e
   * o segmento de cada cliente. Quem NAO tem "customers.manage" so recebe
   * resultado ao informar um termo de busca (>= 3 caracteres) e com campos
   * reduzidos — evita expor a base inteira (CPF, e-mail, nascimento) no PDV.
   */
  async findAll(search: string | undefined, fullAccess: boolean) {
    const isManager = fullAccess;
    const term = (search ?? '').trim();

    if (!isManager && term.length < 3) return [];

    const where: Prisma.CustomerWhereInput | undefined = term
      ? {
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { document: { contains: term } },
            { phone: { contains: term } },
          ],
        }
      : undefined;

    if (!isManager) {
      return this.prisma.customer.findMany({
        where,
        orderBy: { name: 'asc' },
        take: 100,
        select: { id: true, name: true, document: true, phone: true },
      });
    }

    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: { name: 'asc' },
      take: 200,
    });

    const stats = await this.salesStatsByCustomer(customers.map((c) => c.id));

    return customers.map((c) => {
      const s = stats.get(c.id) ?? {
        salesCount: 0,
        totalSpent: 0,
        lastPurchase: null,
      };
      return {
        ...c,
        salesCount: s.salesCount,
        totalSpent: s.totalSpent,
        lastPurchase: s.lastPurchase,
        segment: segmentOf(s),
      };
    });
  }

  async findOne(id: string) {
    const customer = await this.prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new NotFoundException('Cliente nao encontrado.');
    return customer;
  }

  /** Visao 360 do cliente: contato + resumo de compras + historico recente. */
  async profile(id: string) {
    const customer = await this.findOne(id);

    const [agg, recentSales, topProducts] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { customerId: id, status: 'CONCLUIDA' },
        _sum: { total: true },
        _count: { _all: true },
        _min: { completedAt: true },
        _max: { completedAt: true },
      }),
      this.prisma.sale.findMany({
        where: { customerId: id },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          number: true,
          status: true,
          total: true,
          createdAt: true,
          completedAt: true,
          _count: { select: { items: true } },
        },
      }),
      this.prisma.saleItem.groupBy({
        by: ['description'],
        where: { sale: { customerId: id, status: 'CONCLUIDA' } },
        _sum: { quantity: true, total: true },
        orderBy: { _sum: { total: 'desc' } },
        take: 5,
      }),
    ]);

    const salesCount = agg._count._all;
    const totalSpent = Number(agg._sum.total ?? 0);
    const lastPurchase = agg._max.completedAt;

    return {
      customer,
      stats: {
        salesCount,
        totalSpent,
        averageTicket: salesCount ? totalSpent / salesCount : 0,
        firstPurchase: agg._min.completedAt,
        lastPurchase,
        segment: segmentOf({ salesCount, totalSpent, lastPurchase }),
      },
      recentSales,
      topProducts: topProducts.map((p) => ({
        name: p.description,
        quantity: Number(p._sum.quantity ?? 0),
        total: Number(p._sum.total ?? 0),
      })),
    };
  }

  /** Aniversariantes de um mes (1-12), ordenados pelo dia. */
  async birthdays(month: number) {
    const rows = await this.prisma.customer.findMany({
      where: { birthDate: { not: null } },
      select: {
        id: true,
        name: true,
        phone: true,
        email: true,
        birthDate: true,
      },
    });
    return rows
      .filter((c) => c.birthDate && c.birthDate.getUTCMonth() + 1 === month)
      .sort(
        (a, b) =>
          (a.birthDate as Date).getUTCDate() -
          (b.birthDate as Date).getUTCDate(),
      );
  }

  create(dto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        name: dto.name,
        document: dto.document,
        phone: dto.phone,
        email: dto.email,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  async update(id: string, dto: UpdateCustomerDto) {
    await this.findOne(id);
    return this.prisma.customer.update({
      where: { id },
      data: {
        name: dto.name,
        document: dto.document,
        phone: dto.phone,
        email: dto.email,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        notes: dto.notes,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.customer.delete({ where: { id } });
    return { message: 'Cliente removido.' };
  }

  /** Total gasto, nº de compras e data da última — só vendas concluídas. */
  private async salesStatsByCustomer(ids: string[]) {
    if (ids.length === 0) {
      return new Map<
        string,
        { salesCount: number; totalSpent: number; lastPurchase: Date | null }
      >();
    }
    const grouped = await this.prisma.sale.groupBy({
      by: ['customerId'],
      where: { customerId: { in: ids }, status: 'CONCLUIDA' },
      _sum: { total: true },
      _count: { _all: true },
      _max: { completedAt: true },
    });
    return new Map(
      grouped
        .filter((g) => g.customerId)
        .map((g) => [
          g.customerId as string,
          {
            salesCount: g._count._all,
            totalSpent: Number(g._sum.total ?? 0),
            lastPurchase: g._max.completedAt,
          },
        ]),
    );
  }
}
