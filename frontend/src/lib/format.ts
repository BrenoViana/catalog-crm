export const brl = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const num = (value: number | null | undefined, digits = 0) =>
  (value ?? 0).toLocaleString('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: 3,
  });

export const dateTime = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleString('pt-BR') : '—';

export const dateOnly = (value: string | null | undefined) =>
  value ? new Date(value).toLocaleDateString('pt-BR') : '—';

export const paymentLabel: Record<string, string> = {
  DINHEIRO: 'Dinheiro',
  PIX: 'PIX',
  DEBITO: 'Débito',
  CREDITO: 'Crédito',
  CREDIARIO: 'Crediário',
  OUTRO: 'Outro',
};
