import './FinancePage.css';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import {
  customersApi,
  financeApi,
  type CashflowReport,
  type Payable,
  type PayableRecurrence,
  type PaymentMethod,
  type Receivable,
  type Supplier,
  type TitleStatus,
} from '../lib/api-client';
import {
  brl,
  dateInput,
  dateOnly,
  dateTime,
  dayLabelBr,
  num,
  paymentLabel,
  toNumber,
} from '../lib/format';
import { useAuthStore } from '../store/authStore';

type Tab = 'painel' | 'fechamento' | 'receber' | 'pagar' | 'fornecedores';

const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  {
    key: 'painel',
    label: 'Painel',
    hint: 'Resultado do período (competência) e caixa (o que passou pela gaveta) lado a lado.',
  },
  {
    key: 'fechamento',
    label: 'Fechamento do dia',
    hint: 'Consolida todos os turnos e trava o dia. Reabrir exige justificativa.',
  },
  {
    key: 'receber',
    label: 'A receber',
    hint: 'Parcelas de crediário: o que a loja tem a receber, de quem e quando.',
  },
  {
    key: 'pagar',
    label: 'A pagar',
    hint: 'Despesas com vencimento, categoria e recorrência.',
  },
  {
    key: 'fornecedores',
    label: 'Fornecedores',
    hint: 'A quem a loja paga.',
  },
];

/** Formas que dão baixa em título. Crediário e fidelidade não quitam título. */
const SETTLE_METHODS: PaymentMethod[] = ['DINHEIRO', 'PIX', 'DEBITO', 'CREDITO', 'OUTRO'];

const RECURRENCES: Array<{ value: PayableRecurrence; label: string }> = [
  { value: 'NENHUMA', label: 'Não se repete' },
  { value: 'SEMANAL', label: 'Semanal' },
  { value: 'MENSAL', label: 'Mensal' },
  { value: 'BIMESTRAL', label: 'Bimestral' },
  { value: 'TRIMESTRAL', label: 'Trimestral' },
  { value: 'SEMESTRAL', label: 'Semestral' },
  { value: 'ANUAL', label: 'Anual' },
];

const STATUS_TAG: Record<TitleStatus, string> = {
  ABERTO: '',
  PARCIAL: 'tag-warning',
  PAGO: 'tag-success',
  CANCELADO: 'tag-muted',
};

const STATUS_LABEL: Record<TitleStatus, string> = {
  ABERTO: 'Em aberto',
  PARCIAL: 'Parcial',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

const isOverdue = (t: { status: TitleStatus; dueDate: string }) =>
  (t.status === 'ABERTO' || t.status === 'PARCIAL') && new Date(t.dueDate) < new Date();

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'ok' | 'warn';
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong className={tone === 'warn' ? 'text-warning' : tone === 'ok' ? 'text-success' : ''}>
        {value}
      </strong>
      {hint ? <small className="muted">{hint}</small> : null}
    </article>
  );
}

