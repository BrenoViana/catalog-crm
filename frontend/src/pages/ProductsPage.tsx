import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { ImportProductsModal } from '../components/ImportProductsModal';
import { categoriesApi, productsApi, type Product } from '../lib/api-client';
import { brl, num } from '../lib/format';
import { atLeast } from '../lib/roles';
import { useAuthStore } from '../store/authStore';

interface ProductForm {
  id: string | null;
  sku: string;
  name: string;
  barcode: string;
  description: string;
  unit: string;
  pricingMode: 'UNIT' | 'WEIGHT';
  price: string;
  cost: string;
  categoryId: string;
  initialStock: string;
  minStock: string;
  active: boolean;
}

const blank: ProductForm = {
  id: null,
  sku: '',
  name: '',
  barcode: '',
  description: '',
  unit: 'UN',
  pricingMode: 'UNIT',
  price: '',
  cost: '',
  categoryId: '',
  initialStock: '0',
  minStock: '0',
  active: true,
};

function fromProduct(p: Product): ProductForm {
  return {
    id: p.id,
    sku: p.sku,
    name: p.name,
    barcode: p.barcode ?? '',
    description: p.description ?? '',
    unit: p.unit,
    pricingMode: p.pricingMode ?? 'UNIT',
    price: String(p.price ?? ''),
    cost: p.cost == null ? '' : String(p.cost),
    categoryId: p.categoryId ?? '',
    initialStock: String(p.stock?.quantity ?? 0),
    minStock: String(p.stock?.minQuantity ?? 0),
    active: p.active,
  };
}

/** Aceita "12,90" e "12.90". */
const toNumber = (v: string) => Number(String(v).replace(',', '.'));

