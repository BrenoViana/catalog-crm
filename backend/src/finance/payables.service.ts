import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type PayableRecurrence, type TitleStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  CancelTitleDto,
  CreatePayableDto,
  ListTitlesQueryDto,
  SettleTitleDto,
  SupplierDto,
} from './dto/finance.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;

export const PAYABLE_NUMBER_LOCK = 727277;

const OPEN_STATUSES: TitleStatus[] = ['ABERTO', 'PARCIAL'];

/** Quantos meses (ou dias, no semanal) cada periodicidade avanca. */
const RECURRENCE_STEP: Record<PayableRecurrence, { months?: number; days?: number }> = {
  NENHUMA: {},
  SEMANAL: { days: 7 },
  MENSAL: { months: 1 },
  BIMESTRAL: { months: 2 },
  TRIMESTRAL: { months: 3 },
  SEMESTRAL: { months: 6 },
  ANUAL: { months: 12 },
};

/**
 * Contas a pagar.
 *
 * A decisao de projeto que mais importa aqui e a da recorrencia: a proxima
 * competencia de uma despesa que se repete e criada na BAIXA da atual, nunca em
 * lote antecipado. Gerar doze meses de aluguel de uma vez enche o fluxo de caixa
 * de titulos que ainda nao existem como compromisso e faz a projecao mentir —
 * alem de virar um problema de limpeza quando o contrato muda de valor.
 */
@Injectable()
export class PayablesService {
  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------- Fornecedores

