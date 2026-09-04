import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PdvPage } from './pages/PdvPage';
import { ProductsPage } from './pages/ProductsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { InventoryPage } from './pages/InventoryPage';
import { SalesPage } from './pages/SalesPage';
import { CustomersPage } from './pages/CustomersPage';
import { CashPage } from './pages/CashPage';
import { SettingsPage } from './pages/SettingsPage';
import { homePathFor, useAuthStore } from './store/authStore';

/**
 * Exige autenticação E a permissão da tela. Quem não tem cai na própria tela
 * inicial. É só a casca: o backend revalida cada requisição.
 */
function Guard({ need, children }: { need: string; children: ReactNode }) {
  const token = useAuthStore((state) => !!state.token);
  const permissions = useAuthStore((state) => state.permissions);
  if (!token) return <Navigate to="/login" replace />;
  if (!permissions.includes(need)) {
    return <Navigate to={homePathFor(permissions)} replace />;
  }
  return <>{children}</>;
}

function App() {
  const isAuthenticated = useAuthStore((state) => !!state.token);
  const permissions = useAuthStore((state) => state.permissions);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pdv" element={<Guard need="sales.create"><PdvPage /></Guard>} />
      <Route path="/dashboard" element={<Guard need="dashboard.view"><DashboardPage /></Guard>} />
      <Route path="/produtos" element={<Guard need="products.view"><ProductsPage /></Guard>} />
      <Route path="/categorias" element={<Guard need="categories.manage"><CategoriesPage /></Guard>} />
      <Route path="/estoque" element={<Guard need="inventory.view"><InventoryPage /></Guard>} />
      <Route path="/vendas" element={<Guard need="sales.view"><SalesPage /></Guard>} />
      <Route path="/clientes" element={<Guard need="customers.view"><CustomersPage /></Guard>} />
      <Route path="/caixa" element={<Guard need="cash.operate"><CashPage /></Guard>} />
      <Route path="/configuracoes" element={<Guard need="settings.manage"><SettingsPage /></Guard>} />
      <Route
        path="*"
        element={
          <Navigate to={isAuthenticated ? homePathFor(permissions) : '/login'} replace />
        }
      />
    </Routes>
  );
}

export default App;
