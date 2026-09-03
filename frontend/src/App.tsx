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
import { useAuthStore } from './store/authStore';

function Private({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => !!state.token);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" replace />;
}

function App() {
  const isAuthenticated = useAuthStore((state) => !!state.token);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/pdv" element={<Private><PdvPage /></Private>} />
      <Route path="/dashboard" element={<Private><DashboardPage /></Private>} />
      <Route path="/produtos" element={<Private><ProductsPage /></Private>} />
      <Route path="/estoque" element={<Private><InventoryPage /></Private>} />
      <Route path="/vendas" element={<Private><SalesPage /></Private>} />
      <Route path="/clientes" element={<Private><CustomersPage /></Private>} />
      <Route path="/caixa" element={<Private><CashPage /></Private>} />
      <Route path="/configuracoes" element={<Private><SettingsPage /></Private>} />
      <Route
        path="*"
        element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />}
      />
    </Routes>
  );
}

export default App;
