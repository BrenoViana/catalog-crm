import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import {
  customersApi,
  type Customer,
  type CustomerListItem,
  type CustomerSegment,
} from '../lib/api-client';
import { brl, dateOnly, dateTime } from '../lib/format';

const blankForm = {
  name: '',
  document: '',
  phone: '',
  email: '',
  birthDate: '',
  notes: '',
};
type CustomerForm = typeof blankForm;

const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  NOVO: 'Novo',
  VIP: 'VIP',
  ATIVO: 'Ativo',
  EM_RISCO: 'Em risco',
  INATIVO: 'Inativo',
};
const SEGMENT_TAG: Record<CustomerSegment, string> = {
  NOVO: '',
  VIP: 'tag-success',
  ATIVO: 'tag-success',
  EM_RISCO: 'tag-warning',
  INATIVO: 'tag-warning',
};

function fromCustomer(c: Customer): CustomerForm {
  return {
    name: c.name,
    document: c.document ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    birthDate: c.birthDate ? c.birthDate.slice(0, 10) : '',
    notes: c.notes ?? '',
  };
}

/** Só manda o que muda de fato; string vazia vira omissão (não quebra @IsEmail/@IsISO8601). */
function toPayload(f: CustomerForm): Partial<Customer> {
  const out: Partial<Customer> = { name: f.name.trim() };
  if (f.document.trim()) out.document = f.document.trim();
  if (f.phone.trim()) out.phone = f.phone.trim();
  if (f.email.trim()) out.email = f.email.trim();
  if (f.birthDate) out.birthDate = f.birthDate;
  if (f.notes.trim()) out.notes = f.notes.trim();
  return out;
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBirthdays, setShowBirthdays] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState(new Date().getMonth() + 1);

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list(search),
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Cadastros</p>
          <h1>Clientes</h1>
        </div>
        <div className="header-tags">
          <button className="ghost-button" onClick={() => setShowBirthdays((s) => !s)}>
            🎂 Aniversariantes
          </button>
          <button className="primary-button" onClick={() => setCreating(true)}>
            Novo cliente
          </button>
        </div>
      </div>

      {showBirthdays ? (
        <BirthdayPanel
          month={birthdayMonth}
          onMonth={setBirthdayMonth}
          onClose={() => setShowBirthdays(false)}
        />
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
                <th>Segmento</th>
                <th>Última compra</th>
                <th style={{ textAlign: 'right' }}>Total gasto</th>
              </tr>
            </thead>
            <tbody>
              {customers.data?.map((c) => (
                <tr
                  key={c.id}
                  className="row-clickable"
                  onClick={() => setSelectedId(c.id)}
                >
                  <td>{c.name}</td>
                  <td>{c.document ?? '—'}</td>
                  <td>{c.phone ?? '—'}</td>
                  <td>
                    <span className={`tag ${SEGMENT_TAG[c.segment] ?? ''}`}>
                      {SEGMENT_LABEL[c.segment] ?? c.segment}
                    </span>
                  </td>
                  <td>
                    <small>{c.lastPurchase ? dateOnly(c.lastPurchase) : '—'}</small>
                  </td>
                  <td style={{ textAlign: 'right' }}>{brl(c.totalSpent)}</td>
                </tr>
              ))}
              {customers.data?.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    Nenhum cliente.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      {creating ? (
        <CustomerFormModal
          title="Novo cliente"
          initial={blankForm}
          onClose={() => setCreating(false)}
          onSubmit={(payload) => customersApi.create(payload)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            setCreating(false);
          }}
        />
      ) : null}

      {selectedId ? (
        <CustomerProfileModal
          id={selectedId}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </Layout>
  );
}

/* ---------------------------------------------------------------- Aniversariantes */
function BirthdayPanel({
  month,
  onMonth,
  onClose,
}: {
  month: number;
  onMonth: (m: number) => void;
  onClose: () => void;
}) {
  const list = useQuery({
    queryKey: ['customers', 'birthdays', month],
    queryFn: () => customersApi.birthdays(month),
  });

  return (
    <section className="panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <h2>Aniversariantes</h2>
        <div className="header-tags">
          <select value={month} onChange={(e) => onMonth(Number(e.target.value))}>
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <button className="mini-button" onClick={onClose}>Fechar</button>
        </div>
      </div>
      {list.data && list.data.length > 0 ? (
        <ul className="list-rows">
          {list.data.map((c) => (
            <li key={c.id}>
              <span>
                <strong>dia {new Date(c.birthDate).getUTCDate()}</strong> · {c.name}
              </span>
              <small>{c.phone ?? c.email ?? '—'}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">Nenhum cliente faz aniversário em {MONTHS[month - 1]}.</p>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- Form (novo/editar) */
function CustomerFormModal({
  title,
  initial,
  onClose,
  onSubmit,
  onSaved,
}: {
  title: string;
  initial: CustomerForm;
  onClose: () => void;
  onSubmit: (payload: Partial<Customer>) => Promise<unknown>;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<CustomerForm>(initial);
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => onSubmit(toPayload(form)),
    onSuccess: onSaved,
  });

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
          <button
            className="primary-button"
            disabled={!form.name.trim() || save.isPending}
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
      <div className="form-grid">
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span>Nome *</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>CPF</span>
          <input value={form.document} onChange={(e) => set('document', e.target.value)} />
        </label>
        <label className="field">
          <span>Telefone</span>
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label className="field">
          <span>E-mail</span>
          <input value={form.email} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="field">
          <span>Nascimento</span>
          <input
            type="date"
            value={form.birthDate}
            onChange={(e) => set('birthDate', e.target.value)}
          />
        </label>
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span>Observações</span>
          <textarea
            className="field-input"
            style={{ minHeight: 72 }}
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------- Perfil 360 */
function CustomerProfileModal({ id, onClose }: { id: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const profile = useQuery({
    queryKey: ['customers', 'profile', id],
    queryFn: () => customersApi.getProfile(id),
  });

  const data = profile.data;
  const stats = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Total gasto', value: brl(data.stats.totalSpent) },
      { label: 'Compras', value: String(data.stats.salesCount) },
      { label: 'Ticket médio', value: brl(data.stats.averageTicket) },
      {
        label: 'Última compra',
        value: data.stats.lastPurchase ? dateOnly(data.stats.lastPurchase) : '—',
      },
    ];
  }, [data]);

  if (editing && data) {
    return (
      <CustomerFormModal
        title={`Editar — ${data.customer.name}`}
        initial={fromCustomer(data.customer)}
        onClose={() => setEditing(false)}
        onSubmit={(payload) => customersApi.update(id, payload)}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['customers'] });
          setEditing(false);
        }}
      />
    );
  }

  return (
    <Modal
      title={data ? data.customer.name : 'Cliente'}
      width={780}
      onClose={onClose}
      footer={
        <>
          <button className="ghost-button spacer" onClick={onClose}>Fechar</button>
          {data ? (
            <button className="primary-button" onClick={() => setEditing(true)}>
              Editar cadastro
            </button>
          ) : null}
        </>
      }
    >
      {profile.isLoading ? <p className="muted">Carregando…</p> : null}
      {data ? (
        <>
          <div className="header-tags" style={{ marginBottom: 12 }}>
            <span className={`tag ${SEGMENT_TAG[data.stats.segment]}`}>
              {SEGMENT_LABEL[data.stats.segment]}
            </span>
            {data.customer.document ? <span className="tag">CPF {data.customer.document}</span> : null}
            {data.customer.phone ? <span className="tag">{data.customer.phone}</span> : null}
            {data.customer.email ? <span className="tag">{data.customer.email}</span> : null}
            {data.customer.birthDate ? (
              <span className="tag">🎂 {dateOnly(data.customer.birthDate)}</span>
            ) : null}
          </div>

          {data.customer.notes ? (
            <p className="muted" style={{ marginBottom: 12 }}>{data.customer.notes}</p>
          ) : null}

          <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            {stats.map((s) => (
              <article key={s.label} className="stat-card">
                <span>{s.label}</span>
                <strong>{s.value}</strong>
              </article>
            ))}
          </div>

          <div className="panel-header" style={{ marginTop: 20 }}>
            <h2>Compras recentes</h2>
          </div>
          {data.recentSales.length === 0 ? (
            <p className="muted">Nenhuma compra registrada.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Data</th>
                    <th style={{ textAlign: 'right' }}>Itens</th>
                    <th style={{ textAlign: 'right' }}>Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentSales.map((s) => (
                    <tr key={s.id}>
                      <td>{s.number}</td>
                      <td><small>{dateTime(s.completedAt ?? s.createdAt)}</small></td>
                      <td style={{ textAlign: 'right' }}>{s._count.items}</td>
                      <td style={{ textAlign: 'right' }}>{brl(s.total)}</td>
                      <td>
                        <span
                          className={`tag ${
                            s.status === 'CONCLUIDA'
                              ? 'tag-success'
                              : s.status === 'CANCELADA'
                                ? 'tag-warning'
                                : ''
                          }`}
                        >
                          {s.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.topProducts.length > 0 ? (
            <>
              <div className="panel-header" style={{ marginTop: 20 }}>
                <h2>Mais comprados</h2>
              </div>
              <ul className="list-rows">
                {data.topProducts.map((p) => (
                  <li key={p.name}>
                    <span>{p.name} <small>({p.quantity} un)</small></span>
                    <strong>{brl(p.total)}</strong>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      ) : null}
    </Modal>
  );
}
