import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Layout } from '../components/Layout';
import { IconSearch } from '../components/ui-icons';
import { ProductThumb } from '../components/ProductThumb';
import { inventoryApi } from '../lib/api-client';
import { num } from '../lib/format';

export function InventoryPage() {
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  // O dashboard linka "X em ruptura" para cá já filtrado.
  const [onlyLow, setOnlyLow] = useState(searchParams.get('ruptura') === '1');
  const [search, setSearch] = useState('');
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

  const q = search.trim().toLowerCase();
  const rows = (stock.data ?? []).filter((r) => {
    if (onlyLow && !r.low) return false;
    if (!q) return true;
    return (
      r.name.toLowerCase().includes(q) ||
      r.sku.toLowerCase().includes(q) ||
      (r.category ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Operação</p>
          <h1>Estoque</h1>
        </div>
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
        <div className="toolbar">
          <div className="toolbar-field has-icon">
            <span className="toolbar-icon">
              <IconSearch />
            </span>
            <input
              className="field-input"
              placeholder="Buscar por produto, SKU ou categoria…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <label className="toggle">
            <input
              type="checkbox"
              checked={onlyLow}
              onChange={(e) => setOnlyLow(e.target.checked)}
            />
            Só ruptura
          </label>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th colSpan={2}>Produto</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
                <th style={{ textAlign: 'right' }}>Mínimo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td className="cell-thumb">
                    <ProductThumb product={r} />
                  </td>
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
              {!stock.isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {q || onlyLow
                      ? 'Nenhum item corresponde ao filtro.'
                      : 'Nenhum produto com estoque cadastrado.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
}
