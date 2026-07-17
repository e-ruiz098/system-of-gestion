import React, { useState } from 'react';
import {
  useGetVentas, useCreateDevolucion, useGetProductos, useGetVenta,
  DetalleDevolucionInput
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, RotateCcw, CheckCircle2, Hash, Package } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useCurrency } from '@/hooks/use-currency';

export default function Devoluciones() {
  const { formatMoney } = useCurrency();
  const queryClient = useQueryClient();
  const devolucionMutation = useCreateDevolucion();

  // --- Por Ticket ---
  const [ticketSearch, setTicketSearch] = useState('');
  const [selectedVentaId, setSelectedVentaId] = useState<number | null>(null);

  const { data: todasVentas } = useGetVentas(undefined, {
    query: {
      enabled: ticketSearch.length > 0,
      queryKey: ['/api/ventas'],
    }
  });

  const { data: ventaDetalle } = useGetVenta(selectedVentaId!, {
    query: {
      enabled: selectedVentaId != null,
      queryKey: ['/api/ventas', selectedVentaId],
    }
  });

  // --- Por Producto ---
  const [productoSearch, setProductoSearch] = useState('');
  const [selectedProductoId, setSelectedProductoId] = useState<number | null>(null);
  const [selectedProductoNombre, setSelectedProductoNombre] = useState('');

  const { data: productosMatch } = useGetProductos(
    { q: productoSearch } as any,
    {
      query: {
        enabled: productoSearch.length > 1,
        queryKey: ['/api/productos', { q: productoSearch }],
      }
    }
  );

  const { data: ventasConProducto } = useGetVentas(
    { producto_id: String(selectedProductoId) } as any,
    {
      query: {
        enabled: selectedProductoId != null,
        queryKey: ['/api/ventas', { producto_id: selectedProductoId }],
      }
    }
  );

  // --- Shared devolution state ---
  const [devolucionItems, setDevolucionItems] = useState<{ id: number; qty: number; max: number }[]>([]);
  const [motivo, setMotivo] = useState('cambio');
  const [success, setSuccess] = useState(false);

  const handleTicketSearch = () => {
    if (!todasVentas) return;
    const found = todasVentas.find(v => String(v.numero_ticket) === ticketSearch.trim());
    if (found) {
      setSelectedVentaId(found.id);
      setDevolucionItems([]);
    } else {
      alert('Ticket no encontrado');
    }
  };

  const handleSelectVentaFromProducto = (ventaId: number) => {
    setSelectedVentaId(ventaId);
    setDevolucionItems([]);
  };

  const toggleItem = (id: number, qty: number, max: number) => {
    setDevolucionItems(prev => {
      const exists = prev.find(i => i.id === id);
      if (exists) return prev.filter(i => i.id !== id);
      return [...prev, { id, qty, max }];
    });
  };

  const updateItemQty = (id: number, newQty: number, max: number) => {
    if (newQty < 1 || newQty > max) return;
    setDevolucionItems(prev => prev.map(i => i.id === id ? { ...i, qty: newQty } : i));
  };

  const handleSubmit = () => {
    if (!selectedVentaId || devolucionItems.length === 0) return;
    const detalle: DetalleDevolucionInput[] = devolucionItems.map(i => ({
      producto_id: i.id,
      cantidad: i.qty
    }));
    devolucionMutation.mutate({
      data: { venta_id: selectedVentaId, motivo, detalle }
    }, {
      onSuccess: () => {
        setSuccess(true);
        setSelectedVentaId(null);
        setTicketSearch('');
        setProductoSearch('');
        setSelectedProductoId(null);
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        queryClient.invalidateQueries({ queryKey: ['/api/ventas'] });
      }
    });
  };

  const reset = () => {
    setSuccess(false);
    setSelectedVentaId(null);
    setDevolucionItems([]);
    setTicketSearch('');
    setProductoSearch('');
    setSelectedProductoId(null);
  };

  if (success) {
    return (
      <div className="flex flex-col h-full bg-background items-center justify-center p-6">
        <div className="text-center max-w-sm w-full">
          <CheckCircle2 className="w-20 h-20 text-emerald-500 mx-auto mb-5" />
          <h2 className="text-2xl font-bold mb-2">Devolución Procesada</h2>
          <p className="text-muted-foreground mb-6">El stock ha sido reintegrado al inventario.</p>
          <Button size="lg" className="w-full" onClick={reset}>Nueva Devolución</Button>
        </div>
      </div>
    );
  }

  // Detail panel (shared between both search modes)
  const DetailPanel = () => {
    if (!ventaDetalle) {
      return (
        <div className="h-48 flex flex-col items-center justify-center text-muted-foreground opacity-40">
          <Search className="w-10 h-10 mb-3" />
          <p className="text-sm">Selecciona una venta para ver sus detalles</p>
        </div>
      );
    }

    const items = ventaDetalle.detalle ?? [];

    return (
      <>
        <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
          <div>
            <CardTitle>Ticket #{ventaDetalle.numero_ticket}</CardTitle>
            <CardDescription>
              {ventaDetalle.fecha ? new Date(ventaDetalle.fecha).toLocaleDateString('es-AR') : ''}
              {' — '}{ventaDetalle.usuario_nombre}
            </CardDescription>
          </div>
          <div className="text-xl font-bold font-mono text-primary">{formatMoney(ventaDetalle.total)}</div>
        </CardHeader>

        <CardContent className="pt-5 space-y-5">
          <div className="border rounded-md divide-y divide-border">
            {items.map(line => {
              const selected = devolucionItems.find(i => i.id === line.producto_id!);
              return (
                <div key={line.id} className="p-3 flex items-center justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{line.producto_nombre}</div>
                    <div className="text-xs text-muted-foreground">Vendidos: {line.cantidad} × {formatMoney(line.precio_unitario)}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {selected ? (
                      <>
                        <div className="flex items-center bg-background border border-border rounded overflow-hidden">
                          <button className="px-2 py-1 hover:bg-muted text-sm" onClick={() => updateItemQty(line.producto_id!, selected.qty - 1, line.cantidad)}>−</button>
                          <span className="w-8 text-center text-sm font-bold">{selected.qty}</span>
                          <button className="px-2 py-1 hover:bg-muted text-sm" onClick={() => updateItemQty(line.producto_id!, selected.qty + 1, line.cantidad)}>+</button>
                        </div>
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => toggleItem(line.producto_id!, 1, line.cantidad)}>✕</Button>
                      </>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => toggleItem(line.producto_id!, 1, line.cantidad)}>
                        Devolver
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-2">
            <Label>Motivo de Devolución</Label>
            <Select value={motivo} onValueChange={setMotivo}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cambio">Cambio por otro producto</SelectItem>
                <SelectItem value="defectuoso">Producto defectuoso</SelectItem>
                <SelectItem value="error_cobro">Error de cobro / Cajero</SelectItem>
                <SelectItem value="otro">Otro</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            className="w-full h-12 text-base"
            disabled={devolucionItems.length === 0 || devolucionMutation.isPending}
            onClick={handleSubmit}
          >
            <RotateCcw className="w-4 h-4 mr-2" /> Confirmar Devolución
          </Button>
        </CardContent>
      </>
    );
  };

  return (
    <div className="flex flex-col h-full bg-background overflow-auto p-5">
      <div className="mb-5">
        <h1 className="text-2xl font-bold">Devoluciones</h1>
        <p className="text-muted-foreground text-sm">Reingreso de mercadería al inventario</p>
      </div>

      <Tabs defaultValue="ticket" className="flex-1">
        <TabsList className="mb-5">
          <TabsTrigger value="ticket" className="flex items-center gap-2">
            <Hash className="w-4 h-4" /> Por Número de Ticket
          </TabsTrigger>
          <TabsTrigger value="producto" className="flex items-center gap-2">
            <Package className="w-4 h-4" /> Por Nombre de Producto
          </TabsTrigger>
        </TabsList>

        {/* TAB: POR TICKET */}
        <TabsContent value="ticket">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <Card className="h-fit">
              <CardHeader>
                <CardTitle className="text-base">Buscar por Ticket</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label>Número de Ticket</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="Ej. 1045"
                      value={ticketSearch}
                      onChange={e => setTicketSearch(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleTicketSearch()}
                    />
                    <Button onClick={handleTicketSearch} variant="secondary" size="icon">
                      <Search className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="col-span-1 lg:col-span-2">
              <DetailPanel />
            </Card>
          </div>
        </TabsContent>

        {/* TAB: POR PRODUCTO */}
        <TabsContent value="producto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="space-y-4">
              <Card className="h-fit">
                <CardHeader>
                  <CardTitle className="text-base">Buscar Producto</CardTitle>
                  <CardDescription className="text-xs">Ingresa nombre o código para ver las ventas donde aparece</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      placeholder="Nombre o código..."
                      value={productoSearch}
                      onChange={e => { setProductoSearch(e.target.value); setSelectedProductoId(null); setSelectedVentaId(null); }}
                      className="pl-9"
                    />
                  </div>
                  {productoSearch.length > 1 && productosMatch && (
                    <div className="border rounded-md divide-y divide-border max-h-48 overflow-y-auto">
                      {productosMatch.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">Sin resultados</div>}
                      {productosMatch.map(p => (
                        <button
                          key={p.id}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/50 transition-colors ${selectedProductoId === p.id ? 'bg-primary/10 text-primary font-medium' : ''}`}
                          onClick={() => { setSelectedProductoId(p.id); setSelectedProductoNombre(p.nombre); setSelectedVentaId(null); }}
                        >
                          <div className="font-medium">{p.nombre}</div>
                          {p.codigo && <div className="text-xs text-muted-foreground font-mono">{p.codigo}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {selectedProductoId && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Ventas de "{selectedProductoNombre}"</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="divide-y divide-border max-h-64 overflow-y-auto">
                      {!ventasConProducto || ventasConProducto.length === 0 ? (
                        <div className="py-4 text-center text-sm text-muted-foreground">Sin ventas encontradas</div>
                      ) : ventasConProducto.map(v => (
                        <button
                          key={v.id}
                          className={`w-full text-left px-2 py-2.5 hover:bg-muted/50 transition-colors rounded text-sm ${selectedVentaId === v.id ? 'bg-primary/10 text-primary' : ''}`}
                          onClick={() => { setSelectedVentaId(v.id); setDevolucionItems([]); }}
                        >
                          <div className="flex justify-between items-center">
                            <span className="font-medium">Ticket #{v.numero_ticket}</span>
                            <span className="font-mono text-xs text-muted-foreground">{formatMoney(v.total)}</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {v.fecha ? new Date(v.fecha).toLocaleDateString('es-AR') : ''}
                            {v.usuario_nombre && ` · ${v.usuario_nombre}`}
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            <Card className="col-span-1 lg:col-span-2">
              <DetailPanel />
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
