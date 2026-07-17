import React, { useState, useRef } from 'react';
import { useCerrarCaja, useGetCajaActiva, useGetProductos } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calculator, CheckCircle2, Printer, Package } from 'lucide-react';
import { useCurrency } from '@/hooks/use-currency';

export default function CajaCierre() {
  const [contado, setContado] = useState('');
  const [closed, setClosed] = useState(false);
  const cerrarMutation = useCerrarCaja();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { data: cajaActiva, isLoading } = useGetCajaActiva();
  const { data: todosProductos } = useGetProductos({ query: { queryKey: ['/api/productos', { activo: 'all' }] } } as any);
  const { formatMoney } = useCurrency();
  const printRef = useRef<HTMLDivElement>(null);

  if (isLoading) return null;

  if (!cajaActiva && !closed) {
    return (
      <div className="flex h-full items-center justify-center p-4">
        <div className="text-center">
          <h2 className="text-xl font-bold mb-2">No hay caja abierta</h2>
          <p className="text-muted-foreground text-sm mb-4">No hay una sesión de caja activa para cerrar.</p>
          <Button onClick={() => setLocation('/caja/apertura')}>Abrir Caja</Button>
        </div>
      </div>
    );
  }

  const esperado = cajaActiva ? (cajaActiva.apertura.fondo_inicial || 0) + (cajaActiva.total_efectivo || 0) : 0;
  const diff = Number(contado) - esperado;

  const handleCerrar = () => {
    cerrarMutation.mutate({ data: { total_contado: Number(contado) } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/caja/activa'] });
        queryClient.invalidateQueries({ queryKey: ['/api/cierres'] });
        setClosed(true);
      }
    });
  };

  const handlePrint = () => {
    window.print();
  };

  // Sort: agotados first, then low stock, then normal
  const products = todosProductos ?? [];
  const sortedProducts = [...products].sort((a, b) => {
    const order = (p: any) => p.stock_estado === 'rojo' ? 0 : p.stock_estado === 'amarillo' ? 1 : 2;
    return order(a) - order(b);
  });

  const InventarioSection = () => (
    <div ref={printRef}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Package className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Inventario al Cierre — {products.length} productos</h3>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} className="print:hidden">
          <Printer className="w-4 h-4 mr-2" /> Imprimir / PDF
        </Button>
      </div>

      <div className="rounded border border-border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide border-b border-border">
              <th className="px-3 py-2 text-left">Nombre</th>
              <th className="px-3 py-2 text-right w-28">Disponible</th>
              <th className="px-3 py-2 text-center w-28">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedProducts.map(p => {
              const estado = (p as any).stock_estado ?? 'verde';
              const unidad = (p as any).unidad_tipo === 'kg' ? ' kg' : '';
              return (
                <tr key={p.id} className="hover:bg-muted/20">
                  <td className="px-3 py-2 font-medium">{p.nombre}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.stock}{unidad}</td>
                  <td className="px-3 py-2 text-center">
                    {estado === 'rojo'    && <span className="text-xs font-bold text-destructive">🔴 Agotado</span>}
                    {estado === 'amarillo' && <span className="text-xs font-bold text-amber-500">🟡 Bajo</span>}
                    {estado === 'verde'   && <span className="text-xs text-muted-foreground">⚪ Normal</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  // After successful close
  if (closed) {
    return (
      <div className="flex flex-col h-full bg-background overflow-auto p-6 gap-5">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="w-7 h-7 text-emerald-500" />
          <h1 className="text-2xl font-bold">Caja Cerrada</h1>
        </div>

        <div className="flex gap-3">
          <Button onClick={() => setLocation('/venta')} variant="outline">Ir al Terminal POS</Button>
          <Button onClick={() => setLocation('/cierres')} variant="outline">Ver Historial de Cierres</Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inventario al Cierre</CardTitle>
            <CardDescription className="text-xs">Vista de solo lectura — no modifica el stock</CardDescription>
          </CardHeader>
          <CardContent>
            <InventarioSection />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          .print-area { display: block !important; }
        }
      `}</style>

      <div className="flex flex-col h-full bg-background overflow-auto p-5 gap-5">
        <h1 className="text-2xl font-bold shrink-0">Cierre de Caja</h1>

        {/* Stats */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
          <Card>
            <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">Fondo Inicial</CardTitle></CardHeader>
            <CardContent className="pb-3 px-4"><div className="text-xl font-bold font-mono">{formatMoney(cajaActiva!.apertura.fondo_inicial)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">Ventas Efectivo</CardTitle></CardHeader>
            <CardContent className="pb-3 px-4"><div className="text-xl font-bold text-emerald-600 font-mono">+{formatMoney(cajaActiva!.total_efectivo)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">Ventas Tarjeta</CardTitle></CardHeader>
            <CardContent className="pb-3 px-4"><div className="text-xl font-bold text-blue-500 font-mono">{formatMoney(cajaActiva!.total_tarjeta || 0)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1 pt-3 px-4"><CardTitle className="text-xs text-muted-foreground">Cantidad Ventas</CardTitle></CardHeader>
            <CardContent className="pb-3 px-4"><div className="text-xl font-bold">{cajaActiva!.cantidad_ventas}</div></CardContent>
          </Card>
        </div>

        {/* Arqueo */}
        <Card className="border-primary/30 shrink-0">
          <CardHeader className="bg-muted/20 border-b pb-3">
            <CardTitle className="text-base">Arqueo de Efectivo</CardTitle>
            <CardDescription className="text-xs">Cuenta el dinero físico en el cajón</CardDescription>
          </CardHeader>
          <CardContent className="pt-5 space-y-4">
            <div className="flex justify-between items-center p-4 bg-muted/40 rounded-lg">
              <div className="font-medium">Efectivo Esperado:</div>
              <div className="text-2xl font-black font-mono">{formatMoney(esperado)}</div>
            </div>
            <div className="space-y-2">
              <Label>Efectivo Contado (Real)</Label>
              <div className="relative">
                <Calculator className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  type="number" value={contado}
                  onChange={e => setContado(e.target.value)}
                  className="pl-12 h-16 text-3xl font-black font-mono"
                  placeholder="0.00" autoFocus
                />
              </div>
            </div>
            {contado !== '' && (
              <div className={`p-4 rounded-lg border flex justify-between items-center ${
                diff === 0 ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
                diff > 0  ? 'bg-blue-500/10 border-blue-500/20 text-blue-500' :
                             'bg-destructive/10 border-destructive/20 text-destructive'
              }`}>
                <div className="font-medium">Diferencia:</div>
                <div className="text-xl font-black font-mono flex items-center gap-2">
                  {diff === 0 && <CheckCircle2 className="w-5 h-5" />}
                  {diff > 0 ? '+' : ''}{formatMoney(diff)}
                </div>
              </div>
            )}
            <Button
              className="w-full h-12 text-base"
              onClick={handleCerrar}
              disabled={cerrarMutation.isPending || contado === ''}
              variant={diff < 0 ? 'destructive' : 'default'}
            >
              Confirmar Cierre de Caja
            </Button>
          </CardContent>
        </Card>

        {/* Inventory — visible before close too */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Inventario Actual</CardTitle>
            <CardDescription className="text-xs">Solo lectura — para referencia antes de cerrar</CardDescription>
          </CardHeader>
          <CardContent>
            <InventarioSection />
          </CardContent>
        </Card>
      </div>
    </>
  );
}
