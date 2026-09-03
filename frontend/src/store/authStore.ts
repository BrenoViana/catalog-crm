import { create } from 'zustand';

interface AuthState {
  token: string | null;
  user: { id: string; username: string; name: string; role: string } | null;
  setAuth: (token: string, user: { id: string; username: string; name: string; role: string }) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('crm-token'),
  user: (() => {
    const raw = localStorage.getItem('crm-user');
    return raw ? JSON.parse(raw) : null;
  })(),
  setAuth: (token, user) => {
    localStorage.setItem('crm-token', token);
    localStorage.setItem('crm-user', JSON.stringify(user));
    set({ token, user });
  },
  logout: () => {
    localStorage.removeItem('crm-token');
    localStorage.removeItem('crm-user');
    set({ token: null, user: null });
  },
}));
