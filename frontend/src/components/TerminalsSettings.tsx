import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  storeSettingsApi,
  terminalsApi,
  type Terminal,
  type TerminalInput,
} from '../lib/api-client';

type Draft = {
  code: string;
  name: string;
  contingencySeries: string;
  contingencyRangeStart: string;
  contingencyRangeEnd: string;
};

const EMPTY: Draft = {
  code: '',
  name: '',
  contingencySeries: '',
  contingencyRangeStart: '',
  contingencyRangeEnd: '',
};

function toInput(d: Draft): TerminalInput {
  const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return {
    code: d.code.trim().toUpperCase(),
    name: d.name.trim(),
    contingencySeries: num(d.contingencySeries),
    contingencyRangeStart: num(d.contingencyRangeStart),
    contingencyRangeEnd: num(d.contingencyRangeEnd),
  };
}

function faixa(t: Terminal): string {
  if (t.contingencySeries == null) return '—';
  return `série ${t.contingencySeries} · ${t.contingencyRangeStart}–${t.contingencyRangeEnd} · próx. ${t.contingencyNextNumber}`;
}

/**
 * Cadastro de terminais (caixas/dispositivos) e a chave de contingência da
 * NFC-e. A identidade do terminal é núcleo; as faixas de contingência só têm
 * efeito com o módulo Fiscal.
 */
