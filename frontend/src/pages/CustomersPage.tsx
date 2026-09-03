import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { Modal } from '../components/Modal';
import {
  CustomerFormModal,
  SEGMENT_LABEL,
  SEGMENT_TAG,
  blankCustomerForm,
  fromCustomer,
} from '../components/CustomerFormModal';
import { customersApi, type CustomerSegment } from '../lib/api-client';
import { brl, dateOnly, dateTime } from '../lib/format';
import { downloadText, toCsv } from '../lib/download';

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const SEGMENTS: CustomerSegment[] = ['NOVO', 'ATIVO', 'EM_RISCO', 'INATIVO', 'VIP'];

export function CustomersPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [segment, setSegment] = useState<CustomerSegment | ''>('');
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showBirthdays, setShowBirthdays] = useState(false);
  const [birthdayMonth, setBirthdayMonth] = useState(new Date().getMonth() + 1);

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list(search),
  });

  const rows = useMemo(
    () => (customers.data ?? []).filter((c) => !segment || c.segment === segment),
    [customers.data, segment],
  );

  const exportCsv = () => {
    const header = ['Nome', 'CPF', 'Telefone', 'E-mail', 'Segmento', 'Última compra', 'Total gasto'];
    const body = rows.map((c) => [
      c.name,
      c.document ?? '',
      c.phone ?? '',
      c.email ?? '',
      SEGMENT_LABEL[c.segment] ?? c.segment,
      c.lastPurchase ? dateOnly(c.lastPurchase) : '',
      c.totalSpent.toFixed(2).replace('.', ','),
    ]);
    const tag = segment ? `-${segment.toLowerCase()}` : '';
    downloadText(`clientes${tag}.csv`, toCsv([header, ...body]));
  };

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
        <div className="toolbar">
          <input
            className="field-input"
            placeholder="Buscar por nome, CPF ou telefone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select value={segment} onChange={(e) => setSegment(e.target.value as CustomerSegment | '')}>
            <option value="">Todos os segmentos</option>
            {SEGMENTS.map((s) => (
              <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>
            ))}
          </select>
          <button
            className="ghost-button"
            disabled={rows.length === 0}
            onClick={exportCsv}
          >
            Exportar CSV
          </button>
        </div>

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
              {rows.map((c) => (
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
              {!customers.isLoading && rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    {segment ? 'Nenhum cliente neste segmento.' : 'Nenhum cliente.'}
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
          initial={blankCustomerForm}
          onClose={() => setCreating(false)}
          onSubmit={(payload) => customersApi.create(payload)}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ['customers'] });
            setCreating(false);
          }}
        />
      ) : null}

      {selectedId ? (
        <CustomerProfileModal id={selectedId} onClose={() => setSelectedId(null)} />
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

  const exportCsv = () => {
    const body = (list.data ?? []).map((c) => [
      new Date(c.birthDate).getUTCDate(),
      c.name,
      c.phone ?? '',
      c.email ?? '',
    ]);
    downloadText(
      `aniversariantes-${String(month).padStart(2, '0')}.csv`,
      toCsv([['Dia', 'Nome', 'Telefone', 'E-mail'], ...body]),
    );
  };

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
          <button
            className="mini-button"
            disabled={!list.data || list.data.length === 0}
            onClick={exportCsv}
          >
            Exportar
          </button>
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
