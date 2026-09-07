import type { ReportFrequency } from '@prisma/client';

const pad = (n: number) => String(n).padStart(2, '0');
const label = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export interface ScheduleShape {
  frequency: ReportFrequency;
  hour: number;
  weekday: number | null;
  monthday: number | null;
}

/**
 * Proxima execucao devida, a partir de um instante de referencia.
 *
 * Tudo aqui e resolvido no fuso do SERVIDOR, que e o criterio unico de "dia" do
 * sistema (o mesmo do caixa, dos relatorios e do fechamento). Um agendamento
 * das 7h tem de sair as 7h da loja, nao as 7h UTC.
 *
 * O calculo e sempre para a FRENTE e nunca no passado: se o backend ficou
 * desligado tres dias, ao voltar ele roda a ocorrencia devida uma vez e agenda
 * a proxima — nao dispara tres envios em sequencia com o mesmo relatorio.
 * Relatorio atrasado ainda serve; tres copias do mesmo relatorio as 3h da manha
 * fazem o gestor desligar o agendamento.
 */
export function nextRun(schedule: ScheduleShape, from: Date = new Date()): Date {
  const next = new Date(from);
  next.setHours(schedule.hour, 0, 0, 0);
  if (next <= from) next.setDate(next.getDate() + 1);

  if (schedule.frequency === 'SEMANAL') {
    const alvo = schedule.weekday ?? 1;
    while (next.getDay() !== alvo) next.setDate(next.getDate() + 1);
  } else if (schedule.frequency === 'MENSAL') {
    // O dia do mes e limitado a 28 na validacao: dia 31 nao existe em todo mes,
    // e um agendamento que pula fevereiro e o tipo de falha que so aparece
    // depois de o gestor ja ter parado de conferir.
    const alvo = schedule.monthday ?? 1;
    while (next.getDate() !== alvo) next.setDate(next.getDate() + 1);
  }
  return next;
}

/**
 * Janela que o relatorio deve cobrir numa execucao.
 *
 * O periodo nunca inclui o dia da execucao. Incluir o proprio dia mandaria um
 * relatorio de um dia que ainda esta acontecendo: o gestor compararia a receita
 * de hoje as 7h com a de ontem inteiro e concluiria que a loja despencou.
 *
 * - **Diario**: ontem.
 * - **Semanal**: os sete dias que terminam ontem.
 * - **Mensal**: o mes CIVIL anterior, inteiro — que e o recorte com que o
 *   lojista e o contador ja conversam, e nao "os ultimos 30 dias".
 */
export function windowFor(
  frequency: ReportFrequency,
  runAt: Date,
): { from: string; to: string } {
  if (frequency === 'MENSAL') {
    const primeiro = new Date(runAt.getFullYear(), runAt.getMonth() - 1, 1);
    // Dia 0 do mes seguinte = ultimo dia do mes anterior, sem tabela de meses.
    const ultimo = new Date(runAt.getFullYear(), runAt.getMonth(), 0);
    return { from: label(primeiro), to: label(ultimo) };
  }

  const to = new Date(runAt);
  to.setHours(0, 0, 0, 0);
  to.setDate(to.getDate() - 1);

  const from = new Date(to);
  if (frequency === 'SEMANAL') from.setDate(from.getDate() - 6);
  return { from: label(from), to: label(to) };
}
