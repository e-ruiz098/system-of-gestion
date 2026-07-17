import React, { useState } from 'react';
import { useGetVentas, useAnularVenta } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Ban, Search, FileText } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';

export default function VentasHistorial() {
  const { data: ventas, isLoading } = useGetVentas(undefined, { query: { queryKey: ['/api/ventas'] } });
  const anularMutation = useAnularVenta();
  const queryClient = useQueryClient();

  const handleAnular = (id: number) => {
    if (confirm("¿Está seguro que desea anular esta venta? El stock será devuelto y el monto descontado de la caja actual.")) {
      anularMutation.mutate({ id }, {
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/ventas'] })
      });
    }
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(val);

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
                <TableCell className="capitalize">{v.metodo_pago}</TableCell>
                <TableCell className="text-right font-bold">{formatCurrency(v.total)}</TableCell>
                <TableCell className="text-center">
                  {v.anulada ? (
                    <Badge variant="destructive" className="bg-destructive/20 text-destructive border-none">Anulada</Badge>
                  ) : (
                    <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-none">Completada</Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" title="Ver detalle">
                    <FileText className="w-4 h-4 text-muted-foreground" />
                  </Button>
                  {!v.anulada && (
                    <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleAnular(v.id)} title="Anular venta">
                      <Ban className="w-4 h-4" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {ventas?.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center py-8">No hay ventas registradas.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
