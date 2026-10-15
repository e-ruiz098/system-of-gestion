import React, { useState, useRef, useMemo, useEffect } from 'react';
import {
  useGetProductos, useUpdateProducto, useCreateProducto, useDeleteProducto,
  useUploadImage, useGetCategorias, useGetCierresCaja,
} from '@workspace/api-client-react';
import { useQueryClient, useQuery, useMutation } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import {
  Search, Plus, Edit, Trash2, Loader2, History, Package,
  ChevronDown, ChevronRight, Download, Image as ImageIcon, Upload, X, Tag, Barcode,
  PlusCircle, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useGetConfig } from '@workspace/api-client-react';
import { useCurrency } from '@/hooks/use-currency';
import { useBarcodeScanner, cleanBarcode } from '@/hooks/use-barcode-scanner';

// ── Types ──────────────────────────────────────────────────────────────────────
interface CatRow { id: number; nombre: string; parent_id: number | null }

// ── StockBadge ─────────────────────────────────────────────────────────────────
function StockBadge({ estado, stock }: { estado?: string; stock: number }) {
  const label = String(stock);
  if (estado === 'rojo')     return <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-destructive/10 text-destructive">{label}</span>;
  if (estado === 'amarillo') return <span className="inline-flex px-2 py-0.5 rounded text-xs font-bold bg-amber-500/10 text-amber-500">{label}</span>;
  return <span className="text-sm font-mono text-foreground">{label}</span>;
}

