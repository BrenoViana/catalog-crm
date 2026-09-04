import './LoginPage.css';
import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { homePathFor, useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { authApi, storeSettingsApi } from '../lib/api-client';

export function LoginPage() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const theme = useThemeStore((state) => state.theme);

  const branding = useQuery({
    queryKey: ['store-branding'],
    queryFn: storeSettingsApi.branding,
    staleTime: 5 * 60 * 1000,
  });
  const b = branding.data;
  const logo =
    (theme === 'light' ? b?.logoLightUrl : b?.logoDarkUrl) ||
    b?.logoLightUrl ||
    b?.logoDarkUrl ||
    null;
  const storeName = b?.tradeName || b?.legalName || 'Catalog';
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (!username || !password) {
      setError('Informe usuário e senha.');
      setLoading(false);
      return;
    }

    try {
      const response = await authApi.login({ username, password });
      setAuth(response.access_token, response.user, response.permissions);
      // Cada usuário cai na primeira tela que suas permissões abrem.
      navigate(homePathFor(response.permissions));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          {logo ? (
            <img className="auth-logo" src={logo} alt={storeName} />
          ) : (
            <>
              <div className="brand-mark">{storeName.charAt(0).toUpperCase()}</div>
              <div>
                <p className="eyebrow">PDV &amp; Catálogo</p>
                <h1>{storeName}</h1>
              </div>
            </>
          )}
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <label>
            Usuário
            <input 
              value={username} 
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </label>

          <label>
            Senha
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </label>

          {error ? <p className="auth-error">{error}</p> : null}

          <button 
            type="submit" 
            className="primary-button large-button"
            disabled={loading}
          >
            {loading ? 'Autenticando...' : 'Entrar no sistema'}
          </button>
        </form>
      </div>
    </div>
  );
}
