import './FinancePage.css';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { SpotlightCard } from '../components/SpotlightCard';
import { StatusBadge, type BadgeTone } from '../components/StatusBadge';
import { FINANCE_ICONS, type FinanceIcon } from '../components/finance-icons';
import {
  customersApi,
  financeApi,
  type Aging,
  type CashflowReport,
  type Payable,
  type PayableRecurrence,
  type PaymentMethod,
  type Receivable,
  type Supplier,
  type TitleStatus,
} from '../lib/api-client';
import { downloadText, toCsv } from '../lib/download';
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

const STATUS_TONE: Record<TitleStatus, BadgeTone> = {
  ABERTO: 'neutral',
  PARCIAL: 'warning',
  PAGO: 'success',
  CANCELADO: 'neutral',
};

const STATUS_LABEL: Record<TitleStatus, string> = {
  ABERTO: 'Em aberto',
  PARCIAL: 'Parcial',
  PAGO: 'Pago',
  CANCELADO: 'Cancelado',
};

const isOpen = (t: { status: TitleStatus }) => t.status === 'ABERTO' || t.status === 'PARCIAL';

const isOverdue = (t: { status: TitleStatus; dueDate: string }) =>
  isOpen(t) && new Date(t.dueDate) < new Date();

/**
 * Situação do título como etiqueta.
 *
 * "Vencido" não é um status do banco — é ABERTO/PARCIAL com a data já passada.
 * Quem está na lista precisa ver isso antes de ler a coluna de vencimento, e é
 * a única situação que ganha o tom de alerta.
 */
function TitleStatusBadge({
  title,
  overdueLabel,
}: {
  title: { status: TitleStatus; dueDate: string };
  overdueLabel: string;
}) {
  if (isOverdue(title)) return <StatusBadge tone="danger" label={overdueLabel} live />;
  return (
    <StatusBadge
      tone={STATUS_TONE[title.status]}
      label={STATUS_LABEL[title.status]}
      live={isOpen(title)}
    />
  );
}

// --------------------------------------------------------- Faixa de números

type Metric = {
  key: string;
  icon: FinanceIcon;
  tone: 'blue' | 'rose' | 'amber' | 'emerald';
  label: string;
  value: string;
  hint?: string;
};

/**
 * Faixa de indicadores acima da lista.
 *
 * Quatro leituras da carteira inteira e, no fim, um cartão em destaque com o
 * total do recorte que está na tela — ou da seleção, quando existe uma. É esse
 * quinto cartão que amarra a faixa à tabela: os quatro primeiros não mudam com
 * o filtro, ele muda.
 */
function MetricStrip({ metrics, hero }: { metrics: Metric[]; hero: Metric }) {
  const HeroIcon = FINANCE_ICONS[hero.icon];
  return (
    <div className="metric-strip">
      {metrics.map((m) => {
        const Icon = FINANCE_ICONS[m.icon];
        return (
          <SpotlightCard key={m.key} className={`metric-card metric-${m.tone}`}>
            <span className="metric-icon" aria-hidden="true">
              <Icon />
            </span>
            <span className="metric-label">{m.label}</span>
            <strong className="metric-value">{m.value}</strong>
            {m.hint ? <small className="metric-hint">{m.hint}</small> : null}
          </SpotlightCard>
        );
      })}
      <article className="metric-card metric-hero">
        <span className="metric-icon" aria-hidden="true">
          <HeroIcon />
        </span>
        <span className="metric-label">{hero.label}</span>
        <strong className="metric-value">{hero.value}</strong>
        {hero.hint ? <small className="metric-hint">{hero.hint}</small> : null}
      </article>
    </div>
  );
}

