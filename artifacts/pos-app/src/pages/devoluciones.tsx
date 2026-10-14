import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  useCreateCambio,
  useCreateDevolucion,
  useGetCajaActiva,
  useGetConfig,
  useGetDevoluciones,
  useGetProductos,
  useGetVenta,
  useGetVentas,
  CambioInput,
  DevolucionInput,
  Producto,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCircle2,
  Clock3,
  History,
  Printer,
  RotateCcw,
  Search,
  ShoppingBag,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useCurrency } from '@/hooks/use-currency';
import { calcularRedondeo } from '@/utils/rounding';

type RefundMethod = 'efectivo' | 'tarjeta' | 'transferencia' | '';
type PayMethod = RefundMethod | 'mixto';
type ReturnLine = { producto_id: number; cantidad: number; max: number; reingresa_stock: boolean };

function isUnitProduct(unidadTipo?: string | null) {
  const tipo = (unidadTipo || 'unidad').toLowerCase();
  return tipo === 'unidad' || tipo === 'unidades' || tipo === 'u';
}

function parseQty(raw: string) {
  const normalized = raw.replace(',', '.');
  if (normalized === '') return Number.NaN;
  return parseFloat(normalized);
}

function apiErrorMessage(error: unknown): string {
  const data = (error as { data?: { error?: unknown } } | null)?.data;
  if (typeof data?.error === 'string') return data.error;
  return error instanceof Error ? error.message : 'No se pudo procesar la devolución.';
}

