/**
 * Ícones da faixa de indicadores do financeiro.
 *
 * Mesma regra dos ícones do menu (nav-icons.tsx): SVG inline, traço 1.6,
 * `currentColor`, sem biblioteca. Aqui eles são decorativos — o rótulo mono
 * acima do número é que nomeia o indicador — então vão com `aria-hidden`.
 */
import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const FINANCE_ICONS = {
  /** Carteira: o que a loja tem a receber. */
  carteira: () => (
    <Glyph>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H18v3" />
      <path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5H5.5A2.5 2.5 0 0 1 3 7.5Z" />
      <circle cx="16.5" cy="14.5" r="1.1" />
    </Glyph>
  ),
  /** Vencido: o que passou da data. */
  vencido: () => (
    <Glyph>
      <path d="M10.6 3.9 2.5 18a1.6 1.6 0 0 0 1.4 2.4h16.2A1.6 1.6 0 0 0 21.5 18L13.4 3.9a1.6 1.6 0 0 0-2.8 0Z" />
      <path d="M12 9.5v4" />
      <path d="M12 17h.01" />
    </Glyph>
  ),
  /** Prazo curto: o que vence esta semana. */
  prazo: () => (
    <Glyph>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </Glyph>
  ),
  /** Quem deve: clientes com saldo em aberto. */
  clientes: () => (
    <Glyph>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6" />
      <path d="M18 14.9c2 .5 3.5 2.1 3.5 4.6" />
    </Glyph>
  ),
  /** Recorte atual: o total do que está na tela. */
  recorte: () => (
    <Glyph>
      <path d="M4 5h16" />
      <path d="M7 12h10" />
      <path d="M10 19h4" />
    </Glyph>
  ),
} as const;

export type FinanceIcon = keyof typeof FINANCE_ICONS;
