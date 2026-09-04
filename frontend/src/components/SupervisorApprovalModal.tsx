import './SupervisorApprovalModal.css';
import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from './Modal';
import { accessApi } from '../lib/api-client';

/**
 * Liberação de supervisor no balcão.
 *
 * O operador não troca de sessão: um supervisor digita as próprias credenciais
 * aqui e o backend devolve um vale de uso único, válido por poucos minutos e
 * só para a permissão pedida. Quem liberou fica registrado na auditoria.
 */
export function SupervisorApprovalModal({
  permission,
  title,
  description,
  onClose,
  onApproved,
}: {
  /** Chave da permissão que falta (ex.: "sales.cancel"). */
  permission: string;
  title: string;
  description: string;
  onClose: () => void;
  onApproved: (grantToken: string, approverName: string) => void;
}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');

  const approve = useMutation({
    mutationFn: () =>
      accessApi.authorize({
        username: username.trim(),
        password,
        permission,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (grant) => onApproved(grant.token, grant.approver.name),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (username.trim() && password) approve.mutate();
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      width={460}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>
            Cancelar
          </button>
          <button
            className="primary-button"
            disabled={!username.trim() || !password || approve.isPending}
            onClick={() => approve.mutate()}
          >
            {approve.isPending ? 'Verificando…' : 'Liberar'}
          </button>
        </>
      }
    >
      <form className="supervisor-form" onSubmit={submit}>
        <p className="muted">{description}</p>

        <label className="field">
          <span>Usuário do supervisor</span>
          <input
            autoFocus
            autoComplete="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Motivo (opcional)</span>
          <input
            value={reason}
            placeholder="Fica registrado na auditoria"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>

        {approve.error ? (
          <div className="error-message">
            {approve.error instanceof Error
              ? approve.error.message
              : 'Não foi possível liberar.'}
          </div>
        ) : null}

        {/* Permite enviar com Enter sem duplicar o botão do rodapé. */}
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