export default function Devoluciones() {
  const queryClient = useQueryClient();
  const { formatMoney } = useCurrency();
  const { data: config } = useGetConfig();
  const { data: cajaActiva, error: cajaError } = useGetCajaActiva({ query: { retry: false } });
  const rounding = config as any;
  const ticketRequired = rounding?.devoluciones_requieren_ticket ?? true;
  const emitsTickets = rounding?.emite_tickets ?? true;
  const createDevolucion = useCreateDevolucion();
  const createCambio = useCreateCambio();
  const submitLock = useRef(false);
  const cambioLock = useRef(false);
  const { data: devoluciones } = useGetDevoluciones(undefined, {
    query: { queryKey: ['/api/devoluciones'] },
  });

  const [ticketSearch, setTicketSearch] = useState('');
  const [searchRequest, setSearchRequest] = useState('');
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [selectedVentaId, setSelectedVentaId] = useState<number | null>(null);
  const [searchError, setSearchError] = useState('');
  const salesParams = searchRequest && emitsTickets ? { numero_ticket: Number(searchRequest) } : undefined;
  const { data: ventas, isError: ventasFailed, error: ventasError } = useGetVentas(salesParams, {
    query: {
      enabled: searchRequest !== '',
      queryKey: ['/api/ventas', salesParams],
    },
  });
  const { data: ventaDetalle } = useGetVenta(selectedVentaId ?? 0, {
    query: {
      enabled: selectedVentaId != null,
      queryKey: ['/api/ventas', selectedVentaId],
    },
  });

  const sale = ventaDetalle as any;
  const saleLines: any[] = sale?.detalle ?? [];
  const availableFor = (line: any) => Math.max(0, Number(line.cantidad_devolvible ?? line.cantidad ?? 0));
  const productIdFor = (line: any) => Number(line.producto_id ?? line.id);
  const saleReturns = useMemo(
    () => (devoluciones ?? []).filter(item => item.venta_id === selectedVentaId),
    [devoluciones, selectedVentaId],
  );

  const [now, setNow] = useState(Date.now());
  const [showForm, setShowForm] = useState(false);
  const [formItems, setFormItems] = useState<ReturnLine[]>([]);
  const [reason, setReason] = useState('');
  const [buyerName, setBuyerName] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('');
  const [serverError, setServerError] = useState('');
  const [completed, setCompleted] = useState<any>(null);
  const [showCambio, setShowCambio] = useState(false);
  const [cambioLine, setCambioLine] = useState<any>(null);
  const [cambioQty, setCambioQty] = useState(1);
  const [cambioMax, setCambioMax] = useState(1);
  const [cambioReason, setCambioReason] = useState('');
  const [cambioBuyer, setCambioBuyer] = useState('');
  const [cambioReingresa, setCambioReingresa] = useState(true);
  const [cambioProductQuery, setCambioProductQuery] = useState('');
  const [selectedNewProduct, setSelectedNewProduct] = useState<Producto | null>(null);
  const [newQty, setNewQty] = useState(1);
  const [cambioPayMethod, setCambioPayMethod] = useState<PayMethod>('');
  const [cambioRefundMethod, setCambioRefundMethod] = useState<RefundMethod>('');
  const [mixtoEfectivo, setMixtoEfectivo] = useState('');
  const [mixtoTarjeta, setMixtoTarjeta] = useState('');
  const [mixtoTransferencia, setMixtoTransferencia] = useState('');
  const [cambioError, setCambioError] = useState('');
  const [completedCambio, setCompletedCambio] = useState<any>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const saleExpiry = sale?.fecha_vencimiento
    ? new Date(sale.fecha_vencimiento).getTime()
    : sale?.fecha
      ? new Date(sale.fecha).getTime() + (rounding?.horas_limite_devolucion ?? 48) * 60 * 60 * 1000
      : 0;
  const expired = Boolean(sale && (sale.esta_vencida || now >= saleExpiry));
  const hoursRemaining = sale ? Math.max(0, Math.ceil((saleExpiry - now) / 3_600_000)) : 0;
  const totalAlreadyRefunded = sale?.total_devuelto ?? saleReturns.reduce((sum, item) => sum + (item.total_reembolso ?? 0), 0);
  const totalRemaining = Math.max(0, (sale?.total ?? 0) - totalAlreadyRefunded);
  const hasReturnableQuantity = saleLines.some(line => availableFor(line) > 0);
  const locked = !sale || sale.anulada || expired || !hasReturnableQuantity;
  const cajaNoAbierta = (cajaError as any)?.status === 404;

  const { data: cambioSearchRaw } = useGetProductos({
    params: { q: cambioProductQuery, activo: 'true' } as any,
    query: {
      enabled: showCambio && cambioProductQuery.trim().length > 1,
      queryKey: ['/api/productos', { q: cambioProductQuery, activo: true, cambio: true }],
    },
  } as any);
  const cambioSearchResults: Producto[] = useMemo(() => {
    return Array.isArray(cambioSearchRaw)
      ? cambioSearchRaw
      : (cambioSearchRaw as any)?.data ?? (cambioSearchRaw as any)?.productos ?? [];
  }, [cambioSearchRaw]);

  const findSale = () => {
    const value = ticketSearch.trim();
    if (!value) return;
    if (!emitsTickets && ticketRequired) {
      setSearchError('El negocio no emite tickets y la configuración requiere ticket para devolver.');
      return;
    }
    setSearchError('');
    setSearchRequest(value);
    setSearchAttempt(previous => previous + 1);
    queryClient.invalidateQueries({ queryKey: ['/api/ventas'] });
  };

  useEffect(() => {
    if (!searchRequest) return;
    if (ventasFailed) {
      setSearchError(apiErrorMessage(ventasError));
      return;
    }
    if (!ventas) return;
    const found = ventas.find(item =>
      String(item.numero_ticket ?? '') === searchRequest || (!emitsTickets && String(item.id) === searchRequest),
    );
    if (!found) {
      setSelectedVentaId(null);
      setSearchError(emitsTickets ? 'No se encontró ese número de ticket.' : 'No se encontró esa venta.');
      return;
    }
    setSelectedVentaId(found.id);
    setSearchError('');
    setFormItems([]);
  }, [searchRequest, searchAttempt, ventas, ventasFailed, ventasError, emitsTickets]);

  const openForm = (lines: any[]) => {
    const pending = lines
      .map(line => ({
        producto_id: productIdFor(line),
        cantidad: availableFor(line),
        max: availableFor(line),
        reingresa_stock: true,
      }))
      .filter(item => item.max > 0);
    if (!pending.length) return;
    setFormItems(pending);
    setReason('');
    setBuyerName(sale?.nombre_comprador ?? '');
    setRefundMethod(sale?.metodo_pago === 'mixto' ? '' : (sale?.metodo_pago ?? 'efectivo'));
    setServerError('');
    setShowForm(true);
  };

  const exactRefund = formItems.reduce((sum, item) => {
    const line = saleLines.find(row => productIdFor(row) === item.producto_id);
    return sum + Math.round(Number(line?.precio_unitario ?? 0) * item.cantidad);
  }, 0);
  const refund = calcularRedondeo(
    exactRefund,
    rounding?.redondeo_activo ?? true,
    rounding?.redondeo_multiplo ?? 50,
  );

  const legacyPaymentBreakdown = () => {
    const total = Number(sale?.total ?? 0);
    let amounts = {
      efectivo: Number(sale?.monto_efectivo ?? 0),
      tarjeta: Number(sale?.monto_tarjeta ?? 0),
      transferencia: Number(sale?.monto_transferencia ?? 0),
    };
    if (amounts.efectivo + amounts.tarjeta + amounts.transferencia === 0 && total > 0) {
      amounts = { efectivo: total, tarjeta: 0, transferencia: 0 };
    }
    return amounts;
  };
  const paymentAmounts = legacyPaymentBreakdown();
  const refundedByMethod = (method: Exclude<RefundMethod, ''>) => saleReturns
    .filter(item => item.metodo_reembolso === method)
    .reduce((sum, item) => sum + (item.total_reembolso ?? 0), 0);
  const returnedMethodTotals = {
    efectivo: sale?.total_reembolsado_efectivo ?? refundedByMethod('efectivo'),
    tarjeta: sale?.total_reembolsado_tarjeta ?? refundedByMethod('tarjeta'),
    transferencia: sale?.total_reembolsado_transferencia ?? refundedByMethod('transferencia'),
  };
  const refundExceedsSale = refund.total > totalRemaining;
  const invalidQuantities = formItems.some(item => {
    const line = saleLines.find(row => productIdFor(row) === item.producto_id);
    return !Number.isFinite(item.cantidad) || item.cantidad <= 0 || item.cantidad > item.max;
  });
  const canSubmit = Boolean(
    sale && !locked && formItems.length && reason.trim().length >= 3 && buyerName.trim().length >= 2 &&
    refundMethod && !invalidQuantities && !refundExceedsSale &&
    (refundMethod !== 'efectivo' || cajaActiva) && !createDevolucion.isPending,
  );

  const openCambio = (line: any) => {
    const available = availableFor(line);
    if (!available) return;
    setCambioLine(line);
    setCambioQty(available);
    setCambioMax(available);
    setCambioReason('');
    setCambioBuyer(sale?.nombre_comprador ?? '');
    setCambioReingresa(true);
    setCambioProductQuery('');
    setSelectedNewProduct(null);
    setNewQty(1);
    setCambioPayMethod('');
    setCambioRefundMethod('');
    setMixtoEfectivo('');
    setMixtoTarjeta('');
    setMixtoTransferencia('');
    setCambioError('');
    setShowCambio(true);
  };

  const originalUnitPrice = Number(cambioLine?.precio_unitario ?? 0);
  const returnedExact = Number.isFinite(cambioQty) ? Math.round(originalUnitPrice * cambioQty) : 0;
  const returnedRounded = calcularRedondeo(
    returnedExact,
    rounding?.redondeo_activo ?? true,
    rounding?.redondeo_multiplo ?? 50,
  );
  const newUnitPrice = Number(selectedNewProduct?.precio ?? 0);
  const newExact = selectedNewProduct && Number.isFinite(newQty) ? Math.round(newUnitPrice * newQty) : 0;
  const newRounded = calcularRedondeo(
    newExact,
    rounding?.redondeo_activo ?? true,
    rounding?.redondeo_multiplo ?? 50,
  );
  const diferencia = selectedNewProduct ? newRounded.total - returnedRounded.total : 0;
  const mixtoSum = (Number(mixtoEfectivo) || 0) + (Number(mixtoTarjeta) || 0) + (Number(mixtoTransferencia) || 0);
  const newStock = Number(selectedNewProduct?.stock ?? 0);
  const newIsUnit = isUnitProduct((selectedNewProduct as any)?.unidad_tipo);
  const originalIsUnit = isUnitProduct(cambioLine?.unidad_tipo);
  const invalidCambioQty = !Number.isFinite(cambioQty) || cambioQty <= 0 || cambioQty > cambioMax || (originalIsUnit && !Number.isInteger(cambioQty));
  const invalidNewQty = !selectedNewProduct
    || !Number.isFinite(newQty)
    || newQty <= 0
    || (newIsUnit && !Number.isInteger(newQty))
    || newQty > newStock + (cambioReingresa && selectedNewProduct?.id === productIdFor(cambioLine) ? cambioQty : 0);
  const needsCashIn = diferencia > 0 && (cambioPayMethod === 'efectivo' || (cambioPayMethod === 'mixto' && (Number(mixtoEfectivo) || 0) > 0));
  const needsCashOut = diferencia < 0 && cambioRefundMethod === 'efectivo';
  const mixtoOk = diferencia <= 0 || cambioPayMethod !== 'mixto' || mixtoSum === diferencia;
  const canSubmitCambio = Boolean(
    sale && !locked && cambioLine && selectedNewProduct && !invalidCambioQty && !invalidNewQty &&
    cambioReason.trim().length >= 3 && cambioBuyer.trim().length >= 2 &&
    (diferencia === 0 || (diferencia > 0 && cambioPayMethod && mixtoOk) || (diferencia < 0 && cambioRefundMethod)) &&
    (!needsCashIn || cajaActiva) && (!needsCashOut || cajaActiva) && !createCambio.isPending,
  );

  const submitCambio = () => {
    if (!selectedVentaId || !canSubmitCambio || cambioLock.current || !selectedNewProduct) return;
    cambioLock.current = true;
    setCambioError('');
    const data: CambioInput = {
      venta_id: selectedVentaId,
      producto_devuelto_id: productIdFor(cambioLine),
      cantidad_devuelta: cambioQty,
      reingresa_stock: cambioReingresa,
      producto_nuevo_id: selectedNewProduct.id,
      cantidad_nueva: newQty,
      motivo: cambioReason.trim(),
      nombre_comprador: cambioBuyer.trim(),
    };
    if (diferencia > 0) {
      data.metodo_pago_diferencia = cambioPayMethod as Exclude<PayMethod, ''>;
      if (cambioPayMethod === 'mixto') {
        data.detalle_pago_mixto = JSON.stringify({
          efectivo: Number(mixtoEfectivo) || 0,
          tarjeta: Number(mixtoTarjeta) || 0,
          transferencia: Number(mixtoTransferencia) || 0,
        });
      }
    }
    if (diferencia < 0) {
      data.metodo_reembolso_diferencia = cambioRefundMethod as Exclude<RefundMethod, ''>;
    }
    createCambio.mutate({ data }, {
      onSuccess: result => {
        cambioLock.current = false;
        setShowCambio(false);
        setCompletedCambio(result);
        queryClient.invalidateQueries({ queryKey: ['/api/ventas'] });
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        queryClient.invalidateQueries({ queryKey: ['/api/devoluciones'] });
        queryClient.invalidateQueries({ queryKey: ['/api/caja/activa'] });
      },
      onError: error => {
        cambioLock.current = false;
        setCambioError(apiErrorMessage(error));
      },
    });
  };

  const submitReturn = () => {
    if (!selectedVentaId || !canSubmit || submitLock.current) return;
    submitLock.current = true;
    setServerError('');
    const data: DevolucionInput = {
      venta_id: selectedVentaId,
      motivo: reason.trim(),
      nombre_comprador: buyerName.trim(),
      metodo_reembolso: refundMethod as Exclude<RefundMethod, ''>,
      detalle: formItems.map(item => ({
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        reingresa_stock: item.reingresa_stock,
      })),
    };
    createDevolucion.mutate({ data }, {
      onSuccess: result => {
        submitLock.current = false;
        setShowForm(false);
        setCompleted(result);
        queryClient.invalidateQueries({ queryKey: ['/api/ventas'] });
        queryClient.invalidateQueries({ queryKey: ['/api/productos'] });
        queryClient.invalidateQueries({ queryKey: ['/api/devoluciones'] });
        queryClient.invalidateQueries({ queryKey: ['/api/caja/activa'] });
      },
      onError: error => {
        submitLock.current = false;
        setServerError(apiErrorMessage(error));
      },
    });
  };

  const statusText: Record<string, string> = {
    sin_devoluciones: 'Sin devoluciones',
    devuelta_parcialmente: 'Devuelta parcialmente',
    devuelta_totalmente: 'Devuelta totalmente',
    anulada: 'Anulada',
  };

  return (
    <div className="flex h-full flex-col gap-5 overflow-y-auto bg-background p-5">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .return-print, .return-print *, .cambio-print, .cambio-print * { visibility: visible !important; }
          .return-print, .cambio-print { display: block !important; position: fixed; inset: 0; width: 100%; background: white; color: black; }
        }
      `}</style>

      <header>
        <h1 className="text-2xl font-bold">Devoluciones</h1>
        <p className="text-sm text-muted-foreground">Notas de crédito asociadas al ticket original</p>
      </header>

      {completed && emitsTickets && (
        <div className="return-print hidden p-6 text-sm">
          <h1 className="text-xl font-bold">Comprobante de devolución</h1>
          <p>Ticket original: #{completed.numero_ticket ?? sale?.numero_ticket ?? selectedVentaId}</p>
          <p>Fecha: {completed.fecha ? new Date(completed.fecha).toLocaleString('es-PY') : new Date().toLocaleString('es-PY')}</p>
          <p>Comprador: {completed.nombre_comprador}</p>
          <p>Motivo: {completed.motivo}</p>
          <hr className="my-3" />
          {(completed.detalle ?? []).map((line: any) => (
            <p key={line.id}>{line.producto_nombre ?? `Producto #${line.producto_id}`} · {line.cantidad} × {formatMoney(line.precio_unitario)}</p>
          ))}
          <hr className="my-3" />
          <p>Total devuelto: {formatMoney(completed.total_reembolso)}</p>
          <p>Método: {completed.metodo_reembolso}</p>
        </div>
      )}

      {completedCambio && emitsTickets && (
        <div className="cambio-print hidden p-6 text-sm">
          <h1 className="text-xl font-bold">CAMBIO DE PRODUCTO</h1>
          <p>Fecha: {completedCambio.fecha ? new Date(completedCambio.fecha).toLocaleString('es-PY') : new Date().toLocaleString('es-PY')}</p>
          <p>Comprador: {completedCambio.nombre_comprador}</p>
          <p>Motivo: {completedCambio.motivo}</p>
          <hr className="my-3" />
          <h2 className="font-bold">Producto devuelto</h2>
          <p>Ticket original: #{completedCambio.numero_ticket_origen ?? sale?.numero_ticket ?? selectedVentaId}</p>
          <p>{completedCambio.producto_devuelto?.nombre ?? `Producto #${completedCambio.producto_devuelto?.id}`} · {completedCambio.producto_devuelto?.cantidad} × {formatMoney(Number(completedCambio.producto_devuelto?.precio_unitario ?? 0))}</p>
          <p>Subtotal: {formatMoney(Number(completedCambio.producto_devuelto?.subtotal ?? 0))}</p>
          <hr className="my-3" />
          <h2 className="font-bold">Producto nuevo</h2>
          <p>Nuevo ticket: #{completedCambio.numero_ticket_nuevo}</p>
          <p>{completedCambio.producto_nuevo?.nombre ?? `Producto #${completedCambio.producto_nuevo?.id}`} · {completedCambio.producto_nuevo?.cantidad} × {formatMoney(Number(completedCambio.producto_nuevo?.precio_unitario ?? 0))}</p>
          <p>Subtotal: {formatMoney(Number(completedCambio.producto_nuevo?.subtotal ?? 0))}</p>
          <hr className="my-3" />
          <p className="font-bold">
            {completedCambio.tipo_diferencia === 'cliente_paga' && `Diferencia a pagar: ${formatMoney(completedCambio.diferencia)}`}
            {completedCambio.tipo_diferencia === 'negocio_devuelve' && `Diferencia devuelta: ${formatMoney(Math.abs(completedCambio.diferencia))}`}
            {completedCambio.tipo_diferencia === 'equilibrado' && 'Sin diferencia'}
          </p>
        </div>
      )}

      <Tabs defaultValue="devolucion" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="devolucion" className="gap-2"><Search className="h-4 w-4" /> Buscar ticket</TabsTrigger>
          <TabsTrigger value="historial" className="gap-2"><History className="h-4 w-4" /> Historial</TabsTrigger>
        </TabsList>

        <TabsContent value="devolucion" className="mt-4 space-y-4">
          {!(ticketRequired && !emitsTickets) ? (
            <Card>
              <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="ticket-search">{emitsTickets ? 'Número de ticket' : 'Número de venta'}</Label>
                  <Input
                    id="ticket-search"
                    inputMode="numeric"
                    placeholder={emitsTickets ? 'Ej. 1045' : 'Número de venta'}
                    value={ticketSearch}
                    onChange={event => setTicketSearch(event.target.value.replace(/[^0-9]/g, ''))}
                    onKeyDown={event => event.key === 'Enter' && findSale()}
                  />
                </div>
                <Button onClick={findSale} disabled={!ticketSearch.trim()}><Search className="mr-2 h-4 w-4" />Buscar</Button>
                {sale && <Button variant="outline" onClick={() => openForm(saleLines)} disabled={locked || !saleLines.some(line => availableFor(line) > 0)}><RotateCcw className="mr-2 h-4 w-4" />Devolver todo</Button>}
              </CardContent>
            </Card>
          ) : (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-4 text-sm" role="status">
              El negocio no emite tickets y la configuración exige un ticket para procesar devoluciones.
            </div>
          )}

          {searchError && <p className="text-sm text-destructive" role="alert">{searchError}</p>}

          {sale && (
            <>
              <Card>
                <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Ticket #{sale.numero_ticket ?? sale.id}</CardTitle>
                    <CardDescription className="mt-1">
                      {new Date(sale.fecha).toLocaleString('es-PY')} · {sale.usuario_nombre ?? 'Vendedor sin nombre'}
                    </CardDescription>
                    <p className="mt-2 text-sm">Comprador: <strong>{sale.nombre_comprador || 'Sin nombre registrado'}</strong></p>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-xl font-bold">{formatMoney(sale.total)}</div>
                    <Badge variant={sale.estado === 'anulada' ? 'destructive' : 'outline'} className="mt-1">
                      {statusText[sale.estado] ?? 'Sin devoluciones'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className={`flex items-start gap-2 rounded-md border p-3 text-sm ${expired || sale.anulada ? 'border-destructive/30 bg-destructive/5 text-destructive' : 'border-amber-500/30 bg-amber-500/5'}`}>
                    {expired || sale.anulada ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <Clock3 className="mt-0.5 h-4 w-4 shrink-0" />}
                    <div>
                      {sale.anulada
                        ? 'Venta anulada: no se puede devolver.'
                        : expired
                          ? `Plazo vencido el ${new Date(saleExpiry).toLocaleString('es-PY')}.`
                          : `Quedan ${hoursRemaining} h para devolver. Vence el ${new Date(saleExpiry).toLocaleString('es-PY')}.`}
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Método de pago: <strong className="capitalize text-foreground">{sale.metodo_pago}</strong>
                    {' · '}Vendedor: <strong className="text-foreground">{sale.usuario_nombre ?? '—'}</strong>
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">Productos del ticket</CardTitle>
                    <CardDescription>Cantidades y precios originales de la venta</CardDescription>
                  </div>
                  <div className="hidden sm:block font-mono text-sm text-muted-foreground">Pendiente: {formatMoney(totalRemaining)}</div>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[940px] text-sm">
                      <thead className="border-y bg-muted/30 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Producto</th>
                          <th className="px-3 py-3 text-right">Vendida</th>
                          <th className="px-3 py-3 text-right">Ya devuelta</th>
                          <th className="px-3 py-3 text-right">Disponible</th>
                          <th className="px-3 py-3 text-right">Precio pagado</th>
                          <th className="px-3 py-3 text-right">Subtotal</th>
                          <th className="px-4 py-3 text-right">Acciones</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {saleLines.map(line => {
                          const available = availableFor(line);
                          const lineId = productIdFor(line);
                          return (
                            <tr key={line.id}>
                              <td className="px-4 py-3 font-medium">{line.producto_nombre ?? `Producto #${lineId}`}</td>
                              <td className="px-3 py-3 text-right">{line.cantidad}</td>
                              <td className="px-3 py-3 text-right">{line.cantidad_devuelta ?? 0}</td>
                              <td className="px-3 py-3 text-right font-semibold">{available}</td>
                              <td className="px-3 py-3 text-right font-mono">{formatMoney(line.precio_unitario)}</td>
                              <td className="px-3 py-3 text-right font-mono">{formatMoney(line.subtotal)}</td>
                              <td className="px-4 py-3">
                                <div className="flex justify-end gap-2">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    title="Devolución del producto"
                                    aria-label={`Devolución del producto ${line.producto_nombre ?? lineId}`}
                                    disabled={locked || available <= 0}
                                    onClick={() => openForm([line])}
                                  >
                                    <span className="relative mr-2 inline-flex h-5 w-5 items-center justify-center">
                                      <ShoppingBag className="h-5 w-5 text-amber-500" />
                                      <RotateCcw className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-background text-red-600" />
                                    </span>
                                    Devolución del producto
                                  </Button>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    title="Cambio del producto"
                                    aria-label={`Cambio del producto ${line.producto_nombre ?? lineId}`}
                                    disabled={locked || available <= 0}
                                    onClick={() => openCambio(line)}
                                  >
                                    <span className="relative mr-2 inline-flex h-5 w-5 items-center justify-center">
                                      <ShoppingBag className="h-5 w-5 text-amber-500" />
                                      <ArrowLeftRight className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-background text-emerald-600" />
                                    </span>
                                    Cambio del producto
                                  </Button>
                                  {available <= 0 && <span className="self-center text-xs text-muted-foreground">Ya devuelto</span>}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="historial" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Devoluciones y cambios</CardTitle>
              <CardDescription>Registro visible según los permisos de tu usuario</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {!devoluciones?.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No hay devoluciones registradas.</p>
              ) : (
                <div className="divide-y">
                  {devoluciones.map(item => {
                    const isCambio = item.tipo === 'cambio';
                    const newLines = (item as any).detalle_nueva_venta ?? [];
                    const valorDevuelto = calcularRedondeo(
                      (item.detalle ?? []).reduce((sum, line) => sum + Math.round(Number(line.precio_unitario ?? 0) * Number(line.cantidad ?? 0)), 0),
                      rounding?.redondeo_activo ?? true,
                      rounding?.redondeo_multiplo ?? 50,
                    ).total;
                    const valorNuevo = calcularRedondeo(
                      newLines.reduce((sum: number, line: any) => sum + Math.round(Number(line.precio_unitario ?? 0) * Number(line.cantidad ?? 0)), 0),
                      rounding?.redondeo_activo ?? true,
                      rounding?.redondeo_multiplo ?? 50,
                    ).total;
                    const diff = isCambio ? valorNuevo - valorDevuelto : 0;
                    return (
                    <div key={item.id} className="grid gap-2 p-4 text-sm md:grid-cols-[1.2fr_1fr_1fr_1.4fr_auto] md:items-center">
                      <div>
                        <p className="font-medium">{new Date(item.fecha).toLocaleString('es-PY')}</p>
                        <p className="text-xs text-muted-foreground">Ticket #{item.numero_ticket ?? item.venta_id}{isCambio && (item as any).numero_ticket_nuevo ? ` → #${(item as any).numero_ticket_nuevo}` : ''}</p>
                      </div>
                      <Badge variant="outline" className="w-fit capitalize">{isCambio ? 'Cambio' : (item.tipo ?? 'devolución')}</Badge>
                      <div className="font-mono font-semibold">
                        {isCambio
                          ? (diff === 0 ? 'Sin diferencia' : diff > 0 ? `Paga ${formatMoney(diff)}` : `Devuelve ${formatMoney(Math.abs(diff))}`)
                          : formatMoney(item.total_reembolso)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate">
                          {(item.detalle ?? []).map(line => `${line.producto_nombre ?? `#${line.producto_id}`} × ${line.cantidad}`).join(', ')}
                          {isCambio && newLines.length ? ` → ${newLines.map((line: any) => `${line.producto_nombre ?? `#${line.producto_id}`} × ${line.cantidad}`).join(', ')}` : ''}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{item.motivo} · {item.nombre_comprador}</p>
                      </div>
                      <div className="text-xs text-muted-foreground">{item.usuario_nombre ?? '—'} · {isCambio ? ((item as any).metodo_pago_diferencia || item.metodo_reembolso) : item.metodo_reembolso}</div>
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={showForm} onOpenChange={open => { if (!open && !createDevolucion.isPending) setShowForm(false); }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Confirmar devolución · Ticket #{sale?.numero_ticket ?? sale?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label>Productos y cantidades</Label>
              <div className="divide-y rounded-md border">
                {formItems.map(item => {
                  const line = saleLines.find(row => productIdFor(row) === item.producto_id);
                  return (
                    <div key={item.producto_id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_120px_auto] sm:items-center">
                      <div>
                        <p className="font-medium">{line?.producto_nombre ?? `Producto #${item.producto_id}`}</p>
                        <p className="text-xs text-muted-foreground">Máximo {item.max} · {formatMoney(line?.precio_unitario)} por unidad</p>
                      </div>
                      <Input
                        aria-label={`Cantidad de ${line?.producto_nombre ?? item.producto_id}`}
                        type="text"
                        inputMode="decimal"
                        min="0.001"
                        max={item.max}
                        step="any"
                        value={Number.isFinite(item.cantidad) ? item.cantidad : ''}
                        onChange={event => {
                          const raw = event.target.value;
                          // Allow partial input like "1," while typing — commit on blur
                          const normalized = raw.replace(',', '.');
                          const value = normalized === '' ? Number.NaN : parseFloat(normalized);
                          setFormItems(previous => previous.map(current => current.producto_id === item.producto_id ? { ...current, cantidad: value } : current));
                        }}
                      />
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={item.reingresa_stock}
                            onCheckedChange={checked => setFormItems(previous => previous.map(current => current.producto_id === item.producto_id ? { ...current, reingresa_stock: checked } : current))}
                            aria-label="Vuelve al stock"
                          />
                          <span className="text-sm">Vuelve al stock</span>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground sm:col-span-3">Desactivar si el producto está fallado, vencido o no se puede revender.</p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="return-reason">Motivo</Label>
                <Textarea id="return-reason" value={reason} maxLength={500} onChange={event => setReason(event.target.value)} placeholder="Describe el motivo de la devolución" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="return-buyer">Nombre del comprador</Label>
                <Input id="return-buyer" value={buyerName} maxLength={200} onChange={event => setBuyerName(event.target.value)} />
                <p className="text-xs text-muted-foreground">Obligatorio para registrar la nota de crédito.</p>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="refund-method">Método de reembolso</Label>
              <Select value={refundMethod} onValueChange={value => setRefundMethod(value as RefundMethod)}>
                <SelectTrigger id="refund-method"><SelectValue placeholder="Seleccionar método" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="efectivo">Efectivo</SelectItem>
                  <SelectItem value="tarjeta">Tarjeta</SelectItem>
                  <SelectItem value="transferencia">Transferencia</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-md border-2 border-primary/30 bg-primary/5 p-4 text-center">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Total a devolver al comprador</p>
              <p className="mt-1 text-3xl font-black font-mono">{formatMoney(refund.total)}</p>
              {refund.ajusteRedondeo !== 0 && (
                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                  <p>Subtotal exacto: {formatMoney(refund.subtotal)}</p>
                  <p>Redondeo: {formatMoney(refund.ajusteRedondeo)}</p>
                </div>
              )}
              {refundMethod === 'efectivo' && <p className="mt-2 text-sm">Este monto se descontará del efectivo de la caja actual.</p>}
            </div>

            {refundMethod === 'efectivo' && !cajaActiva && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {cajaNoAbierta
                  ? <>No hay una caja abierta. Para reembolsar en efectivo, <Link href="/caja/apertura" className="font-semibold underline">abrir caja</Link> primero.</>
                  : 'No se pudo verificar el estado de la caja. Revisa la conexión e inténtalo nuevamente.'}
              </div>
            )}
            {refundExceedsSale && <p className="text-sm text-destructive" role="alert">El reembolso supera el saldo cobrado disponible ({formatMoney(totalRemaining)}).</p>}
            {serverError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{serverError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setShowForm(false)} disabled={createDevolucion.isPending}>Cancelar</Button>
            <Button onClick={submitReturn} disabled={!canSubmit}>
              {createDevolucion.isPending ? 'Procesando…' : <><RotateCcw className="mr-2 h-4 w-4" />Confirmar devolución</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completed} onOpenChange={open => { if (!open) setCompleted(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Devolución procesada</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-center">
            <p className="text-sm text-muted-foreground">Nota de crédito registrada para el ticket #{completed?.numero_ticket ?? sale?.numero_ticket ?? selectedVentaId}.</p>
            <p className="text-3xl font-black font-mono">{formatMoney(completed?.total_reembolso)}</p>
          </div>
          <DialogFooter>
            {emitsTickets && <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Imprimir comprobante</Button>}
            <Button onClick={() => setCompleted(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showCambio} onOpenChange={open => { if (!open && !createCambio.isPending) setShowCambio(false); }}>
        <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cambio del producto · Ticket #{sale?.numero_ticket ?? sale?.id}</DialogTitle>
          </DialogHeader>
          <div className="space-y-5">
            <div className="rounded-md border p-3">
              <p className="text-xs uppercase text-muted-foreground">Producto original</p>
              <p className="font-medium">{cambioLine?.producto_nombre ?? `Producto #${productIdFor(cambioLine ?? {})}`}</p>
              <p className="text-xs text-muted-foreground">Precio pagado: {formatMoney(originalUnitPrice)} · Disponible: {cambioMax}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[140px_auto] sm:items-center">
                <div className="space-y-1.5">
                  <Label htmlFor="cambio-qty">Cantidad a cambiar</Label>
                  <Input
                    id="cambio-qty"
                    inputMode="decimal"
                    value={Number.isFinite(cambioQty) ? cambioQty : ''}
                    onChange={event => setCambioQty(parseQty(event.target.value))}
                  />
                </div>
                <div className="flex items-center gap-2 pt-5">
                  <Switch checked={cambioReingresa} onCheckedChange={setCambioReingresa} aria-label="Vuelve al stock" />
                  <span className="text-sm">El producto original vuelve al stock</span>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="cambio-reason">Motivo</Label>
                <Textarea id="cambio-reason" value={cambioReason} maxLength={500} onChange={event => setCambioReason(event.target.value)} placeholder="Describe el motivo del cambio" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cambio-buyer">Nombre del comprador</Label>
                <Input id="cambio-buyer" value={cambioBuyer} maxLength={200} onChange={event => setCambioBuyer(event.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cambio-product-search">Producto nuevo</Label>
              <Input
                id="cambio-product-search"
                value={cambioProductQuery}
                onChange={event => setCambioProductQuery(event.target.value)}
                placeholder="Buscar por nombre o código"
              />
              {cambioProductQuery.trim().length > 1 && (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {cambioSearchResults.length === 0 ? (
                    <p className="p-3 text-sm text-muted-foreground">Sin resultados</p>
                  ) : cambioSearchResults.map(product => (
                    <button
                      type="button"
                      key={product.id}
                      className="flex w-full items-center justify-between gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-muted/40"
                      onClick={() => {
                        setSelectedNewProduct(product);
                        setCambioProductQuery('');
                        setNewQty(isUnitProduct((product as any).unidad_tipo) ? 1 : 1);
                      }}
                    >
                      <span>
                        <span className="font-medium">{product.nombre}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{product.codigo || 'Sin código'}</span>
                      </span>
                      <span className="font-mono text-xs">{formatMoney(product.precio)} · Stock {product.stock}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedNewProduct && (
                <div className="rounded-md border bg-muted/20 p-3 text-sm">
                  <p className="font-medium">{selectedNewProduct.nombre}</p>
                  <p className="text-xs text-muted-foreground">Código: {selectedNewProduct.codigo || '—' } · Stock: {selectedNewProduct.stock} · Precio vigente: {formatMoney(selectedNewProduct.precio)}</p>
                  <div className="mt-2 max-w-[140px] space-y-1.5">
                    <Label htmlFor="cambio-new-qty">Cantidad nueva</Label>
                    <Input
                      id="cambio-new-qty"
                      inputMode="decimal"
                      value={Number.isFinite(newQty) ? newQty : ''}
                      onChange={event => setNewQty(parseQty(event.target.value))}
                    />
                  </div>
                  {selectedNewProduct.stock < newQty && <p className="mt-2 text-sm text-destructive">Stock insuficiente para el producto nuevo.</p>}
                </div>
              )}
            </div>

            {selectedNewProduct && (
              <div className="space-y-3 rounded-md border-2 border-primary/30 bg-primary/5 p-4">
                <div className="grid gap-1 text-sm">
                  <div className="flex justify-between"><span>Valor devuelto</span><span className="font-mono">{formatMoney(returnedRounded.total)}</span></div>
                  <div className="flex justify-between"><span>Valor nuevo</span><span className="font-mono">{formatMoney(newRounded.total)}</span></div>
                  {(returnedRounded.ajusteRedondeo !== 0 || newRounded.ajusteRedondeo !== 0) && (
                    <div className="text-xs text-muted-foreground">
                      <p>Devuelto exacto {formatMoney(returnedRounded.subtotal)} · Redondeo {formatMoney(returnedRounded.ajusteRedondeo)}</p>
                      <p>Nuevo exacto {formatMoney(newRounded.subtotal)} · Redondeo {formatMoney(newRounded.ajusteRedondeo)}</p>
                    </div>
                  )}
                </div>
                <div className="text-center">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">
                    {diferencia === 0 ? 'Sin diferencia' : diferencia > 0 ? 'Diferencia a pagar' : 'Diferencia a devolver'}
                  </p>
                  <p className="mt-1 text-3xl font-black font-mono">{formatMoney(Math.abs(diferencia))}</p>
                </div>

                {diferencia > 0 && (
                  <div className="space-y-2">
                    <Label>Método de pago de la diferencia</Label>
                    <Select value={cambioPayMethod} onValueChange={value => setCambioPayMethod(value as PayMethod)}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar método" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="efectivo">Efectivo</SelectItem>
                        <SelectItem value="tarjeta">Tarjeta</SelectItem>
                        <SelectItem value="transferencia">Transferencia</SelectItem>
                        <SelectItem value="mixto">Mixto</SelectItem>
                      </SelectContent>
                    </Select>
                    {cambioPayMethod === 'mixto' && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input inputMode="numeric" placeholder="Efectivo" value={mixtoEfectivo} onChange={event => setMixtoEfectivo(event.target.value.replace(/[^0-9]/g, ''))} />
                        <Input inputMode="numeric" placeholder="Tarjeta" value={mixtoTarjeta} onChange={event => setMixtoTarjeta(event.target.value.replace(/[^0-9]/g, ''))} />
                        <Input inputMode="numeric" placeholder="Transferencia" value={mixtoTransferencia} onChange={event => setMixtoTransferencia(event.target.value.replace(/[^0-9]/g, ''))} />
                        <p className="text-xs text-muted-foreground sm:col-span-3">Debe sumar {formatMoney(diferencia)}. Actual: {formatMoney(mixtoSum)}</p>
                      </div>
                    )}
                  </div>
                )}

                {diferencia < 0 && (
                  <div className="space-y-2">
                    <Label>Método de reembolso de la diferencia</Label>
                    <Select value={cambioRefundMethod} onValueChange={value => setCambioRefundMethod(value as RefundMethod)}>
                      <SelectTrigger><SelectValue placeholder="Seleccionar método" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="efectivo">Efectivo</SelectItem>
                        <SelectItem value="tarjeta">Tarjeta</SelectItem>
                        <SelectItem value="transferencia">Transferencia</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
            )}

            {(needsCashIn || needsCashOut) && !cajaActiva && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                {cajaNoAbierta
                  ? <>No hay una caja abierta. Para mover efectivo, <Link href="/caja/apertura" className="font-semibold underline">abrir caja</Link> primero.</>
                  : 'No se pudo verificar el estado de la caja. Revisa la conexión e inténtalo nuevamente.'}
              </div>
            )}
            {cambioError && <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">{cambioError}</p>}
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setShowCambio(false)} disabled={createCambio.isPending}>Cancelar</Button>
            <Button onClick={submitCambio} disabled={!canSubmitCambio}>
              {createCambio.isPending ? 'Procesando…' : <><ArrowLeftRight className="mr-2 h-4 w-4" />Confirmar cambio</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!completedCambio} onOpenChange={open => { if (!open) setCompletedCambio(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-600" />Cambio de producto</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-center text-sm">
            <p>Ticket original #{completedCambio?.numero_ticket_origen} → nuevo ticket #{completedCambio?.numero_ticket_nuevo}</p>
            <p className="text-3xl font-black font-mono">
              {completedCambio?.tipo_diferencia === 'equilibrado' && 'Sin diferencia'}
              {completedCambio?.tipo_diferencia === 'cliente_paga' && formatMoney(completedCambio?.diferencia)}
              {completedCambio?.tipo_diferencia === 'negocio_devuelve' && formatMoney(Math.abs(completedCambio?.diferencia ?? 0))}
            </p>
            <p className="text-muted-foreground">
              {completedCambio?.tipo_diferencia === 'cliente_paga' && 'Diferencia a pagar'}
              {completedCambio?.tipo_diferencia === 'negocio_devuelve' && 'Diferencia devuelta'}
            </p>
          </div>
          <DialogFooter>
            {emitsTickets && <Button variant="outline" onClick={() => window.print()}><Printer className="mr-2 h-4 w-4" />Imprimir comprobante</Button>}
            <Button onClick={() => setCompletedCambio(null)}>Listo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
