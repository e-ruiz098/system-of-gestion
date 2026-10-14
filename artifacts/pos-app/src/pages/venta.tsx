import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  useGetProductos, useCreateVenta, useGetCajaActiva, useGetConfig, getProductos,
  Producto, DetalleVentaInput,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Search, Trash2, Plus, Minus, CreditCard, Banknote, Landmark,
  CheckCircle2, AlertTriangle, Package, ShoppingCart,
  Barcode, ScanBarcode, Clock,
} from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { useCurrency } from '@/hooks/use-currency';
import { useBarcodeScanner, cleanBarcode, matchProductByBarcode } from '@/hooks/use-barcode-scanner';
import { calcularRedondeo } from '@/utils/rounding';

interface CartItem {
  cartItemId: string;
  id: number;
  nombre: string;
  codigo: string | null | undefined;
  precio: number;
  stock: number;
  cartQty: number;
  subtotal: number;
  imagen?: string | null;
}

interface SaleSnapshot {
  ticketNumber: number | null;
  items: Array<{
    id: number;
    nombre: string;
    codigo: string | null | undefined;
    precio: number;
    cartQty: number;
    subtotal: number;
  }>;
  subtotal: number;
  ajusteRedondeo: number;
  cartTotal: number;
  buyerName: string;
  fecha: string;
}

// ── Componente separado de Ticket de Impresión (Evita reglas de hooks violadas) ─
function TicketPrint({ snapshot, config, formatMoney }: {
  snapshot: SaleSnapshot | null;
  config: any;
  formatMoney: (n: number) => string;
}) {
  const groupedItems = useMemo(() => {
    if (!snapshot) return [];
    const groups: {
      id: number;
      nombre: string;
      codigo: string | null | undefined;
      precio: number;
      cartQty: number;
      subtotal: number;
    }[] = [];
    for (const item of snapshot.items) {
      const existing = groups.find(
        g => g.id === item.id && Math.abs(g.precio - item.precio) < 0.001
      );
      if (existing) {
        existing.cartQty = Math.round((existing.cartQty + item.cartQty) * 1000) / 1000;
        existing.subtotal += item.subtotal;
      } else {
        groups.push({
          id: item.id,
          nombre: item.nombre,
          codigo: item.codigo,
          precio: item.precio,
          cartQty: item.cartQty,
          subtotal: item.subtotal,
        });
      }
    }
    return groups;
  }, [snapshot]);

  if (!snapshot || !config?.emite_tickets) return null;

  return (
    <div className="ticket-print p-6 text-sm" style={{ display: 'none' }}>
      <div className="text-center mb-4">
        <h1 className="text-xl font-bold">{config?.nombre_empresa || 'Empresa'}</h1>
        <p className="text-muted-foreground">{config?.direccion || ''}</p>
        <p className="text-muted-foreground">{config?.telefono || ''}</p>
      </div>
      <div className="border-t border-b py-2 mb-3">
        <p><strong>Ticket #:</strong> {snapshot.ticketNumber}</p>
        <p><strong>Fecha:</strong> {snapshot.fecha}</p>
        {snapshot.buyerName.trim() && <p><strong>Comprador:</strong> {snapshot.buyerName.trim()}</p>}
      </div>

      <div className="mb-4 border-b pb-3">
        <div className="grid grid-cols-[3rem_1fr_6rem_6rem] font-bold border-b pb-1 mb-2 text-xs uppercase">
          <span>Cant.</span>
          <span>Producto</span>
          <span className="text-right">P. Unit.</span>
          <span className="text-right">Subtotal</span>
        </div>
        {groupedItems.map((line, i) => (
          <div key={i} className="grid grid-cols-[3rem_1fr_6rem_6rem] py-1 border-b border-dashed border-border/50 text-xs">
            <span className="font-bold">{line.cartQty}</span>
            <span className="truncate pr-1">{line.nombre}</span>
            <span className="text-right font-mono">{formatMoney(line.precio)}</span>
            <span className="text-right font-mono font-bold">{formatMoney(line.subtotal)}</span>
          </div>
        ))}
      </div>

      <div className="mb-4">
        <p className="flex justify-between"><span>Subtotal:</span> <span className="font-mono">{formatMoney(snapshot.subtotal)}</span></p>
        {snapshot.ajusteRedondeo !== 0 && (
          <p className="flex justify-between"><span>Redondeo:</span> <span className="font-mono">{formatMoney(snapshot.ajusteRedondeo)}</span></p>
        )}
        <p className="flex justify-between text-lg font-bold border-t pt-1 mt-1"><span>Total:</span> <span className="font-mono">{formatMoney(snapshot.cartTotal)}</span></p>
      </div>
    </div>
  );
}

