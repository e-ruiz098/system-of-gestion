import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, Router as WouterRouter, Redirect } from 'wouter';

import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { AdminShell } from '@/components/layout/AdminShell';
import { CajeroShell } from '@/components/layout/CajeroShell';

// Pages — shared
import Setup from '@/pages/setup';
import Login from '@/pages/login';

// Pages — Admin only
import Dashboard from '@/pages/dashboard';
import VentasHistorial from '@/pages/ventas-historial';
import Cierres from '@/pages/cierres';
import Configuracion from '@/pages/configuracion';

// Pages — shared (role differences handled inside the component)
import Venta from '@/pages/venta';
import Productos from '@/pages/productos';
import Devoluciones from '@/pages/devoluciones';
import CajaApertura from '@/pages/caja/apertura';
import CajaCierre from '@/pages/caja/cierre';

const queryClient = new QueryClient();

// ─── Admin routes ─────────────────────────────────────────────────────────────
function AdminRouter() {
  return (
    <AdminShell>
      <Switch>
        <Route path="/"                component={() => <Redirect to="/dashboard" />} />
        <Route path="/dashboard"       component={Dashboard} />
        <Route path="/venta"           component={Venta} />
        <Route path="/productos"       component={Productos} />
        <Route path="/devoluciones"    component={Devoluciones} />
        <Route path="/ventas-historial" component={VentasHistorial} />
        <Route path="/cierres"         component={Cierres} />
        <Route path="/configuracion"   component={Configuracion} />
        <Route path="/caja/apertura"   component={CajaApertura} />
        <Route path="/caja/cierre"     component={CajaCierre} />
        {/* Catch unknown admin paths → dashboard */}
        <Route component={() => <Redirect to="/dashboard" />} />
      </Switch>
    </AdminShell>
  );
}

// ─── Cajero routes ────────────────────────────────────────────────────────────
function CajeroRouter() {
  return (
    <CajeroShell>
      <Switch>
        <Route path="/"              component={() => <Redirect to="/venta" />} />
        <Route path="/venta"         component={Venta} />
        <Route path="/productos"     component={Productos} />
        <Route path="/devoluciones"  component={Devoluciones} />
        <Route path="/caja/apertura" component={CajaApertura} />
        <Route path="/caja/cierre"   component={CajaCierre} />
        {/* Any admin-only path → redirect to POS */}
        <Route component={() => <Redirect to="/venta" />} />
      </Switch>
    </CajeroShell>
  );
}

// ─── Role gate ────────────────────────────────────────────────────────────────
function AuthenticatedApp() {
  const { user, isLoading, isConfigured } = useAuth();

  if (isLoading) return null;

  if (!isConfigured) return <Redirect to="/setup" />;
  if (!user)        return <Redirect to="/login" />;

  return user.rol === 'admin' ? <AdminRouter /> : <CajeroRouter />;
}

// ─── Top-level router ─────────────────────────────────────────────────────────
function Router() {
  return (
    <Switch>
      <Route path="/setup" component={Setup} />
      <Route path="/login" component={Login} />
      <Route component={AuthenticatedApp} />
    </Switch>
  );
}

// ─── App root ─────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <ThemeProvider>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </ThemeProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}
