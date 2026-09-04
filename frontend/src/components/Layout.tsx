import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useNavigate } from 'react-router-dom';
import { storeSettingsApi } from '../lib/api-client';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';

const SIDEBAR_KEY = 'catalog.sidebar';

function initialSidebarOpen(): boolean {
  try {
    const stored = localStorage.getItem(SIDEBAR_KEY);
    if (stored === 'open') return true;
    if (stored === 'closed') return false;
  } catch {
    /* storage indisponível */
  }
  return typeof window === 'undefined' || window.innerWidth > 900;
}

type NavLeaf = { to: string; label: string; need?: string };
type NavGroup = { group: string; items: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

const nav: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard', need: 'dashboard.view' },
  {
    group: 'Caixa',
    items: [
      { to: '/pdv', label: 'Nova venda', need: 'sales.create' },
      { to: '/vendas', label: 'Vendas', need: 'sales.view' },
      { to: '/caixa', label: 'Abertura de caixa', need: 'cash.operate' },
    ],
  },
  {
    group: 'Cadastros',
    items: [
      { to: '/produtos', label: 'Produtos', need: 'products.view' },
      { to: '/categorias', label: 'Categorias', need: 'categories.manage' },
      { to: '/clientes', label: 'Clientes', need: 'customers.view' },
      { to: '/estoque', label: 'Estoque', need: 'inventory.view' },
    ],
  },
];

function NavItem({ to, label, sub }: NavLeaf & { sub?: boolean }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `${sub ? 'nav-subitem' : 'nav-item'} ${isActive ? 'active' : ''}`
      }
    >
      {label}
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);

  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggle);

  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const setSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
    } catch {
      /* storage indisponível */
    }
  };
  const closeOnMobile = () => {
    if (typeof window !== 'undefined' && window.innerWidth <= 900) setSidebar(false);
  };

  const store = useQuery({
    queryKey: ['store-settings'],
    queryFn: storeSettingsApi.get,
    staleTime: 5 * 60 * 1000,
  });

  const logo = theme === 'light' ? store.data?.logoLightUrl : store.data?.logoDarkUrl;
  const storeName = store.data?.tradeName || store.data?.legalName || 'Catalog';

  const visible = (item: NavLeaf) => !item.need || permissions.includes(item.need);

  const entries = nav
    .map((entry) =>
      'group' in entry ? { ...entry, items: entry.items.filter(visible) } : entry,
    )
    .filter((entry) => ('group' in entry ? entry.items.length > 0 : visible(entry)));

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className={`app-shell ${sidebarOpen ? '' : 'nav-collapsed'}`}>
      <button
        type="button"
        className="sidebar-toggle"
        onClick={() => setSidebar(!sidebarOpen)}
        aria-label={sidebarOpen ? 'Recolher menu' : 'Abrir menu'}
        aria-expanded={sidebarOpen}
      >
        <span aria-hidden="true">☰</span>
      </button>
      <div
        className="sidebar-backdrop"
        onClick={() => setSidebar(false)}
        aria-hidden="true"
      />
      <aside className="sidebar">
        <div className="brand-box">
          {logo ? (
            <img className="brand-logo" src={logo} alt={storeName} />
          ) : (
            <>
              <div className="brand-mark">{storeName.charAt(0).toUpperCase()}</div>
              <div>
                <strong>{storeName}</strong>
                <span>PDV &amp; Catálogo</span>
              </div>
            </>
          )}
        </div>

        <nav className="nav-menu" onClick={closeOnMobile}>
          {entries.map((entry) =>
            'group' in entry ? (
              <div key={entry.group} className="nav-group">
                <span className="nav-group-title">{entry.group}</span>
                {entry.items.map((item) => (
                  <NavItem key={item.to} {...item} sub />
                ))}
              </div>
            ) : (
              <NavItem key={entry.to} {...entry} />
            ),
          )}
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            aria-label={`Mudar para tema ${theme === 'dark' ? 'claro' : 'escuro'}`}
          >
            <span>{theme === 'dark' ? '🌙 Tema escuro' : '☀️ Tema claro'}</span>
            <span>Trocar</span>
          </button>

          {permissions.includes('settings.manage') && (
            <NavLink
              to="/configuracoes"
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              Configurações
            </NavLink>
          )}

          <div className="user-box">
            <div>
              <strong>{user?.name ?? 'Usuário'}</strong>
              <small>{user?.roleName ?? user?.role ?? ''}</small>
            </div>
            <button className="footer-action" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