  listSuppliers(search?: string) {
    return this.prisma.supplier.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { document: { contains: search } },
            ],
          }
        : undefined,
      orderBy: { name: 'asc' },
      take: 200,
    });
  }

  createSupplier(dto: SupplierDto) {
    return this.prisma.supplier.create({
      data: {
        name: dto.name,
        document: dto.document ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        notes: dto.notes ?? null,
        active: dto.active ?? true,
      },
    });
  }

  async updateSupplier(id: string, dto: SupplierDto) {
    await this.prisma.supplier.findUniqueOrThrow({ where: { id } }).catch(() => {
      throw new NotFoundException('Fornecedor nao encontrado.');
    });
    return this.prisma.supplier.update({
      where: { id },
      data: {
        name: dto.name,
        document: dto.document ?? null,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        notes: dto.notes ?? null,
        ...(dto.active === undefined ? {} : { active: dto.active }),
      },
    });
  }

  // -------------------------------------------------------------- Titulos

  async create(dto: CreatePayableDto, userId: string) {
    const dueDate = new Date(dto.dueDate);
    if (Number.isNaN(dueDate.getTime())) {
      throw new BadRequestException('Vencimento invalido.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYABLE_NUMBER_LOCK})`;
      const last = await tx.payable.findFirst({
        orderBy: { number: 'desc' },
        select: { number: true },
      });
      return tx.payable.create({
        data: {
          number: (last?.number ?? 0) + 1,
          supplierId: dto.supplierId ?? null,
          description: dto.description,
          category: dto.category?.trim() || 'Geral',
          amount: D(dto.amount),
          dueDate,
          recurrence: dto.recurrence ?? 'NENHUMA',
          note: dto.note ?? null,
          createdById: userId,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });
    });
  }

  list(query: ListTitlesQueryDto) {
    const where: Prisma.PayableWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.supplierId) where.supplierId = query.supplierId;
    if (query.overdue === 'true') {
      where.status = { in: OPEN_STATUSES };
      where.dueDate = { lt: new Date() };
    }
    if (query.search) {
      where.OR = [
        { description: { contains: query.search, mode: 'insensitive' } },
        { category: { contains: query.search, mode: 'insensitive' } },
        { supplier: { name: { contains: query.search, mode: 'insensitive' } } },
      ];
    }

    return this.prisma.payable.findMany({
      where,
      orderBy: [{ status: 'asc' }, { dueDate: 'asc' }],
      take: Math.min(query.take ?? 200, 500),
      include: {
        supplier: { select: { id: true, name: true } },
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

  async summary() {
    const open = await this.prisma.payable.findMany({
      where: { status: { in: OPEN_STATUSES } },
      select: { amount: true, paidAmount: true, dueDate: true, category: true },
    });

    const now = Date.now();
    const aging = { vencido: D(0), ate7: D(0), ate30: D(0), acima30: D(0) };
    const porCategoria = new Map<string, Prisma.Decimal>();
    let total = D(0);
    for (const t of open) {
      const saldo = D(t.amount).minus(t.paidAmount);
      total = total.plus(saldo);
      porCategoria.set(
        t.category,
        (porCategoria.get(t.category) ?? D(0)).plus(saldo),
      );
      const days = Math.floor((t.dueDate.getTime() - now) / DAY);
      if (days < 0) aging.vencido = aging.vencido.plus(saldo);
      else if (days <= 7) aging.ate7 = aging.ate7.plus(saldo);
      else if (days <= 30) aging.ate30 = aging.ate30.plus(saldo);
      else aging.acima30 = aging.acima30.plus(saldo);
    }

    return {
      totalOpen: total,
      titles: open.length,
      aging,
      byCategory: [...porCategoria.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
    };
  }

  /**
   * Baixa. Em dinheiro sai da gaveta do turno aberto de quem pagou — despesa
   * paga do caixa e sangria, e o Z tem de saber disso. Quitando um titulo
   * recorrente, a competencia seguinte nasce aqui.
   */
  async settle(id: string, dto: SettleTitleDto, userId: string) {
    const amount = D(dto.amount);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;

      const title = await tx.payable.findUnique({ where: { id } });
      if (!title) throw new NotFoundException('Despesa nao encontrada.');
      if (title.status === 'CANCELADO') {
        throw new BadRequestException('Despesa cancelada nao aceita baixa.');
      }
      if (title.status === 'PAGO') {
        throw new BadRequestException('Despesa ja esta quitada.');
      }

      const saldo = D(title.amount).minus(title.paidAmount);
      if (amount.gt(saldo)) {
        throw new BadRequestException(
          `Pagamento de R$ ${amount.toFixed(2)} maior que o saldo da despesa (R$ ${saldo.toFixed(2)}).`,
        );
      }

      // Pagamento em especie sem turno aberto sai da gaveta sem par no
      // fechamento (SEC-066).
      const openSession =
        dto.method === 'DINHEIRO'
          ? await tx.cashSession.findFirst({
              where: { operatorId: userId, status: 'ABERTA' },
              select: { id: true },
            })
          : null;
      if (dto.method === 'DINHEIRO' && !openSession) {
        throw new BadRequestException(
          'Abra o caixa para pagar em especie — senao o dinheiro sai sem par no fechamento.',
        );
      }

      await tx.payableSettlement.create({
        data: {
          payableId: id,
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
            type: 'SANGRIA',
            amount,
            reason: `Pagamento da despesa #${title.number} — ${title.description}`,
            userId,
          },
        });
      }

      const paid = D(title.paidAmount).plus(amount);
      const quitado = paid.gte(title.amount);
      const updated = await tx.payable.update({
        where: { id },
        data: {
          paidAmount: paid,
          status: quitado ? 'PAGO' : 'PARCIAL',
          paidAt: quitado ? new Date() : null,
        },
        include: { supplier: { select: { id: true, name: true } } },
      });

      let next: { id: string; number: number; dueDate: Date } | null = null;
      if (quitado && title.recurrence !== 'NENHUMA') {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PAYABLE_NUMBER_LOCK})`;
        const last = await tx.payable.findFirst({
          orderBy: { number: 'desc' },
          select: { number: true },
        });
        next = await tx.payable.create({
          data: {
            number: (last?.number ?? 0) + 1,
            supplierId: title.supplierId,
            description: title.description,
            category: title.category,
            amount: title.amount,
            dueDate: advance(title.dueDate, title.recurrence),
            recurrence: title.recurrence,
            note: title.note,
            createdById: userId,
          },
          select: { id: true, number: true, dueDate: true },
        });
      }

      return { ...updated, next };
    });
  }

  async cancel(id: string, dto: CancelTitleDto) {
    const title = await this.prisma.payable.findUnique({ where: { id } });
    if (!title) throw new NotFoundException('Despesa nao encontrada.');
    if (title.status === 'PAGO') {
      throw new BadRequestException(
        'Despesa quitada nao pode ser cancelada — o dinheiro ja saiu.',
      );
    }
    if (title.status === 'CANCELADO') return title;

    return this.prisma.payable.update({
      where: { id },
      data: {
        status: 'CANCELADO',
        canceledAt: new Date(),
        note: [title.note, `Cancelado: ${dto.reason}`].filter(Boolean).join(' | '),
      },
    });
  }

  /** Categorias ja usadas — alimenta o autocompletar do formulario. */
  async categories() {
    const rows = await this.prisma.payable.groupBy({
      by: ['category'],
      _count: true,
      orderBy: { _count: { category: 'desc' } },
      take: 40,
    });
    return rows.map((r) => r.category);
  }
}

/**
 * Avanca o vencimento uma competencia.
 *
 * Somar meses em JavaScript transborda: 31/01 + 1 mes vira 03/03 num ano
 * comum. Como conta de vencimento mensal cai sempre no mesmo dia, prendemos ao
 * ultimo dia do mes de destino — 31/01 vence 28/02, e nao 03/03.
 */
function advance(from: Date, recurrence: PayableRecurrence): Date {
  const step = RECURRENCE_STEP[recurrence];
  if (step.days) return new Date(from.getTime() + step.days * DAY);
  const months = step.months ?? 1;

  const day = from.getUTCDate();
  const target = new Date(
    Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth() + months,
      1,
      from.getUTCHours(),
      from.getUTCMinutes(),
    ),
  );
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}
