import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { opportunitiesApi } from '../lib/api-client';

export function OpportunitiesPage() {
  const { data: opportunities, isLoading, error } = useQuery({
    queryKey: ['opportunities'],
    queryFn: () => opportunitiesApi.getAll(),
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Pipeline</p>
          <h1>Oportunidades</h1>
        </div>
        <button className="primary-button">Nova oportunidade</button>
      </div>

      {error ? (
        <div className="error-message">
          Erro ao carregar oportunidades: {error instanceof Error ? error.message : 'Tente novamente'}
        </div>
      ) : null}

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Oportunidade</th>
              <th>Etapa</th>
              <th>Valor</th>
              <th>Data de Fechamento</th>
            </tr>
          </thead>
          <tbody>
            {isLoading
              ? Array(3)
                  .fill(0)
                  .map((_, i) => (
                    <tr key={i} className="skeleton">
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                      <td>&nbsp;</td>
                    </tr>
                  ))
              : opportunities?.map((item) => (
                  <tr key={item.id}>
                    <td>{item.title}</td>
                    <td>{item.stage}</td>
                    <td>R$ {(item.amount / 1000).toFixed(1)}K</td>
                    <td>{item.expectedCloseDate ? new Date(item.expectedCloseDate).toLocaleDateString('pt-BR') : '-'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}
