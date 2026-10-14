import React from 'react';
import { useGetDashboard, useGetVentasPorDia, useGetProductosTop, useGetStockAlerta } from '@workspace/api-client-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import { DollarSign, ShoppingCart, Package, AlertTriangle, ArrowRight } from 'lucide-react';
import { Link } from 'wouter';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useCurrency } from '@/hooks/use-currency';

export default function Dashboard() {
  const { data: dashboard, isLoading: isDashboardLoading } = useGetDashboard();
  const { data: ventasDia, isLoading: isVentasLoading } = useGetVentasPorDia();
  const { data: topProductos, isLoading: isTopLoading } = useGetProductosTop();
  const { data: stockAlerta, isLoading: isStockLoading } = useGetStockAlerta();
  const { formatMoney, moneda } = useCurrency();

  return (
    <div className="flex flex-col h-full overflow-y-auto bg-muted/10 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ventas Hoy</CardTitle>
            <ShoppingCart className="w-4 h-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.ventas_hoy || 0}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Tickets emitidos
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Ingresos netos hoy</CardTitle>
            <DollarSign className="w-4 h-4 text-emerald-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatMoney(dashboard?.ingresos_hoy || 0)}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Bruto {formatMoney(dashboard?.ingresos_brutos_hoy || 0)} · devuelto {formatMoney(dashboard?.total_devuelto_hoy || 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Productos Activos</CardTitle>
            <Package className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.productos_activos || 0}</div>
            <Link href="/productos" className="text-xs text-primary hover:underline mt-1 inline-block">
              Ver catálogo
            </Link>
          </CardContent>
        </Card>
        <Card className={`shadow-sm ${dashboard?.productos_agotados && dashboard.productos_agotados > 0 ? 'border-destructive' : ''}`}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Alertas de Stock</CardTitle>
            <AlertTriangle className={`w-4 h-4 ${dashboard?.productos_agotados && dashboard.productos_agotados > 0 ? 'text-destructive' : 'text-amber-500'}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{dashboard?.productos_agotados || 0} <span className="text-base font-normal text-muted-foreground">agotados</span></div>
            <p className="text-xs text-muted-foreground mt-1">
              {dashboard?.productos_stock_bajo || 0} con stock bajo
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart */}
        <Card className="col-span-1 lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle>Ingresos netos últimos 30 días</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {!isVentasLoading ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={
                    // Filter out records with invalid/missing dates before rendering.
                    // Logs a warning in dev so the data source can be traced if it recurs.
                    (Array.isArray(ventasDia) ? ventasDia : []).filter((r: any) => {
                      if (!r?.fecha) {
                        console.warn('[Dashboard] Registro sin fecha descartado del gráfico:', r);
                        return false;
                      }
                      const d = new Date(r.fecha);
                      if (isNaN(d.getTime())) {
                        console.warn('[Dashboard] Registro con fecha inválida descartado del gráfico:', r.fecha, r);
                        return false;
                      }
                      return true;
                    }).slice().reverse()
                  }>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis
                      dataKey="fecha"
                      tickFormatter={(val) => {
                        // Never throw — if date is invalid return empty string
                        try {
                          if (!val) return '';
                          const d = parseISO(String(val));
                          if (isNaN(d.getTime())) return '';
                          return format(d, 'dd MMM');
                        } catch { return ''; }
                      }}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      dy={10}
                    />
                    <YAxis
                      tickFormatter={(val) => `${moneda}${val/1000}k`}
                      stroke="hsl(var(--muted-foreground))"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      dx={-10}
                    />
                    <Tooltip
                      cursor={{fill: 'hsl(var(--muted))'}}
                      contentStyle={{ backgroundColor: 'hsl(var(--popover))', borderColor: 'hsl(var(--border))', color: 'hsl(var(--popover-foreground))', borderRadius: 'var(--radius)' }}
                      formatter={(value: number) => [formatMoney(value), 'Ingresos']}
                      labelFormatter={(label) => {
                        try {
                          if (!label) return '';
                          const d = parseISO(String(label));
                          if (isNaN(d.getTime())) return String(label);
                          return format(d, 'dd MMMM yyyy', { locale: es });
                        } catch { return String(label); }
                      }}
                    />
                    <Bar dataKey="ingresos" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex items-center justify-center text-muted-foreground">Cargando gráfico...</div>
              )}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          {/* Top Products */}
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Productos más vendidos</CardTitle>
              <CardDescription>Top 5 en ingresos</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {topProductos?.slice(0, 5).map((prod, i) => (
                  <div key={prod.producto_id} className="flex items-center justify-between">
                    <div className="flex items-center overflow-hidden">
                      <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center font-bold text-xs text-muted-foreground mr-3 flex-shrink-0">
                        {i+1}
                      </div>
                      <div className="overflow-hidden">
                        <p className="text-sm font-medium truncate">{prod.nombre}</p>
                        <p className="text-xs text-muted-foreground">{prod.cantidad_vendida} unid.</p>
                      </div>
                    </div>
                    <div className="font-medium text-sm">
                      {formatMoney(prod.ingresos)}
                    </div>
                  </div>
                ))}
                {topProductos?.length === 0 && (
                  <p className="text-sm text-muted-foreground text-center py-4">No hay datos de ventas</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Stock Alerts Preview */}
          <Card className="shadow-sm border-destructive/20">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center">
                <AlertTriangle className="w-5 h-5 mr-2" />
                Requieren Atención
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {stockAlerta?.agotados.slice(0, 3).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="truncate pr-2">{p.nombre}</span>
                    <span className="bg-destructive/10 text-destructive px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap">AGOTADO</span>
                  </div>
                ))}
                {stockAlerta?.stock_bajo.slice(0, Math.max(0, 5 - (stockAlerta.agotados.length || 0))).map(p => (
                  <div key={p.id} className="flex items-center justify-between text-sm">
                    <span className="truncate pr-2">{p.nombre}</span>
                    <span className="bg-amber-500/10 text-amber-500 px-2 py-0.5 rounded text-xs font-bold whitespace-nowrap">Quedan {p.stock}</span>
                  </div>
                ))}
                {(stockAlerta?.agotados.length === 0 && stockAlerta?.stock_bajo.length === 0) && (
                  <p className="text-sm text-muted-foreground text-center py-2">Stock en niveles óptimos</p>
                )}
              </div>
              <Link href="/productos" className="w-full flex justify-end mt-4 items-center text-sm font-medium text-primary hover:underline">
                Gestionar inventario <ArrowRight className="w-4 h-4 ml-1" />
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
