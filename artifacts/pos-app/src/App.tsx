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
  const { user, isLoading, isConfigured, connectionError, refetchConfig } = useAuth();

  if (isLoading) return null;

  if (connectionError) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
        <div className="max-w-md w-full p-6 bg-card rounded-xl border border-destructive/30 shadow-lg text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold">Servidor API Desconectado</h2>
          <p className="text-sm text-muted-foreground">
            No se pudo conectar con el servidor backend en <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">http://localhost:8080</code>.
          </p>
          <div className="text-xs bg-muted/60 p-3 rounded text-left font-mono space-y-1">
            <p className="text-muted-foreground font-sans text-xs">Ejecuta el servidor con:</p>
            <p className="text-primary font-bold">pnpm run dev</p>
            <p className="text-muted-foreground font-sans text-xs pt-1">O en una terminal separada:</p>
            <p className="text-primary">pnpm --filter @workspace/api-server run dev</p>
          </div>
          <button
            onClick={() => refetchConfig()}
            className="w-full py-2 px-4 bg-primary text-primary-foreground font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            Reintentar Conexión
          </button>
        </div>
      </div>
    );
  }

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
