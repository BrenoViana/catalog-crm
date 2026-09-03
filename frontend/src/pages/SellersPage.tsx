import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { sellersApi } from '../lib/api-client';

export function SellersPage() {
  const { data: sellers, isLoading, error } = useQuery({
    queryKey: ['sellers'],
    queryFn: () => sellersApi.getAll(),
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Vendedores</h1>
        </div>
        <button className="primary-button">Novo vendedor</button>
      </div>

      {error ? (
        <div className="error-message">
          Erro ao carregar vendedores: {error instanceof Error ? error.message : 'Tente novamente'}
        </div>
      ) : null}

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Área</th>
              <th>Meta</th>
              <th>Comissão</th>
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
              : sellers?.map((seller) => (
                  <tr key={seller.id}>
                    <td>{seller.name}</td>
                    <td>{seller.role || '-'}</td>
                    <td>R$ {(seller.salesTarget / 1000).toFixed(0)}K</td>
                    <td>{seller.commissionRate}%</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}
