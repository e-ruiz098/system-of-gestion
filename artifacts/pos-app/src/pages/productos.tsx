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
  PlusCircle, AlertTriangle, ArrowRight, Undo2, Ban, CheckCircle2, SlidersHorizontal,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { useAuth } from '@/contexts/AuthContext';
import { useCurrency } from '@/hooks/use-currency';
import { useBarcodeScanner, cleanBarcode } from '@/hooks/use-barcode-scanner';

// ── Strict Number Validation Helper ──────────────────────────────────────────
function validateStrictNumber(val: string): { valid: boolean; num: number; error: string | null } {
  if (!val || val.trim() === '') return { valid: false, num: 0, error: 'El valor no puede estar vacío.' };
  const str = val.trim();
  if (!/^-?\d+([.,]\d+)?$/.test(str)) {
    return { valid: false, num: 0, error: `El valor '${val}' no es válido. Use solo dígitos con un separador decimal (ej. 12.4).` };
  }
  if (/^\d+[.,]\d{3}$/.test(str)) {
    return { valid: false, num: 0, error: `El formato '${val}' es ambiguo. Escriba '1500' para mil quinientos o '1.5' para decimales.` };
  }
  const norm = str.replace(',', '.');
  const n = parseFloat(norm);
  if (!Number.isFinite(n)) {
    return { valid: false, num: 0, error: 'Número no válido.' };
  }
  return { valid: true, num: Math.round(n * 1000) / 1000, error: null };
}

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
  product: initialProduct,
  open,
  onClose,
}: {
  product: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.rol === 'admin';
  const [rows, setRows] = useState<string[]>(['']);
  const [showConfirmClose, setShowConfirmClose] = useState(false);
  const [showConfirmSave, setShowConfirmSave] = useState(false);
  const [undoInfo, setUndoInfo] = useState<{ movimientoId: number; total: number; timer: number } | null>(null);

  // Anular history state
  const [anularMov, setAnularMov] = useState<any | null>(null);
  const [motivoAnulacion, setMotivoAnulacion] = useState('');

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const undoIntervalRef = useRef<any>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Fetch live product data so stock is always fresh after undo, void or entry
  const { data: liveProduct } = useQuery<any>({
    queryKey: ['/api/productos', initialProduct?.id],
    queryFn: async () => {
      if (!initialProduct?.id) return null;
      const res = await fetch(`/api/productos/${initialProduct.id}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!initialProduct?.id && open,
    refetchInterval: 1000,
  });

  const product = liveProduct || initialProduct;

  // Fetch product movement history
  const { data: historial, isLoading: loadingHistorial, refetch: refetchHistorial } = useQuery<any[]>({
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

  // Handle undo timer countdown
  useEffect(() => {
    if (undoInfo && undoInfo.timer > 0) {
      undoIntervalRef.current = setInterval(() => {
        setUndoInfo(prev => prev && prev.timer > 1 ? { ...prev, timer: prev.timer - 1 } : null);
      }, 1000);
    } else {
      setUndoInfo(null);
    }
    return () => {
      if (undoIntervalRef.current) clearInterval(undoIntervalRef.current);
    };
  }, [undoInfo?.movimientoId, undoInfo?.timer === 30]);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setRows(['']);
      setShowConfirmClose(false);
      setShowConfirmSave(false);
      setAnularMov(null);
      setMotivoAnulacion('');
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }, [open, product?.id]);

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

  // Row validation & live calculations using strict parser
  const rowStatuses = useMemo(() => {
    return rows.map(r => {
      if (!r || r.trim() === '') return { empty: true, valid: false, error: null, value: 0 };
      const res = validateStrictNumber(r);
      if (!res.valid) {
        return { empty: false, valid: false, error: res.error, value: 0 };
      }
      if (res.num <= 0) {
        return { empty: false, valid: false, error: 'Debe ser un número mayor a 0', value: 0 };
      }
      if (res.num > 100000) {
        return { empty: false, valid: false, error: 'Supera el máximo de 100.000 por renglón', value: 0 };
      }
      return { empty: false, valid: true, error: null, value: res.num };
    });
  }, [rows]);

  const hasErrors = useMemo(() => {
    return rowStatuses.some(s => !s.empty && !s.valid);
  }, [rowStatuses]);

  const parsedQuantities = useMemo(() => {
    return rowStatuses.filter(s => s.valid).map(s => s.value);
  }, [rowStatuses]);

  const totalIngresado = useMemo(() => {
    const sum = parsedQuantities.reduce((acc, q) => acc + q, 0);
    return Math.round(sum * 1000) / 1000;
  }, [parsedQuantities]);

  const currentStock = product?.stock ?? 0;
  const nuevoStock = Math.round((currentStock + totalIngresado) * 1000) / 1000;

  // High quantity warning requirement: > 10x current stock OR > 100 when current stock is 0
  const isHighQuantityWarning = useMemo(() => {
    if (currentStock === 0) {
      return totalIngresado > 100;
    }
    return totalIngresado > currentStock * 10;
  }, [currentStock, totalIngresado]);

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
      refetchHistorial();

      // Start 30 second undo timer
      if (data.movimiento_id) {
        setUndoInfo({
          movimientoId: data.movimiento_id,
          total: data.total_ingresado,
          timer: 30,
        });
      }

      setShowConfirmSave(false);
      setRows(['']);
    },
    onError: (err: any) => {
      toast({
        title: 'Error al agregar stock',
        description: err?.message || 'Revisa las cantidades e intenta nuevamente.',
        variant: 'destructive',
      });
    },
  });

  // Undo mutation (within 30 seconds)
  const undoMutation = useMutation({
    mutationFn: async (movimientoId: number) => {
      const res = await fetch(`/api/productos/${product.id}/stock-ingreso/${movimientoId}/deshacer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al deshacer el ingreso');
      }
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: 'Ingreso deshecho correctamente',
        description: `Stock resultante: ${data.stock_resultante}`,
      });
      setUndoInfo(null);
      queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
      refetchHistorial();
    },
    onError: (err: any) => {
      toast({
        title: 'No se pudo deshacer',
        description: err?.message || 'Ocurrió un error al intentar deshacer.',
        variant: 'destructive',
      });
    },
  });

  // Anular mutation (from history with motivo)
  const anularMutation = useMutation({
    mutationFn: async ({ movimientoId, motivo }: { movimientoId: number; motivo: string }) => {
      const res = await fetch(`/api/productos/${product.id}/stock-historial/${movimientoId}/anular`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ motivo }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Error al anular el ingreso');
      }
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: 'Ingreso anulado con éxito',
        description: `Nuevo stock del producto: ${data.stock_resultante}`,
      });
      setAnularMov(null);
      setMotivoAnulacion('');
      queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
      refetchHistorial();
    },
    onError: (err: any) => {
      toast({
        title: 'No se pudo anular el ingreso',
        description: err?.message || 'Verifique el stock actual y el motivo ingresado.',
        variant: 'destructive',
      });
    },
  });

  const handleOpenConfirmModal = () => {
    if (hasErrors) {
      toast({
        title: 'Errores en los valores',
        description: 'Corrija las cantidades marcadas en rojo antes de guardar.',
        variant: 'destructive',
      });
      return;
    }
    if (parsedQuantities.length === 0) {
      toast({
        title: 'Ingreso vacío',
        description: 'Ingrese al menos una cantidad mayor a cero.',
        variant: 'destructive',
      });
      return;
    }
    setShowConfirmSave(true);
  };

  const handleConfirmSubmit = () => {
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

            {/* 30-second Undo Banner if active */}
            {undoInfo && (
              <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-between gap-3 text-xs">
                <div>
                  <p className="font-bold text-amber-600 dark:text-amber-400">
                    Último ingreso de +{undoInfo.total} registrado
                  </p>
                  <p className="text-muted-foreground">
                    Podés deshacerlo durante los próximos <span className="font-mono font-bold text-foreground">{undoInfo.timer}s</span>.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => undoMutation.mutate(undoInfo.movimientoId)}
                  disabled={undoMutation.isPending}
                  className="gap-1.5 border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20 shrink-0 font-bold"
                >
                  {undoMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Undo2 className="w-3.5 h-3.5" />}
                  Deshacer
                </Button>
              </div>
            )}

            {/* Lista de renglones */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Renglones de ingreso (cada valor suma al stock)
              </Label>

              <div className="space-y-2.5 max-h-52 overflow-y-auto pr-1">
                {rows.map((rowVal, idx) => {
                  const status = rowStatuses[idx];
                  return (
                    <div key={idx} className="space-y-1">
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 font-bold font-mono text-muted-foreground text-sm">
                            +
                          </span>
                          <Input
                            ref={el => { inputRefs.current[idx] = el; }}
                            value={rowVal}
                            onChange={e => handleRowChange(idx, e.target.value)}
                            onKeyDown={e => {
                              // CRITICAL USER REQ: Enter ONLY moves to next row or creates new row; NEVER submits/saves!
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
                            className={`pl-7 font-mono font-bold text-sm h-10 bg-background ${
                              status.error ? 'border-destructive focus-visible:ring-destructive' : ''
                            }`}
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
                      {status.error && (
                        <p className="text-[11px] text-destructive font-medium pl-2">{status.error}</p>
                      )}
                    </div>
                  );
                })}
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
                <History className="w-3.5 h-3.5" /> Historial de movimientos
              </h4>

              {loadingHistorial ? (
                <div className="py-4 text-center text-xs text-muted-foreground">Cargando historial...</div>
              ) : !historial || historial.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-2">Sin movimientos registrados aún.</p>
              ) : (
                <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs font-mono pr-1">
                  {historial.map((h: any) => {
                    const fechaStr = new Date(h.fecha).toLocaleString('es-AR', {
                      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
                    });

                    const sign = h.total_ingresado > 0 ? '+' : '';
                    const labelTipo = h.tipo === 'stock_inicial' ? 'Stock Inicial'
                      : h.tipo === 'ajuste' ? 'Ajuste'
                      : h.tipo === 'anulacion' ? 'Anulación'
                      : 'Ingreso';

                    return (
                      <div key={h.id} className={`p-2 rounded border space-y-0.5 ${h.anulado ? 'bg-destructive/5 border-destructive/20 opacity-70' : 'bg-muted/40 border-border/50'}`}>
                        <div className="flex justify-between text-[11px] text-muted-foreground">
                          <span>{fechaStr}</span>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="outline" className="text-[9px] px-1 py-0">{labelTipo}</Badge>
                            <span className="font-bold text-foreground">{h.usuario_nombre || 'Usuario'}</span>
                            {h.anulado && <Badge variant="outline" className="text-[9px] px-1 py-0 text-destructive border-destructive/30">Anulado</Badge>}
                          </div>
                        </div>
                        <div className="text-foreground leading-snug flex justify-between items-center">
                          <div>
                            anterior {h.stock_anterior} — <span className="text-primary font-bold">{sign}{h.total_ingresado}</span> — resultante <strong>{h.stock_resultante}</strong>
                            {h.motivo && <p className="text-[10px] text-muted-foreground italic mt-0.5">Motivo: {h.motivo}</p>}
                            {h.anulado && h.motivo_anulacion && (
                              <p className="text-[10px] text-destructive italic mt-0.5">Motivo anulación: {h.motivo_anulacion}</p>
                            )}
                          </div>
                          {!h.anulado && h.tipo === 'ingreso' && isAdmin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setAnularMov(h)}
                              className="h-6 px-2 text-[10px] text-destructive hover:bg-destructive/10 shrink-0 gap-1 font-bold"
                            >
                              <Ban className="w-3 h-3" />
                              Anular
                            </Button>
                          )}
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
              onClick={handleOpenConfirmModal}
              disabled={stockIngresoMutation.isPending || parsedQuantities.length === 0 || hasErrors}
              className="gap-2 px-6"
            >
              Listo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Confirm Save Dialog with Summary & Yellow Alert Warning ─────────────────── */}
      <Dialog open={showConfirmSave} onOpenChange={setShowConfirmSave}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" /> Confirmar ingreso de stock
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Verifique los números antes de confirmar la actualización de inventario.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {/* Product summary card */}
            <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Producto:</span>
                <span className="font-bold text-foreground">{product.nombre}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Stock actual:</span>
                <span className="font-mono font-bold text-foreground">{currentStock}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground text-xs">Cantidad a sumar:</span>
                <span className="font-mono font-bold text-primary">+{totalIngresado}</span>
              </div>
              <div className="flex justify-between items-center border-t border-border pt-2 font-bold text-base">
                <span>Stock resultante:</span>
                <span className="font-mono text-primary">{nuevoStock}</span>
              </div>
            </div>

            {/* High quantity warning box in yellow */}
            {isHighQuantityWarning && (
              <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-400 space-y-1">
                <p className="font-bold text-xs flex items-center gap-1.5">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                  ¡ADVERTENCIA DE CANTIDAD ELEVADA!
                </p>
                <p className="text-[11px] leading-relaxed">
                  La cantidad a sumar (<strong>+{totalIngresado}</strong>) {currentStock === 0 ? 'supera un umbral elevado (más de 100)' : `supera más de 10 veces el stock actual (${currentStock})`}. Asegúrese de que no sea un error tipográfico.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="ghost" onClick={() => setShowConfirmSave(false)} disabled={stockIngresoMutation.isPending}>
              Volver a revisar
            </Button>
            <Button
              onClick={handleConfirmSubmit}
              disabled={stockIngresoMutation.isPending}
              className="gap-2 px-6 bg-primary text-primary-foreground font-bold"
            >
              {stockIngresoMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar e Ingresar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog Anular Ingreso con Motivo Obligatorio ───────────────────── */}
      <Dialog open={!!anularMov} onOpenChange={o => { if (!o) setAnularMov(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2 text-destructive">
              <Ban className="w-5 h-5" /> Anular ingreso de stock #{anularMov?.id}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Esta acción restará <strong>-{anularMov?.total_ingresado}</strong> del stock actual del producto.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="p-3 rounded bg-destructive/10 border border-destructive/20 text-xs space-y-1">
              <p><strong>Stock actual del producto:</strong> {currentStock}</p>
              <p><strong>Total a restar por anulación:</strong> -{anularMov?.total_ingresado}</p>
              <p><strong>Stock después de anular:</strong> {currentStock - (anularMov?.total_ingresado ?? 0)}</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Motivo de la anulación *</Label>
              <Input
                value={motivoAnulacion}
                onChange={e => setMotivoAnulacion(e.target.value)}
                placeholder="Ej. Carga duplicada por error"
                autoFocus
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAnularMov(null)} disabled={anularMutation.isPending}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={anularMutation.isPending || !motivoAnulacion.trim()}
              onClick={() => {
                if (anularMov) {
                  anularMutation.mutate({ movimientoId: anularMov.id, motivo: motivoAnulacion.trim() });
                }
              }}
              className="gap-2 font-bold"
            >
              {anularMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar Anulación
            </Button>
          </DialogFooter>
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

// ── Corregir Stock Modal (In-page Correction with Mandatory Reason) ─────────
function CorregirStockModal({
  product,
  open,
  onClose,
}: {
  product: any | null;
  open: boolean;
  onClose: () => void;
}) {
  const [targetStockStr, setTargetStockStr] = useState('');
  const [motivo, setMotivo] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  useEffect(() => {
    if (open && product) {
      setTargetStockStr(String(product.stock ?? 0));
      setMotivo('');
      setShowConfirm(false);
    }
  }, [open, product?.id]);

  const parsed = useMemo(() => validateStrictNumber(targetStockStr), [targetStockStr]);

  const currentStock = product?.stock ?? 0;
  const targetStock = parsed.num;
  const diff = Math.round((targetStock - currentStock) * 1000) / 1000;

  const updateMutation = useUpdateProducto();

  const handleOpenConfirm = () => {
    if (!parsed.valid || parsed.num < 0) {
      toast({ title: 'Stock inválido', description: parsed.error || 'Ingrese un número válido no negativo.', variant: 'destructive' });
      return;
    }
    if (diff < 0 && !motivo.trim()) {
      toast({ title: 'Motivo requerido', description: 'Debe especificar un motivo obligatorio para disminuir el stock.', variant: 'destructive' });
      return;
    }
    setShowConfirm(true);
  };

  const handleExecuteCorrection = () => {
    if (!product) return;
    updateMutation.mutate({
      id: product.id,
      data: {
        stock: targetStock,
        motivo: motivo.trim() || 'Corrección manual de stock',
      } as any,
    }, {
      onSuccess: () => {
        toast({ title: 'Stock corregido con éxito', description: `Stock anterior: ${currentStock} -> Nuevo stock: ${targetStock}` });
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        setShowConfirm(false);
        onClose();
      },
      onError: (err: any) => {
        toast({ title: 'Error al corregir stock', description: err?.message || 'No se pudo guardar la corrección.', variant: 'destructive' });
      },
    });
  };

  if (!product) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={o => { if (!o) onClose(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5 text-primary" /> Corregir Stock — {product.nombre}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Establezca el valor real en estantería. Si disminuye, debe incluir un motivo obligatorio.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-muted/40 border border-border text-xs">
              <div>
                <span className="text-muted-foreground block">Stock actual:</span>
                <span className="font-mono font-bold text-sm text-foreground">{currentStock}</span>
              </div>
              <div>
                <span className="text-muted-foreground block">Diferencia:</span>
                <span className={`font-mono font-bold text-sm ${diff < 0 ? 'text-destructive' : diff > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                  {diff > 0 ? `+${diff}` : diff}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Nuevo Stock Correcto *</Label>
              <Input
                value={targetStockStr}
                onChange={e => setTargetStockStr(e.target.value)}
                placeholder="Ej. 25"
                className={`font-mono font-bold text-sm ${!parsed.valid && targetStockStr ? 'border-destructive focus-visible:ring-destructive' : ''}`}
                autoFocus
              />
              {!parsed.valid && targetStockStr && (
                <p className="text-[11px] text-destructive font-medium">{parsed.error}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">
                Motivo del ajuste {diff < 0 && <span className="text-destructive">* (Obligatorio)</span>}
              </Label>
              <Input
                value={motivo}
                onChange={e => setMotivo(e.target.value)}
                placeholder="Ej. Rotura, conteo de inventario, pérdida"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={onClose} disabled={updateMutation.isPending}>
              Cancelar
            </Button>
            <Button
              onClick={handleOpenConfirm}
              disabled={updateMutation.isPending || !parsed.valid || (diff < 0 && !motivo.trim())}
              className="gap-2 font-bold"
            >
              Revisar y Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Step for Stock Correction */}
      <Dialog open={showConfirm} onOpenChange={setShowConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" /> Confirmar Corrección de Stock
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 py-2 text-xs">
            <div className="p-3 rounded bg-muted/40 border border-border space-y-1">
              <p><strong>Producto:</strong> {product.nombre}</p>
              <p><strong>Stock Anterior:</strong> {currentStock}</p>
              <p><strong>Nuevo Stock:</strong> <span className="font-bold text-primary">{targetStock}</span></p>
              <p><strong>Ajuste:</strong> {diff > 0 ? `+${diff}` : diff}</p>
              {motivo && <p><strong>Motivo:</strong> {motivo}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowConfirm(false)} disabled={updateMutation.isPending}>
              Atrás
            </Button>
            <Button onClick={handleExecuteCorrection} disabled={updateMutation.isPending} className="font-bold gap-2">
              {updateMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar Ajuste
            </Button>
          </DialogFooter>
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

  // Modals for stock operations (Unstacked: Edit dialog is closed before opening these)
  const [stockProductModal, setStockProductModal] = useState<any | null>(null);
  const [corregirStockModal, setCorregirStockModal] = useState<any | null>(null);

  // New product creation confirmation modal
  const [showCreateConfirm, setShowCreateConfirm] = useState<any | null>(null);

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

    const stockInputVal = (fd.get('stock') as string) || '0';
    const parsedStock = validateStrictNumber(stockInputVal);
    if (isAddMode && (!parsedStock.valid || parsedStock.num < 0)) {
      toast({ title: "Stock inicial inválido", description: parsedStock.error || "Ingrese un número válido.", variant: "destructive" });
      return;
    }

    const precioInputVal = (fd.get('precio') as string) || '0';
    const parsedPrecio = validateStrictNumber(precioInputVal);
    if (!parsedPrecio.valid || parsedPrecio.num < 0) {
      toast({ title: "Precio inválido", description: parsedPrecio.error || "Ingrese un número válido.", variant: "destructive" });
      return;
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

    const dataPayload: any = {
      codigo:          codigoFinal,
      nombre:          (fd.get('nombre') as string)?.trim(),
      precio:          parsedPrecio.num,
      costo:           (fd.get('costo') as string) ? Number((fd.get('costo') as string)?.replace(',', '.')) : undefined,
      stock_minimo:    (fd.get('stock_minimo') as string) ? Number((fd.get('stock_minimo') as string)?.replace(',', '.')) : undefined,
      categoria_id:    Number(formMainCatId),
      subcategoria_id: formSubCatId ? Number(formSubCatId) : null,
      imagen:          imagenFinal,
    };

    if (isAddMode) {
      dataPayload.stock = parsedStock.num;
      if (parsedStock.num > 0) {
        // Require confirmation step for creation with stock > 0
        setShowCreateConfirm(dataPayload);
        return;
      }
      executeCreate(dataPayload);
    } else if (editItem) {
      updateMutation.mutate({ id: editItem.id, data: dataPayload }, {
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
          toast({ title: "Error al guardar producto", description: msg, variant: "destructive" });
        },
      });
    }
  };

  const executeCreate = (data: any) => {
    createMutation.mutate({ data }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        closeForm();
        setShowCreateConfirm(null);
        toast({ title: "Producto creado con éxito" });
      },
      onError: (err: any) => {
        const msg = err?.data?.error || err?.message || "No se pudo crear el producto";
        if (typeof msg === 'string' && (msg.toLowerCase().includes("ya está registrado") || msg.toLowerCase().includes("duplicado"))) {
          setCodigoError("Ese código de barras ya está registrado");
        }
        toast({ title: "Error al guardar producto", description: msg, variant: "destructive" });
      },
    });
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
                                onClick={() => {
                                  closeForm(); // Close edit form first so dialogs don't stack
                                  setStockProductModal(p);
                                }}
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

      {/* ── MODAL CORREGIR STOCK DE PRODUCTO ───────────────────────────── */}
      {isAdmin && corregirStockModal && (
        <CorregirStockModal
          product={corregirStockModal}
          open={!!corregirStockModal}
          onClose={() => setCorregirStockModal(null)}
        />
      )}

      {/* ── CONFIRM NEW PRODUCT CREATION WITH INITIAL STOCK ─────────────── */}
      <Dialog open={!!showCreateConfirm} onOpenChange={o => { if (!o) setShowCreateConfirm(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base font-bold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-primary" /> Confirmar Alta con Stock Inicial
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Se creará el producto registrando el stock inicial en el historial.
            </DialogDescription>
          </DialogHeader>

          {showCreateConfirm && (
            <div className="space-y-3 py-2 text-xs">
              <div className="p-3.5 rounded-lg bg-muted/40 border border-border space-y-1.5">
                <p><strong>Nombre:</strong> {showCreateConfirm.nombre}</p>
                <p><strong>Precio:</strong> {formatMoney(showCreateConfirm.precio)}</p>
                <p><strong>Stock Inicial:</strong> <span className="font-bold text-primary text-sm font-mono">+{showCreateConfirm.stock}</span></p>
              </div>

              {showCreateConfirm.stock > 100 && (
                <div className="p-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-400 space-y-1">
                  <p className="font-bold text-xs flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
                    ¡ADVERTENCIA DE STOCK ELEVADO!
                  </p>
                  <p className="text-[11px]">
                    El stock inicial ingresado (<strong>+{showCreateConfirm.stock}</strong>) es elevado. Verifique que no sea un error.
                  </p>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowCreateConfirm(null)} disabled={createMutation.isPending}>
              Atrás
            </Button>
            <Button
              onClick={() => executeCreate(showCreateConfirm)}
              disabled={createMutation.isPending}
              className="font-bold gap-2"
            >
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Confirmar y Crear
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
                  <Input id="precio" name="precio" type="text" defaultValue={editItem?.precio} required />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="costo">Precio de Compra</Label>
                  <Input id="costo" name="costo" type="text" defaultValue={editItem?.costo || ''} />
                </div>

                {/* Stock field: Editable on create, read-only with "+ Agregar stock" and "Corregir stock" buttons on edit */}
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="stock">Stock Actual *</Label>
                  {isAddMode ? (
                    <Input
                      id="stock"
                      name="stock"
                      type="text"
                      inputMode="decimal"
                      defaultValue={0}
                      required
                    />
                  ) : (
                    <div className="flex gap-2 items-center flex-wrap">
                      <Input
                        id="stock"
                        name="stock_readonly"
                        type="text"
                        value={editItem?.stock ?? 0}
                        readOnly
                        className="bg-muted font-mono font-bold cursor-not-allowed w-28"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const item = editItem;
                          closeForm(); // Close edit form first so dialogs don't stack!
                          setStockProductModal(item);
                        }}
                        className="shrink-0 text-xs font-semibold border-primary/30 text-primary hover:bg-primary/10 gap-1 h-9"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        Agregar stock
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const item = editItem;
                          closeForm(); // Close edit form first so dialogs don't stack!
                          setCorregirStockModal(item);
                        }}
                        className="shrink-0 text-xs font-semibold border-muted-foreground/30 text-foreground hover:bg-muted gap-1 h-9"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        Corregir stock
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
