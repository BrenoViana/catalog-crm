import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Modal } from './Modal';
import type { Customer, CustomerSegment } from '../lib/api-client';

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  NOVO: 'Novo',
  VIP: 'VIP',
  ATIVO: 'Ativo',
  EM_RISCO: 'Em risco',
  INATIVO: 'Inativo',
};

export const SEGMENT_TAG: Record<CustomerSegment, string> = {
  NOVO: '',
  VIP: 'tag-success',
  ATIVO: 'tag-success',
  EM_RISCO: 'tag-warning',
  INATIVO: 'tag-warning',
};

export const blankCustomerForm = {
  name: '',
  document: '',
  phone: '',
  email: '',
  birthDate: '',
  notes: '',
};
export type CustomerForm = typeof blankCustomerForm;

export function fromCustomer(c: Customer): CustomerForm {
  return {
    name: c.name,
    document: c.document ?? '',
    phone: c.phone ?? '',
    email: c.email ?? '',
    birthDate: c.birthDate ? c.birthDate.slice(0, 10) : '',
    notes: c.notes ?? '',
  };
}

/** Só manda o que muda de fato; string vazia vira omissão (não quebra @IsEmail/@IsISO8601). */
export function toCustomerPayload(f: CustomerForm): Partial<Customer> {
  const out: Partial<Customer> = { name: f.name.trim() };
  if (f.document.trim()) out.document = f.document.trim();
  if (f.phone.trim()) out.phone = f.phone.trim();
  if (f.email.trim()) out.email = f.email.trim();
  if (f.birthDate) out.birthDate = f.birthDate;
  if (f.notes.trim()) out.notes = f.notes.trim();
  return out;
}

interface Props {
  title: string;
  initial: CustomerForm;
  onClose: () => void;
  onSubmit: (payload: Partial<Customer>) => Promise<unknown>;
  onSaved: (result: unknown) => void;
  /** 'quick' mostra só nome/telefone/CPF — para o cadastro no balcão. */
  variant?: 'full' | 'quick';
}

export function CustomerFormModal({
  title,
  initial,
  onClose,
  onSubmit,
  onSaved,
  variant = 'full',
}: Props) {
  const [form, setForm] = useState<CustomerForm>(initial);
  const set = <K extends keyof CustomerForm>(k: K, v: CustomerForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: () => onSubmit(toCustomerPayload(form)),
    onSuccess: onSaved,
  });

  return (
    <Modal
      title={title}
      width={variant === 'quick' ? 460 : 720}
      onClose={onClose}
      footer={
        <>
          <button className="ghost-button" onClick={onClose}>Cancelar</button>
          <button
            className="primary-button"
            disabled={!form.name.trim() || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? 'Salvando…' : 'Salvar'}
          </button>
        </>
      }
    >
      {save.error ? (
        <div className="error-message">
          {save.error instanceof Error ? save.error.message : 'Erro ao salvar'}
        </div>
      ) : null}
      <div className="form-grid">
        <label className="field" style={{ gridColumn: 'span 2' }}>
          <span>Nome *</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label className="field">
          <span>CPF</span>
          <input value={form.document} onChange={(e) => set('document', e.target.value)} />
        </label>
        <label className="field">
          <span>Telefone</span>
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </label>

        {variant === 'full' ? (
          <>
            <label className="field">
              <span>E-mail</span>
              <input value={form.email} onChange={(e) => set('email', e.target.value)} />
            </label>
            <label className="field">
              <span>Nascimento</span>
              <input
                type="date"
                value={form.birthDate}
                onChange={(e) => set('birthDate', e.target.value)}
              />
            </label>
            <label className="field" style={{ gridColumn: 'span 2' }}>
              <span>Observações</span>
              <textarea
                className="field-input"
                style={{ minHeight: 72 }}
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
              />
            </label>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
