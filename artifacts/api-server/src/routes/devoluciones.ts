import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql, isNull } from "drizzle-orm";
import {
  db, devolucionesTable, detalleDevolucionTable,
  productosTable, usuariosTable, ventasTable, detalleVentaTable,
  configuracionTable, aperturasCajaTable, calcularRedondeo, auditoriaTable,
  montosVenta,
} from "@workspace/db";
import { isDecimalAllowed } from "./productos";

const router: IRouter = Router();

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(s);
  return !Number.isSafeInteger(n) || n <= 0 ? null : n;
}

router.get("/devoluciones", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { fecha_desde, fecha_hasta } = req.query as Record<string, string>;
  const session = (req as any).session;

  const desde = fecha_desde && !Number.isNaN(Date.parse(fecha_desde)) ? new Date(fecha_desde) : undefined;
  const hasta = fecha_hasta && !Number.isNaN(Date.parse(fecha_hasta)) ? new Date(fecha_hasta) : undefined;

  const whereConditions = [
    desde ? gte(devolucionesTable.fecha, desde) : undefined,
    hasta ? lte(devolucionesTable.fecha, hasta) : undefined,
    session.rol !== "admin" ? eq(devolucionesTable.usuario_id, session.userId) : undefined,
  ].filter(Boolean);

  const rows = await db
    .select({
      id: devolucionesTable.id,
      venta_id: devolucionesTable.venta_id,
      apertura_caja_id: devolucionesTable.apertura_caja_id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: devolucionesTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      motivo: devolucionesTable.motivo,
      tipo: devolucionesTable.tipo,
      nombre_comprador: devolucionesTable.nombre_comprador,
      metodo_reembolso: devolucionesTable.metodo_reembolso,
      subtotal: devolucionesTable.subtotal,
      ajuste_redondeo: devolucionesTable.ajuste_redondeo,
      total_reembolso: devolucionesTable.total_reembolso,
      venta_nueva_id: devolucionesTable.venta_nueva_id,
      fecha: devolucionesTable.fecha,
    })
    .from(devolucionesTable)
    .leftJoin(usuariosTable, eq(devolucionesTable.usuario_id, usuariosTable.id))
    .leftJoin(ventasTable, eq(devolucionesTable.venta_id, ventasTable.id))
    .where(and(...whereConditions))
    .orderBy(desc(devolucionesTable.fecha));

  const result = [];
  for (const row of rows) {
    const detalles = await db
      .select({
        id: detalleDevolucionTable.id,
        devolucion_id: detalleDevolucionTable.devolucion_id,
        producto_id: detalleDevolucionTable.producto_id,
        producto_nombre: productosTable.nombre,
        cantidad: detalleDevolucionTable.cantidad,
        precio_unitario: detalleDevolucionTable.precio_unitario,
        subtotal: detalleDevolucionTable.subtotal,
        reingresa_stock: detalleDevolucionTable.reingresa_stock,
      })
      .from(detalleDevolucionTable)
      .leftJoin(productosTable, eq(detalleDevolucionTable.producto_id, productosTable.id))
      .where(eq(detalleDevolucionTable.devolucion_id, row.id));

    let detalleNuevaVenta: any[] = [];
    let ticketNuevo: number | null = null;
    if (row.venta_nueva_id) {
      const [vn] = await db
        .select({ numero_ticket: ventasTable.numero_ticket })
        .from(ventasTable)
        .where(eq(ventasTable.id, row.venta_nueva_id));
      ticketNuevo = vn?.numero_ticket ?? null;
      detalleNuevaVenta = await db
        .select({
          id: detalleVentaTable.id,
          producto_id: detalleVentaTable.producto_id,
          producto_nombre: productosTable.nombre,
          cantidad: detalleVentaTable.cantidad,
          precio_unitario: detalleVentaTable.precio_unitario,
          subtotal: detalleVentaTable.subtotal,
        })
        .from(detalleVentaTable)
        .leftJoin(productosTable, eq(detalleVentaTable.producto_id, productosTable.id))
        .where(eq(detalleVentaTable.venta_id, row.venta_nueva_id));
    }

    result.push({
      ...row,
      fecha: row.fecha.toISOString(),
      venta_nueva_id: row.venta_nueva_id ?? null,
      numero_ticket_nuevo: ticketNuevo,
      detalle_nueva_venta: detalleNuevaVenta,
      detalle: detalles.map(line => ({ ...line, reingresa_stock: Boolean(line.reingresa_stock) })),
    });
  }

  res.json(result);
});

