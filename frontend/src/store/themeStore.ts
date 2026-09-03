import { create } from 'zustand';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'crm-theme';

function readStored(): Theme | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'dark' || v === 'light' ? v : null;
  } catch {
    return null;
  }
}

function systemPreference(): Theme {
  return typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: light)').matches
    ? 'light'
    : 'dark';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

const initial: Theme = readStored() ?? systemPreference();
apply(initial);

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: initial,
  setTheme: (theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* storage indisponivel: tema vale so para esta sessao */
    }
    apply(theme);
    set({ theme });
  },
  toggle: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
}));
