import './CustomersPage.css';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { CustomerCreditLoyalty } from '../components/CustomerCreditLoyalty';
import { Modal } from '../components/Modal';
import { IconCake, IconCaret, IconFilter, IconSearch } from '../components/ui-icons';
import {
  CustomerFormModal,
  SEGMENT_LABEL,
  SEGMENT_TAG,
  blankCustomerForm,
  fromCustomer,
} from '../components/CustomerFormModal';
import { customersApi, type BirthdayCustomer, type CustomerSegment } from '../lib/api-client';
import { brl, dateOnly, dateTime } from '../lib/format';
import { downloadText, toCsv } from '../lib/download';
import { whatsappUrl } from '../lib/receipt-share';

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
          <button
            className="ghost-button with-icon"
            aria-pressed={showBirthdays}
            onClick={() => setShowBirthdays((s) => !s)}
          >
            <IconCake />
            Aniversariantes
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
          <div className="toolbar-field has-icon">
            <span className="toolbar-icon">
              <IconSearch />
            </span>
            <input
              className="field-input"
              placeholder="Buscar por nome, CPF ou telefone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className={`toolbar-field is-filter has-icon ${segment ? 'is-active' : ''}`}>
            <span className="toolbar-icon">
              <IconFilter />
            </span>
            <select
              className="field-input"
              aria-label="Filtrar por segmento"
              value={segment}
              onChange={(e) => setSegment(e.target.value as CustomerSegment | '')}
            >
              <option value="">Todos os segmentos</option>
              {SEGMENTS.map((s) => (
                <option key={s} value={s}>{SEGMENT_LABEL[s]}</option>
              ))}
            </select>
            <span className="toolbar-caret">
              <IconCaret />
            </span>
          </div>
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

/** Iniciais para o avatar: primeira letra do primeiro e do último nome. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0];
  const last = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (first + last).toUpperCase();
}

/**
 * Cor estável do avatar a partir do nome — mesma pessoa, mesma cor sempre.
 * Luminosidade baixa (30%) para as iniciais brancas passarem contraste AA
 * (>= 4.5:1) em qualquer matiz.
 */
function avatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue} 45% 30%)`;
}

/** Frase curta de contexto: quantos dias faltam (no mês corrente) e a idade. */
function birthdayContext(birthDate: string, month: number): string {
  const bd = new Date(birthDate);
  const day = bd.getUTCDate();
  const now = new Date();
  const thisYear = now.getFullYear();
  const bornYear = bd.getUTCFullYear();
  const age =
    bornYear > 1900 && bornYear < thisYear ? `faz ${thisYear - bornYear}` : '';

  let when = '';
  if (month === now.getMonth() + 1) {
    const diff = day - now.getDate();
    if (diff === 0) when = 'Hoje 🎉';
    else if (diff === 1) when = 'Amanhã';
    else if (diff > 1) when = `em ${diff} dias`;
    else when = `há ${-diff} ${-diff === 1 ? 'dia' : 'dias'}`;
  }

  return [when, age].filter(Boolean).join(' · ');
}

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

  const rows = useMemo(() => {
    const data = [...(list.data ?? [])];
    data.sort((a, b) => {
      const da = new Date(a.birthDate).getUTCDate();
      const db = new Date(b.birthDate).getUTCDate();
      return da - db || a.name.localeCompare(b.name, 'pt-BR');
    });
    return data;
  }, [list.data]);

  // "Hoje" no relógio de parede do usuário; o dia do aniversário sai de
  // getUTCDate() (a data nasce como data-only, sem hora), igual ao resto da tela.
  const todayDay = new Date().getDate();
  const isCurrentMonth = month === new Date().getMonth() + 1;

  const exportCsv = () => {
    const body = rows.map((c) => [
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

  const shiftMonth = (delta: number) => onMonth(((month - 1 + delta + 12) % 12) + 1);

  return (
    <section className="panel birthday-panel" style={{ marginBottom: 20 }}>
      <div className="panel-header">
        <div>
          <h2>Aniversariantes</h2>
          <span className="birthday-count">
            {rows.length === 0
              ? `Ninguém em ${MONTHS[month - 1]}`
              : `${rows.length} cliente${rows.length > 1 ? 's' : ''} em ${MONTHS[month - 1]}`}
          </span>
        </div>
        <div className="birthday-tools">
          <div className="month-nav">
            <button type="button" aria-label="Mês anterior" onClick={() => shiftMonth(-1)}>
              ‹
            </button>
            <select
              aria-label="Mês"
              value={month}
              onChange={(e) => onMonth(Number(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </select>
            <button type="button" aria-label="Próximo mês" onClick={() => shiftMonth(1)}>
              ›
            </button>
          </div>
          <button className="mini-button" disabled={rows.length === 0} onClick={exportCsv}>
            Exportar
          </button>
          <button className="mini-button" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>

      {list.isLoading ? (
        <p className="muted">Carregando…</p>
      ) : rows.length === 0 ? (
        <div className="empty-state">
          <strong>Nenhum aniversário em {MONTHS[month - 1]}</strong>
          <span>Cadastre a data de nascimento no perfil do cliente para vê-lo aqui.</span>
        </div>
      ) : (
        <div className="birthday-grid">
          {rows.map((c) => (
            <BirthdayCard
              key={c.id}
              customer={c}
              month={month}
              isToday={isCurrentMonth && new Date(c.birthDate).getUTCDate() === todayDay}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function BirthdayCard({
  customer,
  month,
  isToday,
}: {
  customer: BirthdayCustomer;
  month: number;
  isToday: boolean;
}) {
  const day = new Date(customer.birthDate).getUTCDate();
  const context = birthdayContext(customer.birthDate, month);

  return (
    <article className={`birthday-card ${isToday ? 'is-today' : ''}`}>
      <div className="birthday-top">
        <span className="birthday-avatar" style={{ background: avatarColor(customer.name) }}>
          {initials(customer.name)}
        </span>
        <div className="birthday-id">
          <span className="birthday-name" title={customer.name}>
            {customer.name}
          </span>
          {context ? <span className="birthday-when">{context}</span> : null}
        </div>
        <span className="birthday-daypill">
          {day}
          <small>{MONTHS[month - 1].slice(0, 3)}</small>
        </span>
      </div>
      {customer.phone || customer.email ? (
        <div className="birthday-contacts">
          {customer.phone ? (
            <a
              className="birthday-chip"
              href={whatsappUrl('', customer.phone)}
              target="_blank"
              rel="noreferrer"
            >
              WhatsApp
            </a>
          ) : null}
          {customer.phone ? (
            <a className="birthday-chip" href={`tel:${customer.phone.replace(/\s/g, '')}`}>
              Ligar
            </a>
          ) : null}
          {customer.email ? (
            <a className="birthday-chip" href={`mailto:${customer.email}`}>
              E-mail
            </a>
          ) : null}
        </div>
      ) : null}
    </article>
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

          <CustomerCreditLoyalty customerId={id} />

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
