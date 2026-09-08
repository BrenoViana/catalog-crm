/**
 * Ícones de interface usados fora do menu lateral (toolbars, botões de ação).
 *
 * Mesma linha dos ícones de navegação: SVG inline, sem biblioteca, herdando
 * `currentColor` e o traço, então acompanham tema e estado do controle que os
 * hospeda. São decorativos — quem nomeia a ação é o texto ao lado —, por isso
 * vão com `aria-hidden`.
 */
import type { ReactNode } from 'react';

function Ico({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      className="ui-icon"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconSearch = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Ico>
);

export const IconCaret = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="m6 9 6 6 6-6" />
  </Ico>
);

export const IconCategory = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" />
  </Ico>
);

export const IconBox = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M12 3.2 20 7.5v9L12 20.8 4 16.5v-9z" />
    <path d="M4 7.5 12 12l8-4.5M12 12v8.8" />
  </Ico>
);

export const IconPlus = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M12 5v14M5 12h14" />
  </Ico>
);

export const IconFilter = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 5h16l-6 8v6l-4-2v-4z" />
  </Ico>
);

export const IconCake = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 20h16M5 20v-7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7" />
    <path d="M4 15c1.2 0 1.2 1 2.4 1s1.2-1 2.4-1 1.2 1 2.4 1 1.2-1 2.4-1 1.2 1 2.4 1 1.2-1 2.4-1" />
    <path d="M12 8V5M12 5c0-1 1-1 1-2M12 5c0-1-1-1-1-2" />
  </Ico>
);

export const IconCamera = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 8h3l1.6-2h6.8L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.4" />
  </Ico>
);

export const IconUpload = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M12 16V4m0 0L8 8m4-4 4 4" />
    <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
  </Ico>
);

export const IconRotate = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M20 12a8 8 0 1 1-2.6-5.9" />
    <path d="M20 4v4h-4" />
  </Ico>
);

export const IconZoom = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6M8 11h6M11 8v6" />
  </Ico>
);

export const IconTrash = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" />
  </Ico>
);

export const IconGrid = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 13h6v6H4zM14 13h6v6h-6z" />
  </Ico>
);

export const IconList = ({ size }: { size?: number }) => (
  <Ico size={size}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </Ico>
);
