import { BadRequestException } from '@nestjs/common';

/**
 * Dia de operacao da loja.
 *
 * O caixa, os relatorios e o fechamento do dia precisam concordar sobre onde um
 * dia comeca e termina — relatorio que fecha o dia num fuso e caixa que fecha
 * noutro e relatorio que ninguem concilia. O criterio unico do sistema: o dia
 * e resolvido no fuso do SERVIDOR (que roda na loja), das 00:00 as 23:59:59.
 *
 * A gravacao e outra historia. Uma coluna `DATE` do Postgres nao tem fuso, e o
 * Prisma serializa `Date` em UTC: gravar a meia-noite local de um servidor em
 * GMT-3 salvaria o dia ANTERIOR. Por isso a data de negocio vai e volta do
 * banco sempre como meia-noite UTC do rotulo `AAAA-MM-DD` — o rotulo e o dado,
 * o `Date` e so o transporte.
 */

const pad = (n: number) => String(n).padStart(2, '0');

/** Rotulo `AAAA-MM-DD` do dia a que um instante pertence, no fuso do servidor. */
export function dayLabel(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Valida e converte um rotulo `AAAA-MM-DD` em meia-noite LOCAL.
 *
 * A regex sozinha nao basta: `2026-02-31` casa com o formato e vira uma data
 * inexistente, que o driver entrega ao banco como `Invalid Date`. Aqui a
 * conversao de volta e comparada componente a componente, entao so passa dia
 * que existe de verdade (SEC-075).
 */
export function parseDayLabel(label: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(label)) {
    throw new BadRequestException('Data deve estar no formato AAAA-MM-DD.');
  }
  const [y, m, d] = label.split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    throw new BadRequestException(`Data invalida: ${label}`);
  }
  return date;
}

/** Rotulo do dia de hoje no fuso do servidor. */
export function todayLabel(): string {
  return dayLabel(new Date());
}

/**
 * Converte o rotulo `AAAA-MM-DD` no valor que vai para a coluna `DATE` —
 * meia-noite UTC, para o dia gravado ser o dia digitado em qualquer fuso.
 */
export function businessDateUtc(label: string): Date {
  return new Date(`${label}T00:00:00.000Z`);
}

/**
 * Caminho inverso: o rotulo guardado numa coluna `DATE`.
 *
 * Nao da para assumir que o valor volta em meia-noite UTC. O parser padrao do
 * `node-postgres` para o tipo `DATE` monta `new Date(ano, mes-1, dia)` em hora
 * LOCAL; num fuso positivo isso cai em 23:00Z do dia anterior e um
 * `toISOString().slice(0,10)` devolveria o dia errado (SEC-072). Por isso o
 * rotulo sai do componente que o driver de fato preencheu: se o instante e
 * meia-noite UTC, le-se em UTC; senao, le-se no fuso local.
 */
export function businessDateLabel(date: Date): string {
  if (date.getUTCHours() === 0 && date.getUTCMinutes() === 0) {
    return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(
      date.getUTCDate(),
    )}`;
  }
  return dayLabel(date);
}

/**
 * Chave do advisory lock que serializa, por dia, o fechamento financeiro e a
 * abertura de turno.
 *
 * Sem ela as duas operacoes leem antes de qualquer uma escrever: um caixa
 * aberto entre a previa e a gravacao ficaria fora do retrato assinado, e o dia
 * travaria por cima dele (SEC-071).
 */
export const dayLockKey = (label: string) => `fechamento-do-dia:${label}`;
