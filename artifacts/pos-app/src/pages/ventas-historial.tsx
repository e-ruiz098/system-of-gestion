import React, { useState } from 'react';
import { useGetVentas, useAnularVenta, useGetVenta } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Ban, FileText, RotateCcw } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useCurrency } from '@/hooks/use-currency';

export default function VentasHistorial() {
  const { data: ventas, isLoading } = useGetVentas(undefined, { query: { queryKey: ['/api/ventas'] } });
  const anularMutation = useAnularVenta();
  const queryClient = useQueryClient();
  const { formatMoney, moneda } = useCurrency();

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const { data: detalle, isLoading: isDetalleLoading } = useGetVenta(
    selectedId ?? 0,
    { query: { queryKey: ['/api/ventas', selectedId], enabled: selectedId !== null } }
  );

  const handleAnular = (id: number) => {
    if (confirm("¿Está seguro que desea anular esta venta? El stock será devuelto y el monto descontado de la caja actual.")) {
      anularMutation.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/ventas'] })
      });
    }
  };

  const metodoPagoLabel: Record<string, string> = {
    efectivo: 'Efectivo',
    tarjeta: 'Tarjeta',
    transferencia: 'Transferencia',
    mixto: 'Mixto',
  };

  return (
    <div className="flex flex-col h-full bg-background p-6">
      <div className="mb-6 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">Historial de Ventas</h1>
          <p className="text-muted-foreground">Registro cronológico de tickets emitidos</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha</TableHead>
              <TableHead>Ticket N°</TableHead>
              <TableHead>Usuario</TableHead>
              <TableHead>Método Pago</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-center">Estado</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ventas?.map(v => (
              <TableRow key={v.id} className={v.anulada ? "opacity-60 bg-muted/20" : ""}>
                <TableCell className="font-medium">
                  {format(parseISO(v.fecha), "dd MMM yyyy, HH:mm", { locale: es })}
                </TableCell>
                <TableCell className="font-mono text-muted-foreground">#{String(v.numero_ticket).padStart(6, '0')}</TableCell>
                <TableCell>{v.usuario_nombre}</TableCell>
                <TableCell className="capitalize">{metodoPagoLabel[v.metodo_pago ?? ''] ?? v.metodo_pago}</TableCell>
                <TableCell className="text-right font-bold">{formatMoney(v.total)}</TableCell>
                <TableCell className="text-center">
                  {v.anulada ? (
                    <Badge variant="destructive" className="bg-destructive/20 text-destructive border-none">Anulada</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-none">Completada</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Ver detalle"
                    onClick={() => setSelectedId(v.id)}
                  >
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  {!v.anulada && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => handleAnular(v.id)}
                      title="Anular venta"
                    >
                      <Ban className="w-4 h-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {ventas?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                  No hay ventas registradas.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Detail Modal */}
      <Dialog open={selectedId !== null} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {detalle
                ? `Ticket #${String(detalle.numero_ticket).padStart(6, '0')}`
                : 'Detalle de Venta'}
            </DialogTitle>
          </DialogHeader>

          {isDetalleLoading && (
            <div className="py-8 text-center text-muted-foreground">Cargando...</div>
          )}

          {detalle && !isDetalleLoading && (
            <div className="space-y-4">
              {/* Header info */}
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground">Fecha</p>
                  <p className="font-medium">{format(parseISO(detalle.fecha), "dd MMM yyyy, HH:mm", { locale: es })}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Cajero</p>
                  <p className="font-medium">{detalle.usuario_nombre ?? '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Método de pago</p>
                  <p className="font-medium capitalize">{metodoPagoLabel[detalle.metodo_pago ?? ''] ?? detalle.metodo_pago}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Estado</p>
                  {detalle.anulada
                    ? <Badge variant="destructive" className="bg-destructive/20 text-destructive border-none text-xs">Anulada</Badge>
                    : <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-none text-xs">Completada</Badge>}
                </div>
                {detalle.metodo_pago === 'mixto' && detalle.detalle_pago_mixto && (() => {
                  try {
                    const mixto = JSON.parse(detalle.detalle_pago_mixto!);
                    return (
                      <div className="col-span-2">
                        <p className="text-muted-foreground">Detalle pago mixto</p>
                        <p className="font-medium">
                          {Object.entries(mixto).map(([k, v]) => `${metodoPagoLabel[k] ?? k}: ${formatMoney(v as number)}`).join(' · ')}
                        </p>
                      </div>
                    );
                  } catch { return null; }
                })()}
              </div>

              <Separator />

              {/* Line items */}
              <div>
                <p className="text-sm font-semibold mb-2">Productos</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-0">Producto</TableHead>
                      <TableHead className="text-right">Cant.</TableHead>
                      <TableHead className="text-right">P. Unit.</TableHead>
                      <TableHead className="text-right pr-0">Subtotal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalle.detalle.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell className="pl-0 font-medium">{d.producto_nombre ?? `Producto #${d.producto_id}`}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{d.cantidad}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatMoney(d.precio_unitario)}</TableCell>
                        <TableCell className="text-right pr-0">{formatMoney(d.subtotal)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <Separator />

              <div className="flex justify-between items-center font-bold text-lg">
                <span>Total</span>
                <span>{formatMoney(detalle.total)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
