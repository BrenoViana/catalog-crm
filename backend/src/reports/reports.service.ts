import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  previousRange,
  resolveRange,
  type ReportGroupBy,
  type ReportQueryDto,
  type ResolvedRange,
} from './dto/report-query.dto';

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);
const n = (v: Prisma.Decimal | null | undefined) => (v ? D(v).toNumber() : 0);

/** So dinheiro que a loja realmente recebeu entra em faturamento. */
const RECEIVED = ['AUTORIZADO', 'CONFIRMADO'] as const;

/**
 * Teto de linhas por relatorio.
 *
 * Curva ABC e posicao de estoque nao tem recorte de periodo que limite o
 * volume: numa loja com dezenas de milhares de SKUs, a resposta inteira seria
 * montada em memoria no MESMO processo que atende o balcao. Truncar e dizer que
 * truncou e melhor que derrubar o PDV — e a lista ja vem ordenada por receita,
 * entao o que sobra e a cauda.
 */
const MAX_ROWS = 2000;

/** Variacao percentual entre dois periodos; `null` quando nao ha base. */
function variation(current: number, previous: number): number | null {
  if (!previous) return null;
  return (current - previous) / previous;
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

/** Primeiro dia do balde a que a data pertence, na granularidade pedida. */
function bucketStart(date: Date, groupBy: ReportGroupBy): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  if (groupBy === 'week') {
    // Semana comeca na segunda-feira: e como o varejo fecha a semana.
    const weekday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - weekday);
  } else if (groupBy === 'month') {
    d.setDate(1);
  }
  return d;
}

