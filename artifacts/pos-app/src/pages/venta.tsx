import React, { useState, useEffect, useRef } from 'react';
import { useGetProductos, useCreateVenta, useGetCajaActiva, Producto, DetalleVentaInput } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, ShoppingCart, Trash2, Plus, Minus, CreditCard, Banknote, Landmark, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Label } from '@/components/ui/label';
import { useCurrency } from '@/hooks/use-currency';

interface CartItem {
  id: number;
  nombre: string;
  codigo: string | null | undefined;
  precio: number;
  stock: number;
  unidad_tipo: string;
  cartQty: number;
  subtotal: number;
}

export default function Venta() {
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { data: productos } = useGetProductos({
    params: { q: search, activo: 'true' } as any,
    query: { enabled: search.length > 1, queryKey: ['/api/productos', { q: search, activo: true }] }
  } as any);
  const { data: caja } = useGetCajaActiva();
  const createVentaMutation = useCreateVenta();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { formatMoney } = useCurrency();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'efectivo' | 'tarjeta' | 'transferencia' | 'mixto'>('efectivo');
  const [cashTendered, setCashTendered] = useState<string>('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastTicket, setLastTicket] = useState<number | null>(null);
  const [stockWarning, setStockWarning] = useState<{ product: string; agotado: boolean } | null>(null);

  const cartTotal = cart.reduce((sum, item) => sum + item.subtotal, 0);

  useEffect(() => { searchInputRef.current?.focus(); }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') { e.preventDefault(); setCart([]); setSearch(''); searchInputRef.current?.focus(); }
      if (e.key === 'F2') { e.preventDefault(); searchInputRef.current?.focus(); }
      if (e.key === 'F6') {
        e.preventDefault();
        if (cart.length > 0 && !showPayment && !showSuccess) setShowPayment(true);
        else if (showPayment) handlePay();
      }
      if (e.key === 'F7') { e.preventDefault(); if (showPayment) setShowPayment(false); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [cart, showPayment, showSuccess]);

  const addToCart = (p: Producto) => {
    const stock = (p as any).stock ?? 0;
    if (stock <= 0) {
      setStockWarning({ product: p.nombre, agotado: true });
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => item.id === p.id);
      if (existing) {
        if (existing.cartQty >= stock) {
          setStockWarning({ product: p.nombre, agotado: false });
          return prev;
        }
        return prev.map(item =>
          item.id === p.id
            ? { ...item, cartQty: item.cartQty + 1, subtotal: (item.cartQty + 1) * item.precio }
            : item
        );
      }
      return [...prev, {
        id: p.id, nombre: p.nombre, codigo: p.codigo,
        precio: p.precio, stock, unidad_tipo: (p as any).unidad_tipo ?? 'unidad',
        cartQty: 1, subtotal: p.precio
      }];
    });
    setSearch('');
    searchInputRef.current?.focus();
  };

  const updateQty = (id: number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = item.cartQty + delta;
      if (newQty < 1) return item;
      if (newQty > item.stock) {
        setStockWarning({ product: item.nombre, agotado: item.stock === 0 });
        return item;
      }
      const rounded = item.unidad_tipo === 'kg' ? Math.round(newQty * 1000) / 1000 : Math.round(newQty);
      return { ...item, cartQty: rounded, subtotal: rounded * item.precio };
    }));
  };

  const setQtyDirect = (id: number, val: string) => {
    setCart(prev => prev.map(item => {
      if (item.id !== id) return item;
      const newQty = item.unidad_tipo === 'kg' ? parseFloat(val) : parseInt(val, 10);
      if (isNaN(newQty) || newQty < 0) return { ...item, cartQty: 0, subtotal: 0 };
      if (newQty > item.stock) {
        setStockWarning({ product: item.nombre, agotado: item.stock === 0 });
        return item;
      }
      return { ...item, cartQty: newQty, subtotal: newQty * item.precio };
    }));
  };

  const removeItem = (id: number) => setCart(prev => prev.filter(item => item.id !== id));

  const handlePay = () => {
    if (!caja) {
      toast({ title: "Caja cerrada", description: "Debes abrir la caja antes de vender.", variant: "destructive" });
      return;
    }
    if (paymentMethod === 'efectivo' && cashTendered && Number(cashTendered) < cartTotal) {
      toast({ title: "Monto insuficiente", description: "El monto ingresado es menor al total.", variant: "destructive" });
      return;
    }
    const detalle: DetalleVentaInput[] = cart.map(item => ({
      producto_id: item.id, cantidad: item.cartQty,
      precio_unitario: item.precio, subtotal: item.subtotal
    }));
    createVentaMutation.mutate({
      data: { apertura_caja_id: (caja as any)?.apertura?.id ?? (caja as any)?.id, total: cartTotal, metodo_pago: paymentMethod, detalle }
    }, {
      onSuccess: (data) => {
        setLastTicket(data.numero_ticket);
        setShowPayment(false); setShowSuccess(true);
        setCart([]); setSearch(''); setCashTendered('');
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        queryClient.invalidateQueries({ queryKey: ['/api/dashboard'] });
        setTimeout(() => { setShowSuccess(false); searchInputRef.current?.focus(); }, 3000);
      },
      onError: () => toast({ title: "Error", description: "No se pudo procesar la venta.", variant: "destructive" })
    });
  };

  // CORRECCIÓN SEGUARA CONTRA TYPE ERROR:
  const listaProductos = Array.isArray(productos) 
    ? productos 
    : (productos as any)?.data || (productos as any)?.productos || [];

  const filteredProductos: Producto[] = listaProductos.filter((p: any) => (p as any).stock > 0 || true);

  return (
    <div className="flex h-full bg-background overflow-hidden relative">

      {/* SUCCESS OVERLAY */}
      {showSuccess && (
        <div className="absolute inset-0 z-50 bg-background/95 backdrop-blur flex flex-col items-center justify-center">
          <CheckCircle2 className="w-24 h-24 text-emerald-500 mb-4" />
          <h2 className="text-3xl font-bold mb-1">Venta Completada</h2>
          <p className="text-lg text-muted-foreground">Ticket #{lastTicket}</p>
        </div>
      )}

      {/* STOCK WARNING MODAL */}
      <Dialog open={!!stockWarning} onOpenChange={() => setStockWarning(null)}>
        <DialogContent className="max-w-sm">
          <div className="flex flex-col items-center text-center py-2">
            <AlertTriangle className="w-12 h-12 text-amber-500 mb-3" />
            <h3 className="text-lg font-bold mb-1">
              {stockWarning?.agotado ? "Producto Agotado" : "Stock Insuficiente"}
            </h3>
            <p className="text-muted-foreground text-sm mb-4">
              No hay más unidades disponibles de <strong>{stockWarning?.product}</strong>.
            </p>
            <Button onClick={() => setStockWarning(null)} className="w-full">Aceptar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* LEFT: Search & Results */}
      <div className="flex-1 flex flex-col border-r border-border min-w-0">
        <div className="p-3 border-b border-border bg-card shrink-0">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              ref={searchInputRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar producto o escanear código de barras..."
              className="pl-10 h-12 text-lg font-medium bg-input"
            />
          </div>
          <div className="mt-1.5 text-xs text-muted-foreground flex gap-3">
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded border border-border text-xs">F1</kbd> Limpiar</span>
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded border border-border text-xs">F2</kbd> Buscar</span>
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded border border-border text-xs">F6</kbd> Cobrar</span>
            <span><kbd className="font-mono bg-muted px-1 py-0.5 rounded border border-border text-xs">F7</kbd> Cancelar</span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {search.length > 1 && (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground text-xs uppercase tracking-wide">
                  <th className="px-4 py-2 text-left font-medium w-28">Código</th>
                  <th className="px-4 py-2 text-left font-medium">Nombre</th>
                  <th className="px-4 py-2 text-right font-medium w-24">Precio</th>
                  <th className="px-4 py-2 text-center font-medium w-20">Stock</th>
                </tr>
              </thead>
              <tbody>
                {filteredProductos.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-10 text-muted-foreground">No se encontraron productos para "{search}"</td></tr>
                )}
                {filteredProductos.map(p => {
                  const stock = (p as any).stock ?? 0;
                  const stockEstado = (p as any).stock_estado ?? 'verde';
                  const esAgotado = stock <= 0;
                  return (
                    <tr
                      key={p.id}
                      onClick={() => !esAgotado && addToCart(p)}
                      className={`border-b border-border/50 transition-colors ${
                        esAgotado
                          ? "opacity-50 cursor-not-allowed"
                          : "cursor-pointer hover:bg-primary/8 hover:border-primary/30 active:bg-primary/15"
                      }`}
                    >
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{p.codigo || '—'}</td>
                      <td className="px-4 py-2.5 font-medium">{p.nombre}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-primary font-mono">{formatMoney(p.precio)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${
                          stockEstado === 'rojo' ? 'bg-destructive/10 text-destructive' :
                          stockEstado === 'amarillo' ? 'bg-amber-500/10 text-amber-500' :
                          'bg-emerald-500/10 text-emerald-600'
                        }`}>
                          {stock}{(p as any).unidad_tipo === 'kg' ? ' kg' : ''}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {search.length <= 1 && (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-40 select-none">
              <Search className="w-14 h-14 mb-3" />
              <p className="text-base">Ingresa nombre o escanea código</p>
            </div>
          )}
        </div>
      </div>

      {/* RIGHT: Cart */}
      <div className="w-[400px] flex flex-col bg-card shrink-0">
        <div className="h-12 border-b border-border flex items-center px-4 justify-between bg-muted/30 shrink-0">
          <div className="font-bold text-base flex items-center">
            <ShoppingCart className="w-4 h-4 mr-2" /> Carrito
          </div>
          <div className="bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full text-xs font-bold">
            {cart.length} items
          </div>
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-40 select-none">
              <ShoppingCart className="w-12 h-12 mb-3" />
              <p className="text-sm">El carrito está vacío</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {cart.map(item => (
                <div key={item.id} className="px-4 py-3 flex gap-3 hover:bg-muted/30 group">
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm leading-tight truncate">{item.nombre}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{formatMoney(item.precio)} c/u</div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <div className="font-bold text-base">{formatMoney(item.subtotal)}</div>
                    <div className="flex items-center bg-background border border-border rounded overflow-hidden">
                      <button onClick={() => updateQty(item.id, -1)} className="px-1.5 py-1 hover:bg-muted text-muted-foreground">
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <input
                        type="number"
                        value={item.cartQty}
                        onChange={e => setQtyDirect(item.id, e.target.value)}
                        step={item.unidad_tipo === 'kg' ? '0.1' : '1'}
                        className="w-12 text-center font-bold text-sm bg-transparent border-0 focus:outline-none py-1"
                      />
                      <button onClick={() => updateQty(item.id, 1)} className="px-1.5 py-1 hover:bg-muted text-muted-foreground">
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <button onClick={() => removeItem(item.id)} className="text-muted-foreground hover:text-destructive self-start p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="p-4 border-t border-border bg-background shrink-0">
          <div className="flex justify-between items-end mb-3">
            <div className="text-muted-foreground text-sm font-medium uppercase tracking-wide">TOTAL</div>
            <div className="text-4xl font-black text-primary font-mono tracking-tighter">{formatMoney(cartTotal)}</div>
          </div>
          <Button className="w-full h-14 text-xl font-bold uppercase tracking-widest" onClick={() => setShowPayment(true)} disabled={cart.length === 0}>
            Cobrar (F6)
          </Button>
        </div>
      </div>

      {/* PAYMENT MODAL */}
      <Dialog open={showPayment} onOpenChange={setShowPayment}>
        <DialogContent className="sm:max-w-[560px] p-0 overflow-hidden">
          <div className="bg-primary p-5 text-primary-foreground text-center">
            <div className="text-xs font-medium opacity-70 uppercase tracking-widest mb-1">Total a cobrar</div>
            <div className="text-5xl font-black font-mono tracking-tighter">{formatMoney(cartTotal)}</div>
          </div>
          <div className="p-5">
            <h3 className="text-base font-bold mb-3 text-center">Medio de Pago</h3>
            <div className="grid grid-cols-2 gap-3 mb-5">
              {(['efectivo', 'tarjeta', 'transferencia', 'mixto'] as const).map(m => (
                <Button
                  key={m}
                  variant={paymentMethod === m ? 'default' : 'outline'}
                  className="h-16 flex flex-col gap-1.5 capitalize"
                  onClick={() => setPaymentMethod(m)}
                >
                  {m === 'efectivo' && <Banknote className="w-5 h-5" />}
                  {m === 'tarjeta' && <CreditCard className="w-5 h-5" />}
                  {m === 'transferencia' && <Landmark className="w-5 h-5" />}
                  {m === 'mixto' && <Banknote className="w-5 h-5" />}
                  {m === 'efectivo' ? 'Efectivo' : m === 'tarjeta' ? 'Tarjeta' : m === 'transferencia' ? 'Transferencia' : 'Mixto'}
                </Button>
              ))}
            </div>
            {paymentMethod === 'efectivo' && (
              <div className="space-y-3 bg-muted/30 p-4 rounded-lg border border-border">
                <div>
                  <Label>Monto Entregado</Label>
                  <Input type="number" value={cashTendered} onChange={e => setCashTendered(e.target.value)} className="text-2xl h-12 font-mono font-bold mt-1" autoFocus />
                </div>
                {cashTendered && Number(cashTendered) >= cartTotal && (
                  <div className="flex justify-between items-center bg-emerald-500/10 text-emerald-600 p-3 rounded border border-emerald-500/20">
                    <span className="font-bold">Vuelto:</span>
                    <span className="text-xl font-black font-mono">{formatMoney(Number(cashTendered) - cartTotal)}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="px-5 pb-4 border-t border-border bg-muted/20 sm:justify-between pt-3">
            <Button variant="ghost" onClick={() => setShowPayment(false)}>Cancelar (F7)</Button>
            <Button size="lg" onClick={handlePay} disabled={createVentaMutation.isPending || (paymentMethod === 'efectivo' && !!cashTendered && Number(cashTendered) < cartTotal)} className="px-8">
              Confirmar Venta
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}