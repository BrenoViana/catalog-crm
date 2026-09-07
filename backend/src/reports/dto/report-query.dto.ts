import { BadRequestException } from '@nestjs/common';
import { IsIn, IsOptional, Matches } from 'class-validator';

/** Granularidade da serie temporal do relatorio de vendas. */
export type ReportGroupBy = 'day' | 'week' | 'month';

/**
 * Janela de consulta dos relatorios.
 *
 * As datas chegam como `YYYY-MM-DD` e sao interpretadas no fuso do servidor —
 * o mesmo criterio do dashboard e da leitura X/Z. Relatorio que fecha o dia num
 * fuso diferente do caixa e relatorio que ninguem consegue conciliar.
 */
export class ReportQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data inicial deve estar no formato AAAA-MM-DD.' })
  from?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'A data final deve estar no formato AAAA-MM-DD.' })
  to?: string;

  @IsOptional()
  @IsIn(['day', 'week', 'month'])
  groupBy?: ReportGroupBy;
}

/** Teto de janela: 366 dias. Sem isso, um `from=1900-01-01` varre a base inteira. */
const MAX_RANGE_DAYS = 366;
const DAY_MS = 86_400_000;

export interface ResolvedRange {
  /** Inicio do primeiro dia (inclusive), no fuso do servidor. */
  from: Date;
  /** Inicio do dia SEGUINTE ao ultimo dia (exclusivo). */
  to: Date;
  /** Rotulos originais, para ecoar na resposta e no nome do arquivo CSV. */
  fromLabel: string;
  toLabel: string;
  days: number;
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;

function startOfDay(label: string): Date {
  const [y, m, d] = label.split('-').map(Number);
  const date = new Date(y, m - 1, d, 0, 0, 0, 0);
  if (
    Number.isNaN(date.getTime()) ||
    date.getFullYear() !== y ||
    date.getMonth() !== m - 1 ||
    date.getDate() !== d
  ) {
    throw new BadRequestException(`Data inválida: ${label}`);
  }
  return date;
}

/** Janela padrao quando nada e informado: os ultimos 30 dias, incluindo hoje. */
export function resolveRange(query: ReportQueryDto): ResolvedRange {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const toStart = query.to ? startOfDay(query.to) : today;
  const fromStart = query.from
    ? startOfDay(query.from)
    : new Date(toStart.getTime() - 29 * DAY_MS);

  if (fromStart > toStart) {
    throw new BadRequestException('A data inicial não pode ser maior que a final.');
  }

  const days = Math.round((toStart.getTime() - fromStart.getTime()) / DAY_MS) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new BadRequestException(
      `Período muito longo: ${days} dias. O máximo é ${MAX_RANGE_DAYS}.`,
    );
  }

  const to = new Date(toStart);
  to.setDate(to.getDate() + 1);

  return { from: fromStart, to, fromLabel: iso(fromStart), toLabel: iso(toStart), days };
}

/** Janela imediatamente anterior, de mesmo tamanho — base da variacao percentual. */
export function previousRange(range: ResolvedRange): { from: Date; to: Date } {
  const from = new Date(range.from);
  from.setDate(from.getDate() - range.days);
  return { from, to: range.from };
}
