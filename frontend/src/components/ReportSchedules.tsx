import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  reportSchedulesApi,
  type ReportChannel,
  type ReportFrequency,
  type ReportSchedule,
  type ReportScheduleInput,
} from '../lib/api-client';
import { num } from '../lib/format';

const REPORTS: Array<{ key: string; label: string }> = [
  { key: 'vendas', label: 'Vendas por período' },
  { key: 'produtos', label: 'Produtos (curva ABC)' },
  { key: 'categorias', label: 'Categorias' },
  { key: 'pagamentos', label: 'Pagamentos' },
  { key: 'operadores', label: 'Operadores' },
  { key: 'estoque', label: 'Posição de estoque' },
];

const FREQUENCIES: Array<{ key: ReportFrequency; label: string; janela: string }> = [
  { key: 'DIARIO', label: 'Diário', janela: 'cobre o dia anterior' },
  { key: 'SEMANAL', label: 'Semanal', janela: 'cobre os sete dias até ontem' },
  { key: 'MENSAL', label: 'Mensal', janela: 'cobre o mês civil anterior' },
];

const CHANNELS: Array<{ key: ReportChannel; label: string; hint: string }> = [
  {
    key: 'REGISTRO',
    label: 'Registro',
    hint: 'Não envia para fora: grava a entrega na trilha. Use para conferir o agendamento.',
  },
  {
    key: 'EMAIL',
    label: 'E-mail',
    hint: 'Requer um provedor de envio configurado nesta instalação.',
  },
  {
    key: 'WHATSAPP',
    label: 'WhatsApp',
    hint: 'Requer uma API de envio configurada nesta instalação.',
  },
];

const WEEKDAYS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

const VAZIO: ReportScheduleInput = {
  report: 'vendas',
  name: '',
  frequency: 'DIARIO',
  hour: 7,
  weekday: 1,
  monthday: 1,
  channel: 'REGISTRO',
  recipient: '',
};

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

function cadencia(s: ReportSchedule) {
  const hora = `${String(s.hour).padStart(2, '0')}:00`;
  if (s.frequency === 'SEMANAL') return `Toda ${WEEKDAYS[s.weekday ?? 1]}, ${hora}`;
  if (s.frequency === 'MENSAL') return `Todo dia ${s.monthday ?? 1}, ${hora}`;
  return `Todo dia, ${hora}`;
}

/**
 * Agendamento de relatórios.
 *
 * O que a tela precisa deixar claro, e por isso está escrito nela: o período
 * nunca inclui o dia em que o envio sai. Um "relatório de vendas diário" que
 * chegasse às 7h com as vendas de hoje mostraria a loja despencando todo dia.
 */