export function ProductsPage() {
  const queryClient = useQueryClient();
  const role = useAuthStore((state) => state.user?.role);
  const canEdit = atLeast(role, 'GERENTE');

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [form, setForm] = useState<ProductForm | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<Product | null>(null);
  const [showImport, setShowImport] = useState(false);
  const [feedback, setFeedback] = useState('');

  const products = useQuery({
    queryKey: ['products', 'list', search, categoryFilter],
    queryFn: () => productsApi.list({ search, categoryId: categoryFilter }),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['inventory'] });
    setForm(null);
    setConfirmRemove(null);
    setFeedback(message);
  };

  const save = useMutation({
    mutationFn: () => {
      const f = form!;
      const base = {
        name: f.name.trim(),
        barcode: f.barcode.trim() || undefined,
        description: f.description.trim() || undefined,
        unit: f.unit.trim() || (f.pricingMode === 'WEIGHT' ? 'KG' : 'UN'),
        pricingMode: f.pricingMode,
        price: toNumber(f.price),
        cost: f.cost ? toNumber(f.cost) : undefined,
        categoryId: f.categoryId || undefined,
      };

      // Estoque so entra na criacao; depois vira ajuste na tela de Estoque.
      return f.id
        ? productsApi.update(f.id, { ...base, active: f.active })
        : productsApi.create({
            ...base,
            sku: f.sku.trim(),
            initialStock: toNumber(f.initialStock) || 0,
            minStock: toNumber(f.minStock) || 0,
          });
    },
    onSuccess: () => done(form?.id ? 'Produto atualizado.' : 'Produto criado.'),
  });

  const remove = useMutation({
    mutationFn: () => productsApi.remove(confirmRemove!.id),
    onSuccess: () => done('Produto desativado.'),
  });

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) =>
    setForm((f) => (f ? { ...f, [k]: v } : f));

  const priceInvalid = form ? !form.price || Number.isNaN(toNumber(form.price)) : false;
  const canSave = form
    ? Boolean(form.name.trim()) && (form.id ? true : Boolean(form.sku.trim())) && !priceInvalid
    : false;

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Catálogo</p>
          <h1>Produtos</h1>
        </div>
        {canEdit ? (
          <div className="header-tags">
            <button className="ghost-button" onClick={() => setShowImport(true)}>
              Importar CSV
            </button>
            <button className="primary-button" onClick={() => { setFeedback(''); setForm(blank); }}>
              Novo produto
            </button>
          </div>
        ) : null}
      </div>

      {feedback ? <div className="success-message">{feedback}</div> : null}

      <section className="panel">
        <div className="toolbar">
          <input
            className="field-input"
            placeholder="Buscar por nome, SKU ou código de barras…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
            <option value="">Todas as categorias</option>
            {categories.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

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
                {canEdit ? <th style={{ width: 170 }}></th> : null}
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
                  {canEdit ? (
                    <td>
                      <div className="row-actions">
                        <button
                          className="mini-button"
                          onClick={() => { setFeedback(''); setForm(fromProduct(p)); }}
                        >
                          Editar
                        </button>
                        {p.active ? (
                          <button
                            className="mini-button danger"
                            onClick={() => { setFeedback(''); setConfirmRemove(p); }}
                          >
                            Desativar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
              {!products.isLoading && products.data?.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="muted">
                    Nenhum produto encontrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {form ? (
        <Modal
          title={form.id ? `Editar produto — ${form.name}` : 'Novo produto'}
          onClose={() => setForm(null)}
          footer={
            <>
              {form.id ? (
                <label className="toggle spacer">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => set('active', e.target.checked)}
                  />
                  Produto ativo
                </label>
              ) : null}
              <button className="ghost-button" onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={!canSave || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Salvando…' : 'Salvar produto'}
              </button>
            </>
          }
        >
          {save.error ? (
            <div className="error-message">
              {save.error instanceof Error ? save.error.message : 'Erro ao salvar'}
            </div>
          ) : null}

          <div className="form-grid">
            <label className="field">
              <span>SKU *</span>
              <input
                value={form.sku}
                disabled={Boolean(form.id)}
                onChange={(e) => set('sku', e.target.value)}
              />
              {form.id ? <small>O SKU não pode ser alterado.</small> : null}
            </label>
            <label className="field">
              <span>Código de barras</span>
              <input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>Nome *</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </label>

            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>Descrição</span>
              <input value={form.description} onChange={(e) => set('description', e.target.value)} />
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
              <span>Forma de venda</span>
              <select
                value={form.pricingMode}
                onChange={(e) => set('pricingMode', e.target.value as 'UNIT' | 'WEIGHT')}
              >
                <option value="UNIT">Por unidade</option>
                <option value="WEIGHT">Por peso (balança)</option>
              </select>
              {form.pricingMode === 'WEIGHT' ? (
                <small className="muted">
                  Preço por kg. A quantidade vem da etiqueta da balança (EAN-13 com prefixo 2);
                  cadastre o código do item de 6 dígitos no SKU ou no código de barras.
                </small>
              ) : null}
            </label>

            <label className="field">
              <span>Preço de venda *</span>
              <input
                inputMode="decimal"
                value={form.price}
                onChange={(e) => set('price', e.target.value)}
              />
            </label>
            <label className="field">
              <span>Custo</span>
              <input
                inputMode="decimal"
                value={form.cost}
                onChange={(e) => set('cost', e.target.value)}
              />
            </label>

            {form.id ? null : (
              <>
                <label className="field">
                  <span>Estoque inicial</span>
                  <input
                    inputMode="decimal"
                    value={form.initialStock}
                    onChange={(e) => set('initialStock', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Estoque mínimo</span>
                  <input
                    inputMode="decimal"
                    value={form.minStock}
                    onChange={(e) => set('minStock', e.target.value)}
                  />
                </label>
              </>
            )}
          </div>

          {form.id ? (
            <p className="muted">
              O saldo de estoque é alterado na tela de Estoque, por lançamento — assim todo
              movimento fica registrado.
            </p>
          ) : null}
        </Modal>
      ) : null}

      {showImport ? <ImportProductsModal onClose={() => setShowImport(false)} /> : null}

      {confirmRemove ? (
        <Modal
          title="Desativar produto"
          onClose={() => setConfirmRemove(null)}
          width={460}
          footer={
            <>
              <button className="ghost-button" onClick={() => setConfirmRemove(null)}>
                Cancelar
              </button>
              <button
                className="danger-button"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Desativando…' : 'Desativar'}
              </button>
            </>
          }
        >
          {remove.error ? (
            <div className="error-message">
              {remove.error instanceof Error ? remove.error.message : 'Erro ao desativar'}
            </div>
          ) : null}
          <p>
            Desativar <strong>{confirmRemove.name}</strong>?
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            O produto sai do PDV e das buscas, mas continua no histórico de vendas. Você pode
            reativá-lo depois pela edição.
          </p>
        </Modal>
      ) : null}
    </Layout>
  );
}
