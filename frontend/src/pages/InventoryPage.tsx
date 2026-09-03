import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { inventoryApi } from '../lib/api-client';
import { num } from '../lib/format';

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [onlyLow, setOnlyLow] = useState(false);
  const [adjust, setAdjust] = useState<{
    productId: string;
    name: string;
    type: 'ENTRADA' | 'AJUSTE' | 'PERDA';
    quantity: string;
    reason: string;
  } | null>(null);

  const stock = useQuery({ queryKey: ['inventory'], queryFn: inventoryApi.list });

  const mutate = useMutation({
    mutationFn: () =>
      inventoryApi.adjust({
        productId: adjust!.productId,
        type: adjust!.type,
        quantity: Number(adjust!.quantity),
        reason: adjust!.reason || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      setAdjust(null);
    },
  });

  const rows = (stock.data ?? []).filter((r) => !onlyLow || r.low);

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Operação</p>
          <h1>Estoque</h1>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />
          Só ruptura
        </label>
      </div>

      {adjust ? (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>Movimentar estoque — {adjust.name}</h2>
          </div>
          {mutate.error ? (
            <div className="error-message">
              {mutate.error instanceof Error ? mutate.error.message : 'Erro'}
            </div>
          ) : null}
          <div className="form-grid">
            <label className="field">
              <span>Tipo</span>
              <select
                value={adjust.type}
                onChange={(e) => setAdjust({ ...adjust, type: e.target.value as typeof adjust.type })}
              >
                <option value="ENTRADA">Entrada de mercadoria</option>
                <option value="AJUSTE">Ajuste de saldo (valor final)</option>
                <option value="PERDA">Perda / quebra</option>
              </select>
            </label>
            <label className="field">
              <span>Quantidade</span>
              <input
                inputMode="decimal"
                value={adjust.quantity}
                onChange={(e) => setAdjust({ ...adjust, quantity: e.target.value })}
              />
            </label>
            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>Motivo</span>
              <input
                value={adjust.reason}
                onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })}
              />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
            <button
              className="primary-button"
              disabled={!adjust.quantity || mutate.isPending}
              onClick={() => mutate.mutate()}
            >
              {mutate.isPending ? 'Salvando…' : 'Confirmar'}
            </button>
            <button className="ghost-button" onClick={() => setAdjust(null)}>
              Cancelar
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td>
                    {r.name} <small>({r.sku})</small>
                  </td>
                  <td>{r.category ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>
                    <span className={r.low ? 'text-warning' : ''}>
                      {num(r.quantity)} {r.unit}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{num(r.minQuantity)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <button
                      className="ghost-button"
                      onClick={() =>
                        setAdjust({
                          productId: r.productId,
                          name: r.name,
                          type: 'ENTRADA',
                          quantity: '',
                          reason: '',
                        })
                      }
                    >
                      Movimentar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}
