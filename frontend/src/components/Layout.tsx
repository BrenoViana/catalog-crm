import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { atLeast, type Role } from '../lib/roles';
import { useAuthStore } from '../store/authStore';

type NavLeaf = { to: string; label: string; min?: Role };
type NavGroup = { group: string; items: NavLeaf[] };
type NavEntry = NavLeaf | NavGroup;

const nav: NavEntry[] = [
  { to: '/dashboard', label: 'Dashboard', min: 'GERENTE' },
  {
    group: 'Caixa',
    items: [
      { to: '/pdv', label: 'Nova venda' },
      { to: '/vendas', label: 'Vendas' },
      { to: '/caixa', label: 'Abertura de caixa' },
    ],
  },
  {
    group: 'Cadastros',
    items: [
      { to: '/produtos', label: 'Produtos' },
      { to: '/clientes', label: 'Clientes' },
      { to: '/estoque', label: 'Estoque' },
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
  const role = user?.role;

  const visible = (item: NavLeaf) => !item.min || atLeast(role, item.min);

  const entries = nav
    .map((entry) =>
      'group' in entry
        ? { ...entry, items: entry.items.filter(visible) }
        : entry,
    )
    .filter((entry) =>
      'group' in entry ? entry.items.length > 0 : visible(entry),
    );

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-box">
          <div className="brand-mark">C</div>
          <div>
            <strong>Catalog</strong>
            <span>PDV &amp; Catálogo</span>
          </div>
        </div>

        <nav className="nav-menu">
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
          {atLeast(role, 'ADMIN') && (
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
              <small>{role ?? ''}</small>
            </div>
            <button className="ghost-button" onClick={handleLogout}>
              Sair
            </button>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
