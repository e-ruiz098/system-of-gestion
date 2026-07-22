import React from 'react';
import { useGetCierresCaja } from '@workspace/api-client-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { format, parseISO } from 'date-fns';
import { es } from 'date-fns/locale';
import { useCurrency } from '@/hooks/use-currency';

export default function Cierres() {
  const { data: cierres, isLoading } = useGetCierresCaja({ query: { queryKey: ['/api/cierres'] } });
  const { formatMoney } = useCurrency();

  return (
    <div className="flex flex-col h-full bg-background p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Cierres de Caja</h1>
        <p className="text-muted-foreground">Historial de arqueos y balances</p>
      </div>

      <div className="flex-1 overflow-auto rounded-md border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha de Cierre</TableHead>
              <TableHead>Cajero</TableHead>
              <TableHead className="text-right">Esperado</TableHead>
              <TableHead className="text-right">Contado</TableHead>
              <TableHead className="text-right">Diferencia</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {cierres?.map(c => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  {format(parseISO(c.fecha_cierre), "dd MMM yyyy, HH:mm", { locale: es })}
                </TableCell>
                <TableCell>{c.usuario_nombre}</TableCell>
                <TableCell className="text-right font-mono text-muted-foreground">{formatMoney(c.total_esperado)}</TableCell>
                <TableCell className="text-right font-mono font-bold">{formatMoney(c.total_contado)}</TableCell>
                <TableCell className={`text-right font-mono font-bold ${
                  c.diferencia === 0 ? 'text-emerald-500' :
                  c.diferencia > 0 ? 'text-blue-500' :
                  'text-destructive'
                }`}>
                  {c.diferencia > 0 ? '+' : ''}{formatMoney(c.diferencia)}
                </TableCell>
              </TableRow>
            ))}
            {cierres?.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No hay cierres registrados.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
