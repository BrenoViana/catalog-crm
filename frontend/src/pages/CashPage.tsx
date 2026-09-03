import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Layout } from '../components/Layout';
import { cashApi } from '../lib/api-client';
import { brl, dateTime } from '../lib/format';

const movementLabel: Record<string, string> = {
  ABERTURA: 'Abertura',
  VENDA: 'Venda',
  SANGRIA: 'Sangria',
  SUPRIMENTO: 'Suprimento',
  FECHAMENTO: 'Fechamento',
};

export function CashPage() {
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState('');
  const [counted, setCounted] = useState('');
  const [mov, setMov] = useState({ type: 'SANGRIA' as 'SANGRIA' | 'SUPRIMENTO', amount: '', reason: '' });

  const current = useQuery({ queryKey: ['cash', 'current'], queryFn: cashApi.current });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['cash'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const open = useMutation({
    mutationFn: () => cashApi.open(Number(opening) || 0),
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

      {!session ? (
        <section className="panel" style={{ maxWidth: 420 }}>
          <div className="panel-header">
            <h2>Abrir caixa</h2>
          </div>
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
      )}
    </Layout>
  );
}
