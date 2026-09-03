import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { customersApi, type Customer } from '../lib/api-client';
import { dateOnly } from '../lib/format';

const empty = { name: '', document: '', phone: '', email: '', notes: '' };

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(empty);
  const [showForm, setShowForm] = useState(false);

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list(search),
  });

  const create = useMutation({
    mutationFn: () =>
      customersApi.create({
        name: form.name,
        document: form.document || undefined,
        phone: form.phone || undefined,
        email: form.email || undefined,
        notes: form.notes || undefined,
      } as Partial<Customer>),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setForm(empty);
      setShowForm(false);
    },
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Clientes</h1>
        </div>
        <button className="primary-button" onClick={() => setShowForm((s) => !s)}>
          {showForm ? 'Fechar' : 'Novo cliente'}
        </button>
      </div>

      {showForm ? (
        <section className="panel" style={{ marginBottom: 20 }}>
          {create.error ? (
            <div className="error-message">
              {create.error instanceof Error ? create.error.message : 'Erro'}
            </div>
          ) : null}
          <div className="form-grid">
            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>Nome *</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </label>
            <label className="field">
              <span>CPF</span>
              <input value={form.document} onChange={(e) => setForm({ ...form, document: e.target.value })} />
            </label>
            <label className="field">
              <span>Telefone</span>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </label>
            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>E-mail</span>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </label>
          </div>
          <button
            className="primary-button"
            style={{ marginTop: 16 }}
            disabled={!form.name || create.isPending}
            onClick={() => create.mutate()}
          >
            {create.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </section>
      ) : null}

      <section className="panel">
        <input
          className="field-input"
          placeholder="Buscar por nome, CPF ou telefone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ marginBottom: 16 }}
        />
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>CPF</th>
                <th>Telefone</th>
                <th>Cadastro</th>
              </tr>
            </thead>
            <tbody>
              {customers.data?.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>{c.document ?? '—'}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>
                    <small>{dateOnly(c.createdAt)}</small>
                  </td>
                </tr>
              ))}
              {customers.data?.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    Nenhum cliente.
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
