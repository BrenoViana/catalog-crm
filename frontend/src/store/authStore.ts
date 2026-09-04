import { create } from 'zustand';
import type { AuthUser } from '../lib/api-client';

const TOKEN_KEY = 'catalog.token';
const USER_KEY = 'catalog.user';
const PERMS_KEY = 'catalog.permissions';

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  /**
   * Conjunto efetivo do usuário, vindo do backend. Serve só para montar a UI —
   * a autorização de verdade é reavaliada no servidor a cada requisição.
   */
  permissions: string[];
  setAuth: (token: string, user: AuthUser, permissions: string[]) => void;
  setPermissions: (permissions: string[]) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem(TOKEN_KEY),
  user: read<AuthUser | null>(USER_KEY, null),
  permissions: read<string[]>(PERMS_KEY, []),

  setAuth: (token, user, permissions) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    localStorage.setItem(PERMS_KEY, JSON.stringify(permissions));
    set({ token, user, permissions });
  },

  setPermissions: (permissions) => {
    try {
      localStorage.setItem(PERMS_KEY, JSON.stringify(permissions));
    } catch {
      /* storage indisponível: vale só para esta sessão */
    }
    set({ permissions });
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(PERMS_KEY);
    set({ token: null, user: null, permissions: [] });
  },
}));

/** true se o usuário tem TODAS as permissões pedidas. */
export function useCan(...required: string[]): boolean {
  const permissions = useAuthStore((s) => s.permissions);
  return required.every((p) => permissions.includes(p));
}

/** Primeira tela do usuário, de acordo com o que ele pode ver. */
export function homePathFor(permissions: string[]): string {
  if (permissions.includes('dashboard.view')) return '/dashboard';
  if (permissions.includes('sales.create')) return '/pdv';
  if (permissions.includes('sales.view')) return '/vendas';
  return '/pdv';
}
