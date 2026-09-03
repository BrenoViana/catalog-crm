import { Navigate, Route, Routes } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CustomersPage } from './pages/CustomersPage';
import { SellersPage } from './pages/SellersPage';
import { OpportunitiesPage } from './pages/OpportunitiesPage';
import { SalesPage } from './pages/SalesPage';
import { SettingsPage } from './pages/SettingsPage';
import { useAuthStore } from './store/authStore';

function App() {
  const isAuthenticated = useAuthStore((state) => !!state.token);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/dashboard"
        element={isAuthenticated ? <DashboardPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/clientes"
        element={isAuthenticated ? <CustomersPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/vendedores"
        element={isAuthenticated ? <SellersPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/oportunidades"
        element={isAuthenticated ? <OpportunitiesPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/vendas"
        element={isAuthenticated ? <SalesPage /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/configuracoes"
        element={isAuthenticated ? <SettingsPage /> : <Navigate to="/login" replace />}
      />
      <Route path="*" element={<Navigate to={isAuthenticated ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

export default App;
