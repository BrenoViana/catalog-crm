import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CashflowService } from './cashflow.service';
import { FinancialAccountsService } from './financial-accounts.service';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;
const OPEN = ['ABERTO', 'PARCIAL'] as const;

type OpenTitle = { amount: Prisma.Decimal; paidAmount: Prisma.Decimal; dueDate: Date };

/**
 * Dashboard financeiro: o retrato de saude que o PDF pede como item 1 — saldo
 * por conta, o que vence hoje, o que ja venceu, a projecao por faixa e a
 * inadimplencia. E leitura pura; nao grava nada.
 *
 * As faixas de projecao aqui sao 7/15/30/90 (o pedido do PDF). O
 * `CashflowService` usa 7/30/>30 para outra tela e continua como esta — as duas
 * respondem perguntas diferentes.
 */
@Injectable()
export class FinanceDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: FinancialAccountsService,
    private readonly cashflow: CashflowService,
  ) {}

  async overview() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(startOfDay.getTime() + DAY - 1);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      contas,
      recDueToday,
      payDueToday,
      recOpen,
      payOpen,
      resultado,
    ] = await Promise.all([
      this.accounts.balances(),
      this.prisma.receivable.aggregate({
        where: { status: { in: [...OPEN] }, dueDate: { gte: startOfDay, lte: endOfDay } },
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.payable.aggregate({
        where: { status: { in: [...OPEN] }, dueDate: { gte: startOfDay, lte: endOfDay } },
        _sum: { amount: true, paidAmount: true },
        _count: true,
      }),
      this.prisma.receivable.findMany({
        where: { status: { in: [...OPEN] } },
        select: { amount: true, paidAmount: true, dueDate: true, customerId: true },
      }),
      this.prisma.payable.findMany({
        where: { status: { in: [...OPEN] } },
        select: { amount: true, paidAmount: true, dueDate: true },
      }),
      this.cashflow.report({ from: iso(startOfMonth), to: iso(now) }),
    ]);

    const saldoTotal = contas
      .filter((c) => c.active)
      .reduce((acc, c) => acc.plus(c.balance), D(0));
    const saldoBancario = contas
      .filter((c) => c.active && c.type === 'BANCO')
      .reduce((acc, c) => acc.plus(c.balance), D(0));
    const saldoCaixaCarteira = contas
      .filter((c) => c.active && (c.type === 'CAIXA' || c.type === 'CARTEIRA'))
      .reduce((acc, c) => acc.plus(c.balance), D(0));

    const openBalance = (rows: OpenTitle[]) =>
      rows.reduce((acc, r) => acc.plus(D(r.amount).minus(r.paidAmount)), D(0));

    const vencidos = {
      aReceber: openBalance(recOpen.filter((r) => r.dueDate < startOfDay)),
      aReceberCount: recOpen.filter((r) => r.dueDate < startOfDay).length,
      aPagar: openBalance(payOpen.filter((r) => r.dueDate < startOfDay)),
      aPagarCount: payOpen.filter((r) => r.dueDate < startOfDay).length,
    };

    const aVencer = {
      aReceber: bucketize(recOpen, startOfDay),
      aPagar: bucketize(payOpen, startOfDay),
    };

    // Inadimplencia: saldo vencido sobre o saldo total em aberto dos recebiveis.
    const saldoAbertoReceber = openBalance(recOpen);
    const inadimplenciaPercent = saldoAbertoReceber.gt(0)
      ? vencidos.aReceber.div(saldoAbertoReceber).mul(100).toDecimalPlaces(1)
      : D(0);

    const piores = topDevedores(recOpen, startOfDay);
    const nomes = piores.length
      ? await this.prisma.customer.findMany({
          where: { id: { in: piores.map((p) => p.customerId) } },
          select: { id: true, name: true },
        })
      : [];
    const nomeById = new Map(nomes.map((n) => [n.id, n.name]));

    return {
      contas: contas.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        active: c.active,
        openingBalance: c.openingBalance,
        balance: c.balance,
      })),
      saldos: { total: saldoTotal, bancario: saldoBancario, caixaCarteira: saldoCaixaCarteira },
      hoje: {
        aReceber: D(recDueToday._sum.amount ?? 0).minus(recDueToday._sum.paidAmount ?? 0),
        aReceberCount: recDueToday._count,
        aPagar: D(payDueToday._sum.amount ?? 0).minus(payDueToday._sum.paidAmount ?? 0),
        aPagarCount: payDueToday._count,
      },
      vencidos,
      aVencer,
      resultadoMes: {
        receitaLiquida: resultado.resultado.receitaLiquida,
        despesas: resultado.resultado.despesas,
        resultado: resultado.resultado.resultado,
        cmvEstimado: resultado.resultado.cmvEstimado,
      },
      inadimplencia: {
        percent: inadimplenciaPercent,
        // Sem telefone nem CPF: fechar as contas do dia nao da acesso a dado
        // pessoal de contato (mesma regra do SEC-071 na listagem de titulos).
        piores: piores.map((p) => ({
          nome: nomeById.get(p.customerId) ?? '—',
          valor: p.valor,
          parcelasVencidas: p.parcelas,
        })),
      },
    };
  }
}

function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}

function bucketize(rows: OpenTitle[], startOfDay: Date) {
  const ref = startOfDay.getTime();
  const out = { d7: D(0), d15: D(0), d30: D(0), d90: D(0), acima90: D(0), total: D(0) };
  for (const r of rows) {
    const saldo = D(r.amount).minus(r.paidAmount);
    const days = Math.floor((r.dueDate.getTime() - ref) / DAY);
    if (days < 0) continue; // vencido tem bloco proprio
    out.total = out.total.plus(saldo);
    if (days <= 7) out.d7 = out.d7.plus(saldo);
    else if (days <= 15) out.d15 = out.d15.plus(saldo);
    else if (days <= 30) out.d30 = out.d30.plus(saldo);
    else if (days <= 90) out.d90 = out.d90.plus(saldo);
    else out.acima90 = out.acima90.plus(saldo);
  }
  return out;
}

function topDevedores(
  rows: Array<OpenTitle & { customerId: string }>,
  startOfDay: Date,
) {
  const byCustomer = new Map<string, { valor: Prisma.Decimal; parcelas: number }>();
  for (const r of rows) {
    if (r.dueDate >= startOfDay) continue;
    const saldo = D(r.amount).minus(r.paidAmount);
    const cur = byCustomer.get(r.customerId) ?? { valor: D(0), parcelas: 0 };
    cur.valor = cur.valor.plus(saldo);
    cur.parcelas += 1;
    byCustomer.set(r.customerId, cur);
  }
  return [...byCustomer.entries()]
    .map(([customerId, v]) => ({ customerId, valor: v.valor, parcelas: v.parcelas }))
    .sort((a, b) => Number(b.valor) - Number(a.valor))
    .slice(0, 5);
}
