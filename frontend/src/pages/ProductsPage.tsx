import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { categoriesApi, productsApi, type CreateProductInput } from '../lib/api-client';
import { brl, num } from '../lib/format';

const emptyForm: CreateProductInput = {
  sku: '',
  name: '',
  barcode: '',
  unit: 'UN',
  price: 0,
  cost: 0,
  initialStock: 0,
  minStock: 0,
  categoryId: '',
};

export function ProductsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateProductInput>(emptyForm);

  const products = useQuery({
    queryKey: ['products', 'list', search],
    queryFn: () => productsApi.list({ search }),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const create = useMutation({
    mutationFn: () =>
      productsApi.create({
        ...form,
        price: Number(form.price),
        cost: form.cost ? Number(form.cost) : undefined,
        initialStock: Number(form.initialStock) || 0,
        minStock: Number(form.minStock) || 0,
        barcode: form.barcode || undefined,
        categoryId: form.categoryId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setShowForm(false);
      setForm(emptyForm);
    },
  });

  const set = (k: keyof CreateProductInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Produtos</h1>
        </div>
        <button className="primary-button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Fechar' : 'Novo produto'}
        </button>
      </div>

      {showForm ? (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-header">
            <h2>Novo produto</h2>
          </div>
          {create.error ? (
            <div className="error-message">
              {create.error instanceof Error ? create.error.message : 'Erro ao salvar'}
            </div>
          ) : null}
          <div className="form-grid">
            <label className="field">
              <span>SKU *</span>
              <input value={form.sku} onChange={(e) => set('sku', e.target.value)} />
            </label>
            <label className="field">
              <span>Código de barras</span>
              <input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
            </label>
            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>Nome *</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>
            <label className="field">
              <span>Categoria</span>
              <select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
                <option value="">Sem categoria</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Unidade</span>
              <input value={form.unit} onChange={(e) => set('unit', e.target.value)} />
            </label>
            <label className="field">
              <span>Preço de venda *</span>
              <input inputMode="decimal" value={form.price} onChange={(e) => set('price', e.target.value)} />
            </label>
            <label className="field">
              <span>Custo</span>
              <input inputMode="decimal" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </label>
            <label className="field">
              <span>Estoque inicial</span>
              <input inputMode="decimal" value={form.initialStock} onChange={(e) => set('initialStock', e.target.value)} />
            </label>
            <label className="field">
              <span>Estoque mínimo</span>
              <input inputMode="decimal" value={form.minStock} onChange={(e) => set('minStock', e.target.value)} />
            </label>
          </div>
          <button
            className="primary-button"
            style={{ marginTop: 16 }}
            disabled={!form.sku || !form.name || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Salvando…' : 'Salvar produto'}
          </button>
        </section>
      ) : null}

      <section className="panel">
        <input
          className="field-input"
          placeholder="Buscar produtos…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Produto</th>
                <th>SKU</th>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Preço</th>
                <th style={{ textAlign: 'right' }}>Estoque</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {products.data?.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>
                    <small>{p.sku}</small>
                  </td>
                  <td>{p.category?.name ?? '—'}</td>
                  <td style={{ textAlign: 'right' }}>{brl(p.price)}</td>
                  <td style={{ textAlign: 'right' }}>
                    {num(p.stock?.quantity)} {p.unit}
                  </td>
                  <td>
                    <span className={`tag ${p.active ? 'tag-success' : 'tag-warning'}`}>
                      {p.active ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                </tr>
              ))}
              {products.data?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Nenhum produto.
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