function bucketLabel(date: Date, groupBy: ReportGroupBy): string {
  if (groupBy === 'month') {
    return date.toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' });
  }
  if (groupBy === 'week') {
    return `sem. ${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
  }
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

/** Todos os baldes da janela, inclusive os vazios: buraco no meio da serie e informacao. */
function buildBuckets(range: ResolvedRange, groupBy: ReportGroupBy) {
  const buckets: { key: string; label: string; start: Date }[] = [];
  const seen = new Set<string>();
  const cursor = new Date(range.from);
  while (cursor < range.to) {
    const start = bucketStart(cursor, groupBy);
    const key = dayKey(start);
    if (!seen.has(key)) {
      seen.add(key);
      buckets.push({ key, label: bucketLabel(start, groupBy), start });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return buckets;
}

@Injectable()
export class ReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Um relatorio junta varias agregacoes. Assim como o dashboard, elas vao em
   * lotes pequenos: disparar tudo de uma vez estoura o limite de conexoes do
   * Postgres de desenvolvimento (P1017) e o usuario recebe 500 no lugar do
   * relatorio.
   */

  // ------------------------------------------------------------------ Vendas
  async sales(query: ReportQueryDto) {
    const range = resolveRange(query);
    const groupBy: ReportGroupBy = query.groupBy ?? 'day';
    const window = { gte: range.from, lt: range.to };

    const sales = await this.prisma.sale.findMany({
      where: { status: 'CONCLUIDA', completedAt: window },
      select: { subtotal: true, discount: true, total: true, completedAt: true },
    });
    const [itemsAgg, canceladas] = await Promise.all([
      this.prisma.saleItem.aggregate({
        _sum: { quantity: true },
        where: { sale: { status: 'CONCLUIDA', completedAt: window } },
      }),
      this.prisma.sale.count({ where: { status: 'CANCELADA', canceledAt: window } }),
    ]);
    const returns = await this.prisma.saleReturn.findMany({
      where: { createdAt: window },
      select: { total: true, createdAt: true },
    });
    // Venda concluida cujo pagamento ficou NEGADO ou parado no gateway conta
    // como receita aqui e NAO conta na leitura X/Z nem em `payments()`. Em vez
    // de esconder a diferenca, ela vai declarada: e exatamente o buraco que o
    // relatorio existe para denunciar.
    const naoLiquidadoAgg = await this.prisma.payment.aggregate({
      _sum: { amount: true },
      _count: { _all: true },
      where: {
        status: { in: ['PENDENTE', 'PROCESSANDO', 'NEGADO'] },
        sale: { status: 'CONCLUIDA', completedAt: window },
      },
    });

    const buckets = buildBuckets(range, groupBy);
    const index = new Map(buckets.map((b, i) => [b.key, i]));
    const serie = buckets.map((b) => ({
      key: b.key,
      label: b.label,
      receita: D(0),
      vendas: 0,
      descontos: D(0),
      devolucoes: D(0),
    }));

    let receitaBruta = D(0);
    let descontos = D(0);
    let receitaLiquida = D(0);

    for (const s of sales) {
      receitaBruta = receitaBruta.plus(s.subtotal);
      descontos = descontos.plus(s.discount);
      receitaLiquida = receitaLiquida.plus(s.total);
      if (!s.completedAt) continue;
      const i = index.get(dayKey(bucketStart(s.completedAt, groupBy)));
      if (i === undefined) continue;
      serie[i].receita = serie[i].receita.plus(s.total);
      serie[i].descontos = serie[i].descontos.plus(s.discount);
      serie[i].vendas += 1;
    }

    let devolucoes = D(0);
    for (const r of returns) {
      devolucoes = devolucoes.plus(r.total);
      const i = index.get(dayKey(bucketStart(r.createdAt, groupBy)));
      if (i !== undefined) serie[i].devolucoes = serie[i].devolucoes.plus(r.total);
    }

    const vendas = sales.length;
    const itens = Number(itemsAgg._sum.quantity ?? 0);
    const receitaFinal = receitaLiquida.minus(devolucoes);
    const ticketMedio = vendas ? receitaLiquida.div(vendas).toNumber() : 0;

    const anterior = await this.previousTotals(range);

    return {
      periodo: { from: range.fromLabel, to: range.toLabel, dias: range.days, groupBy },
      totais: {
        receitaBruta: receitaBruta.toNumber(),
        descontos: descontos.toNumber(),
        receitaLiquida: receitaLiquida.toNumber(),
        devolucoes: devolucoes.toNumber(),
        receitaFinal: receitaFinal.toNumber(),
        vendas,
        ticketMedio,
        itens,
        itensPorVenda: vendas ? itens / vendas : 0,
        canceladas,
      },
      /**
       * Parte da receita acima que a loja ainda nao viu entrar. `receitaLiquida`
       * soma `Sale.total` de toda venda concluida; `payments()` e a leitura X/Z
       * so somam pagamento AUTORIZADO/CONFIRMADO. A diferenca mora aqui.
       */
      naoLiquidado: {
        valor: n(naoLiquidadoAgg._sum.amount),
        pagamentos: naoLiquidadoAgg._count._all,
      },
      comparacao: {
        receitaFinal: variation(receitaFinal.toNumber(), anterior.receitaFinal),
        vendas: variation(vendas, anterior.vendas),
        ticketMedio: variation(ticketMedio, anterior.ticketMedio),
      },
      serie: serie.map((b) => ({
        key: b.key,
        label: b.label,
        receita: b.receita.toNumber(),
        vendas: b.vendas,
        descontos: b.descontos.toNumber(),
        devolucoes: b.devolucoes.toNumber(),
      })),
    };
  }

  /** Totais da janela anterior, so o suficiente para a variacao percentual. */
  private async previousTotals(range: ResolvedRange) {
    const prev = previousRange(range);
    const window = { gte: prev.from, lt: prev.to };

    const agg = await this.prisma.sale.aggregate({
      _sum: { total: true },
      _count: { _all: true },
      where: { status: 'CONCLUIDA', completedAt: window },
    });
    const devolucoes = await this.prisma.saleReturn.aggregate({
      _sum: { total: true },
      where: { createdAt: window },
    });

    const receita = n(agg._sum.total);
    const vendas = agg._count._all;
    return {
      receitaFinal: receita - n(devolucoes._sum.total),
      vendas,
      ticketMedio: vendas ? receita / vendas : 0,
    };
  }

  // -------------------------------------------------------------- Pagamentos
  async payments(query: ReportQueryDto) {
    const range = resolveRange(query);
    const window = { gte: range.from, lt: range.to };

    const grouped = await this.prisma.payment.groupBy({
      by: ['method'],
      _sum: { amount: true },
      _count: { _all: true },
      where: {
        status: { in: [...RECEIVED] },
        sale: { status: 'CONCLUIDA', completedAt: window },
      },
    });
    // Recusa e estorno nao sao faturamento, mas dizem muito sobre a maquineta.
    //
    // So de venda CONCLUIDA, como o bloco de cima: cancelar venda estorna cada
    // pagamento por definicao, entao incluir venda cancelada encheria esta linha
    // de estorno normal e esconderia a falha real de adquirente que ela existe
    // para denunciar.
    const problemas = await this.prisma.payment.groupBy({
      by: ['method', 'status'],
      _sum: { amount: true },
      _count: { _all: true },
      where: {
        status: { in: ['NEGADO', 'ESTORNADO'] },
        sale: { status: 'CONCLUIDA', completedAt: window },
      },
    });

    const total = grouped.reduce((acc, g) => acc + n(g._sum.amount), 0);

    return {
      periodo: { from: range.fromLabel, to: range.toLabel, dias: range.days },
      total,
      linhas: grouped
        .map((g) => ({
          method: g.method,
          valor: n(g._sum.amount),
          quantidade: g._count._all,
          participacao: total ? n(g._sum.amount) / total : 0,
          ticketMedio: g._count._all ? n(g._sum.amount) / g._count._all : 0,
        }))
        .sort((a, b) => b.valor - a.valor),
      recusados: problemas.map((p) => ({
        method: p.method,
        status: p.status,
        valor: n(p._sum.amount),
        quantidade: p._count._all,
      })),
    };
  }

  // ---------------------------------------------------------------- Produtos
  /**
   * Custo realizado por produto na janela, direto do snapshot do item da venda.
   *
   * `SaleItem.unitCost` guarda o custo que valia no dia da venda. A soma tem de
   * ser `unitCost * quantity` linha a linha — nao da para fazer com `groupBy`,
   * que so agrega colunas existentes. Vendas anteriores a essa coluna (e itens
   * de produto sem custo cadastrado) entram como `semCusto`: a linha fica sem
   * margem e a cobertura vai na resposta, em vez de a conta silenciosamente
   * tratar custo desconhecido como zero e inflar a margem.
   */
  private async realizedCost(range: ResolvedRange, productIds: string[]) {
    if (!productIds.length) {
      return new Map<string, { custo: Prisma.Decimal | null; comCusto: number; semCusto: number }>();
    }
    const rows = await this.prisma.$queryRaw<
      { productId: string; custo: Prisma.Decimal | null; comCusto: bigint; semCusto: bigint }[]
    >`
      SELECT i."productId"                                                AS "productId",
             SUM(i."unitCost" * i."quantity")                             AS "custo",
             COUNT(*) FILTER (WHERE i."unitCost" IS NOT NULL)             AS "comCusto",
             COUNT(*) FILTER (WHERE i."unitCost" IS NULL)                 AS "semCusto"
        FROM "SaleItem" i
        JOIN "Sale" s ON s."id" = i."saleId"
       WHERE s."status" = 'CONCLUIDA'
         AND s."completedAt" >= ${range.from}
         AND s."completedAt" < ${range.to}
         AND i."productId" IN (${Prisma.join(productIds)})
       GROUP BY i."productId"
    `;
    return new Map(
      rows.map((r) => [
        r.productId,
        {
          custo: r.custo === null ? null : D(r.custo),
          comCusto: Number(r.comCusto),
          semCusto: Number(r.semCusto),
        },
      ]),
    );
  }

  /**
   * Curva ABC por receita, com margem realizada.
   *
   * A margem sai do custo GRAVADO no item da venda (`SaleItem.unitCost`), nao
   * do custo atual do produto: reprecificacao de fornecedor deixou de mexer
   * retroativamente na margem de um periodo ja fechado. Onde o snapshot nao
   * existe — venda anterior a essa coluna, ou produto sem custo cadastrado — a
   * linha sai sem margem e a resposta diz quantos itens ficaram descobertos
   * (`cobertura`), em vez de fingir precisao contabil.
   */
  async products(query: ReportQueryDto) {
    const range = resolveRange(query);
    const window = { gte: range.from, lt: range.to };

    const grouped = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      _sum: { quantity: true, total: true, discount: true },
      where: { sale: { status: 'CONCLUIDA', completedAt: window } },
      orderBy: { _sum: { total: 'desc' } },
      take: MAX_ROWS + 1,
    });
    const truncado = grouped.length > MAX_ROWS;
    if (truncado) grouped.length = MAX_ROWS;

    const ids = grouped.map((g) => g.productId);
    const [products, custos] = await Promise.all([
      this.prisma.product.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          sku: true,
          name: true,
          category: { select: { name: true } },
        },
      }),
      this.realizedCost(range, ids),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));

    let itensComCusto = 0;
    let itensSemCusto = 0;

    const rows = grouped
      .map((g) => {
        const p = byId.get(g.productId);
        const quantidade = Number(g._sum.quantity ?? 0);
        const receita = n(g._sum.total);
        const c = custos.get(g.productId);
        itensComCusto += c?.comCusto ?? 0;
        itensSemCusto += c?.semCusto ?? 0;
        // Custo parcial nao vira margem: se metade das linhas do produto nao
        // tem snapshot, somar so a outra metade produziria uma margem alta
        // demais que ninguem consegue distinguir de uma margem boa.
        const custo =
          c && c.custo !== null && c.semCusto === 0 ? c.custo.toNumber() : null;
        const margem = custo !== null ? receita - custo : null;
        return {
          productId: g.productId,
          sku: p?.sku ?? '—',
          nome: p?.name ?? '(produto removido)',
          categoria: p?.category?.name ?? 'Sem categoria',
          quantidade,
          receita,
          descontos: n(g._sum.discount),
          custo,
          margem,
          margemPercentual: margem !== null && receita ? margem / receita : null,
          curva: 'C' as 'A' | 'B' | 'C',
          participacao: 0,
          participacaoAcumulada: 0,
        };
      })
      .sort((a, b) => b.receita - a.receita);

    // Curva ABC classica: A ate 80% da receita acumulada, B ate 95%, C o resto.
    const total = rows.reduce((acc, r) => acc + r.receita, 0);
    let acumulado = 0;
    for (const r of rows) {
      acumulado += r.receita;
      r.participacao = total ? r.receita / total : 0;
      r.participacaoAcumulada = total ? acumulado / total : 0;
      r.curva =
        r.participacaoAcumulada <= 0.8 ? 'A' : r.participacaoAcumulada <= 0.95 ? 'B' : 'C';
    }

    const resumo = (['A', 'B', 'C'] as const).map((curva) => {
      const itens = rows.filter((r) => r.curva === curva);
      const receita = itens.reduce((acc, r) => acc + r.receita, 0);
      return {
        curva,
        produtos: itens.length,
        receita,
        participacao: total ? receita / total : 0,
      };
    });

    const comCusto = rows.filter((r) => r.margem !== null);
    return {
      periodo: { from: range.fromLabel, to: range.toLabel, dias: range.days },
      total,
      truncado,
      limite: MAX_ROWS,
      // A margem deixou de ser estimativa sobre o custo de hoje: sai do custo
      // gravado na venda. Continua havendo item sem snapshot (venda antiga,
      // produto sem custo), e a cobertura diz exatamente quanto — a tela usa
      // isso para avisar, em vez de o lojista decidir preco sobre um numero
      // cuja procedencia ele nao ve.
      margemEstimada: itensSemCusto > 0,
      cobertura: {
        itensComCusto,
        itensSemCusto,
        percentual: itensComCusto + itensSemCusto
          ? itensComCusto / (itensComCusto + itensSemCusto)
          : null,
      },
      produtosSemCusto: rows.length - comCusto.length,
      margemTotal: comCusto.reduce((acc, r) => acc + (r.margem ?? 0), 0),
      resumo,
      linhas: rows,
    };
  }

  // -------------------------------------------------------------- Categorias
  async categories(query: ReportQueryDto) {
    const detalhe = await this.products(query);

    const map = new Map<
      string,
      {
        categoria: string;
        quantidade: number;
        receita: number;
        margem: number;
        /** Receita so dos produtos que TEM custo — denominador honesto da margem. */
        receitaComCusto: number;
        produtos: number;
        produtosSemCusto: number;
      }
    >();
    for (const r of detalhe.linhas) {
      const atual = map.get(r.categoria) ?? {
        categoria: r.categoria,
        quantidade: 0,
        receita: 0,
        margem: 0,
        receitaComCusto: 0,
        produtos: 0,
        produtosSemCusto: 0,
      };
      atual.quantidade += r.quantidade;
      atual.receita += r.receita;
      atual.produtos += 1;
      // Produto sem custo cadastrado nao vale margem zero: some do numerador E
      // do denominador. Somar zero no numerador com a receita inteira embaixo
      // devolve uma margem menor do que a real, sem sinal nenhum de que falta
      // dado — e e por esse numero que se decide preco e compra.
      if (r.margem === null) atual.produtosSemCusto += 1;
      else {
        atual.margem += r.margem;
        atual.receitaComCusto += r.receita;
      }
      map.set(r.categoria, atual);
    }

    const linhas = [...map.values()]
      .map((c) => ({
        ...c,
        participacao: detalhe.total ? c.receita / detalhe.total : 0,
        margemPercentual: c.receitaComCusto ? c.margem / c.receitaComCusto : null,
      }))
      .sort((a, b) => b.receita - a.receita);

    return {
      periodo: detalhe.periodo,
      total: detalhe.total,
      truncado: detalhe.truncado,
      margemEstimada: detalhe.margemEstimada,
      cobertura: detalhe.cobertura,
      produtosSemCusto: detalhe.produtosSemCusto,
      linhas,
    };
  }

  // --------------------------------------------------------------- Operadores
  async operators(query: ReportQueryDto) {
    const range = resolveRange(query);
    const window = { gte: range.from, lt: range.to };

    const grouped = await this.prisma.sale.groupBy({
      by: ['operatorId'],
      _sum: { total: true, discount: true },
      _count: { _all: true },
      where: { status: 'CONCLUIDA', completedAt: window },
    });
    const canceladas = await this.prisma.sale.groupBy({
      by: ['operatorId'],
      _count: { _all: true },
      where: { status: 'CANCELADA', canceledAt: window },
    });
    const ids = [
      ...new Set([
        ...grouped.map((g) => g.operatorId),
        ...canceladas.map((c) => c.operatorId),
      ]),
    ];
    const users = ids.length
      ? await this.prisma.user.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    const cancelById = new Map(canceladas.map((c) => [c.operatorId, c._count._all]));

    const total = grouped.reduce((acc, g) => acc + n(g._sum.total), 0);

    return {
      periodo: { from: range.fromLabel, to: range.toLabel, dias: range.days },
      total,
      linhas: grouped
        .map((g) => ({
          operatorId: g.operatorId,
          nome: nameById.get(g.operatorId) ?? '(usuário removido)',
          vendas: g._count._all,
          receita: n(g._sum.total),
          descontos: n(g._sum.discount),
          ticketMedio: g._count._all ? n(g._sum.total) / g._count._all : 0,
          participacao: total ? n(g._sum.total) / total : 0,
          canceladas: cancelById.get(g.operatorId) ?? 0,
        }))
        .sort((a, b) => b.receita - a.receita),
    };
  }

  // ----------------------------------------------------------------- Estoque
  /**
   * Posicao de estoque: nao tem periodo, e uma foto do agora. O unico recorte
   * temporal e o "sem giro", que olha 90 dias de venda para tras.
   */
  async inventory() {
    const semGiroDesde = new Date();
    semGiroDesde.setHours(0, 0, 0, 0);
    semGiroDesde.setDate(semGiroDesde.getDate() - 90);

    const stock = await this.prisma.stockItem.findMany({
      take: MAX_ROWS + 1,
      select: {
        quantity: true,
        minQuantity: true,
        product: {
          select: {
            id: true,
            sku: true,
            name: true,
            price: true,
            cost: true,
            active: true,
            category: { select: { name: true } },
          },
        },
      },
    });
    const vendidos = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'CONCLUIDA', completedAt: { gte: semGiroDesde } } },
    });
    const comGiro = new Set(vendidos.map((v) => v.productId));

    const linhas = stock
      .filter((s) => s.product.active)
      .map((s) => {
        const quantidade = D(s.quantity).toNumber();
        const custoUnitario = s.product.cost ? D(s.product.cost).toNumber() : null;
        const precoVenda = D(s.product.price).toNumber();
        return {
          productId: s.product.id,
          sku: s.product.sku,
          nome: s.product.name,
          categoria: s.product.category?.name ?? 'Sem categoria',
          quantidade,
          minimo: D(s.minQuantity).toNumber(),
          precoVenda,
          custoUnitario,
          valorCusto: custoUnitario !== null ? custoUnitario * quantidade : null,
          valorVenda: precoVenda * quantidade,
          ruptura: D(s.quantity).lte(s.minQuantity),
          zerado: D(s.quantity).lte(0),
          semGiro90d: !comGiro.has(s.product.id) && quantidade > 0,
        };
      })
      .sort((a, b) => b.valorVenda - a.valorVenda);

    return {
      geradoEm: new Date().toISOString(),
      truncado: stock.length > MAX_ROWS,
      limite: MAX_ROWS,
      totais: {
        produtos: linhas.length,
        unidades: linhas.reduce((acc, l) => acc + l.quantidade, 0),
        valorCusto: linhas.reduce((acc, l) => acc + (l.valorCusto ?? 0), 0),
        valorVenda: linhas.reduce((acc, l) => acc + l.valorVenda, 0),
        emRuptura: linhas.filter((l) => l.ruptura).length,
        zerados: linhas.filter((l) => l.zerado).length,
        semGiro90d: linhas.filter((l) => l.semGiro90d).length,
        semCusto: linhas.filter((l) => l.custoUnitario === null).length,
      },
      linhas,
    };
  }
}
