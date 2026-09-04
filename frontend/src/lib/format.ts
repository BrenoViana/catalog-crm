export const brl = (value: number | null | undefined) =>
  (value ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Converte texto de campo (aceita vírgula decimal) em número; 0 se inválido. */
export const toNumber = (value: string | number | null | undefined) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const n = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** Arredonda para 2 casas evitando ruído de ponto flutuante. */
export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Resolve um desconto digitado em R$ ou em % (quando o texto termina com "%")
 * para um valor em R$, sempre limitado a [0, base].
 */
export function resolveDiscount(raw: string, base: number): number {
  const s = String(raw ?? '').trim();
  if (!s) return 0;
  const clamp = (v: number) => Math.max(0, Math.min(base, round2(v)));
  if (s.endsWith('%')) {
    return clamp((base * toNumber(s.slice(0, -1))) / 100);
  }
  return clamp(toNumber(s));
}

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
