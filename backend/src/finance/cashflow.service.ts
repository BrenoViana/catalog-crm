import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PeriodQueryDto } from './dto/finance.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const DAY = 24 * 60 * 60 * 1000;

/**
 * Janela maxima do relatorio. Mesmo teto dos relatorios gerenciais: sem ele,
 * `?from=1970-01-01` carregava a base inteira de itens de venda e pagamentos
 * para a memoria do backend da loja (SEC-068).
 */
const MAX_PERIOD_DAYS = 366;

/** Formas que efetivamente movem dinheiro para a loja. */
type Bucket = { date: string; in: Prisma.Decimal; out: Prisma.Decimal };

/**
 * Fluxo de caixa e DRE simples.
 *
 * As duas visoes respondem a perguntas diferentes e nao batem entre si de
 * proposito:
 *
 * - **Resultado (DRE)** e por COMPETENCIA: a venda a prazo entra como receita no
 *   dia em que a mercadoria saiu, mesmo que o dinheiro so chegue em 60 dias.
 *   E o numero que diz se a loja esta ganhando dinheiro.
 * - **Fluxo de caixa** e por CAIXA: so conta o que passou pela gaveta ou pela
 *   conta no periodo — venda a vista, baixa de crediario, pagamento de despesa.
 *   E o numero que diz se a loja consegue pagar as contas deste mes.
 *
 * Um lojista que confunde os dois vende bem e quebra. Por isso as duas aparecem
 * lado a lado, com a diferenca explicada pelos titulos em aberto.
 *
 * O CMV aqui e ESTIMADO sobre o custo atual do produto, nao sobre o custo do
 * dia da venda — o item da venda ainda nao guarda custo. Enquanto for assim, a
 * margem é uma boa aproximacao, nao um fechamento contabil, e o campo vem
 * marcado como estimativa para nao ser lido como outra coisa.
 */
@Injectable()
export class CashflowService {
  constructor(private readonly prisma: PrismaService) {}

  private range(query: PeriodQueryDto) {
    const now = new Date();
    const to = query.to ? new Date(query.to) : now;
    const from = query.from
      ? new Date(query.from)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      throw new BadRequestException('Periodo invalido.');
    }
    // Fim de dia: quem digita "31/10" quer o dia inteiro, nao 00:00.
    to.setHours(23, 59, 59, 999);
    from.setHours(0, 0, 0, 0);