/** Distribuição do saldo em aberto por faixa de vencimento. */
function AgingBar({
  aging,
  total,
}: {
  aging: { vencido: number; ate7: number; ate30: number; acima30: number };
  total: number;
}) {
  const faixas = [
    { key: 'vencido', label: 'Vencido', value: aging.vencido, cls: 'aging-late' },
    { key: 'ate7', label: 'Até 7 dias', value: aging.ate7, cls: 'aging-soon' },
    { key: 'ate30', label: 'Até 30 dias', value: aging.ate30, cls: 'aging-mid' },
    { key: 'acima30', label: 'Mais de 30', value: aging.acima30, cls: 'aging-far' },
  ];
  if (total <= 0) return <p className="muted">Nada em aberto.</p>;
  return (
    <ul className="aging-list">
      {faixas.map((f) => (
        <li key={f.key}>
          <span>{f.label}</span>
          <div className="share-track">
            <div
              className={`share-fill ${f.cls}`}
              style={{ width: `${Math.min(100, (f.value / total) * 100)}%` }}
            />
          </div>
          <strong>{brl(f.value)}</strong>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------- Painel

function Painel({ report }: { report: CashflowReport }) {
  const r = report.resultado;
  const c = report.caixa;
  const maxDaily = Math.max(1, ...c.daily.map((d) => Math.max(d.in, d.out)));

  return (
    <>
      <section className="panel">
        <div className="panel-header">
          <h2>Resultado do período</h2>
          <small className="muted">
            Por competência: a venda a prazo conta no dia em que a mercadoria saiu.
          </small>
        </div>
        <div className="stat-grid">
          <Kpi label="Receita líquida" value={brl(r.receitaLiquida)} hint={`${num(r.vendas)} vendas`} />
          <Kpi
            label="Custo das mercadorias"
            value={brl(r.cmv)}
            hint={
              r.itensSemCusto > 0
                ? `${num(r.itensSemCusto)} itens sem custo gravado, fora do cálculo`
                : 'custo gravado em cada venda'
            }
          />
          <Kpi
            label={r.cmvEstimado ? 'Margem bruta (parcial)' : 'Margem bruta'}
            value={brl(r.margemBruta)}
            hint={
              r.cmvEstimado
                ? `${num(r.margemPercent, 1)}% de ${brl(r.receitaComCusto)} — só a receita com custo gravado`
                : `${num(r.margemPercent, 1)}% da receita`
            }
          />
          <Kpi label="Despesas pagas" value={brl(r.despesas)} />
          <Kpi
            label={r.resultadoParcial ? 'Resultado (parcial)' : 'Resultado'}
            value={brl(r.resultado)}
            tone={r.resultado >= 0 ? 'ok' : 'warn'}
            hint={
              r.resultadoParcial
                ? 'margem de parte da receita menos todas as despesas — pessimista'
                : 'margem bruta menos despesas'
            }
          />
        </div>
        <p className="muted finance-note">
          {r.cmvEstimado ? (
            <>
              A margem sai do <strong>custo gravado em cada venda</strong>, mas{' '}
              {num(r.itensSemCusto)} item(ns) do período não têm esse custo — venda anterior ao
              registro do custo, ou produto sem custo cadastrado. Esses itens ficam{' '}
              <strong>fora</strong> da conta, dos dois lados: a margem é apurada só sobre a receita
              coberta. Como as despesas entram inteiras, o resultado do recorte é{' '}
              <strong>pessimista</strong>, não otimista.
            </>
          ) : (
            <>
              A margem sai do <strong>custo gravado em cada venda</strong>, não do custo atual do
              produto: reprecificação de fornecedor não desloca a margem de um período já fechado.
            </>
          )}
        </p>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Caixa do período</h2>
          <small className="muted">
            Só o que entrou e saiu de fato. Venda no crediário aparece na baixa do título, não na venda.
          </small>
        </div>
        <div className="stat-grid">
          <Kpi label="Entradas" value={brl(c.entradas)} hint={`${brl(c.recebimentos)} de crediário recebido`} />
          <Kpi label="Saídas" value={brl(c.saidas)} hint={`${brl(c.despesas)} despesas · ${brl(c.devolucoes)} devoluções`} />
          <Kpi label="Saldo do período" value={brl(c.saldo)} tone={c.saldo >= 0 ? 'ok' : 'warn'} />
        </div>

        {c.daily.length > 0 ? (
          <div className="cash-chart" role="img" aria-label="Entradas e saídas por dia">
            {c.daily.map((d) => (
              <div key={d.date} className="cash-day">
                <div className="cash-bars">
                  <div
                    className="cash-bar cash-in"
                    style={{ height: `${(d.in / maxDaily) * 100}%` }}
                    title={`Entradas ${brl(d.in)}`}
                  />
                  <div
                    className="cash-bar cash-out"
                    style={{ height: `${(d.out / maxDaily) * 100}%` }}
                    title={`Saídas ${brl(d.out)}`}
                  />
                </div>
                <small>{d.date.slice(8)}</small>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">Nenhum movimento no período.</p>
        )}
      </section>

      <div className="finance-columns">
        <section className="panel">
          <div className="panel-header">
            <h2>A receber</h2>
            <strong>{brl(report.projecao.aReceber.total)}</strong>
          </div>
          <AgingBar aging={report.projecao.aReceber} total={report.projecao.aReceber.total} />
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>A pagar</h2>
            <strong>{brl(report.projecao.aPagar.total)}</strong>
          </div>
          <AgingBar aging={report.projecao.aPagar} total={report.projecao.aPagar.total} />
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <h2>Despesas por categoria</h2>
          <small className="muted">O que foi efetivamente pago no período.</small>
        </div>
        {report.despesasPorCategoria.length === 0 ? (
          <p className="muted">Nenhuma despesa paga no período.</p>
        ) : (
          <ul className="list-rows">
            {report.despesasPorCategoria.map((d) => (
              <li key={d.category}>
                <span>{d.category}</span>
                <strong>{brl(d.amount)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

// ------------------------------------------------------------------- Baixa

function SettleForm({
  saldo,
  busy,
  onSubmit,
  onCancel,
}: {
  saldo: number;
  busy: boolean;
  onSubmit: (data: { amount: number; method: PaymentMethod; note?: string }) => void;
  onCancel: () => void;
}) {
  const [amount, setAmount] = useState(String(saldo.toFixed(2)));
  const [method, setMethod] = useState<PaymentMethod>('DINHEIRO');
  const [note, setNote] = useState('');
  const valor = toNumber(amount);

  return (
    <form
      className="settle-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ amount: valor, method, note: note.trim() || undefined });
      }}
    >
      <label>
        <span>Valor</span>
        <input
          className="field-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
          autoFocus
        />
      </label>
      <label>
        <span>Forma</span>
        <select
          className="field-input"
          value={method}
          onChange={(e) => setMethod(e.target.value as PaymentMethod)}
        >
          {SETTLE_METHODS.map((m) => (
            <option key={m} value={m}>
              {paymentLabel[m]}
            </option>
          ))}
        </select>
      </label>
      <label className="settle-note">
        <span>Observação</span>
        <input
          className="field-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="opcional"
        />
      </label>
      <div className="settle-actions">
        <button className="ghost-button" type="button" onClick={onCancel}>
          Cancelar
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={busy || valor <= 0 || valor > saldo + 0.005}
        >
          {busy ? 'Registrando…' : 'Dar baixa'}
        </button>
      </div>
      {method === 'DINHEIRO' ? (
        <p className="muted settle-hint">
          Em dinheiro o valor entra no seu turno aberto — o fechamento do caixa vai contar com ele.
        </p>
      ) : null}
    </form>
  );
}

// --------------------------------------------------------------- A receber

function Receber({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'aberto' | 'vencido' | 'todos'>('aberto');
  const [search, setSearch] = useState('');
  const [settling, setSettling] = useState<Receivable | null>(null);
  const [creating, setCreating] = useState(false);
  const [erro, setErro] = useState('');

  const titles = useQuery({
    queryKey: ['finance', 'receivables', filter, search],
    queryFn: () =>
      financeApi.receivables({
        status: filter === 'aberto' ? 'ABERTO' : undefined,
        overdue: filter === 'vencido',
        search: search.trim() || undefined,
      }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance'] });
    queryClient.invalidateQueries({ queryKey: ['cash'] });
  };

  const settle = useMutation({
    mutationFn: (data: { amount: number; method: PaymentMethod; note?: string }) =>
      financeApi.settleReceivable(settling!.id, data),
    onSuccess: () => {
      setSettling(null);
      setErro('');
      invalidate();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      financeApi.cancelReceivable(id, reason),
    onSuccess: invalidate,
    onError: (e: Error) => setErro(e.message),
  });

  const totalAberto = useMemo(
    () =>
      (titles.data ?? [])
        .filter((t) => t.status === 'ABERTO' || t.status === 'PARCIAL')
        .reduce((acc, t) => acc + (t.amount - t.paidAmount), 0),
    [titles.data],
  );

  return (
    <section className="panel">
      <div className="toolbar">
        <div className="report-presets">
          {(['aberto', 'vencido', 'todos'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`pill-button ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'aberto' ? 'Em aberto' : f === 'vencido' ? 'Vencidos' : 'Todos'}
            </button>
          ))}
        </div>
        <input
          className="field-input"
          placeholder="Buscar por cliente ou descrição"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManage ? (
          <button className="primary-button" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Fechar' : 'Novo título'}
          </button>
        ) : null}
      </div>

      {erro ? <p className="form-error">{erro}</p> : null}

      {creating ? (
        <NovoTitulo
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
          onError={setErro}
        />
      ) : null}

      <p className="muted finance-note">
        Saldo em aberto nesta lista: <strong>{brl(totalAberto)}</strong>
      </p>

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Cliente</th>
              <th>Descrição</th>
              <th>Vencimento</th>
              <th className="ta-right">Valor</th>
              <th className="ta-right">Saldo</th>
              <th>Situação</th>
              {canManage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {(titles.data ?? []).map((t) => {
              const saldo = t.amount - t.paidAmount;
              return (
                <tr key={t.id} className={isOverdue(t) ? 'row-late' : ''}>
                  <td>{t.number}</td>
                  <td>{t.customer.name}</td>
                  <td>{t.description}</td>
                  <td>{dateOnly(t.dueDate)}</td>
                  <td className="ta-right">{brl(t.amount)}</td>
                  <td className="ta-right">{brl(saldo)}</td>
                  <td>
                    <span className={`tag ${STATUS_TAG[t.status]}`}>
                      {isOverdue(t) ? 'Vencido' : STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  {canManage ? (
                    <td className="ta-right">
                      {t.status === 'ABERTO' || t.status === 'PARCIAL' ? (
                        <>
                          <button className="mini-button" onClick={() => setSettling(t)}>
                            Receber
                          </button>
                          <button
                            className="mini-button"
                            onClick={() => {
                              const reason = prompt('Motivo do cancelamento do título:');
                              if (reason && reason.trim().length >= 3) {
                                cancel.mutate({ id: t.id, reason: reason.trim() });
                              }
                            }}
                          >
                            Cancelar
                          </button>
                        </>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              );
            })}
            {titles.data && titles.data.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 8 : 7} className="muted">
                  Nenhum título nesta faixa.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {settling ? (
        <div className="panel settle-panel">
          <div className="panel-header">
            <h2>
              Receber título #{settling.number} — {settling.customer.name}
            </h2>
          </div>
          <SettleForm
            saldo={settling.amount - settling.paidAmount}
            busy={settle.isPending}
            onSubmit={(data) => settle.mutate(data)}
            onCancel={() => setSettling(null)}
          />
        </div>
      ) : null}
    </section>
  );
}

function NovoTitulo({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [customerId, setCustomerId] = useState('');
  const [search, setSearch] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [installments, setInstallments] = useState(1);
  const [dueDate, setDueDate] = useState(dateInput());

  const customers = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list(search || undefined),
  });

  const create = useMutation({
    mutationFn: () =>
      financeApi.createReceivable({
        customerId,
        description: description.trim(),
        amount: toNumber(amount),
        dueDate: new Date(`${dueDate}T12:00:00`).toISOString(),
        installments,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  });

  return (
    <form
      className="finance-form"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <label>
        <span>Cliente</span>
        <input
          className="field-input"
          placeholder="Buscar cliente"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select
          className="field-input"
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
        >
          <option value="">Selecione…</option>
          {(customers.data ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Descrição</span>
        <input
          className="field-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Renegociação, acerto de conta…"
        />
      </label>
      <label>
        <span>Valor total</span>
        <input
          className="field-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
      </label>
      <label>
        <span>Parcelas</span>
        <input
          className="field-input"
          type="number"
          min={1}
          max={36}
          value={installments}
          onChange={(e) => setInstallments(Math.max(1, Number(e.target.value)))}
        />
      </label>
      <label>
        <span>1º vencimento</span>
        <input
          className="field-input"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </label>
      <div className="settle-actions">
        <button
          className="primary-button"
          type="submit"
          disabled={
            create.isPending ||
            !customerId ||
            description.trim().length < 3 ||
            toNumber(amount) <= 0
          }
        >
          {create.isPending ? 'Criando…' : 'Criar título'}
        </button>
      </div>
    </form>
  );
}

// ----------------------------------------------------------------- A pagar

function Pagar({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'aberto' | 'vencido' | 'todos'>('aberto');
  const [search, setSearch] = useState('');
  const [settling, setSettling] = useState<Payable | null>(null);
  const [creating, setCreating] = useState(false);
  const [erro, setErro] = useState('');

  const titles = useQuery({
    queryKey: ['finance', 'payables', filter, search],
    queryFn: () =>
      financeApi.payables({
        status: filter === 'aberto' ? 'ABERTO' : undefined,
        overdue: filter === 'vencido',
        search: search.trim() || undefined,
      }),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['finance'] });
    queryClient.invalidateQueries({ queryKey: ['cash'] });
  };

  const settle = useMutation({
    mutationFn: (data: { amount: number; method: PaymentMethod; note?: string }) =>
      financeApi.settlePayable(settling!.id, data),
    onSuccess: () => {
      setSettling(null);
      setErro('');
      invalidate();
    },
    onError: (e: Error) => setErro(e.message),
  });

  const cancel = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      financeApi.cancelPayable(id, reason),
    onSuccess: invalidate,
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <section className="panel">
      <div className="toolbar">
        <div className="report-presets">
          {(['aberto', 'vencido', 'todos'] as const).map((f) => (
            <button
              key={f}
              type="button"
              className={`pill-button ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f === 'aberto' ? 'Em aberto' : f === 'vencido' ? 'Vencidas' : 'Todas'}
            </button>
          ))}
        </div>
        <input
          className="field-input"
          placeholder="Buscar por descrição, categoria ou fornecedor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManage ? (
          <button className="primary-button" onClick={() => setCreating((c) => !c)}>
            {creating ? 'Fechar' : 'Nova despesa'}
          </button>
        ) : null}
      </div>

      {erro ? <p className="form-error">{erro}</p> : null}

      {creating ? (
        <NovaDespesa
          onDone={() => {
            setCreating(false);
            invalidate();
          }}
          onError={setErro}
        />
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Descrição</th>
              <th>Categoria</th>
              <th>Fornecedor</th>
              <th>Vencimento</th>
              <th className="ta-right">Valor</th>
              <th className="ta-right">Saldo</th>
              <th>Situação</th>
              {canManage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {(titles.data ?? []).map((t) => (
              <tr key={t.id} className={isOverdue(t) ? 'row-late' : ''}>
                <td>{t.number}</td>
                <td>
                  {t.description}
                  {t.recurrence !== 'NENHUMA' ? (
                    <small className="muted"> · {RECURRENCES.find((r) => r.value === t.recurrence)?.label}</small>
                  ) : null}
                </td>
                <td>{t.category}</td>
                <td>{t.supplier?.name ?? '—'}</td>
                <td>{dateOnly(t.dueDate)}</td>
                <td className="ta-right">{brl(t.amount)}</td>
                <td className="ta-right">{brl(t.amount - t.paidAmount)}</td>
                <td>
                  <span className={`tag ${STATUS_TAG[t.status]}`}>
                    {isOverdue(t) ? 'Vencida' : STATUS_LABEL[t.status]}
                  </span>
                </td>
                {canManage ? (
                  <td className="ta-right">
                    {t.status === 'ABERTO' || t.status === 'PARCIAL' ? (
                      <>
                        <button className="mini-button" onClick={() => setSettling(t)}>
                          Pagar
                        </button>
                        <button
                          className="mini-button"
                          onClick={() => {
                            const reason = prompt('Motivo do cancelamento da despesa:');
                            if (reason && reason.trim().length >= 3) {
                              cancel.mutate({ id: t.id, reason: reason.trim() });
                            }
                          }}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : null}
                  </td>
                ) : null}
              </tr>
            ))}
            {titles.data && titles.data.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 9 : 8} className="muted">
                  Nenhuma despesa nesta faixa.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {settling ? (
        <div className="panel settle-panel">
          <div className="panel-header">
            <h2>
              Pagar #{settling.number} — {settling.description}
            </h2>
            {settling.recurrence !== 'NENHUMA' ? (
              <small className="muted">
                Ao quitar, a próxima competência é criada automaticamente.
              </small>
            ) : null}
          </div>
          <SettleForm
            saldo={settling.amount - settling.paidAmount}
            busy={settle.isPending}
            onSubmit={(data) => settle.mutate(data)}
            onCancel={() => setSettling(null)}
          />
        </div>
      ) : null}
    </section>
  );
}

function NovaDespesa({
  onDone,
  onError,
}: {
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState(dateInput());
  const [recurrence, setRecurrence] = useState<PayableRecurrence>('NENHUMA');

  const suppliers = useQuery({ queryKey: ['finance', 'suppliers'], queryFn: () => financeApi.suppliers() });
  const categories = useQuery({
    queryKey: ['finance', 'payable-categories'],
    queryFn: financeApi.payableCategories,
  });

  const create = useMutation({
    mutationFn: () =>
      financeApi.createPayable({
        description: description.trim(),
        category: category.trim() || undefined,
        supplierId: supplierId || undefined,
        amount: toNumber(amount),
        dueDate: new Date(`${dueDate}T12:00:00`).toISOString(),
        recurrence,
      }),
    onSuccess: onDone,
    onError: (e: Error) => onError(e.message),
  });

  return (
    <form
      className="finance-form"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <label>
        <span>Descrição</span>
        <input
          className="field-input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Aluguel de outubro, energia…"
        />
      </label>
      <label>
        <span>Categoria</span>
        <input
          className="field-input"
          list="payable-categories"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Geral"
        />
        <datalist id="payable-categories">
          {(categories.data ?? []).map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
      </label>
      <label>
        <span>Fornecedor</span>
        <select
          className="field-input"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
        >
          <option value="">Sem fornecedor</option>
          {(suppliers.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>Valor</span>
        <input
          className="field-input"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          inputMode="decimal"
        />
      </label>
      <label>
        <span>Vencimento</span>
        <input
          className="field-input"
          type="date"
          value={dueDate}
          onChange={(e) => setDueDate(e.target.value)}
        />
      </label>
      <label>
        <span>Repetição</span>
        <select
          className="field-input"
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value as PayableRecurrence)}
        >
          {RECURRENCES.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <div className="settle-actions">
        <button
          className="primary-button"
          type="submit"
          disabled={create.isPending || description.trim().length < 3 || toNumber(amount) <= 0}
        >
          {create.isPending ? 'Criando…' : 'Criar despesa'}
        </button>
      </div>
      <p className="muted settle-hint">
        Despesa que se repete gera a próxima competência quando esta for quitada — não doze de uma
        vez, para a projeção de caixa não mentir.
      </p>
    </form>
  );
}

// ----------------------------------------------------------- Fornecedores

function Fornecedores({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<Partial<Supplier> | null>(null);
  const [erro, setErro] = useState('');

  const list = useQuery({
    queryKey: ['finance', 'suppliers', search],
    queryFn: () => financeApi.suppliers(search || undefined),
  });

  const save = useMutation({
    mutationFn: () =>
      form?.id
        ? financeApi.updateSupplier(form.id, form)
        : financeApi.createSupplier(form ?? {}),
    onSuccess: () => {
      setForm(null);
      setErro('');
      queryClient.invalidateQueries({ queryKey: ['finance', 'suppliers'] });
    },
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <section className="panel">
      <div className="toolbar">
        <input
          className="field-input"
          placeholder="Buscar fornecedor"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {canManage ? (
          <button className="primary-button" onClick={() => setForm({ name: '' })}>
            Novo fornecedor
          </button>
        ) : null}
      </div>

      {erro ? <p className="form-error">{erro}</p> : null}

      {form ? (
        <form
          className="finance-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label>
            <span>Nome</span>
            <input
              className="field-input"
              value={form.name ?? ''}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            <span>CNPJ / CPF</span>
            <input
              className="field-input"
              value={form.document ?? ''}
              onChange={(e) => setForm({ ...form, document: e.target.value })}
            />
          </label>
          <label>
            <span>Telefone</span>
            <input
              className="field-input"
              value={form.phone ?? ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </label>
          <label>
            <span>E-mail</span>
            <input
              className="field-input"
              value={form.email ?? ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </label>
          <div className="settle-actions">
            <button className="ghost-button" type="button" onClick={() => setForm(null)}>
              Cancelar
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={save.isPending || (form.name ?? '').trim().length < 2}
            >
              {save.isPending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </form>
      ) : null}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Documento</th>
              <th>Telefone</th>
              <th>E-mail</th>
              {canManage ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.document ?? '—'}</td>
                <td>{s.phone ?? '—'}</td>
                <td>{s.email ?? '—'}</td>
                {canManage ? (
                  <td className="ta-right">
                    <button className="mini-button" onClick={() => setForm(s)}>
                      Editar
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
            {list.data && list.data.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="muted">
                  Nenhum fornecedor cadastrado.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------- Página

/**
 * Fechamento do dia.
 *
 * O X/Z fecha um turno; esta aba fecha o dia da loja. Ela mostra sempre duas
 * coisas ao mesmo tempo: o retrato gravado no fechamento (se já houve) e a
 * prévia calculada agora. Quando os dois divergem, é porque alguma coisa se
 * mexeu depois do fechamento — e é exatamente isso que o gerente precisa ver,
 * em vez de um número recalculado que apaga a diferença.
 */
function Fechamento({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(() => dateInput());
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const status = useQuery({
    queryKey: ['finance', 'day', date],
    queryFn: () => financeApi.dayStatus(date),
  });
  const history = useQuery({
    queryKey: ['finance', 'day', 'history'],
    queryFn: financeApi.dayHistory,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['finance', 'day'] });
    void queryClient.invalidateQueries({ queryKey: ['cash'] });
  };

  const close = useMutation({
    mutationFn: () =>
      financeApi.closeDay({
        date,
        countedCash: counted ? toNumber(counted) : undefined,
        notes: notes || undefined,
      }),
    onSuccess: () => {
      setCounted('');
      setNotes('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const reopen = useMutation({
    mutationFn: () => financeApi.reopenDay(date, reason),
    onSuccess: () => {
      setReason('');
      setError(null);
      invalidate();
    },
    onError: (e: Error) => setError(e.message),
  });

  const data = status.data;
  const preview = data?.preview;
  const closing = data?.closing;
  const blockers = data?.blockers ?? [];

  return (
    <>
      <div className="toolbar">
        <label className="report-date">
          <span>Dia</span>
          <input
            type="date"
            value={date}
            max={dateInput()}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        {closing ? (
          <span className={`tag ${closing.status === 'FECHADO' ? 'tag-success' : 'tag-warning'}`}>
            {closing.status === 'FECHADO' ? 'Dia fechado' : 'Dia reaberto'}
            {closing.version > 1 ? ` · ${closing.version}ª vez` : ''}
          </span>
        ) : (
          <span className="tag">Dia em aberto</span>
        )}
      </div>

      {status.isLoading ? <p className="muted">Carregando…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}

      {preview ? (
        <>
          <div className="stats-grid">
            <Kpi
              label="Vendido no dia"
              value={brl(preview.totals.salesTotal)}
              hint={`${preview.totals.salesCount} venda(s) em ${preview.totals.sessions} turno(s)`}
            />
            <Kpi
              label="Entrou em espécie"
              value={brl(preview.totals.cashSales)}
              hint={`Sangrias ${brl(preview.totals.sangrias)} · suprimentos ${brl(
                preview.totals.suprimentos,
              )}`}
            />
            <Kpi
              label="Diferença de gaveta"
              value={brl(preview.totals.difference)}
              tone={toNumber(preview.totals.difference) === 0 ? 'ok' : 'warn'}
              hint="Soma dos turnos já fechados"
            />
            <Kpi
              label="Líquido do dia"
              value={brl(preview.movimento.liquido)}
              hint="Vendas + recebimentos − devoluções − despesas pagas"
            />
          </div>

          <div className="finance-columns">
            <section className="panel">
              <div className="panel-header">
                <h2>Movimento do dia</h2>
              </div>
              <ul className="list-rows">
                <li>
                  <span>Vendas</span>
                  <strong>{brl(preview.totals.salesTotal)}</strong>
                </li>
                <li>
                  <span>
                    Recebimentos de crediário{' '}
                    <small>× {preview.movimento.recebimentosCount}</small>
                  </span>
                  <strong>{brl(preview.movimento.recebimentos)}</strong>
                </li>
                <li>
                  <span>
                    Devoluções <small>× {preview.movimento.devolucoesCount}</small>
                  </span>
                  <strong className="text-warning">
                    −{brl(preview.movimento.devolucoes)}
                  </strong>
                </li>
                <li>
                  <span>
                    Despesas pagas <small>× {preview.movimento.despesasCount}</small>
                  </span>
                  <strong className="text-warning">−{brl(preview.movimento.despesas)}</strong>
                </li>
                <li>
                  <span>= Líquido</span>
                  <strong>{brl(preview.movimento.liquido)}</strong>
                </li>
              </ul>

              <h3 className="day-sub">Por forma de pagamento</h3>
              {preview.byPaymentMethod.length === 0 ? (
                <p className="muted">Nenhum pagamento no dia.</p>
              ) : (
                <ul className="list-rows">
                  {preview.byPaymentMethod.map((p) => (
                    <li key={p.method}>
                      <span>
                        {paymentLabel[p.method] ?? p.method} <small>× {p.count}</small>
                      </span>
                      <strong>{brl(p.amount)}</strong>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="panel">
              <div className="panel-header">
                <h2>Turnos</h2>
              </div>
              {!data?.canSeeOperators ? (
                <p className="muted">
                  O detalhe por turno e operador exige a permissão de consolidado de caixas.
                </p>
              ) : preview.sessions.length === 0 ? (
                <p className="muted">Nenhum turno de caixa neste dia.</p>
              ) : (
                <ul className="list-rows">
                  {preview.sessions.map((s) => (
                    <li key={s.id}>
                      <span>
                        {s.operator.name}
                        <small>
                          {' '}
                          — {s.terminal ?? 'sem terminal'}
                          {s.status === 'ABERTA' ? ' · aberto' : ''}
                        </small>
                      </span>
                      <strong
                        className={
                          s.difference != null && toNumber(s.difference) !== 0
                            ? 'text-warning'
                            : ''
                        }
                      >
                        {brl(s.salesTotal)}
                        {s.difference != null && toNumber(s.difference) !== 0
                          ? ` (${brl(s.difference)})`
                          : ''}
                      </strong>
                    </li>
                  ))}
                </ul>
              )}

              {blockers.length > 0 ? (
                <p className="text-warning" style={{ marginTop: 12 }}>
                  <strong>Turno aberto.</strong>{' '}
                  {blockers
                    .map((b) => `${b.operator} (${b.terminal ?? 'sem terminal'})`)
                    .join(', ')}{' '}
                  ainda não fechou o caixa. O dia só fecha depois da contagem de todas as
                  gavetas.
                </p>
              ) : null}
            </section>
          </div>

          {closing ? (
            <section className="panel">
              <div className="panel-header">
                <h2>Retrato do fechamento</h2>
                <small className="muted">
                  {closing.closedBy?.name ?? '—'} · {dateTime(closing.closedAt)}
                </small>
              </div>
              <ul className="list-rows">
                <li>
                  <span>Vendido (no fechamento)</span>
                  <strong>{brl(closing.totalSales)}</strong>
                </li>
                <li>
                  <span>Diferença de gaveta (no fechamento)</span>
                  <strong>{brl(closing.cashDifference)}</strong>
                </li>
                <li>
                  <span>Turnos consolidados</span>
                  <strong>{closing.sessionCount}</strong>
                </li>
              </ul>
              {toNumber(closing.totalSales) !== toNumber(preview.totals.salesTotal) ? (
                <p className="text-warning" style={{ marginTop: 8 }}>
                  O total de hoje ({brl(preview.totals.salesTotal)}) não bate com o que foi
                  conferido no fechamento ({brl(closing.totalSales)}): algo se mexeu depois.
                </p>
              ) : null}
              {closing.notes ? <p className="muted">{closing.notes}</p> : null}
              {closing.reopenReason ? (
                <p className="muted">
                  Reaberto por {closing.reopenedBy?.name ?? '—'} em{' '}
                  {closing.reopenedAt ? dateTime(closing.reopenedAt) : '—'}:{' '}
                  {closing.reopenReason}
                </p>
              ) : null}
            </section>
          ) : null}

          {canManage ? (
            <section className="panel">
              <div className="panel-header">
                <h2>{data?.locked ? 'Reabrir o dia' : 'Fechar o dia'}</h2>
              </div>
              {data?.locked ? (
                <>
                  <p className="muted">
                    O dia está travado: nenhum caixa novo abre enquanto ele estiver fechado.
                    Reabrir exige justificativa e fica registrado na trilha de auditoria.
                  </p>
                  <label className="field">
                    <span>Motivo da reabertura</span>
                    <input
                      value={reason}
                      maxLength={300}
                      placeholder="Ex.: lançamento de despesa esquecido"
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <button
                    className="danger-button"
                    disabled={reason.trim().length < 5 || reopen.isPending}
                    onClick={() => reopen.mutate()}
                  >
                    {reopen.isPending ? 'Reabrindo…' : 'Reabrir o dia'}
                  </button>
                </>
              ) : (
                <>
                  <label className="field">
                    <span>Total em espécie conferido (opcional)</span>
                    <input
                      inputMode="decimal"
                      value={counted}
                      placeholder={String(preview.totals.counted)}
                      onChange={(e) => setCounted(e.target.value)}
                    />
                    <small className="muted">
                      Se preenchido, precisa bater com a soma das contagens dos turnos
                      ({brl(preview.totals.counted)}) — senão o fechamento é recusado.
                    </small>
                  </label>
                  <label className="field">
                    <span>Observações</span>
                    <input value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
                  </label>
                  <button
                    className="primary-button"
                    disabled={
                      close.isPending || blockers.length > 0 || preview.totals.sessions === 0
                    }
                    onClick={() => close.mutate()}
                  >
                    {close.isPending ? 'Fechando…' : 'Fechar o dia'}
                  </button>
                </>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      <section className="panel">
        <div className="panel-header">
          <h2>Últimos fechamentos</h2>
        </div>
        {!history.data || history.data.length === 0 ? (
          <p className="muted">Nenhum dia fechado ainda.</p>
        ) : (
          <ul className="list-rows">
            {history.data.map((c) => (
              <li key={c.id}>
                <span>
                  <button type="button" className="ghost-button ghost-button-inline" onClick={() => setDate(c.date)}>
                    {dayLabelBr(c.date)}
                  </button>
                  <small>
                    {' '}
                    — {c.closedBy?.name ?? '—'} · {c.sessionCount} turno(s)
                    {c.status === 'REABERTO' ? ' · reaberto' : ''}
                  </small>
                </span>
                <strong>{brl(c.totalSales)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export function FinancePage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canReceivables = permissions.includes('finance.receivables.manage');
  const canPayables = permissions.includes('finance.payables.manage');
  const canCloseDay = permissions.includes('finance.dailyClosing.manage');

  const [tab, setTab] = useState<Tab>('painel');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    return dateInput(new Date(d.getFullYear(), d.getMonth(), 1));
  });
  const [to, setTo] = useState(() => dateInput());

  const overview = useQuery({ queryKey: ['finance', 'overview'], queryFn: financeApi.overview });
  const cashflow = useQuery({
    queryKey: ['finance', 'cashflow', from, to],
    queryFn: () => financeApi.cashflow(from, to),
    enabled: tab === 'painel',
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1>Contas e fluxo de caixa</h1>
        </div>
        {overview.data ? (
          <div className="header-tags">
            <span className="tag">
              A receber {brl(overview.data.receivables.totalOpen)}
            </span>
            <span className="tag tag-warning">
              A pagar {brl(overview.data.payables.totalOpen)}
            </span>
          </div>
        ) : null}
      </div>

      <nav className="report-tabs" aria-label="Seções do financeiro">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={`pill-button ${tab === t.key ? 'active' : ''}`}
            aria-current={tab === t.key ? 'page' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <p className="muted report-hint">{TABS.find((t) => t.key === tab)?.hint}</p>

      {tab === 'painel' ? (
        <>
          <div className="toolbar">
            <label className="report-date">
              <span>De</span>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label className="report-date">
              <span>Até</span>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          {cashflow.isLoading ? <p className="muted">Carregando…</p> : null}
          {cashflow.error ? (
            <p className="form-error">{(cashflow.error as Error).message}</p>
          ) : null}
          {cashflow.data ? <Painel report={cashflow.data} /> : null}
        </>
      ) : null}

      {tab === 'fechamento' ? <Fechamento canManage={canCloseDay} /> : null}
      {tab === 'receber' ? <Receber canManage={canReceivables} /> : null}
      {tab === 'pagar' ? <Pagar canManage={canPayables} /> : null}
      {tab === 'fornecedores' ? <Fornecedores canManage={canPayables} /> : null}
    </Layout>
  );
}
