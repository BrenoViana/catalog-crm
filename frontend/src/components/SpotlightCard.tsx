/**
 * Cartão que acende sob o cursor.
 *
 * O componente não pinta nada: ele só escreve `--mouse-x` e `--mouse-y` no
 * próprio elemento. Quem desenha a luz é a regra `.spotlight::before` em
 * styles.css — um radial-gradient que entra e sai por opacidade. Assim o
 * mousemove nunca dispara repintura de fundo, só a troca de duas variáveis.
 *
 * A escrita vai dentro de um requestAnimationFrame e no máximo uma por quadro:
 * o mousemove do navegador chega bem mais rápido que a tela atualiza, e seguir
 * cada evento seria trabalho jogado fora.
 *
 * Em telas de toque o evento nunca acontece e o cartão fica no estado neutro,
 * que é o mesmo cartão sem luz. Quem pediu menos movimento no sistema também
 * não paga nada: nem o listener trabalha, nem o pseudo-elemento aparece.
 */
import {
  useCallback,
  useEffect,
  useRef,
  type HTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from 'react';

type SpotlightCardProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  /** Tag renderizada. Padrão `article`: no uso corrente é um cartão de conteúdo. */
  as?: 'article' | 'section' | 'div';
};

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export function SpotlightCard({
  as: Tag = 'article',
  className = '',
  children,
  onMouseMove,
  ...rest
}: SpotlightCardProps) {
  const frame = useRef(0);

  useEffect(
    () => () => {
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      onMouseMove?.(event);
      if (frame.current || prefersReducedMotion()) return;

      // Lidos agora, fora do rAF: dentro do quadro seguinte o evento já não
      // responde por `currentTarget`.
      const element = event.currentTarget;
      const { clientX, clientY } = event;

      frame.current = requestAnimationFrame(() => {
        frame.current = 0;
        const rect = element.getBoundingClientRect();
        element.style.setProperty('--mouse-x', `${clientX - rect.left}px`);
        element.style.setProperty('--mouse-y', `${clientY - rect.top}px`);
      });
    },
    [onMouseMove],
  );

  return (
    <Tag className={`spotlight ${className}`.trim()} onMouseMove={handleMouseMove} {...rest}>
      {children}
    </Tag>
  );
}