function agingMetrics(aging: Aging, extra: Metric): Metric[] {
  return [
    {
      key: 'vencido',
      icon: 'vencido',
      tone: 'rose',
      label: 'Vencido',
      value: brl(aging.vencido),
    },
    {
      key: 'ate7',
      icon: 'prazo',
      tone: 'amber',
      label: 'Vence em 7 dias',
      value: brl(aging.ate7),
    },
    {
      key: 'ate30',
      icon: 'carteira',
      tone: 'emerald',
      label: 'Vence em 30 dias',
      value: brl(aging.ate30),
    },
    extra,
  ];
}

// -------------------------------------------------------------- Seleção

/**
 * Seleção de linhas da tabela.
 *
 * A lista muda debaixo da seleção o tempo todo — o filtro troca, a busca
 * corta, uma baixa some com o título. Por isso o que vale é sempre o cruzamento
 * do que foi marcado com o que ainda está na tela: um id que saiu da lista não
 * pode continuar contando na barra de ações nem entrar numa ação em massa.
 */
function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [marked, setMarked] = useState<string[]>([]);

  const selected = useMemo(() => {
    const onScreen = new Set(rows.map((r) => r.id));
    return marked.filter((id) => onScreen.has(id));
  }, [marked, rows]);

  const selectedRows = useMemo(() => {
    const chosen = new Set(selected);
    return rows.filter((r) => chosen.has(r.id));
  }, [rows, selected]);

  return {
    selected,
    selectedRows,
    isSelected: (id: string) => selected.includes(id),
    toggle: (id: string) =>
      setMarked((current) =>
        current.includes(id) ? current.filter((i) => i !== id) : [...current, id],
      ),
    toggleAll: () =>
      setMarked(selected.length === rows.length ? [] : rows.map((r) => r.id)),
    clear: () => setMarked([]),
    allSelected: rows.length > 0 && selected.length === rows.length,
    someSelected: selected.length > 0 && selected.length < rows.length,
  };
}

/** Caixa do cabeçalho: marcada, vazia ou "parte da lista" (traço). */
function SelectAllBox({
  allSelected,
  someSelected,
  onToggle,
  disabled,
}: {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // `indeterminate` não existe como atributo HTML: só se escreve na propriedade.
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={allSelected}
      disabled={disabled}
      onChange={onToggle}
      aria-label={allSelected ? 'Desmarcar todos' : 'Marcar todos'}
    />
  );
}

/**
 * Barra de ações em massa.
 *
 * Aparece presa acima da tabela quando existe seleção e some quando não existe:
 * uma barra sempre visível com "0 selecionados" é uma linha de ruído que o
 * operador aprende a ignorar.
 */
function BulkBar({
  count,
  children,
  onClear,
}: {
  count: number;
  children: ReactNode;
  onClear: () => void;
}) {
  if (count === 0) return null;
  return (
    <div className="bulk-bar" role="status">
      <strong className="bulk-count">
        {count} <span>selecionado{count > 1 ? 's' : ''}</span>
      </strong>
      <div className="bulk-actions">
        {children}
        <button type="button" className="bulk-action" onClick={onClear}>
          Limpar
        </button>
      </div>
    </div>
  );
}

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
            hint={r.itensSemCusto > 0 ? `${num(r.itensSemCusto)} itens sem custo cadastrado` : 'estimado pelo custo atual'}
          />
          <Kpi label="Margem bruta" value={brl(r.margemBruta)} hint={`${num(r.margemPercent, 1)}% da receita`} />
          <Kpi label="Despesas pagas" value={brl(r.despesas)} />
          <Kpi
            label="Resultado"
            value={brl(r.resultado)}
            tone={r.resultado >= 0 ? 'ok' : 'warn'}
            hint="margem bruta menos despesas"
          />
        </div>
        <p className="muted finance-note">
          A margem é <strong>estimativa</strong>: o custo usado é o cadastrado hoje no produto, não o
          do dia da venda. Serve para decidir preço, não para fechamento contábil.
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

