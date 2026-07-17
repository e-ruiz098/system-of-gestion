import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Route, Switch, Router as WouterRouter } from 'wouter';

import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { Shell } from '@/components/layout/Shell';

// Pages
import Setup from '@/pages/setup';
import Login from '@/pages/login';
import Dashboard from '@/pages/dashboard';
import Venta from '@/pages/venta';
import Productos from '@/pages/productos';
import Devoluciones from '@/pages/devoluciones';
import VentasHistorial from '@/pages/ventas-historial';
import Cierres from '@/pages/cierres';
import Configuracion from '@/pages/configuracion';
import CajaApertura from '@/pages/caja/apertura';
import CajaCierre from '@/pages/caja/cierre';

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/setup" component={Setup} />
      <Route path="/login" component={Login} />
      <Route path="/">
        {() => (
          <Shell>
            <Switch>
              <Route path="/" component={Dashboard} />
              <Route path="/dashboard" component={Dashboard} />
              <Route path="/venta" component={Venta} />
              <Route path="/productos" component={Productos} />
              <Route path="/devoluciones" component={Devoluciones} />
              <Route path="/ventas-historial" component={VentasHistorial} />
              <Route path="/cierres" component={Cierres} />
              <Route path="/configuracion" component={Configuracion} />
              <Route path="/caja/apertura" component={CajaApertura} />
              <Route path="/caja/cierre" component={CajaCierre} />
              <Route component={NotFound} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/dashboard">
        {() => (
          <Shell>
            <Switch>
              <Route path="/dashboard" component={Dashboard} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/venta">
        {() => (
          <Shell>
            <Switch>
              <Route path="/venta" component={Venta} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/productos">
        {() => (
          <Shell>
            <Switch>
              <Route path="/productos" component={Productos} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/devoluciones">
        {() => (
          <Shell>
            <Switch>
              <Route path="/devoluciones" component={Devoluciones} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/ventas-historial">
        {() => (
          <Shell>
            <Switch>
              <Route path="/ventas-historial" component={VentasHistorial} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/cierres">
        {() => (
          <Shell>
            <Switch>
              <Route path="/cierres" component={Cierres} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/configuracion">
        {() => (
          <Shell>
            <Switch>
              <Route path="/configuracion" component={Configuracion} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/caja/apertura">
        {() => (
          <Shell>
            <Switch>
              <Route path="/caja/apertura" component={CajaApertura} />
            </Switch>
          </Shell>
        )}
      </Route>
      <Route path="/caja/cierre">
        {() => (
          <Shell>
            <Switch>
              <Route path="/caja/cierre" component={CajaCierre} />
            </Switch>
          </Shell>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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

export default App;
