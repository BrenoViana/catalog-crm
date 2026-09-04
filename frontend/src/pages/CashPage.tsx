import './CashPage.css';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { cashApi, type CashReport } from '../lib/api-client';
import { brl, dateTime, paymentLabel } from '../lib/format';
import { getTerminal, setTerminal } from '../lib/terminal';

const movementLabel: Record<string, string> = {
  ABERTURA: 'Abertura',
  VENDA: 'Venda',
  SANGRIA: 'Sangria',
  SUPRIMENTO: 'Suprimento',
  FECHAMENTO: 'Fechamento',
};

function TurnReport({ report }: { report: CashReport }) {
  const isZ = report.kind === 'Z';
  return (
    <div className="turn-report">
      <div className="panel-header">
        <h2>{isZ ? 'Fechamento (Z)' : 'Leitura de turno (X)'}</h2>
        <span className="muted">
          {report.session.terminal ? `${report.session.terminal} · ` : ''}
          {dateTime(report.generatedAt)}
        </span>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <article className="stat-card">
          <span>Vendas no turno</span>
          <strong>{report.sales.count}</strong>
        </article>
        <article className="stat-card">
          <span>Total vendido</span>
          <strong>{brl(report.sales.total)}</strong>
        </article>
        <article className="stat-card">
          <span>Descontos concedidos</span>
          <strong>{brl(report.sales.discountTotal)}</strong>
        </article>
        <article className="stat-card">
          <span>Vendas canceladas</span>
          <strong>{report.sales.canceledCount}</strong>
        </article>
      </div>

      <h3 className="turn-report-sub">Por forma de pagamento</h3>
      {report.byPaymentMethod.length === 0 ? (
        <p className="muted">Nenhum pagamento registrado.</p>
      ) : (
        <ul className="list-rows">
          {report.byPaymentMethod.map((p) => (
            <li key={p.method}>
              <span>
                {paymentLabel[p.method] ?? p.method} <small>× {p.count}</small>
              </span>
              <strong>{brl(p.amount)}</strong>
            </li>
          ))}
        </ul>
      )}

      <h3 className="turn-report-sub">Dinheiro na gaveta</h3>
      <ul className="list-rows">
        <li><span>Fundo de abertura</span><strong>{brl(report.cash.opening)}</strong></li>
        <li><span>+ Vendas em dinheiro</span><strong>{brl(report.cash.sales)}</strong></li>
        <li><span>+ Suprimentos</span><strong>{brl(report.cash.suprimentos)}</strong></li>
        <li>
          <span>− Sangrias</span>
          <strong className="text-warning">{brl(report.cash.sangrias)}</strong>
        </li>
        <li>
          <span>= Saldo esperado</span>
          <strong>{brl(report.cash.expected)}</strong>
        </li>
        {isZ ? (
          <>
            <li><span>Contado na gaveta</span><strong>{brl(report.cash.counted)}</strong></li>
            <li>
              <span>Diferença</span>
              <strong className={Number(report.cash.difference) === 0 ? '' : 'text-warning'}>
                {brl(report.cash.difference)}
              </strong>
            </li>
          </>
        ) : null}
      </ul>
    </div>
  );
}

