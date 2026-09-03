import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { salesApi, type Sale } from '../lib/api-client';
import { brl, dateTime, paymentLabel } from '../lib/format';

export function SalesPage() {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const sales = useQuery({ queryKey: ['sales'], queryFn: () => salesApi.list() });
  const detail = useQuery({
    queryKey: ['sales', selected],
    queryFn: () => salesApi.get(selected as string),
    enabled: !!selected,
  });

  const cancel = useMutation({
    mutationFn: (id: string) => salesApi.cancel(id, 'Cancelada pelo operador'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setSelected(null);
    },
  });

  const statusTag = (s: Sale['status']) =>
    s === 'CONCLUIDA' ? 'tag-success' : s === 'CANCELADA' ? 'tag-warning' : '';

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Histórico</p>
          <h1>Vendas</h1>
        </div>
      </div>

      <div className="split-layout">
        <section className="panel">
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Data</th>
                  <th>Cliente</th>
                  <th style={{ textAlign: 'right' }}>Total</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {sales.data?.map((s) => (
                  <tr
                    key={s.id}
                    onClick={() => setSelected(s.id)}
                    className={selected === s.id ? 'row-active' : 'row-clickable'}
                  >
                    <td>{s.number}</td>
                    <td>
                      <small>{dateTime(s.completedAt ?? s.createdAt)}</small>
                    </td>
                    <td>{s.customer?.name ?? 'Não identificado'}</td>
                    <td style={{ textAlign: 'right' }}>{brl(s.total)}</td>
                    <td>
                      <span className={`tag ${statusTag(s.status)}`}>{s.status}</span>
                    </td>
                  </tr>
                ))}
                {sales.data?.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="muted">
                      Nenhuma venda registrada ainda.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>{selected ? `Venda #${detail.data?.number ?? ''}` : 'Detalhe'}</h2>
          </div>
          {!selected ? (
            <p className="muted">Selecione uma venda para ver os itens.</p>
          ) : detail.isLoading ? (
            <p className="muted">Carregando…</p>
          ) : detail.data ? (
            <>
              <ul className="list-rows">
                {detail.data.items?.map((it) => (
                  <li key={it.id}>
                    <span>
                      {it.description} <small>× {it.quantity}</small>
                    </span>
                    <strong>{brl(it.total)}</strong>
                  </li>
                ))}
              </ul>
              <div className="cart-summary">
                <span>Total</span>
                <strong>{brl(detail.data.total)}</strong>
              </div>
              <ul className="list-rows" style={{ marginTop: 12 }}>
                {detail.data.payments?.map((p) => (
                  <li key={p.id}>
                    <span>{paymentLabel[p.method] ?? p.method}</span>
                    <strong>{brl(p.amount)}</strong>
                  </li>
                ))}
              </ul>
              {detail.data.fiscalDocument ? (
                <p className="muted" style={{ marginTop: 12 }}>
                  NFC-e: <span className="tag">{detail.data.fiscalDocument.status}</span>
                </p>
              ) : null}
              {detail.data.status === 'CONCLUIDA' ? (
                <button
                  className="danger-button"
                  style={{ marginTop: 16 }}
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate(detail.data!.id)}
                >
                  {cancel.isPending ? 'Cancelando…' : 'Cancelar venda (estorna estoque)'}
                </button>
              ) : null}
              {cancel.error ? (
                <div className="error-message" style={{ marginTop: 12 }}>
                  {cancel.error instanceof Error ? cancel.error.message : 'Erro'}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </Layout>
  );
}
