import { Router, type IRouter } from "express";
import { eq, and, sql, isNull } from "drizzle-orm";
import {
  db, devolucionesTable, detalleDevolucionTable,
  productosTable, ventasTable, detalleVentaTable,
  configuracionTable, aperturasCajaTable, calcularRedondeo, auditoriaTable,
  montosVenta,
} from "@workspace/db";

const router: IRouter = Router();

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return false;
  }
  return true;
}

function normalizeCantidad(raw: unknown, etiqueta: string): number {
  const cant = Number(raw);
  if (!Number.isFinite(cant) || cant <= 0) {
    throw Object.assign(new Error(`${etiqueta} debe ser un número positivo`), { status: 400 });
  }
  return Math.round(cant * 1000) / 1000;
}

function assertCantidadSegunUnidad(cantidad: number, unidadTipo: string | null | undefined, etiqueta: string) {
  const tipo = (unidadTipo || "unidad").toLowerCase();
  const esUnidad = tipo === "unidad" || tipo === "unidades" || tipo === "u";
  if (esUnidad && !Number.isInteger(cantidad)) {
    throw Object.assign(
      new Error(`${etiqueta} debe ser un número entero para productos vendidos por unidad`),
      { status: 400 },
    );
  }
}

function parseMixto(raw: unknown): { efectivo: number; tarjeta: number; transferencia: number } {
  let parsed: Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw Object.assign(new Error("El pago mixto requiere un desglose JSON válido"), { status: 400 });
    }
  } else if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    parsed = raw as Record<string, unknown>;
  } else {
    throw Object.assign(new Error("El pago mixto requiere un desglose válido"), { status: 400 });
  }
  const montos = [parsed.efectivo ?? 0, parsed.tarjeta ?? 0, parsed.transferencia ?? 0];
  if (montos.some(monto => typeof monto !== "number" || !Number.isSafeInteger(monto) || monto < 0)) {
    throw Object.assign(new Error("Los montos del pago mixto deben ser enteros no negativos"), { status: 400 });
  }
  return {
    efectivo: montos[0] as number,
    tarjeta: montos[1] as number,
    transferencia: montos[2] as number,
  };
}

