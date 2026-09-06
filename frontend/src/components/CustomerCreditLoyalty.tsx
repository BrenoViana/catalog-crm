import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { financeApi, loyaltyApi } from '../lib/api-client';
import { brl, dateTime, toNumber } from '../lib/format';
import { useLicense } from '../lib/useLicense';
import { useAuthStore } from '../store/authStore';

/**
 * Crédito e fidelidade do cliente, dentro da ficha dele.
 *
 * Os dois assuntos vivem aqui, e não numa tela própria, porque a pergunta que
 * o lojista faz é sobre a PESSOA: "quanto ele pode levar fiado?" e "quanto ele
 * tem de saldo?". Separar em telas obriga a procurar o mesmo cliente duas vezes.
 *
 * Cada metade some quando o módulo não está licenciado ou quando falta
 * permissão — não adianta mostrar um campo que vai responder 403.
 */
export function CustomerCreditLoyalty({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const permissions = useAuthStore((s) => s.permissions);
  const { allows } = useLicense();

  const podeVerCredito = allows('financeiro') && permissions.includes('finance.view');
  const podeEditarLimite = permissions.includes('finance.receivables.manage');
  const podeVerFidelidade = allows('promocoes');
  const podeAjustar = permissions.includes('loyalty.manage');

  const credit = useQuery({
    queryKey: ['finance', 'credit', customerId],
    queryFn: () => financeApi.creditStatus(customerId),
    enabled: podeVerCredito,
  });
  const loyalty = useQuery({
    queryKey: ['loyalty', customerId],
    queryFn: () => loyaltyApi.statement(customerId),
    enabled: podeVerFidelidade,
  });

  const [limite, setLimite] = useState<string | null>(null);
  const [ajuste, setAjuste] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState('');

  const salvarLimite = useMutation({
    mutationFn: () => financeApi.setCreditLimit(customerId, toNumber(limite ?? '0')),
    onSuccess: () => {
      setLimite(null);
      setErro('');
      queryClient.invalidateQueries({ queryKey: ['finance', 'credit', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e: Error) => setErro(e.message),
  });

  const ajustarSaldo = useMutation({
    mutationFn: () => loyaltyApi.adjust(customerId, toNumber(ajuste), motivo.trim()),
    onSuccess: () => {
      setAjuste('');
      setMotivo('');
      setErro('');
      queryClient.invalidateQueries({ queryKey: ['loyalty', customerId] });
    },
    onError: (e: Error) => setErro(e.message),
  });

  if (!podeVerCredito && !podeVerFidelidade) return null;

  return (
    <>
      <div className="panel-header" style={{ marginTop: 20 }}>
        <h2>Crédito e fidelidade</h2>
      </div>

      {erro ? <p className="form-error">{erro}</p> : null}

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        {credit.data ? (
          <>
            <article className="stat-card">
              <span>Limite de crediário</span>
              <strong>{brl(credit.data.limit)}</strong>
              <small className="muted">{brl(credit.data.used)} em uso</small>
            </article>
            <article className="stat-card">
              <span>Disponível</span>
              <strong>{brl(credit.data.available)}</strong>
              {credit.data.overdueCount > 0 ? (
                <small className="text-warning">
                  {credit.data.overdueCount} parcela(s) vencida(s) — {brl(credit.data.overdue)}
                </small>
              ) : (
                <small className="muted">sem parcelas vencidas</small>
              )}
            </article>
          </>
        ) : null}
        {loyalty.data ? (
          <article className="stat-card">
            <span>Saldo de fidelidade</span>
            <strong>{brl(loyalty.data.balance)}</strong>
            <small className="muted">
              {brl(loyalty.data.earned)} acumulados · {brl(loyalty.data.redeemed)} usados
            </small>
          </article>
        ) : null}
      </div>

      {podeEditarLimite && credit.data ? (
        <div className="toolbar" style={{ marginTop: 12 }}>
          <label className="report-date">
            <span>Novo limite</span>
            <input
              className="field-input"
              inputMode="decimal"
              value={limite ?? String(credit.data.limit)}
              onChange={(e) => setLimite(e.target.value)}
            />
          </label>
          <button
            className="ghost-button"
            disabled={salvarLimite.isPending || limite === null}
            onClick={() => salvarLimite.mutate()}
          >
            {salvarLimite.isPending ? 'Salvando…' : 'Atualizar limite'}
          </button>
        </div>
      ) : null}

      {podeAjustar && podeVerFidelidade ? (
        <div className="toolbar" style={{ marginTop: 8 }}>
          <label className="report-date">
            <span>Ajuste de saldo</span>
            <input
              className="field-input"
              inputMode="decimal"
              placeholder="+10 ou -5"
              value={ajuste}
              onChange={(e) => setAjuste(e.target.value)}
            />
          </label>
          <label className="report-date" style={{ flex: 1 }}>
            <span>Motivo</span>
            <input
              className="field-input"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Bônus de aniversário, correção…"
            />
          </label>
          <button
            className="ghost-button"
            disabled={
              ajustarSaldo.isPending || toNumber(ajuste) === 0 || motivo.trim().length < 3
            }
            onClick={() => ajustarSaldo.mutate()}
          >
            {ajustarSaldo.isPending ? 'Lançando…' : 'Lançar ajuste'}
          </button>
        </div>
      ) : null}

      {loyalty.data && loyalty.data.entries.length > 0 ? (
        <div className="table-scroll" style={{ marginTop: 12 }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Movimento</th>
                <th style={{ textAlign: 'right' }}>Valor</th>
                <th style={{ textAlign: 'right' }}>Saldo</th>
              </tr>
            </thead>
            <tbody>
              {loyalty.data.entries.slice(0, 10).map((e) => (
                <tr key={e.id}>
                  <td>
                    <small>{dateTime(e.createdAt)}</small>
                  </td>
                  <td>
                    {e.reason ?? e.type}
                    {e.sale ? <small className="muted"> · venda #{e.sale.number}</small> : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{brl(e.amount)}</td>
                  <td style={{ textAlign: 'right' }}>{brl(e.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