    if (to < from) {
      throw new BadRequestException('A data final e anterior a inicial.');
    }
    if (to.getTime() - from.getTime() > MAX_PERIOD_DAYS * DAY) {
      throw new BadRequestException(
        `Periodo limitado a ${MAX_PERIOD_DAYS} dias. Estreite a janela.`,
      );
    }
    return { from, to };
  }

  async report(query: PeriodQueryDto) {
    const { from, to } = this.range(query);
    const period = { gte: from, lte: to };

    const [
      sales,
      returns,
      items,
      salePayments,
      receivableSettlements,
      payableSettlements,
      openReceivables,
      openPayables,
    ] = await Promise.all([
      this.prisma.sale.aggregate({
        where: { status: 'CONCLUIDA', completedAt: period },
        _sum: { total: true, discount: true },
        _count: true,
      }),
      this.prisma.saleReturn.aggregate({
        where: { createdAt: period },
        _sum: { total: true },
        _count: true,
      }),
      // CMV estimado: quantidade vendida x custo atual do produto. O groupBy
      // devolve uma linha por PRODUTO — limitado pelo catalogo, nao pelo numero
      // de itens vendidos no periodo, que e o que estourava a memoria.
      this.prisma.saleItem.groupBy({
        by: ['productId'],
        where: { sale: { status: 'CONCLUIDA', completedAt: period } },
        _sum: { quantity: true },
      }),
      // So o que entrou de verdade: NEGADO e ESTORNADO nao sao dinheiro.
      this.prisma.payment.findMany({
        take: 50_000,
        where: {
          sale: { status: 'CONCLUIDA', completedAt: period },
          status: { in: ['AUTORIZADO', 'CONFIRMADO'] },
        },
        select: { method: true, amount: true, createdAt: true },
      }),
      this.prisma.receivableSettlement.findMany({
        take: 50_000,
        where: { createdAt: period },
        select: { amount: true, method: true, createdAt: true },
      }),
      this.prisma.payableSettlement.findMany({
        take: 50_000,
        where: { createdAt: period },
        select: {
          amount: true,
          method: true,
          createdAt: true,
          payable: { select: { category: true } },
        },
      }),
      this.prisma.receivable.findMany({
        where: { status: { in: ['ABERTO', 'PARCIAL'] } },
        select: { amount: true, paidAmount: true, dueDate: true },
      }),
      this.prisma.payable.findMany({
        where: { status: { in: ['ABERTO', 'PARCIAL'] } },
        select: { amount: true, paidAmount: true, dueDate: true },
      }),
    ]);

    // ------------------------------------------------------- Resultado
    const receitaBruta = D(sales._sum.total ?? 0);
    const devolucoes = D(returns._sum.total ?? 0);
    const receitaLiquida = receitaBruta.minus(devolucoes);

    const custoPorProduto = new Map<string, Prisma.Decimal | null>(
      (
        await this.prisma.product.findMany({
          where: { id: { in: items.map((i) => i.productId) } },
          select: { id: true, cost: true },
        })
      ).map((p) => [p.id, p.cost]),
    );

    let cmv = D(0);
    let itensSemCusto = 0;
    for (const item of items) {
      const custo = custoPorProduto.get(item.productId);
      if (custo == null) {
        itensSemCusto += 1;
        continue;
      }
      cmv = cmv.plus(D(custo).mul(item._sum.quantity ?? 0));
    }

    const despesasPorCategoria = new Map<string, Prisma.Decimal>();
    let despesas = D(0);
    for (const s of payableSettlements) {
      const cat = s.payable.category;
      despesas = despesas.plus(s.amount);
      despesasPorCategoria.set(
        cat,
        (despesasPorCategoria.get(cat) ?? D(0)).plus(s.amount),
      );
    }

    const margemBruta = receitaLiquida.minus(cmv);
    const resultado = margemBruta.minus(despesas);

    // --------------------------------------------------------- Caixa
    // Crediario NAO entra como entrada de caixa na venda: o dinheiro so chega
    // na baixa do titulo, que aparece em `recebimentos`. Fidelidade tambem
    // fica de fora — resgate de saldo nao e dinheiro entrando, e credito que a
    // loja ja tinha concedido sendo devolvido em mercadoria.
    const ignoradasNoCaixa = new Set(['CREDIARIO', 'FIDELIDADE']);
    const entradasPorForma = new Map<string, Prisma.Decimal>();
    let entradasVenda = D(0);
    for (const p of salePayments) {
      if (ignoradasNoCaixa.has(p.method)) continue;
      entradasVenda = entradasVenda.plus(p.amount);
      entradasPorForma.set(
        p.method,
        (entradasPorForma.get(p.method) ?? D(0)).plus(p.amount),
      );
    }

    const recebimentos = receivableSettlements.reduce(
      (acc, s) => acc.plus(s.amount),
      D(0),
    );
    const entradas = entradasVenda.plus(recebimentos);
    const saidas = despesas.plus(devolucoes);

    // Serie diaria: e o formato em que o lojista percebe o aperto de caixa
    // antes de ele acontecer.
    const daily = new Map<string, Bucket>();
    const bump = (date: Date, field: 'in' | 'out', amount: Prisma.Decimal) => {
      const key = date.toISOString().slice(0, 10);
      const row = daily.get(key) ?? { date: key, in: D(0), out: D(0) };
      row[field] = row[field].plus(amount);
      daily.set(key, row);
    };
    for (const p of salePayments) {
      if (ignoradasNoCaixa.has(p.method)) continue;
      bump(p.createdAt, 'in', p.amount);
    }
    for (const s of receivableSettlements) bump(s.createdAt, 'in', s.amount);
    for (const s of payableSettlements) bump(s.createdAt, 'out', s.amount);

    // ------------------------------------------------------ Projecao
    const now = Date.now();
    const bucketize = (
      rows: { amount: Prisma.Decimal; paidAmount: Prisma.Decimal; dueDate: Date }[],
    ) => {
      const out = { vencido: D(0), ate7: D(0), ate30: D(0), acima30: D(0) };
      let total = D(0);
      for (const r of rows) {
        const saldo = D(r.amount).minus(r.paidAmount);
        total = total.plus(saldo);
        const days = Math.floor((r.dueDate.getTime() - now) / DAY);
        if (days < 0) out.vencido = out.vencido.plus(saldo);
        else if (days <= 7) out.ate7 = out.ate7.plus(saldo);
        else if (days <= 30) out.ate30 = out.ate30.plus(saldo);
        else out.acima30 = out.acima30.plus(saldo);
      }
      return { total, ...out };
    };

    const aReceber = bucketize(openReceivables);
    const aPagar = bucketize(openPayables);

    return {
      period: { from, to },
      resultado: {
        receitaBruta,
        devolucoes,
        receitaLiquida,
        cmv,
        /** Custo aproximado: usa o custo ATUAL do produto, nao o do dia da venda. */
        cmvEstimado: true,
        itensSemCusto,
        margemBruta,
        margemPercent: receitaLiquida.gt(0)
          ? margemBruta.div(receitaLiquida).mul(100).toDecimalPlaces(2)
          : D(0),
        despesas,
        resultado,
        vendas: sales._count,
        devolucoesCount: returns._count,
      },
      caixa: {
        entradas,
        entradasVenda,
        recebimentos,
        saidas,
        despesas,
        devolucoes,
        saldo: entradas.minus(saidas),
        byMethod: [...entradasPorForma.entries()]
          .map(([method, amount]) => ({ method, amount }))
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
        daily: [...daily.values()].sort((a, b) => a.date.localeCompare(b.date)),
      },
      despesasPorCategoria: [...despesasPorCategoria.entries()]
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => Number(b.amount) - Number(a.amount)),
      projecao: {
        aReceber,
        aPagar,
        /** O que sobra se tudo em aberto for liquidado no vencimento. */
        saldoProjetado: aReceber.total.minus(aPagar.total),
      },
    };
  }
}