// ── Modal Agregar Stock Acumulativo ───────────────────────────────────────────
function AgregarStockModal({
  product,
  open,
  onClose,
}: {
  product: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<string[]>(['']);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch product movement history
  const { data: historial, isLoading: loadingHistorial } = useQuery<any[]>({
    queryKey: ['/api/productos', product?.id, 'stock-historial'],
    queryFn: async () => {
      if (!product?.id) return [];
      const res = await fetch(`/api/productos/${product.id}/stock-historial`, {
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Error al obtener historial');
      return res.json();
    },
    enabled: !!product?.id && open,
  });

  // Reset rows when opening
  useEffect(() => {
    if (open) {
      setRows(['']);
      setShowConfirmClose(false);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [open, product?.id]);

  // Check if user has entered non-empty values
  const hasFilledRows = useMemo(() => {
    return rows.some(r => r.trim().length > 0);
  }, [rows]);

  const handleRequestClose = () => {
    if (hasFilledRows) {
      setShowConfirmClose(true);
    } else {
      onClose();
    }
  };

  const handleRowChange = (index: number, val: string) => {
    // Replace comma with dot for validation display
    const next = [...rows];
    next[index] = val;
    setRows(next);
  };

  const addRow = () => {
    setRows(prev => [...prev, '']);
    setTimeout(() => {
      const idx = rows.length;
      inputRefs.current[idx]?.focus();
    }, 50);
  };

  const deleteRow = (index: number) => {
    if (rows.length === 1) {
      setRows(['']);
    } else {
      setRows(prev => prev.filter((_, i) => i !== index));
    }
  };

  // Live calculations
  const parsedQuantities = useMemo(() => {
    const list: number[] = [];
    for (const r of rows) {
      if (!r || r.trim() === '') continue;
      const normalized = r.trim().replace(',', '.');
      const val = parseFloat(normalized);
      if (Number.isFinite(val) && val > 0) {
        list.push(Math.round(val * 1000) / 1000);
      }
    }
    return list;
  }, [rows]);

  const totalIngresado = useMemo(() => {
    const sum = parsedQuantities.reduce((acc, q) => acc + q, 0);
    return Math.round(sum * 1000) / 1000;
  }, [parsedQuantities]);

  const currentStock = product?.stock ?? 0;
  const nuevoStock = Math.round((currentStock + totalIngresado) * 1000) / 1000;

  // Mutation to submit stock
  const stockIngresoMutation = useMutation({
    mutationFn: async (quantities: number[]) => {
      const res = await fetch(`/api/productos/${product.id}/stock-ingreso`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ renglones: quantities }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al agregar stock');
      }
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: 'Stock actualizado con éxito',
        description: `Se agregaron +${data.total_ingresado}. Nuevo stock: ${data.stock_resultante}`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
      onClose();
    },
    onError: (err: any) => {
      toast({
        title: 'Error al agregar stock',
        description: err?.message || 'Revisa las cantidades e intenta nuevamente.',
        variant: 'destructive',
      });
    },
  });

  const handleSave = () => {
    if (parsedQuantities.length === 0) {
      toast({
        title: 'Ingreso vacío',
        description: 'Ingrese al menos una cantidad mayor a cero.',
        variant: 'destructive',
      });
      return;
    }
    stockIngresoMutation.mutate(parsedQuantities);
  };

  if (!product) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) handleRequestClose(); }}>
        <DialogContent className="sm:max-w-md max-h-[85vh] flex flex-col p-0 overflow-hidden">

          {/* Header */}
          <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center gap-3">
            {product.imagen ? (
              <img src={product.imagen} alt={product.nombre} className="w-10 h-10 object-cover rounded border border-border shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center shrink-0 text-muted-foreground">
                <Package className="w-5 h-5" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold truncate">Agregar Stock — {product.nombre}</h3>
              <p className="text-xs text-muted-foreground font-mono">
                Stock actual: <strong className="text-foreground">{currentStock}</strong>
              </p>
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">

            {/* Lista de renglones */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Renglones de ingreso (cada valor suma al stock)
              </Label>

              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {rows.map((rowVal, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold font-mono text-muted-foreground text-sm">
                        +
                      </span>
                      <Input
                        ref={el => { inputRefs.current[idx] = el; }}
                        value={rowVal}
                        onChange={e => handleRowChange(idx, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (idx === rows.length - 1) {
                              addRow();
                            } else {
                              inputRefs.current[idx + 1]?.focus();
                            }
                          }
                        }}
                        placeholder="Ej. 12,4"
                        className="pl-7 font-mono font-bold text-sm h-10 bg-background"
                        autoComplete="off"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteRow(idx)}
                      className="h-10 w-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10 shrink-0"
                      title="Borrar renglón"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                className="w-full text-xs gap-1.5 border-dashed h-9 mt-1"
              >
                <Plus className="w-3.5 h-3.5" /> Agregar otra cantidad
              </Button>
            </div>

            {/* Total acumulado + Nuevo Stock en vivo */}
            <div className="p-3.5 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
              <div className="flex justify-between items-center text-xs">
                <span className="text-muted-foreground">Total ingresado:</span>
                <span className="font-mono font-bold text-sm text-primary">+{totalIngresado}</span>
              </div>
              <div className="flex justify-between items-center border-t border-primary/10 pt-2 text-sm font-bold">
                <span>NUEVO STOCK:</span>
                <span className="font-mono text-lg text-primary">{nuevoStock}</span>
              </div>
            </div>

            {/* Historial de Ingresos de este producto */}
            <div className="border-t border-border pt-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                <History className="w-3.5 h-3.5" /> Historial de ingresos
              </h4>

              {loadingHistorial ? (
                <div className="py-4 text-center text-xs text-muted-foreground">Cargando historial...</div>
              ) : !historial || historial.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">Sin ingresos acumulativos registrados aún.</p>
              ) : (
                <div className="space-y-1.5 max-h-36 overflow-y-auto text-xs font-mono pr-1">
                  {historial.map((h: any) => {
                    const fechaStr = new Date(h.fecha).toLocaleString('es-AR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                    });
                    const formattedRenglones = h.renglones_parsed?.map((q: number) => `+${q}`).join(' ') || '';

                    return (
                      <div key={h.id} className="p-2 rounded bg-muted/40 border border-border/50 space-y-0.5">
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>{fechaStr}</span>
                          <span className="font-bold text-foreground">{h.usuario_nombre || 'Usuario'}</span>
                        </div>
                        <div className="text-foreground leading-snug">
                          anterior {h.stock_anterior} — <span className="text-primary font-bold">{formattedRenglones}</span> — total <strong className="text-primary">+{h.total_ingresado}</strong> — resultante <strong>{h.stock_resultante}</strong>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-between items-center gap-3">
            <Button variant="ghost" onClick={handleRequestClose} disabled={stockIngresoMutation.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleSave}
              disabled={stockIngresoMutation.isPending || parsedQuantities.length === 0}
              className="gap-2 px-6"
            >
              {stockIngresoMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Listo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog on Unsaved Changes */}
      <Dialog open={showConfirmClose} onOpenChange={setShowConfirmClose}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center text-center py-2">
            <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
            <h3 className="text-base font-bold mb-1">¿Descartar ingresos de stock?</h3>
            <p className="text-xs text-muted-foreground mb-4">
              Tiene cantidades cargadas sin guardar. Si sale ahora se perderán todos los valores ingresados.
            </p>
            <div className="flex gap-2 w-full">
              <Button variant="outline" onClick={() => setShowConfirmClose(false)} className="flex-1">
                Continuar cargando
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setShowConfirmClose(false);
                  onClose();
                }}
                className="flex-1"
              >
                Descartar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── HistorialTab ───────────────────────────────────────────────────────────────
function HistorialTab() {
  const { data: cierres, isLoading } = useGetCierresCaja({ query: { queryKey: ['/api/caja/cierres'] } });
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { formatMoney } = useCurrency();

  const downloadSnapshot = (cierre: any) => {
    const snapshot: any[] = typeof cierre.snapshot_stock === 'string'
      ? JSON.parse(cierre.snapshot_stock) : (cierre.snapshot_stock ?? []);
    const lines = [
      `Cierre de Caja #${cierre.id}`,
      `Fecha: ${new Date(cierre.fecha_cierre).toLocaleString('es-AR')}`, '',
      'NOMBRE,STOCK,ESTADO',
      ...snapshot.map((p: any) => `"${p.nombre}",${p.stock},${p.estado === 'rojo' ? 'Agotado' : p.estado === 'amarillo' ? 'Stock bajo' : 'Normal'}`),
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stock-cierre-${cierre.id}-${new Date(cierre.fecha_cierre).toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="flex justify-center p-10"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>;
  if (!cierres?.length) return (
    <div className="flex flex-col items-center justify-center py-16 text-muted-foreground opacity-50">
      <History className="w-12 h-12 mb-3" /><p>No hay cierres de caja registrados aún</p>
    </div>
  );

  return (
    <div className="rounded-md border border-border bg-card divide-y divide-border">
      {cierres.map(cierre => {
        const snapshot: any[] = typeof (cierre as any).snapshot_stock === 'string'
          ? JSON.parse((cierre as any).snapshot_stock) : ((cierre as any).snapshot_stock ?? []);
        const isExpanded = expandedId === cierre.id;
        return (
          <div key={cierre.id}>
            <div className="flex items-center px-4 py-3 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => setExpandedId(isExpanded ? null : cierre.id)}>
              {isExpanded
                ? <ChevronDown  className="w-4 h-4 mr-3 text-muted-foreground shrink-0" />
                : <ChevronRight className="w-4 h-4 mr-3 text-muted-foreground shrink-0" />}
              <div className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="font-medium text-sm">Cierre #{cierre.id}</span>
                  <span className="text-xs text-muted-foreground">{new Date((cierre as any).fecha_cierre).toLocaleString('es-AR')}</span>
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
              <Button variant="ghost" size="sm" className="ml-4 shrink-0"
                onClick={e => { e.stopPropagation(); downloadSnapshot(cierre); }}>
                <Download className="w-4 h-4" />
              </Button>
            </div>
            {isExpanded && (
              <div className="px-4 pb-4 pt-1 bg-muted/10">
                <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">
                  Inventario al cierre — {snapshot.length} productos
                </p>
                <div className="rounded border border-border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead><tr className="bg-muted/40 text-xs text-muted-foreground uppercase">
                      <th className="px-3 py-2 text-left">Nombre</th>
                      <th className="px-3 py-2 text-right">Cantidad</th>
                      <th className="px-3 py-2 text-center">Estado</th>
                    </tr></thead>
                    <tbody className="divide-y divide-border">
                      {snapshot.map((p: any, i: number) => (
                        <tr key={i} className="hover:bg-muted/20">
                          <td className="px-3 py-1.5 font-medium">{p.nombre}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{p.stock}</td>
                          <td className="px-3 py-1.5 text-center">
                            {p.estado === 'rojo'    && <span className="text-xs font-bold text-destructive">🔴 Agotado</span>}
                            {p.estado === 'amarillo' && <span className="text-xs font-bold text-amber-500">🟡 Bajo</span>}
                            {p.estado === 'verde'   && <span className="text-xs text-muted-foreground">⚪ Normal</span>}
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

// ── Main ───────────────────────────────────────────────────────────────────────
export default function Productos() {
  const { user }   = useAuth();
  const isAdmin    = user?.rol === 'admin';
  const { formatMoney } = useCurrency();

  // ── Categories ──────────────────────────────────────────────────────────────
  const { data: categoriasRaw } = useGetCategorias({ query: { queryKey: ['/api/categorias'] } } as any);
  const categorias = useMemo(() => (categoriasRaw as CatRow[] | undefined) ?? [], [categoriasRaw]);
  const mainCats   = useMemo(() => categorias.filter(c => c.parent_id === null), [categorias]);
  const subCatMap  = useMemo(() => {
    const m = new Map<number, CatRow[]>();
    categorias.filter(c => c.parent_id !== null).forEach(c => {
      const arr = m.get(c.parent_id!) ?? [];
      arr.push(c);
      m.set(c.parent_id!, arr);
    });
    return m;
  }, [categorias]);

  // Filter state
  const [selectedMainId, setSelectedMainId] = useState<number | null>(null);
  const [selectedSubId,  setSelectedSubId]  = useState<number | null>(null);

  const subsOfSelected = useMemo(
    () => selectedMainId !== null ? (subCatMap.get(selectedMainId) ?? []) : [],
    [selectedMainId, subCatMap]
  );

  const handleSelectMain = (id: number | null) => {
    setSelectedMainId(id);
    setSelectedSubId(null);
  };

  // ── Search ──────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('');

  const queryParams = useMemo(() => {
    const p: Record<string, any> = {};
    if (search)           p.q               = search;
    if (selectedMainId)   p.categoria_id    = selectedMainId;
    if (selectedSubId)    p.subcategoria_id  = selectedSubId;
    return p;
  }, [search, selectedMainId, selectedSubId]);

  const { data: productosRaw, isLoading } = useGetProductos(
    queryParams as any,
    { query: { queryKey: ['/api/productos', queryParams] } }
  );
  const productos = (productosRaw as any[]) ?? [];

  // ── Form state ──────────────────────────────────────────────────────────────
  const [editItem,         setEditItem]        = useState<any | null>(null);
  const [isAddMode,        setIsAddMode]       = useState(false);
  const [codigoError,      setCodigoError]     = useState<string | null>(null);
  const [imagePreview,     setImagePreview]    = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage]= useState(false);

  // Modal para "+ Agregar stock" acumulativo
  const [stockProductModal, setStockProductModal] = useState<any | null>(null);

  const [formMainCatId,    setFormMainCatId]   = useState<string>('');
  const [formSubCatId,     setFormSubCatId]    = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nombreInputRef = useRef<HTMLInputElement>(null);

  const barcodeScanner = useBarcodeScanner({
    autoFocus: isAddMode,
    onEnterNext: () => {
      nombreInputRef.current?.focus();
    },
  });

  const formSubsAvailable = useMemo(
    () => formMainCatId ? (subCatMap.get(Number(formMainCatId)) ?? []) : [],
    [formMainCatId, subCatMap]
  );

  const queryClient  = useQueryClient();
  const updateMutation = useUpdateProducto();
  const createMutation = useCreateProducto();
  const deleteMutation = useDeleteProducto();
  const uploadMutation = useUploadImage();
  const { toast } = useToast();

  const openAdd = () => {
    setEditItem(null); setIsAddMode(true);
    barcodeScanner.reset();
    setCodigoError(null);
    setImagePreview(null);
    setFormMainCatId(''); setFormSubCatId('');
  };

  const openEdit = (p: any) => {
    setEditItem(p); setIsAddMode(false);
    barcodeScanner.setBarcode(p.codigo || '');
    setCodigoError(null);
    setImagePreview(p.imagen || null);
    setFormMainCatId(p.categoria_id    ? String(p.categoria_id)    : '');
    setFormSubCatId (p.subcategoria_id ? String(p.subcategoria_id) : '');
  };

  const closeForm = () => {
    setEditItem(null);
    setIsAddMode(false);
    setImagePreview(null);
    barcodeScanner.reset();
    setCodigoError(null);
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.match(/^image\/(jpeg|png|webp|gif)$/i)) {
      toast({ title: "Formato no válido", description: "Solo se admiten JPG, PNG, WEBP o GIF.", variant: "destructive" }); return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Imagen muy pesada", description: "El tamaño máximo es 5MB.", variant: "destructive" }); return;
    }
    const reader = new FileReader();
    reader.onload = () => setImagePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    if (!formMainCatId) {
      toast({ title: "Categoría requerida", description: "Seleccioná una categoría principal.", variant: "destructive" }); return;
    }

    let imagenFinal: string | null | undefined = undefined;
    if (imagePreview && imagePreview.startsWith('data:')) {
      try {
        setIsUploadingImage(true);
        const res = await uploadMutation.mutateAsync({ data: { data: imagePreview } });
        imagenFinal = res.url;
      } catch (err: any) {
        toast({ title: "Error al subir imagen", description: err?.message || "No se pudo guardar la foto.", variant: "destructive" });
        setIsUploadingImage(false); return;
      } finally { setIsUploadingImage(false); }
    } else if (imagePreview === null) {
      imagenFinal = null;
    } else {
      imagenFinal = imagePreview;
    }

    const trimmedCodigo = cleanBarcode(barcodeScanner.barcode);
    const codigoFinal = trimmedCodigo.length > 0 ? trimmedCodigo : undefined;

    const data: any = {
      codigo:          codigoFinal,
      nombre:          (fd.get('nombre') as string)?.trim(),
      precio:          Number((fd.get('precio') as string)?.replace(',', '.')),
      costo:           (fd.get('costo') as string) ? Number((fd.get('costo') as string)?.replace(',', '.')) : undefined,
      stock_minimo:    (fd.get('stock_minimo') as string) ? Number((fd.get('stock_minimo') as string)?.replace(',', '.')) : undefined,
      categoria_id:    Number(formMainCatId),
      subcategoria_id: formSubCatId ? Number(formSubCatId) : null,
      imagen:          imagenFinal,
    };

    if (isAddMode) {
      data.stock = Number((fd.get('stock') as string)?.replace(',', '.'));
      createMutation.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
          closeForm();
          toast({ title: "Producto creado con éxito" });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || err?.message || "No se pudo crear el producto";
          if (typeof msg === 'string' && (msg.toLowerCase().includes("ya está registrado") || msg.toLowerCase().includes("duplicado"))) {
            setCodigoError("Ese código de barras ya está registrado");
          }
          toast({
            title: "Error al guardar producto",
            description: msg,
            variant: "destructive",
          });
        },
      });
    } else if (editItem) {
      updateMutation.mutate({ id: editItem.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
          closeForm();
          toast({ title: "Producto actualizado con éxito" });
        },
        onError: (err: any) => {
          const msg = err?.data?.error || err?.message || "No se pudo actualizar el producto";
          if (typeof msg === 'string' && (msg.toLowerCase().includes("ya está registrado") || msg.toLowerCase().includes("duplicado"))) {
            setCodigoError("Ese código de barras ya está registrado");
          }
          toast({
            title: "Error al guardar producto",
            description: msg,
            variant: "destructive",
          });
        },
      });
    }
  };

  const handleToggleActive = (id: number, current: boolean) => {
    if (!isAdmin) return;
    updateMutation.mutate({ id, data: { activo: !current } as any }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/productos'] }),
    });
  };

  const handleDelete = (id: number) => {
    if (!isAdmin) return;
    if (!confirm("¿Estás seguro? Si tiene historial de ventas, el producto se desactivará.")) return;
    deleteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        toast({ title: "Producto procesado" });
      },
    });
  };

  return (
    <div className="flex h-full bg-background overflow-hidden">

      {/* ── SIDEBAR ──────────────────────────────────────────────────────── */}
      <aside className="w-52 shrink-0 border-r border-border bg-sidebar flex flex-col overflow-hidden">
        <div className="px-4 py-3 border-b border-border shrink-0">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <Tag className="w-3.5 h-3.5" /> Categorías
          </p>
        </div>
        <nav className="flex-1 overflow-y-auto py-1">
          <button
            onClick={() => handleSelectMain(null)}
            className={`w-full text-left px-4 py-2 text-sm transition-colors border-l-2 ${
              selectedMainId === null
                ? 'bg-primary/10 text-primary border-primary font-semibold'
                : 'text-sidebar-foreground hover:bg-sidebar-accent border-transparent'
            }`}
          >
            Todos los productos
          </button>

          {mainCats.map(cat => (
            <button
              key={cat.id}
              onClick={() => handleSelectMain(cat.id)}
              className={`w-full text-left px-4 py-2 text-sm transition-colors border-l-2 ${
                selectedMainId === cat.id
                  ? 'bg-primary/10 text-primary border-primary font-semibold'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent border-transparent'
              }`}
            >
              {cat.nombre}
            </button>
          ))}
        </nav>
      </aside>

      {/* ── MAIN AREA ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Top bar */}
        <div className="shrink-0 px-5 py-3 border-b border-border flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <h1 className="text-lg font-bold shrink-0">Productos</h1>
            {selectedMainId !== null && (
              <span className="text-muted-foreground text-sm truncate">
                / {mainCats.find(c => c.id === selectedMainId)?.nombre}
                {selectedSubId !== null && ` / ${categorias.find(c => c.id === selectedSubId)?.nombre}`}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por nombre o código..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 h-9"
              />
            </div>
            {isAdmin && (
              <Button onClick={openAdd} size="sm">
                <Plus className="w-4 h-4 mr-1.5" /> Nuevo Producto
              </Button>
            )}
          </div>
        </div>

        {/* Subcategory chips */}
        {selectedMainId !== null && subsOfSelected.length > 0 && (
          <div className="shrink-0 px-5 py-2 border-b border-border bg-muted/20 flex items-center gap-2 overflow-x-auto">
            <span className="text-xs text-muted-foreground font-medium shrink-0">Filtrar:</span>
            <button
              onClick={() => setSelectedSubId(null)}
              className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                selectedSubId === null
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
              }`}
            >
              Todos
            </button>
            {subsOfSelected.map(sub => (
              <button
                key={sub.id}
                onClick={() => setSelectedSubId(sub.id)}
                className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                  selectedSubId === sub.id
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
                }`}
              >
                {sub.nombre}
              </button>
            ))}
          </div>
        )}

        {/* Tabs */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
          <Tabs defaultValue="productos" className="flex-1 flex flex-col min-h-0">
            <div className="px-5 pt-3 shrink-0">
              <TabsList className="h-8">
                <TabsTrigger value="productos" className="text-xs flex items-center gap-1.5 h-7">
                  <Package className="w-3.5 h-3.5" /> Productos
                </TabsTrigger>
                {isAdmin && (
                  <TabsTrigger value="historial" className="text-xs flex items-center gap-1.5 h-7">
                    <History className="w-3.5 h-3.5" /> Historial stock
                  </TabsTrigger>
                )}
              </TabsList>
            </div>

            {/* ── Products table ──────────────────────────────────────────── */}
            <TabsContent value="productos" className="flex-1 overflow-auto px-5 pb-5 pt-3 m-0">
              <div className="rounded-md border border-border bg-card">
                <Table>
                  <TableHeader>
                    <TableRow className="text-xs">
                      <TableHead className="w-12 text-center">Foto</TableHead>
                      <TableHead className="w-24">Código</TableHead>
                      <TableHead>Nombre</TableHead>
                      <TableHead className="w-32">Categoría</TableHead>
                      <TableHead className="w-32">Subcategoría</TableHead>
                      <TableHead className="text-right w-24">Precio</TableHead>
                      <TableHead className="text-right w-24">Stock</TableHead>
                      {isAdmin && <TableHead className="text-center w-16">Activo</TableHead>}
                      {isAdmin && <TableHead className="text-right w-28">Acciones</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 9 : 7} className="text-center h-28">
                          <Loader2 className="w-5 h-5 animate-spin mx-auto text-muted-foreground" />
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && productos.map((p: any) => (
                      <TableRow key={p.id} className={!p.activo ? 'opacity-50 bg-muted/10' : ''}>
                        <TableCell className="p-1.5 text-center">
                          {p.imagen ? (
                            <img src={p.imagen} alt={p.nombre} className="w-9 h-9 object-cover rounded border border-border inline-block" />
                          ) : (
                            <div className="w-9 h-9 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center text-muted-foreground/40 mx-auto">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{p.codigo || '—'}</TableCell>
                        <TableCell className="font-medium text-sm">
                          {p.nombre}
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.categoria_nombre
                            ? <span className="px-2 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 font-medium whitespace-nowrap">{p.categoria_nombre}</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.subcategoria_nombre
                            ? <span className="px-2 py-0.5 rounded-full bg-muted border border-border text-muted-foreground whitespace-nowrap">{p.subcategoria_nombre}</span>
                            : <span className="text-muted-foreground/40">—</span>
                          }
                        </TableCell>
                        <TableCell className="text-right font-medium text-sm">{formatMoney(p.precio)}</TableCell>
                        <TableCell className="text-right">
                          <StockBadge estado={p.stock_estado} stock={p.stock ?? 0} />
                        </TableCell>
                        {isAdmin && (
                          <TableCell className="text-center">
                            <Switch checked={p.activo} onCheckedChange={() => handleToggleActive(p.id, p.activo)} />
                          </TableCell>
                        )}
                        {isAdmin && (
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px] px-2 gap-1 text-primary border-primary/30 hover:bg-primary/10 shrink-0 font-semibold"
                                onClick={() => setStockProductModal(p)}
                                title="Agregar stock acumulativo"
                              >
                                <Plus className="w-3 h-3" />
                                Stock
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(p)}>
                                <Edit className="w-3.5 h-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" onClick={() => handleDelete(p.id)}>
                                <Trash2 className="w-3.5 h-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                    {!isLoading && productos.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 9 : 7} className="text-center py-12 text-muted-foreground">
                          <Package className="w-10 h-10 mx-auto mb-2 opacity-30" />
                          No se encontraron productos{selectedMainId !== null ? ' en esta categoría' : ''}.
                        </TableCell>
                      </TableRow>
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
      </div>

      {/* ── MODAL AGREGAR STOCK ACUMULATIVO ───────────────────────────── */}
      {isAdmin && stockProductModal && (
        <AgregarStockModal
          product={stockProductModal}
          open={!!stockProductModal}
          onClose={() => setStockProductModal(null)}
        />
      )}

      {/* ── ADD / EDIT MODAL ──────────────────────────────────────────────── */}
      {isAdmin && (
        <Dialog open={!!editItem || isAddMode} onOpenChange={o => { if (!o) closeForm(); }}>
          <DialogContent
            className="max-w-lg max-h-[92vh] overflow-y-auto"
            onOpenAutoFocus={e => {
              if (isAddMode) {
                e.preventDefault();
                barcodeScanner.focus();
              }
            }}
          >
            <DialogHeader>
              <DialogTitle>{isAddMode ? 'Nuevo Producto' : 'Editar Producto'}</DialogTitle>
            </DialogHeader>

            <form onSubmit={handleSave} className="space-y-4 pt-1">
              {/* Photo */}
              <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Foto del Producto (vista previa 3×3 cm)
                </Label>
                <div className="flex items-center gap-4 pt-1">
                  <div className="w-[114px] h-[114px] min-w-[114px] rounded-lg border-2 border-dashed border-border relative overflow-hidden bg-background shrink-0">
                    {imagePreview ? (
                      <>
                        <img src={imagePreview} alt="Vista previa" className="w-full h-full object-cover" />
                        <button type="button"
                          onClick={() => { setImagePreview(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                          className="absolute top-1 right-1 p-1 bg-destructive text-destructive-foreground rounded-full shadow">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <div onClick={() => fileInputRef.current?.click()}
                        className="flex flex-col items-center justify-center p-2 text-center text-xs text-muted-foreground cursor-pointer w-full h-full hover:bg-muted/40">
                        <ImageIcon className="w-6 h-6 mb-1 opacity-60" />
                        <span className="font-semibold">3×3 cm</span>
                        <span className="text-[10px]">Subir foto</span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2 flex-1">
                    <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden" onChange={handleImageChange} />
                    <Button type="button" variant="outline" size="sm"
                      onClick={() => fileInputRef.current?.click()} className="gap-2 w-full justify-start text-xs">
                      <Upload className="w-3.5 h-3.5" />
                      {imagePreview ? 'Cambiar imagen' : 'Cargar imagen'}
                    </Button>
                    <p className="text-[11px] text-muted-foreground leading-tight">
                      JPG, PNG, WEBP o GIF — máx. 5MB. Se guarda localmente.
                    </p>
                  </div>
                </div>
              </div>

              {/* Basic fields */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="codigo" className="flex items-center gap-1.5">
                    <Barcode className="w-4 h-4 text-primary" />
                    <span>Código de barras / SKU</span>
                    <span className="text-xs text-muted-foreground font-normal">(Escanear con lector USB o escribir)</span>
                  </Label>
                  <Input
                    id="codigo"
                    name="codigo"
                    ref={barcodeScanner.inputRef}
                    value={barcodeScanner.barcode}
                    onChange={e => {
                      barcodeScanner.handleChange(e);
                      if (codigoError) setCodigoError(null);
                    }}
                    onKeyDown={barcodeScanner.handleKeyDown}
                    placeholder="Escanear con lector USB o escribir código..."
                    autoComplete="off"
                    className={`font-mono text-sm ${codigoError ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                  />
                  {codigoError && (
                    <p className="text-xs text-destructive font-medium mt-1">{codigoError}</p>
                  )}
                </div>
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="nombre">Nombre *</Label>
                  <Input
                    id="nombre"
                    name="nombre"
                    ref={nombreInputRef}
                    defaultValue={editItem?.nombre || ''}
                    key={editItem?.id ? `edit-${editItem.id}` : 'new'}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="precio">Precio de Venta *</Label>
                  <Input id="precio" name="precio" type="number" step="0.01" defaultValue={editItem?.precio} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="costo">Precio de Compra</Label>
                  <Input id="costo" name="costo" type="number" step="0.01" defaultValue={editItem?.costo || ''} />
                </div>

                {/* Stock field: Editable on create, read-only with "+ Agregar stock" button on edit */}
                <div className="space-y-1.5">
                  <Label htmlFor="stock">Stock Actual *</Label>
                  {isAddMode ? (
                    <Input
                      id="stock"
                      name="stock"
                      type="text"
                      inputMode="decimal"
                      step="any"
                      defaultValue={0}
                      required
                    />
                  ) : (
                    <div className="flex gap-2 items-center">
                      <Input
                        id="stock"
                        name="stock_readonly"
                        type="text"
                        value={editItem?.stock ?? 0}
                        readOnly
                        className="bg-muted font-mono font-bold cursor-not-allowed"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setStockProductModal(editItem);
                        }}
                        className="shrink-0 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10 gap-1 h-9"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar stock
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="stock_minimo">Stock Mínimo</Label>
                  <Input id="stock_minimo" name="stock_minimo" type="text" inputMode="decimal"
                    step="any"
                    defaultValue={editItem?.stock_minimo || 5} />
                </div>
              </div>

              {/* Category + Subcategory */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Categoría *</Label>
                  <Select
                    value={formMainCatId}
                    onValueChange={v => { setFormMainCatId(v); setFormSubCatId(''); }}
                  >
                    <SelectTrigger><SelectValue placeholder="Seleccionar categoría..." /></SelectTrigger>
                    <SelectContent className="max-h-60">
                      {mainCats.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>
                    Subcategoría
                    <span className="ml-1 text-muted-foreground text-xs">(opcional)</span>
                  </Label>
                  <Select
                    value={formSubCatId}
                    onValueChange={setFormSubCatId}
                    disabled={!formMainCatId || formSubsAvailable.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Sin subcategoría" />
                    </SelectTrigger>
                    <SelectContent className="max-h-60">
                      <SelectItem value="">Sin subcategoría</SelectItem>
                      {formSubsAvailable.map(c => (
                        <SelectItem key={c.id} value={String(c.id)}>{c.nombre}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button type="button" variant="ghost" onClick={closeForm}>Cancelar</Button>
                <Button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending || isUploadingImage || !formMainCatId}
                >
                  {isUploadingImage && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Guardar
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
