import React, { useState } from 'react';
import { useGetProductos, useUpdateProducto, useCreateProducto, useDeleteProducto, Producto, useGetCierresCaja } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Search, Plus, Edit, Trash2, FileUp, Loader2, History, Package, ChevronDown, ChevronRight, Download } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useGetConfig } from '@workspace/api-client-react';
import { useCurrency } from '@/hooks/use-currency';

function StockBadge({ estado, stock, unidad }: { estado?: string; stock: number; unidad?: string }) {
  const label = `${stock}${unidad === 'kg' ? ' kg' : ''}`;
  if (estado === 'rojo') return <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-destructive/10 text-destructive">{label}</span>;
  if (estado === 'amarillo') return <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-amber-500/10 text-amber-500">{label}</span>;
  return <span className="text-sm font-mono">{label}</span>;
}

function HistorialTab() {
  const { data: cierres, isLoading } = useGetCierresCaja({ query: { queryKey: ['/api/caja/cierres'] } });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { formatMoney } = useCurrency();

  const downloadSnapshot = (cierre: any) => {
    const snapshot: any[] = typeof cierre.snapshot_stock === 'string'
      ? JSON.parse(cierre.snapshot_stock)
      : (cierre.snapshot_stock ?? []);

    const lines = [
      `Cierre de Caja #${cierre.id}`,
      `Fecha: ${new Date(cierre.fecha_cierre).toLocaleString('es-AR')}`,
      ``,
      `NOMBRE,STOCK,ESTADO`,
      ...snapshot.map((p: any) => `"${p.nombre}",${p.stock},${p.estado === 'rojo' ? 'Agotado' : p.estado === 'amarillo' ? 'Stock bajo' : 'Normal'}`),
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-cierre-${cierre.id}-${new Date(cierre.fecha_cierre).toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;

  if (!cierres?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground opacity-50">
        <History className="w-12 h-12 mb-3" />
        <p>No hay cierres de caja registrados aún</p>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-card divide-y divide-border">
      {cierres.map(cierre => {
        const snapshot: any[] = typeof (cierre as any).snapshot_stock === 'string'
          ? JSON.parse((cierre as any).snapshot_stock)
          : ((cierre as any).snapshot_stock ?? []);
        const isExpanded = expandedId === cierre.id;

        return (
          <div key={cierre.id}>
            <div
              className="flex items-center px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : cierre.id)}
            >
              {isExpanded ? <ChevronDown className="w-4 h-4 mr-3 text-muted-foreground shrink-0" /> : <ChevronRight className="w-4 h-4 mr-3 text-muted-foreground shrink-0" />}
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">Cierre #{cierre.id}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date((cierre as any).fecha_cierre).toLocaleString('es-AR')}
                  </span>
                  <span className="text-xs text-muted-foreground">{(cierre as any).usuario_nombre}</span>
                </div>
                <div className="flex gap-4 text-xs text-muted-foreground mt-0.5">
                  <span>Esperado: {formatMoney(cierre.total_esperado)}</span>
                  <span>Contado: {formatMoney(cierre.total_contado)}</span>
                  <span className={cierre.diferencia < 0 ? 'text-destructive' : cierre.diferencia > 0 ? 'text-blue-500' : 'text-emerald-500'}>
                    Dif: {cierre.diferencia > 0 ? '+' : ''}{formatMoney(cierre.diferencia)}
                  </span>
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="ml-4 shrink-0"
                onClick={e => { e.stopPropagation(); downloadSnapshot(cierre); }}
                title="Descargar CSV"
              >
                <Download className="w-4 h-4" />
              </Button>
            </div>

            {isExpanded && (
              <div className="px-4 pb-4 pt-1 bg-muted/10">
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Inventario al cierre — {snapshot.length} productos</p>
                <div className="rounded border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                        <th className="px-3 py-2 text-left">Nombre</th>
                        <th className="px-3 py-2 text-right">Cantidad</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {snapshot.map((p: any, i: number) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-3 py-1.5 font-medium">{p.nombre}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{p.stock}</td>
                          <td className="px-3 py-1.5 text-center">
                            {p.estado === 'rojo' && <span className="text-xs font-bold text-destructive">🔴 Agotado</span>}
                            {p.estado === 'amarillo' && <span className="text-xs font-bold text-amber-500">🟡 Bajo</span>}
                            {p.estado === 'verde' && <span className="text-xs text-muted-foreground">⚪ Normal</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function Productos() {
  const { user } = useAuth();
  const isAdmin = user?.rol === 'admin';
  const { formatMoney } = useCurrency();
  const { data: config } = useGetConfig();
  const activaKg = (config as any)?.activa_kg ?? false;

  const [search, setSearch] = useState('');
  const { data: productos, isLoading } = useGetProductos(
    { q: search } as any,
    { query: { queryKey: ['/api/productos', { q: search }] } }
  );

  const [editItem, setEditItem] = useState<Producto | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);

  const queryClient = useQueryClient();
  const updateMutation = useUpdateProducto();
  const createMutation = useCreateProducto();
  const deleteMutation = useDeleteProducto();
  const { toast } = useToast();

  const handleEditSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const unidadTipo = fd.get('unidad_tipo') as string || 'unidad';
    const data: any = {
      codigo: fd.get('codigo') as string || undefined,
      nombre: fd.get('nombre') as string,
      precio: Number(fd.get('precio')),
      costo: Number(fd.get('costo')) || undefined,
      stock: Number(fd.get('stock')),
      stock_minimo: Number(fd.get('stock_minimo')) || undefined,
      unidad_tipo: unidadTipo,
    };

    if (isAddMode) {
      createMutation.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
          setIsAddMode(false);
          toast({ title: "Producto creado" });
        }
      });
    } else if (editItem) {
      updateMutation.mutate({ id: editItem.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
          setEditItem(null);
          toast({ title: "Producto actualizado" });
        }
      });
    }
  };

  const handleToggleActive = (id: number, currentActive: boolean) => {
    if (!isAdmin) return;
    updateMutation.mutate({ id, data: { activo: !currentActive } as any }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/productos'] })
    });
  };

  const handleDelete = (id: number) => {
    if (!isAdmin) return;
    if (confirm("¿Estás seguro? Si tiene historial de ventas, el producto se desactivará.")) {
      deleteMutation.mutate({ id }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
          toast({ title: "Producto procesado" });
        }
      });
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="p-5 border-b border-border flex items-center justify-between shrink-0">
        <h1 className="text-xl font-bold">Productos</h1>
        <div className="flex items-center gap-3">
          <div className="relative w-56">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Buscar..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          {isAdmin && (
            <Button onClick={() => setIsAddMode(true)}>
              <Plus className="w-4 h-4 mr-2" /> Nuevo Producto
            </Button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <Tabs defaultValue="productos" className="h-full flex flex-col">
          <div className="px-5 pt-4 shrink-0">
            <TabsList>
              <TabsTrigger value="productos" className="flex items-center gap-2">
                <Package className="w-4 h-4" /> Productos
              </TabsTrigger>
              {isAdmin && (
                <TabsTrigger value="historial" className="flex items-center gap-2">
                  <History className="w-4 h-4" /> Historial de cierres (stock)
                </TabsTrigger>
              )}
            </TabsList>
          </div>

          <TabsContent value="productos" className="flex-1 overflow-auto px-5 pb-5 pt-3 m-0">
            <div className="rounded-md border border-border bg-card">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">Código</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead className="text-right w-28">Precio</TableHead>
                    <TableHead className="text-right w-24">Stock</TableHead>
                    {isAdmin && <TableHead className="text-center w-20">Activo</TableHead>}
                    {isAdmin && <TableHead className="text-right w-24">Acciones</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow><TableCell colSpan={isAdmin ? 6 : 4} className="text-center h-28">
                      <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                    </TableCell></TableRow>
                  )}
                  {!isLoading && productos?.map(p => (
                    <TableRow key={p.id} className={!p.activo ? "opacity-50 bg-muted/10" : ""}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{p.codigo || '—'}</TableCell>
                      <TableCell className="font-medium">
                        {p.nombre}
                        {(p as any).unidad_tipo === 'kg' && (
                          <Badge variant="outline" className="ml-2 text-xs py-0">kg</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">{formatMoney(p.precio)}</TableCell>
                      <TableCell className="text-right">
                        <StockBadge estado={(p as any).stock_estado} stock={p.stock ?? 0} unidad={(p as any).unidad_tipo} />
                      </TableCell>
                      {isAdmin && (
                        <TableCell className="text-center">
                          <Switch checked={p.activo} onCheckedChange={() => handleToggleActive(p.id, p.activo)} />
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" onClick={() => setEditItem(p)}>
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button variant="ghost" size="icon" className="text-destructive hover:bg-destructive/10" onClick={() => handleDelete(p.id)}>
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                  {!isLoading && productos?.length === 0 && (
                    <TableRow><TableCell colSpan={isAdmin ? 6 : 4} className="text-center py-10 text-muted-foreground">No se encontraron productos.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          {isAdmin && (
            <TabsContent value="historial" className="flex-1 overflow-auto px-5 pb-5 pt-3 m-0">
              <HistorialTab />
            </TabsContent>
          )}
        </Tabs>
      </div>

      {/* Add/Edit Modal */}
      {isAdmin && (
        <Dialog open={!!editItem || isAddMode} onOpenChange={(o) => { if (!o) { setEditItem(null); setIsAddMode(false); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{isAddMode ? 'Nuevo Producto' : 'Editar Producto'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleEditSave} className="space-y-4 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="nombre">Nombre *</Label>
                  <Input id="nombre" name="nombre" defaultValue={editItem?.nombre} required autoFocus />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="codigo">Código</Label>
                  <Input id="codigo" name="codigo" defaultValue={editItem?.codigo || ''} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="precio">Precio *</Label>
                  <Input id="precio" name="precio" type="number" step="0.01" defaultValue={editItem?.precio} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="costo">Costo</Label>
                  <Input id="costo" name="costo" type="number" step="0.01" defaultValue={editItem?.costo || ''} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stock">Stock *</Label>
                  <Input
                    id="stock" name="stock" type="number"
                    step={(editItem as any)?.unidad_tipo === 'kg' ? '0.001' : '1'}
                    defaultValue={(editItem as any)?.stock ?? 0} required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="stock_minimo">Stock Mínimo</Label>
                  <Input id="stock_minimo" name="stock_minimo" type="number" step="0.001" defaultValue={(editItem as any)?.stock_minimo || 5} />
                </div>
                {activaKg && (
                  <div className="space-y-1.5 col-span-2">
                    <Label htmlFor="unidad_tipo">Tipo de Unidad</Label>
                    <Select name="unidad_tipo" defaultValue={(editItem as any)?.unidad_tipo ?? 'unidad'}>
                      <SelectTrigger id="unidad_tipo">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unidad">Unidad (piezas enteras)</SelectItem>
                        <SelectItem value="kg">Kilogramo (acepta decimales)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={() => { setEditItem(null); setIsAddMode(false); }}>Cancelar</Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>Guardar</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
