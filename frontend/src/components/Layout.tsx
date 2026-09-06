import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { storeSettingsApi } from '../lib/api-client';
import { useAuthStore } from '../store/authStore';
import { useThemeStore } from '../store/themeStore';
import { NAV_ICONS } from './nav-icons';

const SIDEBAR_KEY = 'catalog.sidebar';
const COLLAPSED_GROUPS_KEY = 'catalog.navGroups';

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

function initialCollapsedGroups(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

import { MODULE_OF_PERMISSION, useLicense } from '../lib/useLicense';

type NavLeaf = {
  to: string;
  label: string;
  need?: string;
  icon: keyof typeof NAV_ICONS;
  /** Item de ação principal do menu: fica em destaque no topo. */
  primary?: boolean;
};
type NavGroup = { group: string; items: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

/**
 * Menu lateral.
 *
 * A ordem é por frequência de uso, não por hierarquia do banco: quem trabalha
 * no balcão abre "Nova venda" dezenas de vezes por dia e "Categorias" uma vez
 * por mês. Por isso a operação vem primeiro, os cadastros no meio e a análise
 * no fim — e "Configurações" fica no rodapé, fora do fluxo diário.
 *
 * Os grupos são recolhíveis e a escolha do usuário persiste. Um grupo que sobra
 * com um item só (porque os outros dependem de permissão ou de módulo não
 * licenciado) é promovido a item de topo: rótulo de grupo com um filho só é
 * ruído.
 */
const nav: NavEntry[] = [
  { to: '/dashboard', label: 'Início', need: 'dashboard.view', icon: 'inicio' },
  {
    group: 'Operação',
    items: [
      { to: '/pdv', label: 'Nova venda', need: 'sales.create', icon: 'venda', primary: true },
      { to: '/vendas', label: 'Vendas', need: 'sales.view', icon: 'vendas' },
      { to: '/caixa', label: 'Caixa', need: 'cash.operate', icon: 'caixa' },
    ],
  },
  {
    group: 'Catálogo',
    items: [
      { to: '/produtos', label: 'Produtos', need: 'products.view', icon: 'produtos' },
      { to: '/categorias', label: 'Categorias', need: 'categories.manage', icon: 'categorias' },
      { to: '/promocoes', label: 'Promoções', need: 'promotions.manage', icon: 'promocoes' },
      { to: '/estoque', label: 'Estoque', need: 'inventory.view', icon: 'estoque' },
    ],
  },
  {
    group: 'Clientes',
    items: [{ to: '/clientes', label: 'Clientes', need: 'customers.view', icon: 'clientes' }],
  },
  {
    group: 'Análise',
    items: [
      { to: '/financeiro', label: 'Financeiro', need: 'finance.view', icon: 'financeiro' },
      { to: '/relatorios', label: 'Relatórios', need: 'reports.view', icon: 'relatorios' },
    ],
  },
];

function NavItem({ to, label, icon, primary, sub }: NavLeaf & { sub?: boolean }) {
  const Icon = NAV_ICONS[icon];
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        [sub ? 'nav-subitem' : 'nav-item', primary ? 'nav-primary' : '', isActive ? 'active' : '']
          .filter(Boolean)
          .join(' ')
      }
    >
      <Icon />
      <span>{label}</span>
    </NavLink>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);
  const permissions = useAuthStore((state) => state.permissions);

  const theme = useThemeStore((state) => state.theme);
  const toggleTheme = useThemeStore((state) => state.toggle);

  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(initialCollapsedGroups);
  const setSidebar = (open: boolean) => {
    setSidebarOpen(open);
    try {
      localStorage.setItem(SIDEBAR_KEY, open ? 'open' : 'closed');
    } catch {
      /* storage indisponível */
    }
  };
  const toggleGroup = (group: string) => {
    setCollapsedGroups((current) => {
      const next = current.includes(group)
        ? current.filter((g) => g !== group)
        : [...current, group];
      try {
        localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* storage indisponível: vale só para esta sessão */
      }
      return next;
    });
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

  const { allows, aviso, situacao } = useLicense();
  // Um item some do menu quando falta a permissao OU quando o modulo dono dele
  // nao esta licenciado. Oferecer um botao que vai responder 403 e pior que
  // nao oferecer nada.
  const visible = (item: NavLeaf) => {
    if (item.need && !permissions.includes(item.need)) return false;
    const modulo = item.need ? MODULE_OF_PERMISSION[item.need] : undefined;
    return !modulo || allows(modulo);
  };

  const entries: NavEntry[] = nav
    .map((entry) =>
      'group' in entry ? { ...entry, items: entry.items.filter(visible) } : entry,
    )
    .filter((entry) => ('group' in entry ? entry.items.length > 0 : visible(entry)))
    // Grupo que sobrou com um item só vira item de topo.
    .map((entry) => ('group' in entry && entry.items.length === 1 ? entry.items[0] : entry));

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

        <nav className="nav-menu" aria-label="Navegação principal" onClick={closeOnMobile}>
          {entries.map((entry) => {
            if (!('group' in entry)) return <NavItem key={entry.to} {...entry} />;
            // Um grupo nunca fica recolhido escondendo a tela em que o usuário
            // está: ele não encontraria de volta o item que acabou de abrir.
            const hasActive = entry.items.some((i) => location.pathname.startsWith(i.to));
            const collapsed = collapsedGroups.includes(entry.group) && !hasActive;
            return (
              <div key={entry.group} className="nav-group">
                <button
                  type="button"
                  className="nav-group-title"
                  aria-expanded={!collapsed}
                  onClick={(event) => {
                    event.stopPropagation();
                    toggleGroup(entry.group);
                  }}
                >
                  <span>{entry.group}</span>
                  <span className="nav-chevron" aria-hidden="true">
                    {collapsed ? '▸' : '▾'}
                  </span>
                </button>
                {collapsed
                  ? null
                  : entry.items.map((item) => <NavItem key={item.to} {...item} sub />)}
              </div>
            );
          })}
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
            <NavItem to="/configuracoes" label="Configurações" icon="configuracoes" />
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

      <main className="main-content">
        {/* Aviso de licenca: fica no topo de TODAS as telas de proposito. O
            lojista precisa saber que vai perder modulos antes de perder, e o
            unico lugar que ele olha todo dia e a tela em que trabalha. */}
        {aviso ? (
          <div
            className={`license-banner license-${situacao ?? 'ok'}`}
            role="status"
          >
            {aviso}
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