router.post("/devoluciones", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { venta_id, motivo, nombre_comprador, metodo_reembolso, detalle } = req.body ?? {};

  if (!venta_id || !Array.isArray(detalle) || detalle.length === 0) {
    res.status(400).json({ error: "venta_id y detalle son requeridos" });
    return;
  }

  const ventaId = Number(venta_id);
  if (!Number.isSafeInteger(ventaId) || ventaId <= 0) {
    res.status(400).json({ error: "venta_id inválido" });
    return;
  }

  if (!motivo || typeof motivo !== "string" || motivo.trim().length < 3 || motivo.length > 500) {
    res.status(400).json({ error: "El motivo es obligatorio (mínimo 3 caracteres y máximo 500)" });
    return;
  }

  if (!nombre_comprador || typeof nombre_comprador !== "string" || nombre_comprador.trim().length < 2 || nombre_comprador.length > 200) {
    res.status(400).json({ error: "El nombre del comprador es obligatorio (mínimo 2 caracteres)" });
    return;
  }

  if (detalle.length > 200) {
    res.status(400).json({ error: "Demasiados ítems en la devolución" });
    return;
  }

  const session = (req as any).session;

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

  const reingresaMap = new Map<number, boolean>();
  const lineasConsolidadasMap = new Map<number, number>();
  for (const line of detalle) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      res.status(400).json({ error: "Cada ítem debe ser un objeto válido" });
      return;
    }
    const pid = Number(line.producto_id);
    const cant = Number(line.cantidad);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      res.status(400).json({ error: "producto_id inválido en detalle" });
      return;
    }
    if (!Number.isFinite(cant) || cant <= 0) {
      res.status(400).json({ error: "La cantidad debe ser un número positivo" });
      return;
    }
    if (line.reingresa_stock != null && typeof line.reingresa_stock !== "boolean") {
      res.status(400).json({ error: "reingresa_stock debe ser booleano" });
      return;
    }
    const prevCant = lineasConsolidadasMap.get(pid) ?? 0;
    lineasConsolidadasMap.set(pid, Math.round((prevCant + cant) * 1000) / 1000);
    if (lineasConsolidadasMap.get(pid)! > 100_000) {
      res.status(400).json({ error: "La cantidad total excede el límite permitido" });
      return;
    }
    const reingresa = line.reingresa_stock !== false;
    reingresaMap.set(pid, (reingresaMap.get(pid) ?? true) && reingresa);
  }

  const detalleConsolidado = Array.from(lineasConsolidadasMap.entries()).map(([producto_id, cantidad]) => ({
    producto_id,
    cantidad,
    reingresa_stock: reingresaMap.get(producto_id) ?? true,
  }));

  let dev: any = null;

  try {
  await db.transaction(async (tx) => {
    const [venta] = await tx
      .select({
        id: ventasTable.id,
        usuario_id: ventasTable.usuario_id,
        anulada: ventasTable.anulada,
        numero_ticket: ventasTable.numero_ticket,
        fecha: ventasTable.fecha,
        metodo_pago: ventasTable.metodo_pago,
        total: ventasTable.total,
        monto_efectivo: ventasTable.monto_efectivo,
        monto_tarjeta: ventasTable.monto_tarjeta,
        monto_transferencia: ventasTable.monto_transferencia,
      })
      .from(ventasTable)
      .where(eq(ventasTable.id, ventaId));

    if (!venta) {
      throw Object.assign(new Error("Venta no encontrada"), { status: 404 });
    }
    if (venta.anulada) {
      throw Object.assign(new Error("No se puede devolver una venta anulada"), { status: 400 });
    }

    const ahora = new Date();
    const fechaVenta = venta.fecha;
    const horasDesdeVenta = (ahora.getTime() - fechaVenta.getTime()) / (1000 * 60 * 60);
    
    if (horasDesdeVenta > horasLimite) {
      const fechaVencimiento = new Date(fechaVenta.getTime() + horasLimite * 60 * 60 * 1000);
      throw Object.assign(new Error(`El plazo para devolver ha vencido. Venció el ${fechaVencimiento.toLocaleString('es-ES')}`), { status: 400 });
    }

    if (requiereTicket && (!config?.emite_tickets || !venta.numero_ticket)) {
      throw Object.assign(new Error("Las devoluciones requieren ticket, pero el negocio no emite tickets o esta venta no tiene número de ticket."), { status: 400 });
    }

    if (session.rol !== "admin" && venta.usuario_id !== session.userId) {
      throw Object.assign(new Error("No tienes permiso para devolver esta venta"), { status: 403 });
    }

    const [cajaActiva] = await tx
      .select({ id: aperturasCajaTable.id })
      .from(aperturasCajaTable)
      .where(and(
        eq(aperturasCajaTable.usuario_id, session.userId),
        isNull(aperturasCajaTable.cierre_id),
      ))
      .limit(1);

    const metodoReembolsoRaw = metodo_reembolso || (["efectivo", "tarjeta", "transferencia"].includes(venta.metodo_pago ?? "") ? venta.metodo_pago : "efectivo");
    if (typeof metodoReembolsoRaw !== "string" || !["efectivo", "tarjeta", "transferencia"].includes(metodoReembolsoRaw)) {
      throw Object.assign(new Error("Método de reembolso inválido. Debe ser efectivo, tarjeta o transferencia"), { status: 400 });
    }
    const metodoReembolso = metodoReembolsoRaw as "efectivo" | "tarjeta" | "transferencia";

    if (metodoReembolso === "efectivo" && !cajaActiva) {
      throw Object.assign(new Error("Para reembolsar en efectivo debes tener una caja abierta"), { status: 400 });
    }

    const originalLines = await tx
      .select({
        producto_id: detalleVentaTable.producto_id,
        cantidad: detalleVentaTable.cantidad,
        precio_unitario: detalleVentaTable.precio_unitario,
        nombre: productosTable.nombre,
        unidad_tipo: productosTable.unidad_tipo,
      })
      .from(detalleVentaTable)
      .leftJoin(productosTable, eq(detalleVentaTable.producto_id, productosTable.id))
      .where(eq(detalleVentaTable.venta_id, ventaId));

    const originalQtyMap = new Map<number, { cantidad: number; precio: number; nombre: string; unidad_tipo: string }>();
    for (const line of originalLines) {
      const pid = line.producto_id!;
      const existing = originalQtyMap.get(pid) || { cantidad: 0, precio: 0, nombre: line.nombre || "", unidad_tipo: line.unidad_tipo || "unidad" };
      originalQtyMap.set(pid, {
        cantidad: existing.cantidad + line.cantidad,
        precio: line.precio_unitario,
        nombre: line.nombre || "",
        unidad_tipo: line.unidad_tipo || "unidad",
      });
    }

    const devolucionesPreviasDetalle = await tx
      .select({
        producto_id: detalleDevolucionTable.producto_id,
        cantidad: detalleDevolucionTable.cantidad,
      })
      .from(detalleDevolucionTable)
      .innerJoin(devolucionesTable, eq(detalleDevolucionTable.devolucion_id, devolucionesTable.id))
      .where(eq(devolucionesTable.venta_id, ventaId));

    const yaDevueltoMap = new Map<number, number>();
    for (const d of devolucionesPreviasDetalle) {
      const pid = d.producto_id!;
      yaDevueltoMap.set(pid, (yaDevueltoMap.get(pid) ?? 0) + d.cantidad);
    }

    const lineas: { 
      producto_id: number; 
      cantidad: number; 
      precio_unitario: number; 
      subtotal: number; 
      reingresa_stock: boolean; 
    }[] = [];
    let subtotalDevolucion = 0;

    for (const line of detalleConsolidado) {
      const original = originalQtyMap.get(line.producto_id);
      if (!original) {
        throw Object.assign(new Error(`El producto ${line.producto_id} no pertenece a esta venta`), { status: 400 });
      }

      if (!isDecimalAllowed(original.unidad_tipo) && line.cantidad % 1 !== 0) {
        throw Object.assign(new Error(`El producto '${original.nombre}' no admite cantidades decimales`), { status: 400 });
      }

      const yaDevuelto = yaDevueltoMap.get(line.producto_id) ?? 0;
      if (yaDevuelto + line.cantidad > original.cantidad) {
        throw Object.assign(new Error(`La cantidad a devolver (${line.cantidad}) excede lo disponible. Ya devuelto: ${yaDevuelto}, Vendido: ${original.cantidad}`), { status: 400 });
      }

      const precioUnitario = original.precio;
      const subtotal = Math.round(line.cantidad * precioUnitario);
      const reingresaStock = line.reingresa_stock !== false;

      lineas.push({
        producto_id: line.producto_id,
        cantidad: line.cantidad,
        precio_unitario: precioUnitario,
        subtotal,
        reingresa_stock: reingresaStock
      });
      subtotalDevolucion += subtotal;
    }

    const { ajusteRedondeo, total: totalReembolso } = calcularRedondeo(
      subtotalDevolucion,
      redondeoActivo,
      config?.redondeo_multiplo ?? 50,
    );

    const devolucionesPrevias = await tx
      .select({
        metodo: devolucionesTable.metodo_reembolso,
        total: devolucionesTable.total_reembolso,
      })
      .from(devolucionesTable)
      .where(eq(devolucionesTable.venta_id, ventaId));

    const yaReembolsadoTotal = devolucionesPrevias.reduce((sum, d) => sum + (d.total || 0), 0);
    if (yaReembolsadoTotal + totalReembolso > venta.total) {
      throw Object.assign(new Error(`El reembolso total excede lo cobrado. Cobrado: ${venta.total}, Ya reembolsado: ${yaReembolsadoTotal}, Esta devolución: ${totalReembolso}`), { status: 400 });
    }

    if (metodoReembolso === "efectivo" && cajaActiva) {
      const [aperturaActual] = await tx
        .select({
          id: aperturasCajaTable.id,
          fondo_inicial: aperturasCajaTable.fondo_inicial,
        })
        .from(aperturasCajaTable)
        .where(eq(aperturasCajaTable.id, cajaActiva.id));

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

      let efectivoCobradoCaja = 0;
      for (const v of ventasCaja) {
        efectivoCobradoCaja += montosVenta(v).efectivo;
      }

      const devolucionesCaja = await tx
        .select({
          total_reembolso: devolucionesTable.total_reembolso,
        })
        .from(devolucionesTable)
        .where(and(
          eq(devolucionesTable.apertura_caja_id, cajaActiva.id),
          eq(devolucionesTable.metodo_reembolso, "efectivo"),
        ));

      const efectivoReembolsadoCaja = devolucionesCaja.reduce((sum, d) => sum + (d.total_reembolso || 0), 0);
      const efectivoDisponible = (aperturaActual?.fondo_inicial || 0) + efectivoCobradoCaja - efectivoReembolsadoCaja;

      if (totalReembolso > efectivoDisponible) {
        throw Object.assign(new Error(`Efectivo insuficiente en caja. Disponible: ${efectivoDisponible}, Solicitado: ${totalReembolso}`), { status: 400 });
      }
    }

    const insertedDevolucion = await tx.insert(devolucionesTable).values({
      venta_id: ventaId,
      usuario_id: session.userId,
      apertura_caja_id: cajaActiva?.id ?? null,
      tipo: "devolucion",
      nombre_comprador: nombre_comprador.trim(),
      motivo: motivo.trim(),
      metodo_reembolso: metodoReembolso,
      subtotal: subtotalDevolucion,
      ajuste_redondeo: ajusteRedondeo,
      total_reembolso: totalReembolso,
    }).returning();
    dev = insertedDevolucion[0];

    for (const linea of lineas) {
      // @ts-ignore
      await tx.insert(detalleDevolucionTable).values({
        devolucion_id: dev.id,
        producto_id: linea.producto_id,
        cantidad: linea.cantidad,
        precio_unitario: linea.precio_unitario,
        subtotal: linea.subtotal,
        reingresa_stock: linea.reingresa_stock ? 1 : 0,
      });

      if (linea.reingresa_stock) {
        await tx
          .update(productosTable)
          .set({ stock: sql`ROUND(${productosTable.stock} + ${linea.cantidad}, 3)` })
          .where(eq(productosTable.id, linea.producto_id));
      }
    }

    await tx.insert(auditoriaTable).values({
      usuario_id: session.userId,
      accion: "devolucion",
      entidad: "devolucion",
      entidad_id: dev.id,
      detalle: `Devolución de venta #${venta.numero_ticket}: ${motivo}`,
      monto: totalReembolso,
    });
  }, { behavior: "immediate" });
  } catch (error: any) {
    const status = typeof error?.status === "number" ? error.status : 400;
    res.status(status).json({ error: error?.message ?? "Error al crear devolución" });
    return;
  }

  if (!dev) {
    res.status(500).json({ error: "Error al crear devolución" });
    return;
  }

  const [usuario] = await db
    .select({ nombre: usuariosTable.nombre })
    .from(usuariosTable)
    .where(eq(usuariosTable.id, dev.usuario_id!));

  const [ventaConTicket] = await db
    .select({ numero_ticket: ventasTable.numero_ticket })
    .from(ventasTable)
    .where(eq(ventasTable.id, ventaId))
    .limit(1);
  const detalleRespuesta = await db
    .select({
      id: detalleDevolucionTable.id,
      devolucion_id: detalleDevolucionTable.devolucion_id,
      producto_id: detalleDevolucionTable.producto_id,
      producto_nombre: productosTable.nombre,
      cantidad: detalleDevolucionTable.cantidad,
      precio_unitario: detalleDevolucionTable.precio_unitario,
      subtotal: detalleDevolucionTable.subtotal,
      reingresa_stock: detalleDevolucionTable.reingresa_stock,
    })
    .from(detalleDevolucionTable)
    .leftJoin(productosTable, eq(detalleDevolucionTable.producto_id, productosTable.id))
    .where(eq(detalleDevolucionTable.devolucion_id, dev.id));

  // @ts-ignore
  res.status(201).json({
    ...dev,
    // @ts-ignore
    fecha: dev.fecha.toISOString(),
    numero_ticket: ventaConTicket?.numero_ticket ?? null,
    usuario_nombre: usuario?.nombre ?? null,
    detalle: detalleRespuesta.map(line => ({ ...line, reingresa_stock: Boolean(line.reingresa_stock) })),
  });
});

export default router;
