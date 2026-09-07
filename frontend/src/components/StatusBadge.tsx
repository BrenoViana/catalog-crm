/**
 * Etiqueta de situação com ponto.
 *
 * O ponto só pulsa quando a situação ainda pode mudar sozinha — título em
 * aberto, parcial, vencido. Pago e cancelado são assunto encerrado e ficam com
 * o ponto parado: numa lista de cem linhas, movimento em tudo é o mesmo que
 * movimento em nada.
 *
 * A cor sozinha não conta a situação — o rótulo escrito ao lado é que conta.
 * O ponto é reforço visual e vai com aria-hidden.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: '',
  success: 'tag-success',
  warning: 'tag-warning',
  danger: 'tag-danger',
};

export function StatusBadge({
  tone,
  label,
  live = false,
}: {
  tone: BadgeTone;
  label: string;
  /** Situação que ainda anda: o ponto pulsa. */
  live?: boolean;
}) {
  return (
    <span className={['tag', TONE_CLASS[tone], live ? '' : 'tag-static'].filter(Boolean).join(' ')}>
      <span className="tag-dot" aria-hidden="true" />
      {label}
    </span>
  );
}
