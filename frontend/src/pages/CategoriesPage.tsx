import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import { categoriesApi, type Category } from '../lib/api-client';

interface Editing {
  id: string | null;
  name: string;
  parentId: string;
}

const blank: Editing = { id: null, name: '', parentId: '' };

/** Achata a arvore em linhas com nivel, para indentar a listagem. */
function flatten(categories: Category[]): Array<Category & { depth: number }> {
  const byParent = new Map<string | null, Category[]>();
  for (const c of categories) {
    const key = c.parentId ?? null;
    byParent.set(key, [...(byParent.get(key) ?? []), c]);
  }

  const rows: Array<Category & { depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      rows.push({ ...c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);

  // Categorias cujo pai sumiu da lista nao podem ficar invisiveis.
  const seen = new Set(rows.map((r) => r.id));
  for (const c of categories) if (!seen.has(c.id)) rows.push({ ...c, depth: 0 });
  return rows;
}

export function CategoriesPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Editing | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [feedback, setFeedback] = useState('');

  const categories = useQuery({ queryKey: ['categories'], queryFn: categoriesApi.list });
  const rows = useMemo(() => flatten(categories.data ?? []), [categories.data]);

  const done = (message: string) => {
    queryClient.invalidateQueries({ queryKey: ['categories'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
    setEditing(null);
    setConfirmDelete(null);
    setFeedback(message);
  };

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: editing!.name.trim(),
        parentId: editing!.parentId || undefined,
      };
      return editing!.id
        ? categoriesApi.update(editing!.id, payload)
        : categoriesApi.create(payload);
    },
    onSuccess: () => done(editing?.id ? 'Categoria atualizada.' : 'Categoria criada.'),
  });

  const remove = useMutation({
    mutationFn: () => categoriesApi.remove(confirmDelete!.id),
    onSuccess: () => done('Categoria removida.'),
  });

  /** Opcoes de pai: exclui a propria categoria (o backend tambem barra ciclos). */
  const parentOptions = (rows ?? []).filter((c) => c.id !== editing?.id);

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Categorias</h1>
        </div>
        <button className="primary-button" onClick={() => { setFeedback(''); setEditing(blank); }}>
          Nova categoria
        </button>
      </div>

      {feedback ? <div className="success-message">{feedback}</div> : null}
      {categories.error ? (
        <div className="error-message">
          {categories.error instanceof Error ? categories.error.message : 'Erro ao carregar'}
        </div>
      ) : null}

      <section className="panel">
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Categoria</th>
                <th style={{ textAlign: 'right' }}>Produtos</th>
                <th style={{ textAlign: 'right' }}>Subcategorias</th>
                <th style={{ width: 170 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td style={{ paddingLeft: 12 + c.depth * 22 }}>
                    {c.depth > 0 ? <span className="muted">└ </span> : null}
                    {c.name}
                  </td>
                  <td style={{ textAlign: 'right' }}>{c._count?.products ?? 0}</td>
                  <td style={{ textAlign: 'right' }}>{c._count?.children ?? 0}</td>
                  <td>
                    <div className="row-actions">
                      <button
                        className="mini-button"
                        onClick={() => {
                          setFeedback('');
                          setEditing({ id: c.id, name: c.name, parentId: c.parentId ?? '' });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        className="mini-button danger"
                        onClick={() => { setFeedback(''); setConfirmDelete(c); }}
                      >
                        Remover
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {!categories.isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Nenhuma categoria cadastrada.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {editing ? (
        <Modal
          title={editing.id ? 'Editar categoria' : 'Nova categoria'}
          onClose={() => setEditing(null)}
          width={520}
          footer={
            <>
              <button className="ghost-button" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button
                className="primary-button"
                disabled={!editing.name.trim() || save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </>
          }
        >
          {save.error ? (
            <div className="error-message">
              {save.error instanceof Error ? save.error.message : 'Erro ao salvar'}
            </div>
          ) : null}

          <label className="field">
            <span>Nome *</span>
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editing.name.trim()) save.mutate();
              }}
            />
          </label>

          <label className="field">
            <span>Categoria pai</span>
            <select
              value={editing.parentId}
              onChange={(e) => setEditing({ ...editing, parentId: e.target.value })}
            >
              <option value="">Nenhuma (categoria raiz)</option>
              {parentOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {'— '.repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        </Modal>
      ) : null}

      {confirmDelete ? (
        <Modal
          title="Remover categoria"
          onClose={() => setConfirmDelete(null)}
          width={460}
          footer={
            <>
              <button className="ghost-button" onClick={() => setConfirmDelete(null)}>
                Cancelar
              </button>
              <button
                className="danger-button"
                disabled={remove.isPending}
                onClick={() => remove.mutate()}
              >
                {remove.isPending ? 'Removendo…' : 'Remover'}
              </button>
            </>
          }
        >
          {remove.error ? (
            <div className="error-message">
              {remove.error instanceof Error ? remove.error.message : 'Erro ao remover'}
            </div>
          ) : null}
          <p>
            Remover a categoria <strong>{confirmDelete.name}</strong>?
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Categorias com produtos ou subcategorias não podem ser removidas — mova-os antes.
          </p>
        </Modal>
      ) : null}
    </Layout>
  );
}