export function CashPage() {
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState('');
  const [terminal, setTerminalName] = useState(getTerminal);
  const [counted, setCounted] = useState('');
  const [mov, setMov] = useState({ type: 'SANGRIA' as 'SANGRIA' | 'SUPRIMENTO', amount: '', reason: '' });

  const current = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cash'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const open = useMutation({
    mutationFn: () => cashApi.open(Number(opening) || 0, undefined, terminal || undefined),
    onSuccess: () => {
      setOpening('');
      invalidate();
    },
  });
  const addMov = useMutation({
    mutationFn: () => cashApi.movement(mov.type, Number(mov.amount), mov.reason || undefined),
    onSuccess: () => {
      setMov({ ...mov, amount: '', reason: '' });
      invalidate();
    },
  });
  const close = useMutation({
    mutationFn: () => cashApi.close(Number(counted) || 0),
    onSuccess: () => {
      setCounted('');
      invalidate();
    },
  });

  const session = current.data;

  const report = useQuery({
    queryKey: ['cash', 'report'],
    queryFn: cashApi.report,
    enabled: !!session,
  });
  const closedReport = useQuery({
    queryKey: ['cash', 'report', close.data?.id],
    queryFn: () => cashApi.reportFor(close.data!.id),
    enabled: !!close.data?.id,
  });

  return (
    <Layout>
      <div className="page-header">
        <div>
          <p className="eyebrow">Operação</p>
          <h1>Caixa</h1>
        </div>
        <span className={`tag ${session ? 'tag-success' : 'tag-warning'}`}>
          {session ? 'Aberto' : 'Fechado'}
        </span>
      </div>

      {!session && closedReport.data ? (
        <section className="panel" style={{ marginBottom: 20 }}>
          <TurnReport report={closedReport.data} />
        </section>
      ) : null}

      {!session ? (
        <section className="panel" style={{ maxWidth: 420 }}>
          <div className="panel-header">
            <h2>Abrir caixa</h2>
          </div>
          <label className="field">
            <span>Terminal / caixa</span>
            <input
              value={terminal}
              placeholder="Caixa 01"
              maxLength={40}
              onChange={(e) => setTerminalName(e.target.value)}
              onBlur={(e) => setTerminalName(setTerminal(e.target.value))}
            />
            <small className="muted">Fica salvo neste dispositivo e acompanha as vendas do turno.</small>
          </label>
          <label className="field">
            <span>Fundo de troco inicial</span>
            <input inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </label>
          <button
            className="primary-button large-button"
            style={{ marginTop: 12 }}
            disabled={open.isPending}
            onClick={() => open.mutate()}
          >
            {open.isPending ? 'Abrindo…' : 'Abrir caixa'}
          </button>
        </section>
      ) : (
        <>
        <div className="split-layout">
          <section className="panel">
            <div className="panel-header">
              <h2>Turno atual</h2>
            </div>
            <div className="stats-grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <article className="stat-card">
                <span>Abertura</span>
                <strong>{brl(session.openingAmount)}</strong>
              </article>
              <article className="stat-card">
                <span>Saldo esperado (dinheiro)</span>
                <strong>{brl(session.expectedAmount)}</strong>
              </article>
            </div>
            <p className="muted" style={{ marginTop: 10 }}>
              {session.terminal ? `${session.terminal} · ` : ''}
              Aberto em {dateTime(session.openedAt)}
            </p>

            <ul className="list-rows" style={{ marginTop: 16 }}>
              {session.movements.map((m) => (
                <li key={m.id}>
                  <span>
                    {movementLabel[m.type] ?? m.type}
                    {m.reason ? <small> — {m.reason}</small> : null}
                  </span>
                  <strong className={m.type === 'SANGRIA' ? 'text-warning' : ''}>
                    {m.type === 'SANGRIA' ? '-' : ''}
                    {brl(m.amount)}
                  </strong>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <div className="panel-header">
              <h2>Sangria / Suprimento</h2>
            </div>
            <div className="pay-methods">
              <button
                className={`pill-button ${mov.type === 'SANGRIA' ? 'active' : ''}`}
                onClick={() => setMov({ ...mov, type: 'SANGRIA' })}
              >
                Sangria
              </button>
              <button
                className={`pill-button ${mov.type === 'SUPRIMENTO' ? 'active' : ''}`}
                onClick={() => setMov({ ...mov, type: 'SUPRIMENTO' })}
              >
                Suprimento
              </button>
            </div>
            <label className="field">
              <span>Valor</span>
              <input inputMode="decimal" value={mov.amount} onChange={(e) => setMov({ ...mov, amount: e.target.value })} />
            </label>
            <label className="field">
              <span>Motivo</span>
              <input value={mov.reason} onChange={(e) => setMov({ ...mov, reason: e.target.value })} />
            </label>
            <button
              className="ghost-button"
              disabled={!mov.amount || addMov.isPending}
              onClick={() => addMov.mutate()}
            >
              Registrar
            </button>

            <div className="panel-header" style={{ marginTop: 24 }}>
              <h2>Fechar caixa</h2>
            </div>
            <label className="field">
              <span>Valor contado na gaveta</span>
              <input inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} />
            </label>
            <button
              className="danger-button"
              disabled={!counted || close.isPending}
              onClick={() => close.mutate()}
            >
              {close.isPending ? 'Fechando…' : 'Fechar turno'}
            </button>
            {close.data && close.data.status === 'FECHADA' ? (
              <div className="success-message" style={{ marginTop: 12 }}>
                Turno fechado. Diferença: {brl(close.data.difference)}
              </div>
            ) : null}
          </section>
        </div>

        {report.data ? (
          <section className="panel" style={{ marginTop: 20 }}>
            <TurnReport report={report.data} />
          </section>
        ) : null}
        </>
      )}
    </Layout>
  );
}