export default function TerminalsSettings() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [editing, setEditing] = useState<string | null>(null);
  const [erro, setErro] = useState('');

  const terminals = useQuery({ queryKey: ['terminals'], queryFn: terminalsApi.list });
  const store = useQuery({ queryKey: ['store-settings'], queryFn: storeSettingsApi.get });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['terminals'] });
    void queryClient.invalidateQueries({ queryKey: ['store-settings'] });
  };
  const fail = (e: unknown) =>
    setErro(e instanceof Error ? e.message : 'Não foi possível salvar.');

  const create = useMutation({
    mutationFn: () => terminalsApi.create(toInput(draft)),
    onSuccess: () => {
      setDraft(EMPTY);
      setErro('');
      invalidate();
    },
    onError: fail,
  });
  const update = useMutation({
    mutationFn: (v: { id: string; data: Partial<TerminalInput> }) =>
      terminalsApi.update(v.id, v.data),
    onSuccess: () => {
      setEditing(null);
      setErro('');
      invalidate();
    },
    onError: fail,
  });
  const toggle = useMutation({
    mutationFn: (v: { id: string; active: boolean }) =>
      terminalsApi.setActive(v.id, v.active),
    onSuccess: invalidate,
    onError: fail,
  });
  const contingency = useMutation({
    mutationFn: (active: boolean) => storeSettingsApi.setContingency(active),
    onSuccess: () => {
      setErro('');
      invalidate();
    },
    onError: fail,
  });

  const rows = terminals.data ?? [];
  const contingencyOn = store.data?.nfceContingencyActive ?? false;
  const storeSeries = store.data?.nfceContingencySeries ?? null;

  return (
    <>
      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Terminais</h2>
        </div>

        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <label className="field">
            <span>Código</span>
            <input
              value={draft.code}
              placeholder="CAIXA-01"
              onChange={(e) => setDraft({ ...draft, code: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Nome</span>
            <input
              value={draft.name}
              placeholder="Caixa da frente"
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Série de contingência</span>
            <input
              inputMode="numeric"
              value={draft.contingencySeries}
              onChange={(e) =>
                setDraft({ ...draft, contingencySeries: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Faixa: nº inicial</span>
            <input
              inputMode="numeric"
              value={draft.contingencyRangeStart}
              onChange={(e) =>
                setDraft({ ...draft, contingencyRangeStart: e.target.value })
              }
            />
          </label>
          <label className="field">
            <span>Faixa: nº final</span>
            <input
              inputMode="numeric"
              value={draft.contingencyRangeEnd}
              onChange={(e) =>
                setDraft({ ...draft, contingencyRangeEnd: e.target.value })
              }
            />
          </label>
          <div className="form-actions">
            <button
              type="submit"
              className="btn"
              disabled={!draft.code.trim() || !draft.name.trim() || create.isPending}
            >
              Adicionar terminal
            </button>
          </div>
        </form>
        <p className="muted" style={{ marginTop: 8 }}>
          A série de contingência (opcional) reserva uma numeração fiscal só para
          este terminal quando a SEFAZ está indisponível. Deixe em branco para
          usar a série de contingência da loja. Os três campos andam juntos.
        </p>
        {erro ? <p className="form-error">{erro}</p> : null}

        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Código</th>
                <th>Nome</th>
                <th>Contingência</th>
                <th>Visto por último</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    Nenhum terminal cadastrado.
                  </td>
                </tr>
              ) : (
                rows.map((t) => (
                  <TerminalRow
                    key={t.id}
                    terminal={t}
                    editing={editing === t.id}
                    onEdit={() => {
                      setEditing(t.id);
                      setErro('');
                    }}
                    onCancel={() => setEditing(null)}
                    onSave={(data) => update.mutate({ id: t.id, data })}
                    onToggle={() => toggle.mutate({ id: t.id, active: !t.active })}
                    busy={update.isPending || toggle.isPending}
                  />
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel" style={{ marginBottom: 20 }}>
        <div className="panel-header">
          <h2>Contingência da NFC-e</h2>
        </div>
        <p className="muted">
          Com a contingência <strong>ligada</strong>, toda venda emite a NFC-e
          direto na série de contingência{storeSeries != null ? ` (${storeSeries})` : ''};
          as notas chegam à SEFAZ sozinhas quando a conexão voltar. Use apenas
          enquanto a SEFAZ ou o provedor estiverem fora do ar.
        </p>
        <label
          className="field"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
        >
          <input
            type="checkbox"
            checked={contingencyOn}
            disabled={contingency.isPending}
            onChange={(e) => {
              const active = e.target.checked;
              if (
                active &&
                !window.confirm(
                  'As próximas vendas vão emitir NFC-e em contingência. Confirmar?',
                )
              ) {
                return;
              }
              contingency.mutate(active);
            }}
          />
          <span>
            {contingencyOn
              ? 'Contingência LIGADA — vendas emitem na série de contingência'
              : 'Contingência desligada — emissão normal'}
          </span>
        </label>
        {storeSeries == null ? (
          <p className="muted" style={{ marginTop: 8 }}>
            Defina a série de contingência da loja em <em>Dados da loja</em> para
            poder ligar a chave.
          </p>
        ) : null}
      </section>
    </>
  );
}

function TerminalRow({
  terminal,
  editing,
  onEdit,
  onCancel,
  onSave,
  onToggle,
  busy,
}: {
  terminal: Terminal;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (data: Partial<TerminalInput>) => void;
  onToggle: () => void;
  busy: boolean;
}) {
  const [s, setS] = useState(String(terminal.contingencySeries ?? ''));
  const [a, setA] = useState(String(terminal.contingencyRangeStart ?? ''));
  const [b, setB] = useState(String(terminal.contingencyRangeEnd ?? ''));

  if (!editing) {
    return (
      <tr className={terminal.active ? undefined : 'row-muted'}>
        <td>{terminal.code}</td>
        <td>{terminal.name}</td>
        <td>{faixa(terminal)}</td>
        <td className="muted">
          {terminal.lastSeenAt
            ? new Date(terminal.lastSeenAt).toLocaleString('pt-BR')
            : '—'}
        </td>
        <td className="row-actions">
          <button className="ghost-button" onClick={onEdit}>
            Contingência
          </button>
          <button className="ghost-button" onClick={onToggle} disabled={busy}>
            {terminal.active ? 'Inativar' : 'Ativar'}
          </button>
        </td>
      </tr>
    );
  }

  const numOrUndef = (v: string) => (v.trim() === '' ? undefined : Number(v));
  return (
    <tr>
      <td>{terminal.code}</td>
      <td>{terminal.name}</td>
      <td colSpan={2}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            style={{ width: 90 }}
            placeholder="série"
            inputMode="numeric"
            value={s}
            onChange={(e) => setS(e.target.value)}
          />
          <input
            style={{ width: 90 }}
            placeholder="nº inicial"
            inputMode="numeric"
            value={a}
            onChange={(e) => setA(e.target.value)}
          />
          <input
            style={{ width: 90 }}
            placeholder="nº final"
            inputMode="numeric"
            value={b}
            onChange={(e) => setB(e.target.value)}
          />
        </div>
      </td>
      <td className="row-actions">
        <button
          className="ghost-button"
          disabled={busy}
          onClick={() =>
            onSave({
              contingencySeries: numOrUndef(s),
              contingencyRangeStart: numOrUndef(a),
              contingencyRangeEnd: numOrUndef(b),
            })
          }
        >
          Salvar
        </button>
        <button className="ghost-button" onClick={onCancel}>
          Cancelar
        </button>
      </td>
    </tr>
  );
}
