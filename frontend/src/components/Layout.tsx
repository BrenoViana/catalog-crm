import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

const navItems = [
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/clientes', label: 'Clientes' },
  { to: '/vendedores', label: 'Vendedores' },
  { to: '/oportunidades', label: 'Oportunidades' },
  { to: '/vendas', label: 'Vendas' },
  { to: '/configuracoes', label: 'Configurações' },
];

export function Layout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const logout = useAuthStore((state) => state.logout);
  const user = useAuthStore((state) => state.user);

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
            <span>CRM</span>
          </div>
        </div>

        <nav className="nav-menu">
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="user-box">
          <div>
            <strong>{user?.name ?? 'Usuário'}</strong>
            <small>{user?.role ?? 'admin'}</small>
          </div>
          <button className="ghost-button" onClick={handleLogout}>Sair</button>
        </div>
      </aside>

      <main className="main-content">{children}</main>
    </div>
  );
}