function Receber({
  canManage,
  search,
  creating,
  onCloseCreate,
  aging,
  carteira,
}: {
  canManage: boolean;
  search: string;
  creating: boolean;
  onCloseCreate: () => void;
  aging: Aging | undefined;
  carteira: { totalOpen: number; titles: number; customers: number } | undefined;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'aberto' | 'vencido' | 'todos'>('aberto');
  const [settling, setSettling] = useState<Receivable | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

  const titles = useQuery({
    queryKey: ['finance', 'receivables', filter, search],
    queryFn: () =>
      financeApi.receivables({
        status: filter === 'aberto' ? 'ABERTO' : undefined,
        overdue: filter === 'vencido',
        search: search.trim() || undefined,
      }),
  });

  const rows = useMemo(() => titles.data ?? [], [titles.data]);
  const selection = useRowSelection(rows);

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

  /**
   * Cancelamento em massa.
   *
   * Só entram os títulos que ainda podem ser cancelados: um pago ou já
   * cancelado na seleção seria recusado pelo servidor e o operador acharia que
   * a operação inteira falhou. O motivo é um só para o lote — é o que vai para
   * a trilha de auditoria de cada título.
   */
  const cancelarSelecionados = async () => {
    const alvos = selection.selectedRows.filter(isOpen);
    if (alvos.length === 0) {
      setErro('Nenhum título selecionado pode ser cancelado: pago ou já cancelado.');
      return;
    }
    const reason = prompt(`Motivo do cancelamento de ${alvos.length} título(s):`);
    if (!reason || reason.trim().length < 3) return;

    setErro('');
    setAviso('');
    const falhas: number[] = [];
    for (const t of alvos) {
      try {
        await financeApi.cancelReceivable(t.id, reason.trim());
      } catch {
        falhas.push(t.number);
      }
    }
    selection.clear();
    invalidate();
    if (falhas.length > 0) {
      setErro(
        `${alvos.length - falhas.length} de ${alvos.length} cancelados. ` +
          `Falharam: ${falhas.join(', ')}.`,
      );
    } else {
      setAviso(`${alvos.length} título(s) cancelado(s).`);
    }
  };

  const exportarSelecionados = () => {
    const linhas: (string | number)[][] = [
      ['Numero', 'Cliente', 'Descricao', 'Parcela', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Situacao'],
      ...selection.selectedRows.map((t) => [
        t.number,
        t.customer.name,
        t.description,
        `${t.installment}/${t.installments}`,
        dateOnly(t.dueDate),
        num(t.amount, 2),
        num(t.paidAmount, 2),
        num(t.amount - t.paidAmount, 2),
        isOverdue(t) ? 'Vencido' : STATUS_LABEL[t.status],
      ]),
    ];
    downloadText(`a-receber-${dateInput()}.csv`, toCsv(linhas));
    setAviso(`${selection.selected.length} título(s) exportado(s).`);
  };

  const saldoDe = (list: Receivable[]) =>
    list.filter(isOpen).reduce((acc, t) => acc + (t.amount - t.paidAmount), 0);

  const temSelecao = selection.selected.length > 0;
  const hero: Metric = {
    key: 'recorte',
    icon: 'recorte',
    tone: 'blue',
    label: temSelecao ? 'Selecionados' : 'Nesta lista',
    value: brl(saldoDe(temSelecao ? selection.selectedRows : rows)),
    hint: temSelecao
      ? `${selection.selected.length} de ${rows.length} título(s)`
      : `${rows.length} título(s) em aberto no recorte`,
  };

  return (
    <>
      {aging && carteira ? (
        <MetricStrip
          metrics={agingMetrics(aging, {
            key: 'clientes',
            icon: 'clientes',
            tone: 'emerald',
            label: 'Clientes devendo',
            value: num(carteira.customers),
            hint: `${num(carteira.titles)} título(s) · ${brl(carteira.totalOpen)}`,
          })}
          hero={hero}
        />
      ) : null}

      <section className="panel list-panel">
        <div className="list-toolbar">
          <div className="report-presets" role="group" aria-label="Filtrar por situação">
            {(['aberto', 'vencido', 'todos'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`pill-button ${filter === f ? 'active' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'aberto' ? 'Em aberto' : f === 'vencido' ? 'Vencidos' : 'Todos'}
              </button>
            ))}
          </div>
          {titles.isFetching ? <small className="muted">Atualizando…</small> : null}
        </div>

        {erro ? <p className="form-error">{erro}</p> : null}
        {aviso ? <p className="success-message">{aviso}</p> : null}

        {creating ? (
          <NovoTitulo
            onDone={() => {
              onCloseCreate();
              invalidate();
            }}
            onError={setErro}
          />
        ) : null}

        <BulkBar count={selection.selected.length} onClear={selection.clear}>
          <button type="button" className="bulk-action" onClick={exportarSelecionados}>
            Exportar CSV
          </button>
          {canManage ? (
            <button type="button" className="bulk-action danger" onClick={cancelarSelecionados}>
              Cancelar títulos
            </button>
          ) : null}
        </BulkBar>

        <div className="table-scroll">
          <table className="data-table invoice-table">
            <thead>
              <tr>
                <th className="col-check">
                  <SelectAllBox
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggle={selection.toggleAll}
                    disabled={rows.length === 0}
                  />
                </th>
                <th>Título</th>
                <th>Cliente</th>
                <th>Descrição</th>
                <th>Vencimento</th>
                <th className="ta-right">Valor</th>
                <th className="ta-right">Saldo</th>
                <th>Situação</th>
                {canManage ? <th className="ta-right">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const saldo = t.amount - t.paidAmount;
                const marcado = selection.isSelected(t.id);
                return (
                  <tr
                    key={t.id}
                    className={[isOverdue(t) ? 'row-late' : '', marcado ? 'row-selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => selection.toggle(t.id)}
                        aria-label={`Selecionar título ${t.number} de ${t.customer.name}`}
                      />
                    </td>
                    <td>
                      <span className="cell-id">#{t.number}</span>
                      {t.installments > 1 ? (
                        <small className="cell-sub">
                          {t.installment}/{t.installments}
                        </small>
                      ) : null}
                    </td>
                    <td className="cell-name">{t.customer.name}</td>
                    <td className="cell-desc">{t.description}</td>
                    <td className="cell-date">{dateOnly(t.dueDate)}</td>
                    <td className="ta-right">{brl(t.amount)}</td>
                    <td className="ta-right cell-amount">{brl(saldo)}</td>
                    <td>
                      <TitleStatusBadge title={t} overdueLabel="Vencido" />
                    </td>
                    {canManage ? (
                      <td className="ta-right">
                        {isOpen(t) ? (
                          <div className="row-actions">
                            <button className="mini-button" onClick={() => setSettling(t)}>
                              Receber
                            </button>
                            <button
                              className="mini-button danger"
                              onClick={() => {
                                const reason = prompt('Motivo do cancelamento do título:');
                                if (reason && reason.trim().length >= 3) {
                                  cancel.mutate({ id: t.id, reason: reason.trim() });
                                }
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {titles.data && rows.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 9 : 8} className="table-empty muted">
                    {search
                      ? `Nenhum título para "${search}" nesta faixa.`
                      : 'Nenhum título nesta faixa.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
    </>
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

function Pagar({
  canManage,
  search,
  creating,
  onCloseCreate,
  aging,
  carteira,
}: {
  canManage: boolean;
  search: string;
  creating: boolean;
  onCloseCreate: () => void;
  aging: Aging | undefined;
  carteira: { totalOpen: number; titles: number } | undefined;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'aberto' | 'vencido' | 'todos'>('aberto');
  const [settling, setSettling] = useState<Payable | null>(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');

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

  const rows = useMemo(() => titles.data ?? [], [titles.data]);
  const selection = useRowSelection(rows);

  const exportarSelecionados = () => {
    const linhas: (string | number)[][] = [
      ['Numero', 'Descricao', 'Categoria', 'Fornecedor', 'Vencimento', 'Valor', 'Pago', 'Saldo', 'Situacao'],
      ...selection.selectedRows.map((t) => [
        t.number,
        t.description,
        t.category,
        t.supplier?.name ?? '',
        dateOnly(t.dueDate),
        num(t.amount, 2),
        num(t.paidAmount, 2),
        num(t.amount - t.paidAmount, 2),
        isOverdue(t) ? 'Vencida' : STATUS_LABEL[t.status],
      ]),
    ];
    downloadText(`a-pagar-${dateInput()}.csv`, toCsv(linhas));
    setAviso(`${selection.selected.length} despesa(s) exportada(s).`);
  };

  const saldoDe = (list: Payable[]) =>
    list.filter(isOpen).reduce((acc, t) => acc + (t.amount - t.paidAmount), 0);

  const temSelecao = selection.selected.length > 0;
  const hero: Metric = {
    key: 'recorte',
    icon: 'recorte',
    tone: 'blue',
    label: temSelecao ? 'Selecionadas' : 'Nesta lista',
    value: brl(saldoDe(temSelecao ? selection.selectedRows : rows)),
    hint: temSelecao
      ? `${selection.selected.length} de ${rows.length} despesa(s)`
      : `${rows.length} despesa(s) em aberto no recorte`,
  };

  return (
    <>
      {aging && carteira ? (
        <MetricStrip
          metrics={agingMetrics(aging, {
            key: 'carteira',
            icon: 'carteira',
            tone: 'emerald',
            label: 'Total em aberto',
            value: brl(carteira.totalOpen),
            hint: `${num(carteira.titles)} despesa(s)`,
          })}
          hero={hero}
        />
      ) : null}

      <section className="panel list-panel">
        <div className="list-toolbar">
          <div className="report-presets" role="group" aria-label="Filtrar por situação">
            {(['aberto', 'vencido', 'todos'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={`pill-button ${filter === f ? 'active' : ''}`}
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
              >
                {f === 'aberto' ? 'Em aberto' : f === 'vencido' ? 'Vencidas' : 'Todas'}
              </button>
            ))}
          </div>
          {titles.isFetching ? <small className="muted">Atualizando…</small> : null}
        </div>

        {erro ? <p className="form-error">{erro}</p> : null}
        {aviso ? <p className="success-message">{aviso}</p> : null}

        {creating ? (
          <NovaDespesa
            onDone={() => {
              onCloseCreate();
              invalidate();
            }}
            onError={setErro}
          />
        ) : null}

        <BulkBar count={selection.selected.length} onClear={selection.clear}>
          <button type="button" className="bulk-action" onClick={exportarSelecionados}>
            Exportar CSV
          </button>
        </BulkBar>

        <div className="table-scroll">
          <table className="data-table invoice-table">
            <thead>
              <tr>
                <th className="col-check">
                  <SelectAllBox
                    allSelected={selection.allSelected}
                    someSelected={selection.someSelected}
                    onToggle={selection.toggleAll}
                    disabled={rows.length === 0}
                  />
                </th>
                <th>Despesa</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Fornecedor</th>
                <th>Vencimento</th>
                <th className="ta-right">Valor</th>
                <th className="ta-right">Saldo</th>
                <th>Situação</th>
                {canManage ? <th className="ta-right">Ações</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const marcado = selection.isSelected(t.id);
                return (
                  <tr
                    key={t.id}
                    className={[isOverdue(t) ? 'row-late' : '', marcado ? 'row-selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={marcado}
                        onChange={() => selection.toggle(t.id)}
                        aria-label={`Selecionar despesa ${t.number} — ${t.description}`}
                      />
                    </td>
                    <td>
                      <span className="cell-id">#{t.number}</span>
                    </td>
                    <td className="cell-desc">
                      {t.description}
                      {t.recurrence !== 'NENHUMA' ? (
                        <small className="cell-sub">
                          {RECURRENCES.find((r) => r.value === t.recurrence)?.label}
                        </small>
                      ) : null}
                    </td>
                    <td className="cell-name">{t.category}</td>
                    <td className="cell-name">{t.supplier?.name ?? '—'}</td>
                    <td className="cell-date">{dateOnly(t.dueDate)}</td>
                    <td className="ta-right">{brl(t.amount)}</td>
                    <td className="ta-right cell-amount">{brl(t.amount - t.paidAmount)}</td>
                    <td>
                      <TitleStatusBadge title={t} overdueLabel="Vencida" />
                    </td>
                    {canManage ? (
                      <td className="ta-right">
                        {isOpen(t) ? (
                          <div className="row-actions">
                            <button className="mini-button" onClick={() => setSettling(t)}>
                              Pagar
                            </button>
                            <button
                              className="mini-button danger"
                              onClick={() => {
                                const reason = prompt('Motivo do cancelamento da despesa:');
                                if (reason && reason.trim().length >= 3) {
                                  cancel.mutate({ id: t.id, reason: reason.trim() });
                                }
                              }}
                            >
                              Cancelar
                            </button>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {titles.data && rows.length === 0 ? (
                <tr>
                  <td colSpan={canManage ? 10 : 9} className="table-empty muted">
                    {search
                      ? `Nenhuma despesa para "${search}" nesta faixa.`
                      : 'Nenhuma despesa nesta faixa.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

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
    </>
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

function Fornecedores({
  canManage,
  search,
  creating,
  onCloseCreate,
}: {
  canManage: boolean;
  search: string;
  creating: boolean;
  onCloseCreate: () => void;
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Partial<Supplier> | null>(null);
  const [erro, setErro] = useState('');

  const list = useQuery({
    queryKey: ['finance', 'suppliers', search],
    queryFn: () => financeApi.suppliers(search || undefined),
  });

  // O "Novo fornecedor" mora no cabeçalho da página, junto com a busca: aqui
  // ele só abre o formulário em branco. Editar continua sendo pela linha.
  useEffect(() => {
    if (creating) setForm((current) => current ?? { name: '' });
  }, [creating]);

  const closeForm = () => {
    setForm(null);
    onCloseCreate();
  };

  const save = useMutation({
    mutationFn: () =>
      form?.id
        ? financeApi.updateSupplier(form.id, form)
        : financeApi.createSupplier(form ?? {}),
    onSuccess: () => {
      closeForm();
      setErro('');
      queryClient.invalidateQueries({ queryKey: ['finance', 'suppliers'] });
    },
    onError: (e: Error) => setErro(e.message),
  });

  return (
    <section className="panel list-panel">
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
            <button className="ghost-button" type="button" onClick={closeForm}>
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
        <table className="data-table invoice-table">
          <thead>
            <tr>
              <th>Nome</th>
              <th>Documento</th>
              <th>Telefone</th>
              <th>E-mail</th>
              {canManage ? <th className="ta-right">Ações</th> : null}
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((s) => (
              <tr key={s.id}>
                <td className="cell-name">{s.name}</td>
                <td className="cell-date">{s.document ?? '—'}</td>
                <td className="cell-date">{s.phone ?? '—'}</td>
                <td>{s.email ?? '—'}</td>
                {canManage ? (
                  <td className="ta-right">
                    <div className="row-actions">
                      <button className="mini-button" onClick={() => setForm(s)}>
                        Editar
                      </button>
                    </div>
                  </td>
                ) : null}
              </tr>
            ))}
            {list.data && list.data.length === 0 ? (
              <tr>
                <td colSpan={canManage ? 5 : 4} className="table-empty muted">
                  {search
                    ? `Nenhum fornecedor para "${search}".`
                    : 'Nenhum fornecedor cadastrado.'}
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

/**
 * Busca e ação principal de cada aba.
 *
 * As duas moram no cabeçalho, não dentro da lista — assim o operador acha o
 * campo de busca sempre no mesmo lugar, em vez de caçá-lo em cada aba. Onde a
 * busca não faz sentido (painel, fechamento do dia), o campo não aparece: um
 * campo inerte na tela é pior que campo nenhum.
 */
/** Curto para caber nos 224px do campo; o rótulo acessível abaixo é o completo. */
const SEARCH_HINT: Partial<Record<Tab, string>> = {
  receber: 'Buscar cliente…',
  pagar: 'Buscar despesa…',
  fornecedores: 'Buscar fornecedor…',
};

const SEARCH_LABEL: Partial<Record<Tab, string>> = {
  receber: 'Buscar título por cliente ou descrição',
  pagar: 'Buscar despesa por descrição, categoria ou fornecedor',
  fornecedores: 'Buscar fornecedor por nome',
};

const CTA_LABEL: Partial<Record<Tab, string>> = {
  receber: 'Novo título',
  pagar: 'Nova despesa',
  fornecedores: 'Novo fornecedor',
};

export function FinancePage() {
  const permissions = useAuthStore((s) => s.permissions);
  const canReceivables = permissions.includes('finance.receivables.manage');
  const canPayables = permissions.includes('finance.payables.manage');
  const canCloseDay = permissions.includes('finance.dailyClosing.manage');

  const [tab, setTab] = useState<Tab>('painel');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
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

  // Trocar de aba zera a busca e fecha o formulário: "aluguel" digitado em
  // A pagar não quer dizer nada em Fornecedores, e o formulário aberto de uma
  // aba não pode reaparecer na outra.
  const goToTab = (next: Tab) => {
    setTab(next);
    setSearch('');
    setCreating(false);
  };

  const searchHint = SEARCH_HINT[tab];
  const canCreate =
    (tab === 'receber' && canReceivables) ||
    ((tab === 'pagar' || tab === 'fornecedores') && canPayables);
  const ctaLabel = CTA_LABEL[tab];

  return (
    <Layout>
      <header className="page-bar">
        <div className="page-bar-id">
          <p className="eyebrow">Financeiro</p>
          <h1>{TABS.find((t) => t.key === tab)?.label}</h1>
        </div>

        <nav className="page-subnav" aria-label="Seções do financeiro">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`pill-button ${tab === t.key ? 'active' : ''}`}
              aria-current={tab === t.key ? 'page' : undefined}
              onClick={() => goToTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div className="page-bar-actions">
          {searchHint ? (
            <input
              className="field-input header-search"
              type="search"
              placeholder={searchHint}
              aria-label={SEARCH_LABEL[tab] ?? searchHint}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          ) : null}
          {canCreate && ctaLabel ? (
            <button
              className="primary-button"
              aria-expanded={creating}
              onClick={() => setCreating((c) => !c)}
            >
              {creating ? 'Fechar' : ctaLabel}
            </button>
          ) : null}
        </div>
      </header>

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
      {tab === 'receber' ? (
        <Receber
          canManage={canReceivables}
          search={search}
          creating={creating}
          onCloseCreate={() => setCreating(false)}
          aging={overview.data?.receivables.aging}
          carteira={overview.data?.receivables}
        />
      ) : null}
      {tab === 'pagar' ? (
        <Pagar
          canManage={canPayables}
          search={search}
          creating={creating}
          onCloseCreate={() => setCreating(false)}
          aging={overview.data?.payables.aging}
          carteira={overview.data?.payables}
        />
      ) : null}
      {tab === 'fornecedores' ? (
        <Fornecedores
          canManage={canPayables}
          search={search}
          creating={creating}
          onCloseCreate={() => setCreating(false)}
        />
      ) : null}
    </Layout>
  );
}
