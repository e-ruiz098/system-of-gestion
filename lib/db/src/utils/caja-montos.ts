/**
 * Desglose de cobros de una venta para caja.
 * Respeta montos explícitos. El fallback (ventas viejas sin desglose)
 * no aplica a metodo_pago "cambio": el total de esa venta es el producto
 * nuevo, pero el efectivo físico solo se mueve por la diferencia cobrada.
 */
export function montosVenta(v: {
  metodo_pago: string | null;
  total: number;
  monto_efectivo: number | null;
  monto_tarjeta: number | null;
  monto_transferencia: number | null;
}): { efectivo: number; tarjeta: number; transferencia: number } {
  let efectivo = v.monto_efectivo ?? 0;
  let tarjeta = v.monto_tarjeta ?? 0;
  let transferencia = v.monto_transferencia ?? 0;
  if (v.metodo_pago === "cambio") {
    return { efectivo, tarjeta, transferencia };
  }
  if (efectivo + tarjeta + transferencia === 0 && v.total !== 0) {
    if (v.metodo_pago === "tarjeta") tarjeta = v.total;
    else if (v.metodo_pago === "transferencia") transferencia = v.total;
    else efectivo = v.total;
  }
  return { efectivo, tarjeta, transferencia };
}
