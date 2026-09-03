import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { salesApi } from '../lib/api-client';

export function SalesPage() {
  const { data: sales, isLoading, error } = useQuery({
    queryKey: ['sales'],
    queryFn: () => salesApi.getAll(),
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Caixa</p>
          <h1>Vendas</h1>
        </div>
        <button className="primary-button">Registrar venda</button>
      </div>

      {error ? (
        <div className="error-message">
          Erro ao carregar vendas: {error instanceof Error ? error.message : 'Tente novamente'}
        </div>
      ) : null}

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Data</th>
              <th>Valor</th>
              <th>Status</th>
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
              : sales?.map((sale) => (
                  <tr key={sale.id}>
                    <td>{sale.id.slice(0, 8)}</td>
                    <td>{new Date(sale.createdAt).toLocaleDateString('pt-BR')}</td>
                    <td>R$ {(sale.amount / 1000).toFixed(1)}K</td>
                    <td><span className="badge">{sale.status}</span></td>
                  </tr>
                ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}
