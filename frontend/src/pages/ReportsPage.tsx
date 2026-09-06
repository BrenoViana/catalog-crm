import './ReportsPage.css';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import {
  reportsApi,
  type ReportGroupBy,
  type ReportKey,
  type ReportRange,
} from '../lib/api-client';
import { brl, num, paymentLabel } from '../lib/format';
import { useAuthStore } from '../store/authStore';

/** Chave de dia no fuso local — `toISOString` desloca a data em UTC-3. */
const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

const shiftDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dayKey(d);
};

/**
 * Atalhos de período. É o que o lojista realmente usa: quase nunca ele quer uma
 * janela arbitrária, quer "este mês" ou "os últimos 30 dias".
 */
const PRESETS: Array<{ id: string; label: string; range: () => { from: string; to: string } }> = [
  { id: 'hoje', label: 'Hoje', range: () => ({ from: shiftDays(0), to: shiftDays(0) }) },
  { id: '7d', label: '7 dias', range: () => ({ from: shiftDays(-6), to: shiftDays(0) }) },
  { id: '30d', label: '30 dias', range: () => ({ from: shiftDays(-29), to: shiftDays(0) }) },
  {
    id: 'mes',
    label: 'Este mês',
    range: () => {
      const now = new Date();
      return { from: dayKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: dayKey(now) };
    },
  },
  {
    id: 'mes-passado',
    label: 'Mês passado',
    range: () => {
      const now = new Date();
      return {
        from: dayKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: dayKey(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    },
  },
];

const TABS: Array<{ key: ReportKey; label: string; hint: string }> = [
  { key: 'vendas', label: 'Vendas', hint: 'Faturamento, ticket médio e evolução no período.' },
  { key: 'produtos', label: 'Produtos', hint: 'Curva ABC por receita, com margem estimada.' },
  { key: 'categorias', label: 'Categorias', hint: 'Onde o faturamento se concentra.' },
  { key: 'pagamentos', label: 'Pagamentos', hint: 'Recebido por forma de pagamento.' },
  { key: 'operadores', label: 'Operadores', hint: 'Desempenho por quem opera o caixa.' },
  { key: 'estoque', label: 'Estoque', hint: 'Posição atual: valor parado, ruptura e giro.' },
];

const pct = (v: number | null | undefined, digits = 1) =>
  v === null || v === undefined
    ? '—'
    : `${(v * 100).toLocaleString('pt-BR', { maximumFractionDigits: digits })}%`;

/** Variação contra o período anterior, com sinal e cor. */
function Delta({ value }: { value: number | null }) {
  if (value === null) return <small className="muted">sem base anterior</small>;
  const up = value >= 0;
  return (
    <small className={up ? 'text-success' : 'text-warning'}>
      {up ? '▲' : '▼'} {pct(Math.abs(value))} vs. período anterior
    </small>
  );
}

function Kpi({
  label,
  value,
  delta,
  hint,
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {delta !== undefined ? <Delta value={delta} /> : null}
      {hint ? <small className="muted">{hint}</small> : null}
    </article>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="muted report-empty">{children}</p>;
}

/** A lista bateu no teto do servidor: dizer isso é melhor que entregar meia verdade. */
function Truncado({ limite }: { limite: number }) {
  return (
    <p className="muted report-note">
      Lista cortada nas <strong>{num(limite)} primeiras linhas</strong>, as de maior receita.
      Estreite o período ou use a exportação para o conjunto completo.
    </p>
  );
}

export function ReportsPage() {
  const canExport = useAuthStore((s) => s.permissions.includes('reports.export'));

  const [tab, setTab] = useState<ReportKey>('vendas');
  const [preset, setPreset] = useState('30d');
  const [groupBy, setGroupBy] = useState<ReportGroupBy>('day');
  const [custom, setCustom] = useState(() => PRESETS[2].range());
  const [exportError, setExportError] = useState('');
  const [exporting, setExporting] = useState(false);

  const period = preset === 'custom' ? custom : (PRESETS.find((p) => p.id === preset) ?? PRESETS[2]).range();
  const range: ReportRange = { ...period, groupBy };
  // Estoque é uma foto do agora: o período não entra na chave nem na consulta.
  const queryKey = ['reports', tab, tab === 'estoque' ? 'now' : period.from, tab === 'estoque' ? '' : period.to, tab === 'vendas' ? groupBy : ''];

  const sales = useQuery({ queryKey, queryFn: () => reportsApi.sales(range), enabled: tab === 'vendas' });
  const products = useQuery({ queryKey, queryFn: () => reportsApi.products(range), enabled: tab === 'produtos' });
  const categories = useQuery({ queryKey, queryFn: () => reportsApi.categories(range), enabled: tab === 'categorias' });
  const payments = useQuery({ queryKey, queryFn: () => reportsApi.payments(range), enabled: tab === 'pagamentos' });
  const operators = useQuery({ queryKey, queryFn: () => reportsApi.operators(range), enabled: tab === 'operadores' });
  const inventory = useQuery({ queryKey, queryFn: () => reportsApi.inventory(), enabled: tab === 'estoque' });

  const active = { vendas: sales, produtos: products, categorias: categories, pagamentos: payments, operadores: operators, estoque: inventory }[tab];

  const maxSerie = useMemo(
    () => Math.max(1, ...(sales.data?.serie.map((s) => s.receita) ?? [1])),
    [sales.data],
  );

  const doExport = async () => {
    setExportError('');
    setExporting(true);
    try {
      await reportsApi.exportCsv(tab, range);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : 'Falha ao exportar.');
    } finally {
      setExporting(false);
    }
  };

  const applyCustom = (patch: Partial<{ from: string; to: string }>) => {
    setCustom((c) => ({ ...c, ...patch }));
    setPreset('custom');
  };

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Análise</p>
          <h1>Relatórios</h1>
        </div>
        {canExport ? (
          <button className="ghost-button" onClick={doExport} disabled={exporting || active.isLoading}>
            {exporting ? 'Gerando…' : 'Exportar CSV'}
          </button>
        ) : null}
      </div>

      <nav className="report-tabs" aria-label="Relatórios disponíveis">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pill-button ${tab === t.key ? 'active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <p className="muted report-hint">{TABS.find((t) => t.key === tab)?.hint}</p>

      {tab !== 'estoque' ? (
        <div className="toolbar report-toolbar">
          <div className="report-presets">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`pill-button ${preset === p.id ? 'active' : ''}`}
                onClick={() => setPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <label className="report-date">
            <span>De</span>
            <input
              type="date"
              value={period.from}
              max={period.to}
              onChange={(e) => applyCustom({ from: e.target.value })}
            />
          </label>
          <label className="report-date">
            <span>Até</span>
            <input
              type="date"
              value={period.to}
              min={period.from}
              onChange={(e) => applyCustom({ to: e.target.value })}
            />
          </label>
          {tab === 'vendas' ? (
            <label className="report-date">
              <span>Agrupar</span>
              <select value={groupBy} onChange={(e) => setGroupBy(e.target.value as ReportGroupBy)}>
                <option value="day">Por dia</option>
                <option value="week">Por semana</option>
                <option value="month">Por mês</option>
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      {exportError ? <div className="error-message">{exportError}</div> : null}
      {active.error ? (
        <div className="error-message">
          Não foi possível carregar o relatório:{' '}
          {active.error instanceof Error ? active.error.message : 'tente novamente'}
        </div>
      ) : null}
      {active.isLoading ? <Empty>Carregando o relatório…</Empty> : null}

      {/* ------------------------------------------------------------ Vendas */}
      {tab === 'vendas' && sales.data ? (
        <>
          <div className="stats-grid">
            <Kpi
              label="Receita líquida"
              value={brl(sales.data.totais.receitaFinal)}
              delta={sales.data.comparacao.receitaFinal}
              hint="já descontadas as devoluções"
            />
            <Kpi label="Vendas" value={num(sales.data.totais.vendas)} delta={sales.data.comparacao.vendas} />
            <Kpi label="Ticket médio" value={brl(sales.data.totais.ticketMedio)} delta={sales.data.comparacao.ticketMedio} />
            <Kpi
              label="Itens vendidos"
              value={num(sales.data.totais.itens)}
              hint={`${sales.data.totais.itensPorVenda.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} por venda`}
            />
          </div>

          <section className="panel report-panel">
            <div className="panel-header">
              <h2>Evolução do faturamento</h2>
              <small className="muted">{sales.data.periodo.dias} dias</small>
            </div>
            {sales.data.serie.length === 0 ? (
              <Empty>Sem vendas no período.</Empty>
            ) : (
              <div className="report-bars">
                {sales.data.serie.map((s) => (
                  <div key={s.key} className="bar-group" title={`${s.label}: ${brl(s.receita)}`}>
                    <div className="bar" style={{ height: `${Math.max(4, (s.receita / maxSerie) * 100)}%` }} />
                    <small>{s.label}</small>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel report-panel">
            <div className="panel-header">
              <h2>Composição do período</h2>
            </div>
            <ul className="list-rows">
              <li>
                <span>Receita bruta <small>soma dos itens, antes de desconto</small></span>
                <strong>{brl(sales.data.totais.receitaBruta)}</strong>
              </li>
              <li>
                <span>Descontos concedidos</span>
                <strong className="text-warning">− {brl(sales.data.totais.descontos)}</strong>
              </li>
              <li>
                <span>Devoluções</span>
                <strong className="text-warning">− {brl(sales.data.totais.devolucoes)}</strong>
              </li>
              <li>
                <span>Receita líquida</span>
                <strong>{brl(sales.data.totais.receitaFinal)}</strong>
              </li>
              <li>
                <span>Vendas canceladas <small>não entram no faturamento</small></span>
                <strong>{num(sales.data.totais.canceladas)}</strong>
              </li>
              {sales.data.naoLiquidado.pagamentos > 0 ? (
                <li>
                  <span>
                    Ainda não liquidado{' '}
                    <small>
                      {num(sales.data.naoLiquidado.pagamentos)} pagamento(s) negado(s) ou parado(s)
                      no gateway em venda concluída
                    </small>
                  </span>
                  <strong className="text-warning">{brl(sales.data.naoLiquidado.valor)}</strong>
                </li>
              ) : null}
            </ul>
            {sales.data.naoLiquidado.pagamentos > 0 ? (
              <p className="muted report-note" style={{ marginTop: 12 }}>
                A receita acima soma toda venda concluída. A leitura X/Z e a aba de Pagamentos
                contam só o que foi autorizado ou confirmado — a linha "ainda não liquidado" é
                exatamente essa diferença.
              </p>
            ) : null}
          </section>
        </>
      ) : null}

      {/* ---------------------------------------------------------- Produtos */}
      {tab === 'produtos' && products.data ? (
        <>
          <div className="stats-grid">
            {products.data.resumo.map((r) => (
              <Kpi
                key={r.curva}
                label={`Curva ${r.curva}`}
                value={`${num(r.produtos)} produtos`}
                hint={`${brl(r.receita)} · ${pct(r.participacao, 0)} da receita`}
              />
            ))}
            <Kpi
              label="Margem estimada"
              value={brl(products.data.margemTotal)}
              hint={
                products.data.produtosSemCusto
                  ? `${products.data.produtosSemCusto} produto(s) sem custo cadastrado`
                  : 'todos os produtos têm custo cadastrado'
              }
            />
          </div>

          <section className="panel report-panel">
            <div className="panel-header">
              <h2>Curva ABC por receita</h2>
              <small className="muted">A: até 80% · B: até 95% · C: cauda</small>
            </div>
            <p className="muted report-note">
              A margem usa o <strong>custo atual</strong> de cada produto — a venda não guarda
              snapshot de custo, então uma mudança de preço de fornecedor desloca a margem
              histórica. Use como ordem de grandeza, não como fechamento contábil.
            </p>
            {products.data.truncado ? <Truncado limite={products.data.limite} /> : null}
            {products.data.linhas.length === 0 ? (
              <Empty>Sem vendas no período.</Empty>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Curva</th>
                      <th>Produto</th>
                      <th>Categoria</th>
                      <th className="ta-right">Qtd.</th>
                      <th className="ta-right">Receita</th>
                      <th className="ta-right">Margem</th>
                      <th className="ta-right">Acum.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.data.linhas.map((l) => (
                      <tr key={l.productId}>
                        <td>
                          <span className={`tag curva-${l.curva}`}>{l.curva}</span>
                        </td>
                        <td>
                          {l.nome}
                          <br />
                          <small className="muted">{l.sku}</small>
                        </td>
                        <td>{l.categoria}</td>
                        <td className="ta-right">{num(l.quantidade, 0)}</td>
                        <td className="ta-right">{brl(l.receita)}</td>
                        <td className="ta-right">
                          {l.margem === null ? (
                            <small className="muted">sem custo</small>
                          ) : (
                            <>
                              {brl(l.margem)}
                              <br />
                              <small className="muted">{pct(l.margemPercentual)}</small>
                            </>
                          )}
                        </td>
                        <td className="ta-right">{pct(l.participacaoAcumulada, 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}

      {/* -------------------------------------------------------- Categorias */}
      {tab === 'categorias' && categories.data ? (
        <section className="panel report-panel">
          <div className="panel-header">
            <h2>Faturamento por categoria</h2>
            <small className="muted">{brl(categories.data.total)} no período</small>
          </div>
          {categories.data.linhas.length === 0 ? (
            <Empty>Sem vendas no período.</Empty>
          ) : (
            <ul className="list-rows report-shares">
              {categories.data.linhas.map((c) => (
                <li key={c.categoria}>
                  <span>
                    {c.categoria}{' '}
                    <small>
                      {num(c.produtos)} produtos · margem{' '}
                      {c.margemPercentual === null
                        ? 'sem custo cadastrado'
                        : pct(c.margemPercentual)}
                      {c.produtosSemCusto > 0 && c.margemPercentual !== null
                        ? ` (${num(c.produtosSemCusto)} sem custo, fora do cálculo)`
                        : ''}
                    </small>
                    <span className="share-track" aria-hidden="true">
                      <span className="share-fill" style={{ width: `${c.participacao * 100}%` }} />
                    </span>
                  </span>
                  <strong>
                    {brl(c.receita)}
                    <br />
                    <small className="muted">{pct(c.participacao, 0)}</small>
                  </strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/* -------------------------------------------------------- Pagamentos */}
      {tab === 'pagamentos' && payments.data ? (
        <>
          <section className="panel report-panel">
            <div className="panel-header">
              <h2>Recebido por forma de pagamento</h2>
              <small className="muted">{brl(payments.data.total)} no período</small>
            </div>
            {payments.data.linhas.length === 0 ? (
              <Empty>Nenhum recebimento confirmado no período.</Empty>
            ) : (
              <ul className="list-rows report-shares">
                {payments.data.linhas.map((p) => (
                  <li key={p.method}>
                    <span>
                      {paymentLabel[p.method] ?? p.method}{' '}
                      <small>
                        {num(p.quantidade)} recebimentos · ticket {brl(p.ticketMedio)}
                      </small>
                      <span className="share-track" aria-hidden="true">
                        <span className="share-fill" style={{ width: `${p.participacao * 100}%` }} />
                      </span>
                    </span>
                    <strong>
                      {brl(p.valor)}
                      <br />
                      <small className="muted">{pct(p.participacao, 0)}</small>
                    </strong>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {payments.data.recusados.length > 0 ? (
            <section className="panel report-panel">
              <div className="panel-header">
                <h2>Recusas e estornos</h2>
              </div>
              <p className="muted report-note">
                Não entram no faturamento, mas denunciam maquineta com problema ou venda que o
                cliente desistiu de pagar.
              </p>
              <ul className="list-rows">
                {payments.data.recusados.map((r) => (
                  <li key={`${r.method}-${r.status}`}>
                    <span>
                      {paymentLabel[r.method] ?? r.method}{' '}
                      <span className="tag tag-warning">{r.status}</span>{' '}
                      <small>{num(r.quantidade)} ocorrências</small>
                    </span>
                    <strong>{brl(r.valor)}</strong>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      {/* -------------------------------------------------------- Operadores */}
      {tab === 'operadores' && operators.data ? (
        <section className="panel report-panel">
          <div className="panel-header">
            <h2>Desempenho por operador</h2>
            <small className="muted">{brl(operators.data.total)} no período</small>
          </div>
          {operators.data.linhas.length === 0 ? (
            <Empty>Nenhuma venda concluída no período.</Empty>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Operador</th>
                    <th className="ta-right">Vendas</th>
                    <th className="ta-right">Receita</th>
                    <th className="ta-right">Ticket médio</th>
                    <th className="ta-right">Descontos</th>
                    <th className="ta-right">Canceladas</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.data.linhas.map((o) => (
                    <tr key={o.operatorId}>
                      <td>
                        {o.nome}
                        <br />
                        <small className="muted">{pct(o.participacao, 0)} da receita</small>
                      </td>
                      <td className="ta-right">{num(o.vendas)}</td>
                      <td className="ta-right">{brl(o.receita)}</td>
                      <td className="ta-right">{brl(o.ticketMedio)}</td>
                      <td className="ta-right">{brl(o.descontos)}</td>
                      <td className="ta-right">
                        {o.canceladas > 0 ? (
                          <span className="tag tag-warning">{num(o.canceladas)}</span>
                        ) : (
                          num(0)
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}

      {/* ----------------------------------------------------------- Estoque */}
      {tab === 'estoque' && inventory.data ? (
        <>
          <div className="stats-grid">
            <Kpi
              label="Valor a custo"
              value={brl(inventory.data.totais.valorCusto)}
              hint={
                inventory.data.totais.semCusto
                  ? `${inventory.data.totais.semCusto} produto(s) sem custo cadastrado`
                  : 'dinheiro parado na prateleira'
              }
            />
            <Kpi label="Valor a venda" value={brl(inventory.data.totais.valorVenda)} />
            <Kpi
              label="Em ruptura"
              value={num(inventory.data.totais.emRuptura)}
              hint={`${num(inventory.data.totais.zerados)} zerados`}
            />
            <Kpi
              label="Sem giro (90 dias)"
              value={num(inventory.data.totais.semGiro90d)}
              hint="com saldo e sem nenhuma venda"
            />
          </div>

          <section className="panel report-panel">
            <div className="panel-header">
              <h2>Posição de estoque</h2>
              <small className="muted">{num(inventory.data.totais.produtos)} produtos ativos</small>
            </div>
            {inventory.data.truncado ? <Truncado limite={inventory.data.limite} /> : null}
            {inventory.data.linhas.length === 0 ? (
              <Empty>Nenhum produto ativo com estoque cadastrado.</Empty>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Produto</th>
                      <th>Categoria</th>
                      <th className="ta-right">Saldo</th>
                      <th className="ta-right">Valor a custo</th>
                      <th className="ta-right">Valor a venda</th>
                      <th>Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.data.linhas.map((l) => (
                      <tr key={l.productId}>
                        <td>
                          {l.nome}
                          <br />
                          <small className="muted">{l.sku}</small>
                        </td>
                        <td>{l.categoria}</td>
                        <td className="ta-right">
                          {num(l.quantidade, 0)}
                          <br />
                          <small className="muted">mín. {num(l.minimo, 0)}</small>
                        </td>
                        <td className="ta-right">
                          {l.valorCusto === null ? <small className="muted">—</small> : brl(l.valorCusto)}
                        </td>
                        <td className="ta-right">{brl(l.valorVenda)}</td>
                        <td>
                          {l.zerado ? <span className="tag tag-warning">zerado</span> : null}
                          {!l.zerado && l.ruptura ? <span className="tag tag-warning">ruptura</span> : null}
                          {l.semGiro90d ? <span className="tag">sem giro</span> : null}
                          {!l.ruptura && !l.semGiro90d ? <span className="tag tag-success">ok</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </Layout>
  );
}