router.post("/cambios", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const {
    venta_id,
    producto_devuelto_id,
    cantidad_devuelta,
    reingresa_stock = true,
    producto_nuevo_id,
    cantidad_nueva,
    motivo,
    nombre_comprador,
    metodo_pago_diferencia,
    metodo_reembolso_diferencia,
    detalle_pago_mixto,
  } = req.body ?? {};

  const ventaId = Number(venta_id);
  const prodDevId = Number(producto_devuelto_id);
  const prodNuevoId = Number(producto_nuevo_id);

  if (!Number.isSafeInteger(ventaId) || ventaId <= 0) {
    res.status(400).json({ error: "venta_id inválido" });
    return;
  }
  if (!Number.isSafeInteger(prodDevId) || prodDevId <= 0) {
    res.status(400).json({ error: "producto_devuelto_id inválido" });
    return;
  }
  if (!Number.isSafeInteger(prodNuevoId) || prodNuevoId <= 0) {
    res.status(400).json({ error: "producto_nuevo_id inválido" });
    return;
  }
  if (typeof reingresa_stock !== "boolean" && reingresa_stock != null) {
    res.status(400).json({ error: "reingresa_stock debe ser booleano" });
    return;
  }
  if (!motivo || typeof motivo !== "string" || motivo.trim().length < 3 || motivo.length > 500) {
    res.status(400).json({ error: "El motivo del cambio es obligatorio (mínimo 3 caracteres)" });
    return;
  }
  if (!nombre_comprador || typeof nombre_comprador !== "string" || nombre_comprador.trim().length < 2 || nombre_comprador.length > 200) {
    res.status(400).json({ error: "El nombre del comprador es obligatorio (mínimo 2 caracteres)" });
    return;
  }

  let cantDev: number;
  let cantNueva: number;
  try {
    cantDev = normalizeCantidad(cantidad_devuelta, "La cantidad a devolver");
    cantNueva = normalizeCantidad(cantidad_nueva, "La cantidad del producto nuevo");
  } catch (error: any) {
    res.status(400).json({ error: error?.message ?? "Cantidad inválida" });
    return;
  }

  const session = (req as any).session;
  const reingresa = reingresa_stock !== false;

  const [config] = await db
    .select({
      horas_limite: configuracionTable.horas_limite_devolucion,
      requiere_ticket: configuracionTable.devoluciones_requieren_ticket,
      emite_tickets: configuracionTable.emite_tickets,
      redondeo_activo: configuracionTable.redondeo_activo,
      redondeo_multiplo: configuracionTable.redondeo_multiplo,
    })
    .from(configuracionTable)
    .limit(1);

  const horasLimite = config?.horas_limite ?? 48;
  const requiereTicket = config?.requiere_ticket ?? true;
  const redondeoActivo = config?.redondeo_activo ?? true;
  const redondeoMultiplo = config?.redondeo_multiplo ?? 50;

  let resultadoCambio: any = null;

  try {
    await db.transaction(async (tx) => {
      const [venta] = await tx
        .select({
          id: ventasTable.id,
          usuario_id: ventasTable.usuario_id,
          anulada: ventasTable.anulada,
          numero_ticket: ventasTable.numero_ticket,
          fecha: ventasTable.fecha,
          total: ventasTable.total,
        })
        .from(ventasTable)
        .where(eq(ventasTable.id, ventaId));

      if (!venta) {
        throw Object.assign(new Error("Venta original no encontrada"), { status: 404 });
      }
      if (venta.anulada) {
        throw Object.assign(new Error("No se puede realizar un cambio sobre una venta anulada"), { status: 400 });
      }

      const ahora = new Date();
      const fechaVenta = venta.fecha;
      const horasDesdeVenta = (ahora.getTime() - fechaVenta.getTime()) / (1000 * 60 * 60);
      if (horasDesdeVenta > horasLimite) {
        const fechaVencimiento = new Date(fechaVenta.getTime() + horasLimite * 60 * 60 * 1000);
        throw Object.assign(
          new Error(`El plazo para devolver o cambiar ha vencido. Venció el ${fechaVencimiento.toLocaleString("es-ES")}`),
          { status: 400 },
        );
      }

      if (requiereTicket && (!config?.emite_tickets || !venta.numero_ticket)) {
        throw Object.assign(
          new Error("Los cambios requieren ticket, pero el negocio no emite tickets o esta venta no tiene número de ticket."),
          { status: 400 },
        );
      }

      if (session.rol !== "admin" && venta.usuario_id !== session.userId) {
        throw Object.assign(new Error("No tienes permiso para realizar un cambio sobre esta venta"), { status: 403 });
      }

      const [lineaOriginal] = await tx
        .select({
          producto_id: detalleVentaTable.producto_id,
          cantidad: detalleVentaTable.cantidad,
          precio_unitario: detalleVentaTable.precio_unitario,
        })
        .from(detalleVentaTable)
        .where(and(
          eq(detalleVentaTable.venta_id, ventaId),
          eq(detalleVentaTable.producto_id, prodDevId),
        ));

      if (!lineaOriginal) {
        throw Object.assign(new Error(`El producto #${prodDevId} no pertenece a esta venta`), { status: 400 });
      }

      const [productoDevuelto] = await tx
        .select({
          id: productosTable.id,
          nombre: productosTable.nombre,
          unidad_tipo: productosTable.unidad_tipo,
        })
        .from(productosTable)
        .where(eq(productosTable.id, prodDevId));

      assertCantidadSegunUnidad(cantDev, productoDevuelto?.unidad_tipo, "La cantidad a cambiar");

      const devsPrevias = await tx
        .select({
          cantidad: detalleDevolucionTable.cantidad,
        })
        .from(detalleDevolucionTable)
        .innerJoin(devolucionesTable, eq(detalleDevolucionTable.devolucion_id, devolucionesTable.id))
        .where(and(
          eq(devolucionesTable.venta_id, ventaId),
          eq(detalleDevolucionTable.producto_id, prodDevId),
        ));

      const yaDevuelto = devsPrevias.reduce((sum, d) => sum + d.cantidad, 0);
      if (yaDevuelto + cantDev > lineaOriginal.cantidad + 1e-9) {
        throw Object.assign(
          new Error(`La cantidad a cambiar (${cantDev}) excede lo disponible. Ya devuelto: ${yaDevuelto}, Vendido: ${lineaOriginal.cantidad}`),
          { status: 400 },
        );
      }

      const [productoNuevo] = await tx
        .select({
          id: productosTable.id,
          nombre: productosTable.nombre,
          codigo: productosTable.codigo,
          precio: productosTable.precio,
          stock: productosTable.stock,
          activo: productosTable.activo,
          unidad_tipo: productosTable.unidad_tipo,
        })
        .from(productosTable)
        .where(eq(productosTable.id, prodNuevoId));

      if (!productoNuevo || !productoNuevo.activo) {
        throw Object.assign(new Error("El producto nuevo no existe o no está activo"), { status: 400 });
      }

      assertCantidadSegunUnidad(cantNueva, productoNuevo.unidad_tipo, "La cantidad del producto nuevo");

      const stockDisponible = (prodNuevoId === prodDevId && reingresa)
        ? productoNuevo.stock + cantDev
        : productoNuevo.stock;
      if (stockDisponible < cantNueva) {
        throw Object.assign(
          new Error(`Stock insuficiente para el producto nuevo '${productoNuevo.nombre}'. Disponible: ${productoNuevo.stock}, Solicitado: ${cantNueva}`),
          { status: 400 },
        );
      }

      const precioUnitarioDevuelto = lineaOriginal.precio_unitario;
      const subtotalDevuelto = Math.round(cantDev * precioUnitarioDevuelto);
      const precioUnitarioNuevo = productoNuevo.precio;
      const subtotalNuevo = Math.round(cantNueva * precioUnitarioNuevo);
      const resDev = calcularRedondeo(subtotalDevuelto, redondeoActivo, redondeoMultiplo);
      const resNuevo = calcularRedondeo(subtotalNuevo, redondeoActivo, redondeoMultiplo);
      const diferencia = resNuevo.total - resDev.total;

      const [cajaActiva] = await tx
        .select({
          id: aperturasCajaTable.id,
          fondo_inicial: aperturasCajaTable.fondo_inicial,
        })
        .from(aperturasCajaTable)
        .where(and(
          eq(aperturasCajaTable.usuario_id, session.userId),
          isNull(aperturasCajaTable.cierre_id),
        ))
        .limit(1);

      let montoEfectivo = 0;
      let montoTarjeta = 0;
      let montoTransferencia = 0;
      let metodoPagoVenta: "efectivo" | "tarjeta" | "transferencia" | "mixto" | "cambio" = "cambio";
      let metodoReembolsoDev: "efectivo" | "tarjeta" | "transferencia" = "efectivo";
      let totalReembolsoMonto = 0;
      let mixtoGuardado: Record<string, unknown> | null = null;

      const asegurarCaja = (mensaje: string) => {
        if (!cajaActiva) {
          throw Object.assign(new Error(mensaje), { status: 400 });
        }
      };

      const efectivoDisponibleEnCaja = async (): Promise<number> => {
        if (!cajaActiva) return 0;
        const ventasCaja = await tx
          .select({
            metodo_pago: ventasTable.metodo_pago,
            total: ventasTable.total,
            monto_efectivo: ventasTable.monto_efectivo,
            monto_tarjeta: ventasTable.monto_tarjeta,
            monto_transferencia: ventasTable.monto_transferencia,
          })
          .from(ventasTable)
          .where(and(
            eq(ventasTable.apertura_caja_id, cajaActiva.id),
            eq(ventasTable.anulada, false),
          ));
        let effCobrado = 0;
        for (const v of ventasCaja) {
          effCobrado += montosVenta(v).efectivo;
        }
        const devsCaja = await tx
          .select({ total_reembolso: devolucionesTable.total_reembolso })
          .from(devolucionesTable)
          .where(and(
            eq(devolucionesTable.apertura_caja_id, cajaActiva.id),
            eq(devolucionesTable.metodo_reembolso, "efectivo"),
          ));
        const effReembolsado = devsCaja.reduce((sum, d) => sum + (d.total_reembolso || 0), 0);
        return (cajaActiva.fondo_inicial || 0) + effCobrado - effReembolsado;
      };

      if (diferencia === 0) {
        metodoPagoVenta = "cambio";
        metodoReembolsoDev = "efectivo";
        totalReembolsoMonto = 0;
      } else if (diferencia > 0) {
        if (!metodo_pago_diferencia || !["efectivo", "tarjeta", "transferencia", "mixto"].includes(metodo_pago_diferencia)) {
          throw Object.assign(
            new Error("El cliente debe pagar la diferencia. Seleccione método de pago: efectivo, tarjeta, transferencia o mixto"),
            { status: 400 },
          );
        }
        metodoPagoVenta = metodo_pago_diferencia;
        metodoReembolsoDev = metodo_pago_diferencia === "mixto" ? "efectivo" : metodo_pago_diferencia;
        totalReembolsoMonto = 0;

        if (metodo_pago_diferencia === "efectivo") {
          asegurarCaja("Para cobrar la diferencia en efectivo debes tener una caja abierta");
          montoEfectivo = diferencia;
        } else if (metodo_pago_diferencia === "tarjeta") {
          montoTarjeta = diferencia;
        } else if (metodo_pago_diferencia === "transferencia") {
          montoTransferencia = diferencia;
        } else {
          const mixto = parseMixto(detalle_pago_mixto);
          if (mixto.efectivo + mixto.tarjeta + mixto.transferencia !== diferencia) {
            throw Object.assign(
              new Error(`El pago mixto debe sumar exactamente la diferencia (${diferencia}). Recibido: ${mixto.efectivo + mixto.tarjeta + mixto.transferencia}`),
              { status: 400 },
            );
          }
          if (mixto.efectivo > 0) {
            asegurarCaja("Para cobrar parte de la diferencia en efectivo debes tener una caja abierta");
          }
          montoEfectivo = mixto.efectivo;
          montoTarjeta = mixto.tarjeta;
          montoTransferencia = mixto.transferencia;
          mixtoGuardado = mixto;
        }
      } else {
        const montoADevolver = Math.abs(diferencia);
        if (!metodo_reembolso_diferencia || !["efectivo", "tarjeta", "transferencia"].includes(metodo_reembolso_diferencia)) {
          throw Object.assign(
            new Error("El negocio debe devolver la diferencia. Seleccione método de reembolso: efectivo, tarjeta o transferencia"),
            { status: 400 },
          );
        }
        metodoPagoVenta = "cambio";
        metodoReembolsoDev = metodo_reembolso_diferencia;
        totalReembolsoMonto = montoADevolver;

        if (metodo_reembolso_diferencia === "efectivo") {
          asegurarCaja("Para devolver la diferencia en efectivo debes tener una caja abierta");
          const disponible = await efectivoDisponibleEnCaja();
          if (montoADevolver > disponible) {
            throw Object.assign(
              new Error(`Efectivo insuficiente en caja para devolver la diferencia. Disponible: ${disponible}, Solicitado: ${montoADevolver}`),
              { status: 400 },
            );
          }
        }
      }

      const [insertedDev] = await tx.insert(devolucionesTable).values({
        venta_id: ventaId,
        usuario_id: session.userId,
        apertura_caja_id: cajaActiva?.id ?? null,
        tipo: "cambio",
        nombre_comprador: nombre_comprador.trim(),
        motivo: motivo.trim(),
        metodo_reembolso: metodoReembolsoDev,
        subtotal: subtotalDevuelto,
        ajuste_redondeo: resDev.ajusteRedondeo,
        total_reembolso: totalReembolsoMonto,
      }).returning();

      await tx.insert(detalleDevolucionTable).values({
        devolucion_id: insertedDev.id,
        producto_id: prodDevId,
        cantidad: cantDev,
        precio_unitario: precioUnitarioDevuelto,
        subtotal: subtotalDevuelto,
        reingresa_stock: reingresa ? 1 : 0,
      } as any);

      if (reingresa) {
        await tx.update(productosTable)
          .set({ stock: sql`${productosTable.stock} + ${cantDev}` })
          .where(eq(productosTable.id, prodDevId));
      }

      const [maxTicket] = await tx
        .select({ max: sql<number>`COALESCE(MAX(numero_ticket), 0)` })
        .from(ventasTable);
      const nuevoTicket = (maxTicket?.max ?? 0) + 1;

      const metaCambio = {
        tipo: "cambio",
        devolucion_id: insertedDev.id,
        venta_origen_id: ventaId,
        ticket_origen: venta.numero_ticket,
        valor_devuelto: resDev.total,
        valor_nuevo: resNuevo.total,
        diferencia,
        credito: resDev.total,
        pagado: Math.max(diferencia, 0),
        ...(mixtoGuardado ?? {}),
      };

      const [nuevaVenta] = await tx.insert(ventasTable).values({
        numero_ticket: nuevoTicket,
        usuario_id: session.userId,
        apertura_caja_id: cajaActiva?.id ?? null,
        nombre_comprador: nombre_comprador.trim(),
        subtotal: subtotalNuevo,
        ajuste_redondeo: resNuevo.ajusteRedondeo,
        total: resNuevo.total,
        metodo_pago: metodoPagoVenta,
        monto_efectivo: montoEfectivo,
        monto_tarjeta: montoTarjeta,
        monto_transferencia: montoTransferencia,
        detalle_pago_mixto: JSON.stringify(metaCambio),
        anulada: false,
      }).returning();

      await tx.insert(detalleVentaTable).values({
        venta_id: nuevaVenta.id,
        producto_id: prodNuevoId,
        cantidad: cantNueva,
        precio_unitario: precioUnitarioNuevo,
        subtotal: subtotalNuevo,
      });

      const descontados = await tx.update(productosTable)
        .set({ stock: sql`${productosTable.stock} - ${cantNueva}` })
        .where(and(
          eq(productosTable.id, prodNuevoId),
          sql`${productosTable.stock} >= ${cantNueva}`,
        ))
        .returning({ id: productosTable.id });

      if (!descontados.length) {
        throw Object.assign(
          new Error(`Stock insuficiente para el producto nuevo '${productoNuevo.nombre}'`),
          { status: 400 },
        );
      }

      await tx.update(devolucionesTable)
        .set({ venta_nueva_id: nuevaVenta.id })
        .where(eq(devolucionesTable.id, insertedDev.id));

      await tx.insert(auditoriaTable).values({
        usuario_id: session.userId,
        accion: "cambio",
        entidad: "cambio",
        entidad_id: insertedDev.id,
        detalle: JSON.stringify({
          venta_origen_id: ventaId,
          ticket_origen: venta.numero_ticket,
          venta_nueva_id: nuevaVenta.id,
          ticket_nuevo: nuevoTicket,
          producto_devuelto_id: prodDevId,
          producto_devuelto: productoDevuelto?.nombre ?? null,
          cantidad_devuelta: cantDev,
          producto_nuevo_id: prodNuevoId,
          producto_nuevo: productoNuevo.nombre,
          cantidad_nueva: cantNueva,
          diferencia,
          tipo_diferencia: diferencia === 0 ? "equilibrado" : diferencia > 0 ? "cliente_paga" : "negocio_devuelve",
          metodo_pago_diferencia: diferencia > 0 ? metodo_pago_diferencia : null,
          metodo_reembolso_diferencia: diferencia < 0 ? metodo_reembolso_diferencia : null,
          reingresa_stock: reingresa,
          motivo: motivo.trim(),
          comprador: nombre_comprador.trim(),
        }),
        monto: diferencia,
      });

      resultadoCambio = {
        devolucion_id: insertedDev.id,
        venta_origen_id: ventaId,
        numero_ticket_origen: venta.numero_ticket,
        venta_nueva_id: nuevaVenta.id,
        numero_ticket_nuevo: nuevoTicket,
        producto_devuelto: {
          id: prodDevId,
          nombre: productoDevuelto?.nombre ?? null,
          cantidad: cantDev,
          precio_unitario: precioUnitarioDevuelto,
          subtotal: subtotalDevuelto,
          reingresa_stock: reingresa,
          total_devuelto: resDev.total,
          ajuste_redondeo: resDev.ajusteRedondeo,
        },
        producto_nuevo: {
          id: prodNuevoId,
          nombre: productoNuevo.nombre,
          codigo: productoNuevo.codigo,
          cantidad: cantNueva,
          precio_unitario: precioUnitarioNuevo,
          subtotal: subtotalNuevo,
          total_nuevo: resNuevo.total,
          ajuste_redondeo: resNuevo.ajusteRedondeo,
        },
        diferencia,
        tipo_diferencia: diferencia === 0 ? "equilibrado" : diferencia > 0 ? "cliente_paga" : "negocio_devuelve",
        metodo_pago_diferencia: diferencia > 0 ? metodo_pago_diferencia : null,
        metodo_reembolso_diferencia: diferencia < 0 ? metodo_reembolso_diferencia : null,
        nombre_comprador: nombre_comprador.trim(),
        motivo: motivo.trim(),
        fecha: new Date().toISOString(),
      };
    }, { behavior: "immediate" });
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 400;
    res.status(status).json({ error: error?.message ?? "Error al procesar el cambio" });
    return;
  }

  res.status(201).json(resultadoCambio);
});

export default router;
