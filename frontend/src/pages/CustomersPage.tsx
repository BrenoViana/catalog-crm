import { useQuery } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { customersApi } from '../lib/api-client';

export function CustomersPage() {
  const { data: customers, isLoading, error } = useQuery({
    queryKey: ['customers'],
    queryFn: () => customersApi.getAll(),
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Clientes</h1>
        </div>
        <button className="primary-button">Novo cliente</button>
      </div>

      {error ? (
        <div className="error-message">
          Erro ao carregar clientes: {error instanceof Error ? error.message : 'Tente novamente'}
        </div>
      ) : null}

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Segmento</th>
              <th>Status</th>
              <th>Contato</th>
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
              : customers?.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name}</td>
                    <td>{customer.segment || '-'}</td>
                    <td>
                      <span className="badge">{customer.status}</span>
                    </td>
                    <td>{customer.email || customer.phone || '-'}</td>
                  </tr>
                ))}
          </tbody>
        </table>
      </section>
    </Layout>
  );
}
