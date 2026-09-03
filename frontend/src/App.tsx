import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PdvPage } from './pages/PdvPage';
import { ProductsPage } from './pages/ProductsPage';
import { InventoryPage } from './pages/InventoryPage';
import { SalesPage } from './pages/SalesPage';
import { CustomersPage } from './pages/CustomersPage';
import { CashPage } from './pages/CashPage';
import { SettingsPage } from './pages/SettingsPage';
import { atLeast, homePath, type Role } from './lib/roles';
import { useAuthStore } from './store/authStore';

function Private({ children }: { children: ReactNode }) {
  const isAuthenticated = useAuthStore((state) => !!state.token);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

/** Exige autenticacao E papel minimo; quem nao tem cai na sua tela inicial. */
function Guard({ min, children }: { min: Role; children: ReactNode }) {
  const token = useAuthStore((state) => !!state.token);
  const role = useAuthStore((state) => state.user?.role);
  if (!token) return <Navigate to="/login" replace />;
  if (!atLeast(role, min)) return <Navigate to={homePath(role)} replace />;
  return <>{children}</>;
}

function App() {
  const isAuthenticated = useAuthStore((state) => !!state.token);
  const role = useAuthStore((state) => state.user?.role);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pdv" element={<Private><PdvPage /></Private>} />
      <Route path="/dashboard" element={<Guard min="GERENTE"><DashboardPage /></Guard>} />
      <Route path="/produtos" element={<Private><ProductsPage /></Private>} />
      <Route path="/estoque" element={<Private><InventoryPage /></Private>} />
      <Route path="/vendas" element={<Private><SalesPage /></Private>} />
      <Route path="/clientes" element={<Private><CustomersPage /></Private>} />
      <Route path="/caixa" element={<Private><CashPage /></Private>} />
      <Route path="/configuracoes" element={<Guard min="ADMIN"><SettingsPage /></Guard>} />
      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? homePath(role) : '/login'} replace />}
      />
    </Routes>
  );
}

export default App;
