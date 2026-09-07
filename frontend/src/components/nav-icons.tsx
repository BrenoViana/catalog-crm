/**
 * Ícones do menu lateral.
 *
 * SVG inline, sem biblioteca: são nove ícones, e uma dependência de ícones
 * custaria mais bytes no bundle do PDV do que o arquivo inteiro. Todos herdam
 * `currentColor` e o traço de 1.6, então acompanham o tema e o estado ativo do
 * item sem nenhuma regra de CSS extra.
 *
 * São decorativos: o rótulo de texto ao lado é que nomeia o destino, por isso
 * vão com `aria-hidden`.
 */
import type { ReactNode } from 'react';

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
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

export const NAV_ICONS: Record<string, () => ReactNode> = {
  inicio: () => (
    <Glyph>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.8V20h14V9.8" />
      <path d="M9.5 20v-5.5h5V20" />
    </Glyph>
  ),
  venda: () => (
    <Glyph>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v9M9.2 10a2.6 2.6 0 0 1 2.8-1.6c1.6 0 2.6.8 2.6 1.9 0 2.6-5.4 1.3-5.4 3.9 0 1.1 1 1.9 2.6 1.9A2.6 2.6 0 0 0 14.8 14" />
    </Glyph>
  ),
  vendas: () => (
    <Glyph>
      <path d="M4 5h16v14H4z" />
      <path d="M8 9.5h8M8 13h8M8 16.5h4" />
    </Glyph>
  ),
  caixa: () => (
    <Glyph>
      <path d="M3 8.5h18v11H3z" />
      <path d="M3 8.5 5.5 4.5h13L21 8.5" />
      <path d="M10 12.5h4" />
    </Glyph>
  ),
  produtos: () => (
    <Glyph>
      <path d="M12 3.2 20 7.5v9L12 20.8 4 16.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v8.8" />
    </Glyph>
  ),
  categorias: () => (
    <Glyph>
      <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" />
    </Glyph>
  ),
  promocoes: () => (
    <Glyph>
      <path d="M20.5 12 12 20.5 3.5 12V3.5H12z" />
      <circle cx="8" cy="8" r="1.4" />
    </Glyph>
  ),
  estoque: () => (
    <Glyph>
      <path d="M3 7.5h18v12H3z" />
      <path d="M3 7.5 12 3l9 4.5M9 12h6" />
    </Glyph>
  ),
  clientes: () => (
    <Glyph>
      <circle cx="9.5" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a6 6 0 0 1 12 0" />
      <path d="M16.5 6.2a3.2 3.2 0 0 1 0 6.1M17.5 14a5.4 5.4 0 0 1 3.2 5" />
    </Glyph>
  ),
  financeiro: () => (
    <Glyph>
      <path d="M3 7h18v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />
      <path d="M3 7l3-3h12l3 3" />
      <circle cx="12" cy="13" r="2.5" />
    </Glyph>
  ),
  relatorios: () => (
    <Glyph>
      <path d="M4 20V4M4 20h16" />
      <path d="M8 20v-6M12.5 20V8M17 20v-9" />
    </Glyph>
  ),
  configuracoes: () => (
    <Glyph>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.8v2.4M12 18.8v2.4M4.5 7.5l2 1.2M17.5 15.3l2 1.2M4.5 16.5l2-1.2M17.5 8.7l2-1.2" />
    </Glyph>
  ),
  /** Tema escuro. Era um emoji: emoji muda de desenho a cada sistema e não
      herda a cor do item, então virou traço como todos os outros. */
  lua: () => (
    <Glyph>
      <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />
    </Glyph>
  ),
  /** Tema claro. */
  sol: () => (
    <Glyph>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </Glyph>
  ),
};
