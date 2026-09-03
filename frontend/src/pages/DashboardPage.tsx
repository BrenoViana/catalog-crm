import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { dashboardApi } from '../lib/api-client';

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => dashboardApi.getSummary(),
  });

  const stats = data
    ? [
        { label: 'Receita total', value: `R$ ${(data.totalRevenue / 1000).toFixed(1)}K`, delta: '+12.4%' },
        { label: 'Meta mensal', value: `R$ ${(data.monthlyTarget / 1000).toFixed(0)}K`, delta: '+8.1%' },
        { label: 'Pipeline', value: `R$ ${(data.pipeline / 1000).toFixed(1)}K`, delta: '+15.8%' },
        { label: 'Taxa de conversão', value: `${(data.conversionRate * 100).toFixed(1)}%`, delta: '+2.7%' },
      ]
    : [];

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Resumo executivo</p>
          <h1>Dashboard geral</h1>
        </div>
        <button className="primary-button">Exportar relatório</button>
      </div>

      {error ? (
        <div className="error-message">
          Erro ao carregar dashboard: {error instanceof Error ? error.message : 'Tente novamente'}
        </div>
      ) : null}

      <div className="stats-grid">
        {isLoading
          ? Array(4)
              .fill(0)
              .map((_, i) => (
                <article key={i} className="stat-card skeleton">
                  <span>&nbsp;</span>
                  <strong>&nbsp;</strong>
                </article>
              ))
          : stats.map((item) => (
              <article key={item.label} className="stat-card">
                <span>{item.label}</span>
                <strong>{item.value}</strong>
                <em>{item.delta}</em>
              </article>
            ))}
      </div>

      <div className="chart-grid">
        <section className="panel">
          <div className="panel-header">
            <h2>Vendas por mês</h2>
          </div>
          <div className="bars">
            {isLoading
              ? Array(6)
                  .fill(0)
                  .map((_, i) => (
                    <div key={i} className="bar-group">
                      <div className="bar skeleton" style={{ height: '50%' }} />
                      <small>&nbsp;</small>
                    </div>
                  ))
              : data?.salesByMonth.map((item) => (
                  <div key={item.month} className="bar-group">
                    <div className="bar" style={{ height: `${Math.min(item.value, 100)}%` }} />
                    <small>{item.month}</small>
                  </div>
                ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Top vendedores</h2>
          </div>
          <ul className="list-rows">
            {isLoading
              ? Array(3)
                  .fill(0)
                  .map((_, i) => (
                    <li key={i} className="skeleton">
                      <span>&nbsp;</span>
                      <strong>&nbsp;</strong>
                    </li>
                  ))
              : data?.topSellers.map((seller, index) => (
                  <li key={seller.name}>
                    <span>{index + 1}. {seller.name}</span>
                    <strong>R$ {(seller.value / 1000).toFixed(1)}K</strong>
                  </li>
                ))}
          </ul>
        </section>
      </div>
    </Layout>
  );
}