export function ReportSchedules() {
  const qc = useQueryClient();
  const [form, setForm] = useState<ReportScheduleInput>(VAZIO);
  const [erro, setErro] = useState('');
  const [aberto, setAberto] = useState<string | null>(null);

  const schedules = useQuery({
    queryKey: ['report-schedules'],
    queryFn: reportSchedulesApi.list,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['report-schedules'] });
  const falhou = (err: unknown) =>
    setErro(err instanceof Error ? err.message : 'Não foi possível concluir.');

  const criar = useMutation({
    mutationFn: () =>
      reportSchedulesApi.create({
        ...form,
        weekday: form.frequency === 'SEMANAL' ? form.weekday : undefined,
        monthday: form.frequency === 'MENSAL' ? form.monthday : undefined,
      }),
    onSuccess: () => {
      setForm(VAZIO);
      setErro('');
      invalidate();
    },
    onError: falhou,
  });

  const alternar = useMutation({
    mutationFn: (s: ReportSchedule) => reportSchedulesApi.update(s.id, { active: !s.active }),
    onSuccess: invalidate,
    onError: falhou,
  });

  const remover = useMutation({
    mutationFn: (id: string) => reportSchedulesApi.remove(id),
    onSuccess: invalidate,
    onError: falhou,
  });

  const enviarAgora = useMutation({
    mutationFn: (id: string) => reportSchedulesApi.runNow(id),
    onSuccess: () => {
      setErro('');
      invalidate();
    },
    onError: falhou,
  });

  const detalhe = useQuery({
    queryKey: ['report-schedules', aberto],
    queryFn: () => reportSchedulesApi.detail(aberto as string),
    enabled: !!aberto,
  });

  return (
    <>
      <section className="panel report-panel">
        <div className="panel-header">
          <h2>Novo agendamento</h2>
          <small className="muted">
            {FREQUENCIES.find((f) => f.key === form.frequency)?.janela}
          </small>
        </div>
        <p className="muted report-note">
          O relatório sai no horário da loja e <strong>nunca inclui o dia do envio</strong> — um
          diário das 7h leva o movimento de ontem fechado, não o de hoje pela metade. O arquivo é o
          mesmo CSV da exportação manual, e cada envio vira linha na trilha de entregas.
        </p>

        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            criar.mutate();
          }}
        >
          <label>
            <span>Nome</span>
            <input
              value={form.name}
              minLength={3}
              maxLength={80}
              required
              placeholder="Vendas de ontem para a gerência"
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            <span>Relatório</span>
            <select
              value={form.report}
              onChange={(e) => setForm({ ...form, report: e.target.value })}
            >
              {REPORTS.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Frequência</span>
            <select
              value={form.frequency}
              onChange={(e) => setForm({ ...form, frequency: e.target.value as ReportFrequency })}
            >
              {FREQUENCIES.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Hora</span>
            <input
              type="number"
              min={0}
              max={23}
              value={form.hour}
              onChange={(e) => setForm({ ...form, hour: Number(e.target.value) })}
            />
          </label>
          {form.frequency === 'SEMANAL' ? (
            <label>
              <span>Dia da semana</span>
              <select
                value={form.weekday ?? 1}
                onChange={(e) => setForm({ ...form, weekday: Number(e.target.value) })}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {form.frequency === 'MENSAL' ? (
            <label>
              <span>Dia do mês</span>
              <input
                type="number"
                min={1}
                max={28}
                value={form.monthday ?? 1}
                onChange={(e) => setForm({ ...form, monthday: Number(e.target.value) })}
              />
              <small className="muted">
                Até 28: dia 29 a 31 não existe em todo mês e pularia fevereiro em silêncio.
              </small>
            </label>
          ) : null}
          <label>
            <span>Canal</span>
            <select
              value={form.channel}
              onChange={(e) => setForm({ ...form, channel: e.target.value as ReportChannel })}
            >
              {CHANNELS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
            <small className="muted">{CHANNELS.find((c) => c.key === form.channel)?.hint}</small>
          </label>
          <label>
            <span>Destinatário</span>
            <input
              value={form.recipient}
              required
              maxLength={120}
              placeholder={
                form.channel === 'EMAIL'
                  ? 'gerencia@loja.com.br'
                  : form.channel === 'WHATSAPP'
                    ? '(11) 90000-0000'
                    : 'gerência'
              }
              onChange={(e) => setForm({ ...form, recipient: e.target.value })}
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={criar.isPending}>
              {criar.isPending ? 'Salvando…' : 'Agendar'}
            </button>
          </div>
        </form>
        {erro ? <p className="form-error">{erro}</p> : null}
      </section>

      <section className="panel report-panel">
        <div className="panel-header">
          <h2>Agendamentos</h2>
          <small className="muted">
            O destinatário aparece mascarado: a trilha prova o envio sem espalhar o contato.
          </small>
        </div>
        {schedules.isLoading ? (
          <p className="muted report-empty">Carregando…</p>
        ) : !schedules.data?.length ? (
          <p className="muted report-empty">Nenhum relatório agendado.</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Agendamento</th>
                  <th>Cadência</th>
                  <th>Destino</th>
                  <th>Próximo envio</th>
                  <th>Última entrega</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {schedules.data.map((s) => (
                  <tr key={s.id} className={s.active ? undefined : 'row-muted'}>
                    <td>
                      <strong>{s.name}</strong>
                      <br />
                      <small className="muted">
                        {REPORTS.find((r) => r.key === s.report)?.label ?? s.report}
                      </small>
                    </td>
                    <td>{cadencia(s)}</td>
                    <td>
                      {CHANNELS.find((c) => c.key === s.channel)?.label}
                      <br />
                      <small className="muted">{s.recipientMascarado}</small>
                    </td>
                    <td>{s.active ? dataHora(s.nextRunAt) : 'pausado'}</td>
                    <td>
                      {s.ultimaEntrega ? (
                        <>
                          <span
                            className={
                              s.ultimaEntrega.status === 'ENVIADO' ? 'text-success' : 'text-warning'
                            }
                          >
                            {s.ultimaEntrega.status === 'ENVIADO' ? 'enviado' : 'falhou'}
                          </span>
                          <br />
                          <small className="muted">{dataHora(s.ultimaEntrega.runAt)}</small>
                        </>
                      ) : (
                        <small className="muted">nunca enviado</small>
                      )}
                    </td>
                    <td className="row-actions">
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => enviarAgora.mutate(s.id)}
                        disabled={enviarAgora.isPending}
                      >
                        Enviar agora
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => alternar.mutate(s)}
                      >
                        {s.active ? 'Pausar' : 'Retomar'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => setAberto(aberto === s.id ? null : s.id)}
                      >
                        {aberto === s.id ? 'Fechar' : 'Entregas'}
                      </button>
                      <button
                        type="button"
                        className="ghost-button danger"
                        onClick={() => remover.mutate(s.id)}
                      >
                        Remover
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {aberto && detalhe.data ? (
        <section className="panel report-panel">
          <div className="panel-header">
            <h2>Entregas de “{detalhe.data.name}”</h2>
            <small className="muted">as 50 mais recentes</small>
          </div>
          {detalhe.data.entregas.length === 0 ? (
            <p className="muted report-empty">Nenhuma entrega ainda.</p>
          ) : (
            <div className="table-scroll">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Quando</th>
                    <th>Situação</th>
                    <th>Período coberto</th>
                    <th>Linhas</th>
                    <th>Destino</th>
                    <th>Detalhe</th>
                  </tr>
                </thead>
                <tbody>
                  {detalhe.data.entregas.map((d) => (
                    <tr key={d.id}>
                      <td>{dataHora(d.runAt)}</td>
                      <td className={d.status === 'ENVIADO' ? 'text-success' : 'text-warning'}>
                        {d.status === 'ENVIADO' ? 'enviado' : 'falhou'}
                      </td>
                      <td>
                        {d.periodFrom} a {d.periodTo}
                      </td>
                      <td>{num(d.rows)}</td>
                      <td>{d.recipient}</td>
                      <td>
                        <small className="muted">{d.error ?? '—'}</small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