// ── Widget de Fecha y Hora en tiempo real ─────────────────────────────────────
function DateTimeWidget() {
  const [currentDate, setCurrentDate] = useState(() => new Date());

  useEffect(() => {
    const timer = setInterval(() => setCurrentDate(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const dateStr = currentDate.toLocaleDateString('es-AR', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });
  const timeStr = currentDate.toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-md border border-border bg-muted/40 font-mono select-none shrink-0 shadow-sm">
      <Clock className="w-3.5 h-3.5 text-primary shrink-0" />
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="capitalize text-muted-foreground font-medium text-[11px]">{dateStr}</span>
        <span className="font-bold text-foreground text-xs tracking-tight">{timeStr}</span>
      </div>
    </div>
  );
}

export default function Venta() {
  // ── 1. Campo dedicado "Buscar Productos" (búsqueda por nombre) ─────────────
  const [nameSearch, setNameSearch] = useState('');
  const [nameDropdownOpen, setNameDropdownOpen] = useState(false);
  const nameSearchInputRef = useRef<HTMLInputElement>(null);
  const nameDropdownRef = useRef<HTMLDivElement>(null);

  // ── 2. Lista completa de productos activos para escaneo instantáneo ──────────
  const { data: todosProductosRaw } = useGetProductos({
    params: { activo: 'true' } as any,
    query: {
      queryKey: ['/api/productos', { activo: true }],
    },
  } as any);

  const todosProductos: Producto[] = useMemo(() => {
    return Array.isArray(todosProductosRaw)
      ? todosProductosRaw
      : (todosProductosRaw as any)?.data ?? (todosProductosRaw as any)?.productos ?? [];
  }, [todosProductosRaw]);

  // Resultados para la búsqueda por nombre en dropdown
  const { data: nameSearchResultsRaw } = useGetProductos({
    params: { q: nameSearch, activo: 'true' } as any,
    query: {
      enabled: nameSearch.trim().length > 1,
      queryKey: ['/api/productos', { q: nameSearch, activo: true }],
    },
  } as any);

  const nameSearchResults: Producto[] = useMemo(() => {
    return Array.isArray(nameSearchResultsRaw)
      ? nameSearchResultsRaw
      : (nameSearchResultsRaw as any)?.data ?? (nameSearchResultsRaw as any)?.productos ?? [];
  }, [nameSearchResultsRaw]);

  // ── 3. Campo dedicado "Escanear Código" (Lector USB / Keyboard Wedge) ──────
  const barcodeScanner = useBarcodeScanner({
    autoFocus: true,
    onScan: (scannedCode) => {
      handleBarcodeScan(scannedCode);
    },
  });

  // Campo chico de Cantidad (defecto '1')
  const [scanQty, setScanQty] = useState('1');
  const scanQtyInputRef = useRef<HTMLInputElement>(null);

  // Modal para modo Eliminar Productos (modo corrección)
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Last product added — for preview in right panel
  const [lastAdded, setLastAdded] = useState<CartItem | null>(null);
  // Last scanned barcode string — shown near the total
  const [lastScannedCode, setLastScannedCode] = useState<string>('');

  const { data: caja } = useGetCajaActiva({ query: { retry: false } });
  const { data: config } = useGetConfig();
  const createVentaMutation = useCreateVenta();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { formatMoney } = useCurrency();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'transferencia' | 'mixto'>('efectivo');
  const [cashTendered, setCashTendered] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);

  // Snapshot de venta realizada para ticket e impresión independiente del carrito
  const [saleSnapshot, setSaleSnapshot] = useState<SaleSnapshot | null>(null);

  const [stockWarning, setStockWarning] = useState<{ product: string; agotado: boolean; disponible?: number } | null>(null);
  
  // Para pagos mixtos
  const [mixtoEfectivo, setMixtoEfectivo] = useState('');
  const [mixtoTarjeta, setMixtoTarjeta] = useState('');
  const [mixtoTransferencia, setMixtoTransferencia] = useState('');

  const rawCartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0);
  const redondeoActivo = config?.redondeo_activo ?? true;
  const { subtotal, ajusteRedondeo, total: cartTotal } = calcularRedondeo(
    rawCartTotal,
    redondeoActivo,
    config?.redondeo_multiplo ?? 50,
  );

  // Open name dropdown when there are typed results
  useEffect(() => {
    setNameDropdownOpen(nameSearch.trim().length > 1 && nameSearchResults.length > 0);
  }, [nameSearch, nameSearchResults.length]);

  // Close name dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        nameDropdownRef.current && !nameDropdownRef.current.contains(e.target as Node) &&
        nameSearchInputRef.current && !nameSearchInputRef.current.contains(e.target as Node)
      ) {
        setNameDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Keyboard shortcuts (deshabilitados cuando la papelera/modal de corrección está abierta)
  useEffect(() => {
    if (showDeleteModal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setCart([]); setNameSearch(''); setLastAdded(null); setLastScannedCode(''); setScanQty('1');
        barcodeScanner.focus();
      }
      if (e.key === 'F2') {
        e.preventDefault();
        barcodeScanner.focus();
      }
      if (e.key === 'F3') {
        e.preventDefault();
        nameSearchInputRef.current?.focus();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        scanQtyInputRef.current?.focus();
        scanQtyInputRef.current?.select();
      }
      if (e.key === 'F6') {
        e.preventDefault();
        if (cart.length > 0 && !showPayment && !showSuccess) setShowPayment(true);
        else if (showPayment) handlePay();
      }
      if (e.key === 'F7') {
        e.preventDefault();
        if (showPayment) setShowPayment(false);
      }
      if (e.key === 'Escape') {
        setNameDropdownOpen(false);
        barcodeScanner.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, showPayment, showSuccess, showDeleteModal, barcodeScanner]);

  // ── Core: add product to cart ──────────────────────────────────────────────
  const addToCart = (p: Producto) => {
    const normalizedQty = scanQty.trim().replace(',', '.');
    const qtyNum = parseFloat(normalizedQty);
    if (isNaN(qtyNum) || qtyNum <= 0) {
      toast({
        title: 'Cantidad no válida',
        description: 'Ingrese una cantidad mayor a cero.',
        variant: 'destructive',
      });
      scanQtyInputRef.current?.focus();
      scanQtyInputRef.current?.select();
      return;
    }
    const pendingQty = qtyNum;

    const prodActual = todosProductos.find(item => item.id === p.id);
    const stockActual = prodActual != null ? ((prodActual as any).stock ?? 0) : ((p as any).stock ?? 0);

    if (stockActual <= 0) {
      setStockWarning({ product: p.nombre, agotado: true, disponible: 0 });
      barcodeScanner.focus();
      return;
    }

    const currentQtyForProduct = cart
      .filter(item => item.id === p.id)
      .reduce((sum, item) => sum + item.cartQty, 0);
    const newTotalQty = Math.round((currentQtyForProduct + pendingQty) * 1000) / 1000;

    if (newTotalQty > stockActual) {
      setStockWarning({ product: p.nombre, agotado: false, disponible: stockActual });
      barcodeScanner.focus();
      return;
    }

    const roundedPending = Math.round(pendingQty * 1000) / 1000;
    const newCartItemId = `row-${Date.now()}-${Math.random().toString(36).substr(2, 7)}`;
    const newItem: CartItem = {
      cartItemId: newCartItemId,
      id: p.id,
      nombre: p.nombre,
      codigo: p.codigo,
      precio: p.precio,
      stock: stockActual,
      cartQty: roundedPending,
      subtotal: Math.round(roundedPending * p.precio),
      imagen: p.imagen ?? null,
    };

    setCart(prev => [...prev, newItem]);

    setLastAdded({
      cartItemId: newCartItemId,
      id: p.id,
      nombre: p.nombre,
      codigo: p.codigo,
      precio: p.precio,
      stock: stockActual,
      cartQty: pendingQty,
      subtotal: Math.round(p.precio * pendingQty * 100) / 100,
      imagen: p.imagen ?? null,
    });

    if (p.codigo) {
      setLastScannedCode(p.codigo);
    }

    setNameSearch('');
    setNameDropdownOpen(false);
    setScanQty('1');

    setTimeout(() => {
      barcodeScanner.focus();
    }, 20);
  };

  // ── Handle Barcode Scan ───────────────────────────────────────────────────
  const handleBarcodeScan = async (code: string) => {
    const trimmed = cleanBarcode(code);
    if (!trimmed) return;

    setLastScannedCode(trimmed);
    try {
      localStorage.setItem('sgc_last_scan_time', String(Date.now()));
    } catch (_) {}

    let match = matchProductByBarcode(todosProductos, trimmed);

    if (!match) {
      try {
        const results = await getProductos({ q: trimmed, activo: 'true' } as any);
        if (Array.isArray(results) && results.length > 0) {
          match = matchProductByBarcode(results, trimmed) || results[0];
        }
      } catch (err) {
        console.error('Error fetching barcode match:', err);
      }
    }

    if (match) {
      addToCart(match);
    } else {
      toast({
        title: 'Código no encontrado',
        description: `No se encontró ningún producto con el código: ${trimmed}`,
        variant: 'destructive',
      });
      barcodeScanner.focus();
    }
  };

  // ── Handle Name Search ─────────────────────────────────────────────────────
  const handleNameSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNameSearch(e.target.value);
  };

  const handleNameSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (nameSearchResults.length === 1) {
        addToCart(nameSearchResults[0]);
      }
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = nameDropdownRef.current?.querySelector<HTMLButtonElement>('button');
      first?.focus();
    }
    if (e.key === 'Escape') {
      setNameDropdownOpen(false);
      barcodeScanner.focus();
    }
  };

  // ── Modal / Corrección de filas específicas ─────────────────────────────────
  const removeItemByCartItemId = (cartItemId: string) => {
    const itemToRemove = cart.find(item => item.cartItemId === cartItemId);
    const next = cart.filter(item => item.cartItemId !== cartItemId);
    setCart(prev => prev.filter(item => item.cartItemId !== cartItemId));
    if (itemToRemove && lastAdded?.cartItemId === itemToRemove.cartItemId) {
      setLastAdded(next.length > 0 ? next[next.length - 1] : null);
    }
  };

  const incrementRowQty = (cartItemId: string) => {
    const targetItem = cart.find(i => i.cartItemId === cartItemId);
    if (!targetItem) return;

    const prodActual = todosProductos.find(p => p.id === targetItem.id);
    const stockActual = prodActual != null ? ((prodActual as any).stock ?? 0) : targetItem.stock;

    const currentTotalQtyForProduct = cart
      .filter(i => i.id === targetItem.id)
      .reduce((sum, i) => sum + i.cartQty, 0);

    if (currentTotalQtyForProduct + 1 > stockActual) {
      setStockWarning({ product: targetItem.nombre, agotado: stockActual <= 0, disponible: stockActual });
      return;
    }

    setCart(prev => prev.map(i => {
      if (i.cartItemId === cartItemId) {
        const newQty = i.cartQty + 1;
        return {
          ...i,
          cartQty: newQty,
          subtotal: Math.round(newQty * i.precio),
        };
      }
      return i;
    }));
  };

  const decrementRowQty = (cartItemId: string) => {
    const targetItem = cart.find(i => i.cartItemId === cartItemId);
    if (!targetItem) return;

    if (targetItem.cartQty <= 1) {
      removeItemByCartItemId(cartItemId);
      return;
    }

    setCart(prev => prev.map(i => {
      if (i.cartItemId === cartItemId) {
        const newQty = i.cartQty - 1;
        return {
          ...i,
          cartQty: newQty,
          subtotal: Math.round(newQty * i.precio),
        };
      }
      return i;
    }));
  };

  // ── Procesar Cobro ──────────────────────────────────────────────────────────
  const handlePay = () => {
    if (!caja) {
      toast({ title: 'Caja cerrada', description: 'Debes abrir la caja antes de vender.', variant: 'destructive' });
      return;
    }
    if (paymentMethod === 'efectivo' && cashTendered && Number(cashTendered) < cartTotal) {
      toast({ title: 'Monto insuficiente', description: 'El monto ingresado es menor al total.', variant: 'destructive' });
      return;
    }
    
    if (paymentMethod === 'mixto') {
      const efectivo = Number(mixtoEfectivo) || 0;
      const tarjeta = Number(mixtoTarjeta) || 0;
      const transferencia = Number(mixtoTransferencia) || 0;
      const totalMixto = efectivo + tarjeta + transferencia;
      
      if (Math.abs(totalMixto - cartTotal) > 0.01) {
        toast({ 
          title: 'El pago mixto debe sumar exactamente el total', 
          description: `Total: ${formatMoney(cartTotal)}, Suma actual: ${formatMoney(totalMixto)}`, 
          variant: 'destructive' 
        });
        return;
      }
    }
    
    const detalle: DetalleVentaInput[] = cart.map(item => ({
      producto_id: item.id,
      cantidad: item.cartQty,
      precio_unitario: item.precio,
      subtotal: item.subtotal,
    }));
    
    const ventaData: any = {
      apertura_caja_id: (caja as any)?.apertura?.id ?? (caja as any)?.id,
      metodo_pago: paymentMethod,
      detalle,
    };
    if (config?.emite_tickets && buyerName.trim()) {
      ventaData.nombre_comprador = buyerName.trim();
    }
    
    if (paymentMethod === 'mixto') {
      ventaData.detalle_pago_mixto = JSON.stringify({
        efectivo: Number(mixtoEfectivo) || 0,
        tarjeta: Number(mixtoTarjeta) || 0,
        transferencia: Number(mixtoTransferencia) || 0,
      });
    }
    
    createVentaMutation.mutate(
      { data: ventaData },
      {
        onSuccess: (data) => {
          // Generar copia (snapshot) congelada antes de vaciar el carrito
          const snapshotData: SaleSnapshot = {
            ticketNumber: data.numero_ticket,
            items: cart.map(i => ({ ...i })),
            subtotal,
            ajusteRedondeo,
            cartTotal,
            buyerName: buyerName.trim(),
            fecha: new Date().toLocaleString('es-ES'),
          };
          setSaleSnapshot(snapshotData);

          setShowPayment(false);
          setShowSuccess(true);
          setCart([]); setNameSearch(''); setCashTendered(''); setBuyerName(''); setLastAdded(null);
          setMixtoEfectivo(''); setMixtoTarjeta(''); setMixtoTransferencia('');
          setPaymentMethod('efectivo');
          queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
          queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
          setTimeout(() => { setShowSuccess(false); barcodeScanner.focus(); }, 3000);
        },
        onError: () => toast({ title: 'Error', description: 'No se pudo procesar la venta.', variant: 'destructive' }),
      }
    );
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-background overflow-hidden relative">

      {/* Estilos de impresión para ticket */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          .ticket-print { display: block !important; position: absolute; top: 0; left: 0; width: 100%; }
        }
      `}</style>

      {/* ── TICKET PARA IMPRESIÓN (Basado en saleSnapshot) ────────────────────── */}
      <TicketPrint snapshot={saleSnapshot} config={config} formatMoney={formatMoney} />

      {/* ── SUCCESS OVERLAY ─────────────────────────────────────────────── */}
      {showSuccess && (
        <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur flex flex-col items-center justify-center">
          <CheckCircle2 className="w-24 h-24 text-emerald-500 mb-4" />
          <h2 className="text-3xl font-bold mb-1">Venta Completada</h2>
          <p className="text-lg text-muted-foreground">Ticket #{saleSnapshot?.ticketNumber}</p>
          {config?.emite_tickets && (
            <Button 
              onClick={() => window.print()}
              className="mt-4"
              variant="outline"
            >
              Imprimir Ticket
            </Button>
          )}
        </div>
      )}

      {/* ── STOCK WARNING ───────────────────────────────────────────────── */}
      <Dialog open={!!stockWarning} onOpenChange={() => setStockWarning(null)}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center text-center py-2">
            <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
            <h3 className="text-lg font-bold mb-1">
              {stockWarning?.agotado ? 'Producto Agotado' : 'Stock Insuficiente'}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              {stockWarning?.agotado ? (
                <>El producto <strong>{stockWarning?.product}</strong> está agotado.</>
              ) : (
                <>
                  No hay suficientes unidades disponibles de <strong>{stockWarning?.product}</strong>
                  {stockWarning?.disponible !== undefined ? ` (disponible: ${stockWarning.disponible})` : ''}.
                </>
              )}
            </p>
            <Button onClick={() => { setStockWarning(null); barcodeScanner.focus(); }} className="w-full">Aceptar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── TOP BAR: Buscar Productos + Atajos + Recuadro Fecha y Hora ──── */}
      <div className="shrink-0 px-3 py-1.5 border-b border-border bg-card">
        <div className="flex items-center justify-between gap-3">

          {/* Campo "Buscar Productos" + Botón "Eliminar Productos" */}
          <div className="flex items-center gap-2 flex-1 max-w-xl">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                ref={nameSearchInputRef}
                value={nameSearch}
                onChange={handleNameSearchChange}
                onKeyDown={handleNameSearchKeyDown}
                onFocus={() => nameSearch.trim().length > 1 && nameSearchResults.length > 0 && setNameDropdownOpen(true)}
                placeholder="Buscar productos por nombre (ej: Leche, Galletitas)..."
                className="pl-9 h-8 text-sm bg-input"
                autoComplete="off"
              />

              {/* Dropdown de resultados por nombre */}
              {nameDropdownOpen && nameSearchResults.length > 0 && (
                <div
                  ref={nameDropdownRef}
                  className="absolute top-full left-0 right-0 z-40 mt-1 bg-popover border border-border rounded-lg shadow-xl overflow-hidden"
                  style={{ maxHeight: '280px', overflowY: 'auto' }}
                >
                  {nameSearchResults.slice(0, 20).map((p) => {
                    const stock = (p as any).stock ?? 0;
                    const agotado = stock <= 0;
                    return (
                      <button
                        key={p.id}
                        onClick={() => !agotado && addToCart(p)}
                        onKeyDown={e => {
                          if (e.key === 'ArrowDown') {
                            e.preventDefault();
                            const next = e.currentTarget.nextElementSibling as HTMLButtonElement;
                            next?.focus();
                          }
                          if (e.key === 'ArrowUp') {
                            e.preventDefault();
                            const prev = e.currentTarget.previousElementSibling as HTMLButtonElement;
                            if (prev) prev.focus();
                            else nameSearchInputRef.current?.focus();
                          }
                        }}
                        disabled={agotado}
                        className={`w-full flex items-center gap-3 px-3 py-2 text-left text-sm transition-colors border-b border-border/40 last:border-0 focus:outline-none focus:bg-primary/10 ${
                          agotado
                            ? 'opacity-40 cursor-not-allowed'
                            : 'hover:bg-primary/8 cursor-pointer'
                        }`}
                      >
                        {/* Thumbnail */}
                        {p.imagen ? (
                          <img src={p.imagen} alt={p.nombre} className="w-8 h-8 rounded object-cover border border-border shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center shrink-0">
                            <Package className="w-4 h-4 text-muted-foreground/40" />
                          </div>
                        )}
                        {/* Name + code */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium truncate">{p.nombre}</div>
                          {p.codigo && <div className="text-xs text-muted-foreground font-mono">{p.codigo}</div>}
                        </div>
                        {/* Price */}
                        <div className="font-bold text-primary font-mono shrink-0">{formatMoney(p.precio)}</div>
                        {/* Stock badge */}
                        <div className={`text-xs font-bold px-1.5 py-0.5 rounded shrink-0 ${
                          agotado ? 'bg-destructive/10 text-destructive' :
                          stock <= 5 ? 'bg-amber-500/10 text-amber-500' :
                          'bg-emerald-500/10 text-emerald-600'
                        }`}>
                          {agotado ? 'Agotado' : `${stock}`}
                        </div>
                      </button>
                    );
                  })}
                  {nameSearchResults.length > 20 && (
                    <div className="px-3 py-2 text-xs text-muted-foreground text-center bg-muted/20">
                      Mostrando 20 de {nameSearchResults.length} resultados — refiná el nombre
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Botón Eliminar Productos */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDeleteModal(true)}
              disabled={cart.length === 0}
              className="h-8 text-xs font-semibold gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive shrink-0"
              title="Abrir modo para eliminar productos del carrito"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Eliminar Productos
            </Button>
          </div>

          {/* Atajos de teclado + Recuadro Fecha y Hora */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1 shrink-0">
              <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground" title="Vaciar carrito (F1)">
                F1
              </kbd>
              <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground" title="Escanear código (F2)">
                F2
              </kbd>
              <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground" title="Buscar por nombre (F3)">
                F3
              </kbd>
              <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground" title="Cantidad antes de escanear (F4)">
                F4
              </kbd>
              <kbd className="font-mono bg-muted px-1.5 py-0.5 rounded border border-border text-[10px] text-muted-foreground" title="Cobrar venta (F6)">
                F6
              </kbd>
            </div>

            {/* Recuadro de Fecha y Hora */}
            <DateTimeWidget />
          </div>
        </div>
      </div>

      {/* ── MAIN AREA: Cart table + Right panel ─────────────────────────── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* ── CENTER: Cart table ── */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Table header */}
          <div className="shrink-0 grid grid-cols-[2.5rem_2.5rem_7rem_1fr_8rem_7rem_7rem] gap-0 border-b border-border bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
            <div className="px-2 py-2 text-center">N°</div>
            <div className="px-1 py-2 text-center">Foto</div>
            <div className="px-2 py-2">Código</div>
            <div className="px-2 py-2">Nombre</div>
            <div className="px-2 py-2 text-center">Cantidad</div>
            <div className="px-2 py-2 text-right">P. Unit.</div>
            <div className="px-2 py-2 text-right">Subtotal</div>
          </div>

          {/* Table body */}
          <div className="flex-1 overflow-y-auto">
            {cart.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-30 select-none">
                <ShoppingCart className="w-16 h-16 mb-3" />
                <p className="text-base">El carrito está vacío</p>
                <p className="text-xs mt-1">Escané un código de barras o busque un producto por nombre</p>
              </div>
            ) : (
              cart.map((item, idx) => (
                <div
                  key={item.cartItemId}
                  className="grid grid-cols-[2.5rem_2.5rem_7rem_1fr_8rem_7rem_7rem] gap-0 border-b border-border/50 hover:bg-muted/20 items-center"
                >
                  <div className="px-2 py-2 text-center text-xs text-muted-foreground font-mono">{idx + 1}</div>
                  <div className="px-1 py-1.5 flex justify-center">
                    {item.imagen ? (
                      <img src={item.imagen} alt={item.nombre} className="w-8 h-8 object-cover rounded border border-border" />
                    ) : (
                      <div className="w-8 h-8 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center">
                        <Package className="w-3.5 h-3.5 text-muted-foreground/40" />
                      </div>
                    )}
                  </div>
                  <div className="px-2 py-2 font-mono text-xs text-muted-foreground truncate">{item.codigo || '—'}</div>
                  <div className="px-2 py-2 font-medium text-sm truncate">{item.nombre}</div>
                  <div className="px-2 py-2 text-center font-bold text-sm font-mono text-foreground">
                    {item.cartQty}
                  </div>
                  <div className="px-2 py-2 text-right font-mono text-sm">{formatMoney(item.precio)}</div>
                  <div className="px-2 py-2 text-right font-bold text-sm text-primary font-mono">{formatMoney(item.subtotal)}</div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── RIGHT PANEL ─────────────────────────────────────────────── */}
        <div className="w-80 shrink-0 flex flex-col border-l border-border bg-card">

          {/* ── SECCIÓN: "CANTIDAD" (Izquierda) + "CÓDIGO / LECTOR" (Derecha) ── */}
          <div className="p-3 border-b border-border bg-muted/10 space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-primary">
                <Barcode className="w-4 h-4" /> Terminal POS
              </Label>
              <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Lector Listo (F2)
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-20 shrink-0 relative">
                <Input
                  ref={scanQtyInputRef}
                  value={scanQty}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^[0-9]*[.,]?[0-9]*$/.test(val)) {
                      setScanQty(val);
                    }
                  }}
                  onBlur={() => {
                    if (!scanQty || scanQty.trim() === '' || parseFloat(scanQty.replace(',', '.')) <= 0) {
                      setScanQty('1');
                    }
                  }}
                  onFocus={(e) => e.target.select()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      barcodeScanner.focus();
                    }
                  }}
                  placeholder="1"
                  className="h-10 text-center font-mono font-bold text-sm bg-background border-border focus:border-primary focus:ring-2 focus:ring-primary/20 px-1"
                  title="Cantidad para el próximo escaneo (F4)"
                  autoComplete="off"
                />
                <span className="absolute -top-1.5 right-1 px-1 bg-muted text-[9px] font-mono text-muted-foreground border border-border rounded leading-none pointer-events-none">
                  F4
                </span>
              </div>

              <div className="relative flex-1 min-w-0">
                <Input
                  ref={barcodeScanner.inputRef}
                  value={barcodeScanner.barcode}
                  onChange={barcodeScanner.handleChange}
                  onKeyDown={barcodeScanner.handleKeyDown}
                  placeholder="Escanear o escribir código..."
                  className="h-10 text-sm font-mono font-bold bg-background border-primary/50 focus:border-primary focus:ring-2 focus:ring-primary/20 pr-8"
                  autoComplete="off"
                />
                <ScanBarcode className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              </div>
            </div>

            <p className="text-[10px] text-muted-foreground leading-tight flex items-center justify-between">
              <span>Lector agrega automático. Manual: Enter.</span>
              {parseFloat(scanQty.replace(',', '.')) > 1 && (
                <span className="text-primary font-semibold">
                  Cantidad: {scanQty}
                </span>
              )}
            </p>
          </div>

          {/* ── PANEL: "Último producto cargado" ── */}
          <div className="flex-1 flex flex-col p-3 border-b border-border min-h-0 overflow-hidden items-center justify-center">
            <span className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground mb-1 text-center shrink-0">
              Último producto cargado
            </span>

            {lastAdded ? (
              <div className="flex-1 flex flex-col items-center justify-center min-h-0 w-full">
                <div className="w-full max-h-40 flex-1 rounded-lg border border-border bg-muted/20 flex items-center justify-center overflow-hidden shadow-sm p-2">
                  {lastAdded.imagen ? (
                    <img
                      src={lastAdded.imagen}
                      alt={lastAdded.nombre}
                      className="w-full h-full object-contain"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-muted-foreground/40">
                      <Package className="w-12 h-12 mb-1" />
                      <span className="text-xs">Sin imagen</span>
                    </div>
                  )}
                </div>

                <div className="mt-2 text-center w-full px-1 shrink-0">
                  <h4 className="text-sm font-bold text-foreground leading-snug line-clamp-2">
                    {lastAdded.nombre}
                  </h4>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground/30 select-none py-2 w-full">
                <div className="w-full max-h-40 flex-1 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center p-3">
                  <Package className="w-12 h-12 mb-1 text-muted-foreground/30" />
                  <p className="text-xs text-center font-medium">Esperando primer escaneo...</p>
                </div>
              </div>
            )}
          </div>

          {/* Total + Cobrar */}
          <div className="shrink-0 p-3 bg-muted/10">
            <div className="flex items-center justify-between text-xs text-muted-foreground font-mono mb-2 pb-1.5 border-b border-border/50">
              <span className="text-[10px] uppercase tracking-wider font-semibold">Último código:</span>
              <span className="font-bold text-foreground bg-muted px-2 py-0.5 rounded border border-border/50 truncate max-w-[170px]">
                {lastScannedCode || '—'}
              </span>
            </div>

            <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-1">Subtotal</div>
            <div className="text-lg font-semibold text-foreground font-mono tracking-tight mb-1">
              {formatMoney(subtotal)}
            </div>
            {ajusteRedondeo !== 0 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Redondeo</span>
                <span className="font-mono">{ajusteRedondeo > 0 ? '+' : ''}{formatMoney(ajusteRedondeo)}</span>
              </div>
            )}
            <div className="text-[10px] text-muted-foreground font-semibold uppercase tracking-widest mb-1 mt-2">Total a cobrar</div>
            <div className="text-3xl font-black text-primary font-mono tracking-tight leading-none mb-3">
              {formatMoney(cartTotal)}
            </div>
            <Button
              className="w-full h-11 text-sm font-bold uppercase tracking-wide"
              onClick={() => setShowPayment(true)}
              disabled={cart.length === 0}
            >
              COBRAR (F6)
            </Button>
          </div>
        </div>
      </div>

      {/* ── MODAL: Modo Corrección en "Eliminar Productos" ──────────────── */}
      <Dialog
        open={showDeleteModal}
        onOpenChange={(open) => {
          setShowDeleteModal(open);
          if (!open) {
            barcodeScanner.focus();
          }
        }}
      >
        <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 border-b border-border bg-muted/20 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-full bg-destructive/10 text-destructive">
                <Trash2 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-foreground">Modo Corrección / Eliminar Productos</h3>
                <p className="text-xs text-muted-foreground">
                  Al pasar el cursor sobre la cantidad podrá usar [-] y [+] solo en cantidades enteras.
                </p>
              </div>
            </div>
          </div>

          {/* Table with row-level correction */}
          <div className="flex-1 overflow-y-auto min-h-0">
            {cart.length === 0 ? (
              <div className="py-12 flex flex-col items-center justify-center text-muted-foreground opacity-60">
                <ShoppingCart className="w-12 h-12 mb-2" />
                <p className="text-sm font-medium">El carrito está vacío</p>
              </div>
            ) : (
              <div>
                <div className="shrink-0 grid grid-cols-[2.5rem_2.5rem_6.5rem_1fr_7rem_6rem_6rem_3.5rem] gap-0 border-b border-border bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide sticky top-0 z-10 backdrop-blur">
                  <div className="px-2 py-2 text-center">N°</div>
                  <div className="px-1 py-2 text-center">Foto</div>
                  <div className="px-2 py-2">Código</div>
                  <div className="px-2 py-2">Nombre</div>
                  <div className="px-2 py-2 text-center">Cantidad</div>
                  <div className="px-2 py-2 text-right">P. Unit.</div>
                  <div className="px-2 py-2 text-right">Subtotal</div>
                  <div className="px-2 py-2 text-center text-destructive font-bold">Quitar</div>
                </div>

                {cart.map((item, idx) => {
                  const isIntegerQty = Number.isInteger(item.cartQty);

                  return (
                    <div
                      key={item.cartItemId}
                      className="grid grid-cols-[2.5rem_2.5rem_6.5rem_1fr_7rem_6rem_6rem_3.5rem] gap-0 border-b border-border/50 hover:bg-muted/30 items-center transition-colors group"
                    >
                      <div className="px-2 py-2.5 text-center text-xs text-muted-foreground font-mono">{idx + 1}</div>
                      <div className="px-1 py-2 flex justify-center">
                        {item.imagen ? (
                          <img src={item.imagen} alt={item.nombre} className="w-8 h-8 object-cover rounded border border-border" />
                        ) : (
                          <div className="w-8 h-8 rounded border border-dashed border-border bg-muted/30 flex items-center justify-center">
                            <Package className="w-3.5 h-3.5 text-muted-foreground/40" />
                          </div>
                        )}
                      </div>
                      <div className="px-2 py-2 font-mono text-xs text-muted-foreground truncate">{item.codigo || '—'}</div>
                      <div className="px-2 py-2 font-medium text-sm truncate">{item.nombre}</div>

                      {/* Cantidad con [-] y [+] visibles SOLO al pasar el mouse (y SOLO si es entera) */}
                      <div className="px-2 py-2 text-center flex items-center justify-center gap-1 font-mono">
                        {isIntegerQty ? (
                          <>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => decrementRowQty(item.cartItemId)}
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity p-0 border-destructive/40 text-destructive hover:bg-destructive/10"
                              title="Disminuir cantidad en 1"
                            >
                              <Minus className="w-3 h-3" />
                            </Button>
                            <span className="font-bold text-sm min-w-[1.5rem]">{item.cartQty}</span>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => incrementRowQty(item.cartItemId)}
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity p-0 border-primary/40 text-primary hover:bg-primary/10"
                              title="Aumentar cantidad en 1"
                            >
                              <Plus className="w-3 h-3" />
                            </Button>
                          </>
                        ) : (
                          <span className="font-bold text-sm">{item.cartQty}</span>
                        )}
                      </div>

                      <div className="px-2 py-2 text-right font-mono text-sm">{formatMoney(item.precio)}</div>
                      <div className="px-2 py-2 text-right font-bold text-sm text-primary font-mono">{formatMoney(item.subtotal)}</div>
                      <div className="px-2 py-2 flex justify-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeItemByCartItemId(item.cartItemId)}
                          className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/15 rounded-full transition-colors"
                          title="Eliminar esta fila del carrito"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              Total en carrito: <strong className="text-foreground font-mono">{formatMoney(cartTotal)}</strong> ({cart.length} {cart.length === 1 ? 'producto' : 'productos'})
            </span>
            <Button
              variant="default"
              onClick={() => {
                setShowDeleteModal(false);
                barcodeScanner.focus();
              }}
            >
              Cerrar y Volver a Venta
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── PAYMENT MODAL ───────────────────────────────────────────────── */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="sm:max-w-[480px] p-0 overflow-hidden flex flex-col max-h-[90vh]">
          {/* Total header */}
          <div className="bg-primary px-5 py-4 text-primary-foreground text-center shrink-0">
            <div className="text-xs font-medium opacity-70 uppercase tracking-widest mb-1">Subtotal</div>
            <div className="text-lg font-semibold font-mono tracking-tight mb-1">
              {formatMoney(subtotal)}
            </div>
            {ajusteRedondeo !== 0 && (
              <div className="flex items-center justify-center text-xs opacity-80 mb-1">
                <span>Redondeo: </span>
                <span className="font-mono ml-1">{ajusteRedondeo > 0 ? '+' : ''}{formatMoney(ajusteRedondeo)}</span>
              </div>
            )}
            <div className="text-xs font-medium opacity-70 uppercase tracking-widest mb-1 mt-2">Total a cobrar</div>
            <div className="text-4xl font-black font-mono tracking-tighter">{formatMoney(cartTotal)}</div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4">
            {config?.emite_tickets && (
              <div className="space-y-1.5">
                <Label htmlFor="nombre-comprador">Nombre del comprador (opcional)</Label>
                <Input
                  id="nombre-comprador"
                  value={buyerName}
                  onChange={e => setBuyerName(e.target.value)}
                  maxLength={200}
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <p className="text-sm font-bold mb-2 text-center">Medio de Pago</p>
              <div className="grid grid-cols-4 gap-2">
                {(['efectivo', 'tarjeta', 'transferencia', 'mixto'] as const).map(m => (
                  <Button
                    key={m}
                    variant={paymentMethod === m ? 'default' : 'outline'}
                    className="h-14 flex flex-col gap-1 text-xs px-1"
                    onClick={() => {
                      setPaymentMethod(m);
                      if (m !== 'mixto') {
                        setMixtoEfectivo('');
                        setMixtoTarjeta('');
                        setMixtoTransferencia('');
                      }
                    }}
                  >
                    {m === 'efectivo' && <Banknote className="w-4 h-4" />}
                    {m === 'tarjeta' && <CreditCard className="w-4 h-4" />}
                    {m === 'transferencia' && <Landmark className="w-4 h-4" />}
                    {m === 'mixto' && <Banknote className="w-4 h-4" />}
                    <span>{m === 'efectivo' ? 'Efectivo' : m === 'tarjeta' ? 'Tarjeta' : m === 'transferencia' ? 'Transfer.' : 'Mixto'}</span>
                  </Button>
                ))}
              </div>
            </div>

            <div className="min-h-[120px]">
              {paymentMethod === 'efectivo' && (
                <div className="bg-muted/30 rounded-lg border border-border p-3 space-y-2">
                  <div>
                    <Label className="text-xs">Monto Entregado</Label>
                    <Input
                      type="number"
                      value={cashTendered}
                      onChange={e => setCashTendered(e.target.value)}
                      className="h-10 font-mono font-bold text-lg mt-1"
                      autoFocus
                    />
                  </div>
                  <div className={`flex justify-between items-center rounded px-3 py-1.5 border transition-all ${
                    cashTendered && Number(cashTendered) >= cartTotal
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-transparent border-transparent text-transparent select-none'
                  }`}>
                    <span className="font-bold text-sm">Vuelto:</span>
                    <span className="text-lg font-black font-mono">
                      {cashTendered && Number(cashTendered) >= cartTotal
                        ? formatMoney(Number(cashTendered) - cartTotal)
                        : '—'}
                    </span>
                  </div>
                </div>
              )}
              
              {paymentMethod === 'mixto' && (
                <div className="bg-muted/30 rounded-lg border border-border p-3 space-y-3">
                  <p className="text-xs text-muted-foreground">Ingresa el monto por cada método (debe sumar {formatMoney(cartTotal)})</p>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Efectivo</Label>
                      <Input
                        type="number"
                        value={mixtoEfectivo}
                        onChange={e => setMixtoEfectivo(e.target.value)}
                        className="h-10 font-mono font-bold mt-1"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Tarjeta</Label>
                      <Input
                        type="number"
                        value={mixtoTarjeta}
                        onChange={e => setMixtoTarjeta(e.target.value)}
                        className="h-10 font-mono font-bold mt-1"
                        placeholder="0"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Transferencia</Label>
                      <Input
                        type="number"
                        value={mixtoTransferencia}
                        onChange={e => setMixtoTransferencia(e.target.value)}
                        className="h-10 font-mono font-bold mt-1"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <div className={`flex justify-between items-center rounded px-3 py-1.5 border transition-all ${
                    (Number(mixtoEfectivo) + Number(mixtoTarjeta) + Number(mixtoTransferencia)) === cartTotal
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                      : 'bg-amber-500/10 text-amber-600 border-amber-500/20'
                  }`}>
                    <span className="font-bold text-sm">Suma actual:</span>
                    <span className="text-lg font-black font-mono">
                      {formatMoney(Number(mixtoEfectivo) + Number(mixtoTarjeta) + Number(mixtoTransferencia))}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="shrink-0 px-4 py-3 border-t border-border bg-muted/20 flex justify-between items-center gap-3">
            <Button variant="ghost" onClick={() => { setShowPayment(false); barcodeScanner.focus(); }} className="shrink-0">
              Cancelar (F7)
            </Button>
            <Button
              size="lg"
              onClick={handlePay}
              disabled={
                createVentaMutation.isPending ||
                (paymentMethod === 'efectivo' && !!cashTendered && Number(cashTendered) < cartTotal) ||
                (paymentMethod === 'mixto' && (Number(mixtoEfectivo) + Number(mixtoTarjeta) + Number(mixtoTransferencia)) !== cartTotal)
              }
              className="flex-1"
            >
              Confirmar Venta
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
