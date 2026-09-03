import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { dashboardApi } from '../lib/api-client';
import { brl, dateTime, num, paymentLabel } from '../lib/format';

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.getSummary,
    refetchInterval: 30000,
  });

  const stats = data
    ? [
        { label: 'Faturamento hoje', value: brl(data.revenueToday) },
        { label: 'Vendas hoje', value: num(data.salesToday) },
        { label: 'Ticket médio', value: brl(data.averageTicket) },
        { label: 'Itens vendidos hoje', value: num(data.itemsSoldToday) },
      ]
    : [];

  const maxDay = Math.max(1, ...(data?.salesLast7Days.map((d) => d.value) ?? [1]));

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Resumo da loja</p>
          <h1>Dashboard</h1>
        </div>
        <div className="header-tags">
          <span className={`tag ${data?.cashOpen ? 'tag-success' : 'tag-warning'}`}>
            {data?.openCashCount
              ? `${data.openCashCount} caixa${data.openCashCount > 1 ? 's' : ''} aberto${data.openCashCount > 1 ? 's' : ''}`
              : 'Nenhum caixa aberto'}
          </span>
          <Link
            to="/estoque?ruptura=1"
            className={`tag tag-link ${data && data.lowStockCount > 0 ? 'tag-warning' : ''}`}
          >
            {num(data?.lowStockCount)} em ruptura
          </Link>
        </div>
      </div>

      {error ? (
        <div className="error-message">
          Erro ao carregar o dashboard: {error instanceof Error ? error.message : 'tente novamente'}
        </div>
      ) : null}

      <div className="stats-grid">
        {(isLoading ? Array.from({ length: 4 }) : stats).map((item, i) => (
          <article key={i} className={`stat-card ${isLoading ? 'skeleton' : ''}`}>
            <span>{(item as { label?: string })?.label ?? ' '}</span>
            <strong>{(item as { value?: string })?.value ?? ' '}</strong>
          </article>
        ))}
      </div>

      <div className="chart-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Vendas nos últimos 7 dias</h2>
          </div>
          <div className="bars">
            {(data?.salesLast7Days ?? []).map((d) => (
              <div key={d.date} className="bar-group">
                <div
                  className="bar"
                  style={{ height: `${Math.max(6, (d.value / maxDay) * 100)}%` }}
                  title={brl(d.value)}
                />
                <small>{d.label}</small>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Mais vendidos (30 dias)</h2>
          </div>
          <ul className="list-rows">
            {(data?.topProducts ?? []).length === 0 ? (
              <li>
                <span className="muted">Sem vendas no período.</span>
              </li>
            ) : (
              data?.topProducts.map((p, i) => (
                <li key={p.name}>
                  <span>
                    {i + 1}. {p.name} <small>({num(p.quantity)} un)</small>
                  </span>
                  <strong>{brl(p.value)}</strong>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      {data && data.openCashSessions.length > 0 ? (
        <section className="panel" style={{ marginTop: 20 }}>
          <div className="panel-header">
            <h2>Caixas abertos na loja</h2>
          </div>
          <ul className="list-rows">
            {data.openCashSessions.map((s) => (
              <li key={s.id}>
                <span>
                  {s.operatorName} <small>· aberto em {dateTime(s.openedAt)}</small>
                </span>
                <strong>{brl(s.expectedAmount)}</strong>
              </li>
            ))}
          </ul>
          <p className="muted" style={{ marginTop: 8 }}>
            Saldo esperado em dinheiro por turno — o mesmo número que cada operador vê na
            tela de <Link to="/caixa">Caixa</Link>.
          </p>
        </section>
      ) : null}

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-header">
          <h2>Recebido hoje por forma de pagamento</h2>
        </div>
        <ul className="list-rows">
          {(data?.paymentsByMethod ?? []).length === 0 ? (
            <li>
              <span className="muted">Nenhum recebimento hoje.</span>
            </li>
          ) : (
            data?.paymentsByMethod.map((p) => (
              <li key={p.method}>
                <span>{paymentLabel[p.method] ?? p.method}</span>
                <strong>{brl(p.value)}</strong>
              </li>
            ))
          )}
        </ul>
      </section>
    </Layout>
  );
}
