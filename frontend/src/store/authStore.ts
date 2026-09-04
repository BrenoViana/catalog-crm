import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: { id: string; username: string; name: string; role: string } | null;
  setAuth: (token: string, user: { id: string; username: string; name: string; role: string }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('catalog.token'),
  user: (() => {
    try {
      const raw = localStorage.getItem('catalog.user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  })(),
  setAuth: (token, user) => {
    localStorage.setItem('catalog.token', token);
    localStorage.setItem('catalog.user', JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('catalog.token');
    localStorage.removeItem('catalog.user');
    set({ token: null, user: null });
  },
}));
