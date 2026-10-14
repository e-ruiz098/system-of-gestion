import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql, isNull } from "drizzle-orm";
import { db, ventasTable, detalleVentaTable, productosTable, usuariosTable, configuracionTable, aperturasCajaTable, devolucionesTable, detalleDevolucionTable, auditoriaTable, calcularRedondeo } from "@workspace/db";

const router: IRouter = Router();

const METODOS_PAGO = ["efectivo", "tarjeta", "transferencia", "mixto"] as const;
type MetodoPago = typeof METODOS_PAGO[number];

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

function requireAdmin(req: any, res: any): boolean {
  if (req.session?.rol !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(s);
  return !Number.isSafeInteger(n) || n <= 0 ? null : n;
}

async function buildVentaDetalleResponse(venta: {
  id: number;
  fecha: Date;
  total: number;
  anulada: boolean;
  [key: string]: unknown;
}) {
  const detalles = await db
    .select({
      id: detalleVentaTable.id,
      venta_id: detalleVentaTable.venta_id,
      producto_id: detalleVentaTable.producto_id,
      producto_nombre: productosTable.nombre,
      cantidad: detalleVentaTable.cantidad,
      precio_unitario: detalleVentaTable.precio_unitario,
      subtotal: detalleVentaTable.subtotal,
    })
    .from(detalleVentaTable)
    .leftJoin(productosTable, eq(detalleVentaTable.producto_id, productosTable.id))
    .where(eq(detalleVentaTable.venta_id, venta.id));

  const devolucionesPrevias = await db
    .select({
      producto_id: detalleDevolucionTable.producto_id,
      cantidad: detalleDevolucionTable.cantidad,
    })
    .from(detalleDevolucionTable)
    .innerJoin(devolucionesTable, eq(detalleDevolucionTable.devolucion_id, devolucionesTable.id))
    .where(eq(devolucionesTable.venta_id, venta.id));

  const yaDevueltoMap = new Map<number, number>();
  for (const d of devolucionesPrevias) {
    const pid = d.producto_id!;
    yaDevueltoMap.set(pid, (yaDevueltoMap.get(pid) ?? 0) + d.cantidad);
  }

  const detallesConDevoluciones = detalles.map(d => ({
    ...d,
    cantidad_devuelta: yaDevueltoMap.get(d.producto_id!) ?? 0,
    cantidad_devolvible: d.cantidad - (yaDevueltoMap.get(d.producto_id!) ?? 0),
  }));

  let estado: string;
  if (venta.anulada) {
    estado = "anulada";
  } else {
    const totalDevuelto = await db
      .select({
        total: sql<number>`CASE WHEN ${devolucionesTable.tipo} = 'cambio' THEN ${devolucionesTable.subtotal} ELSE ${devolucionesTable.total_reembolso} END`,
      })
      .from(devolucionesTable)
      .where(eq(devolucionesTable.venta_id, venta.id))
      .then(rows => rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0));

    if (totalDevuelto === 0) {
      estado = "sin_devoluciones";
    } else if (totalDevuelto >= venta.total) {
      estado = "devuelta_totalmente";
    } else {
      estado = "devuelta_parcialmente";
    }
  }

  const [config] = await db
    .select({ horas_limite: configuracionTable.horas_limite_devolucion })
    .from(configuracionTable)
    .limit(1);
  const horasLimite = config?.horas_limite ?? 48;
  const fechaVencimiento = new Date(venta.fecha.getTime() + horasLimite * 60 * 60 * 1000);
  const estaVencida = new Date() > fechaVencimiento;

  return {
    ...venta,
    fecha: venta.fecha.toISOString(),
    estado,
    fecha_vencimiento: fechaVencimiento.toISOString(),
    esta_vencida: estaVencida,
    detalle: detallesConDevoluciones,
  };
}

router.get("/ventas", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const { fecha_desde, fecha_hasta, usuario_id, producto_id, numero_ticket } = req.query as Record<string, string>;
  const session = (req as any).session;

  // Validate date strings to prevent injection via new Date()
  const desde = fecha_desde && !Number.isNaN(Date.parse(fecha_desde)) ? new Date(fecha_desde) : undefined;
  const hasta = fecha_hasta && !Number.isNaN(Date.parse(fecha_hasta)) ? new Date(fecha_hasta) : undefined;
  const uidFilter = session.rol === "admin"
    ? (usuario_id ? Number(usuario_id) : undefined)
    : session.userId;
  const pidFilter = producto_id ? Number(producto_id) : undefined;
  const ticketFilter = numero_ticket ? Number(numero_ticket) : undefined;

  if (
    (session.rol === "admin" && usuario_id && (!Number.isSafeInteger(uidFilter) || uidFilter <= 0)) ||
    (producto_id && (!Number.isSafeInteger(pidFilter) || pidFilter! <= 0)) ||
    (numero_ticket && (!Number.isSafeInteger(ticketFilter) || ticketFilter! <= 0))
  ) {
    res.status(400).json({ error: "Parámetro de filtro inválido" });
    return;
  }

  const rows = await db
    .select({
      id: ventasTable.id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: ventasTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      apertura_caja_id: ventasTable.apertura_caja_id,
      nombre_comprador: ventasTable.nombre_comprador,
      total_devuelto: sql<number>`COALESCE((SELECT SUM(CASE WHEN d.tipo = 'cambio' THEN d.subtotal ELSE d.total_reembolso END) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id}), 0)`,
      total_reembolsado_efectivo: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'efectivo'), 0)`,
      total_reembolsado_tarjeta: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'tarjeta'), 0)`,
      total_reembolsado_transferencia: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'transferencia'), 0)`,
      cantidad_vendida: sql<number>`COALESCE((SELECT SUM(dv.cantidad) FROM detalle_venta dv WHERE dv.venta_id = ${ventasTable.id}), 0)`,
      cantidad_devuelta: sql<number>`COALESCE((SELECT SUM(dd.cantidad) FROM detalle_devolucion dd INNER JOIN devoluciones d ON d.id = dd.devolucion_id WHERE d.venta_id = ${ventasTable.id}), 0)`,
      subtotal: ventasTable.subtotal,
      ajuste_redondeo: ventasTable.ajuste_redondeo,
      total: ventasTable.total,
      metodo_pago: ventasTable.metodo_pago,
      monto_efectivo: ventasTable.monto_efectivo,
      monto_tarjeta: ventasTable.monto_tarjeta,
      monto_transferencia: ventasTable.monto_transferencia,
      detalle_pago_mixto: ventasTable.detalle_pago_mixto,
      fecha: ventasTable.fecha,
      anulada: ventasTable.anulada,
      anulada_por_usuario: ventasTable.anulada_por_usuario,
      fecha_anulacion: ventasTable.fecha_anulacion,
    })
    .from(ventasTable)
    .leftJoin(usuariosTable, eq(ventasTable.usuario_id, usuariosTable.id))
    .where(
      and(
        desde ? gte(ventasTable.fecha, desde) : undefined,
        hasta ? lte(ventasTable.fecha, hasta) : undefined,
        uidFilter ? eq(ventasTable.usuario_id, uidFilter) : undefined,
        ticketFilter ? eq(ventasTable.numero_ticket, ticketFilter) : undefined,
        pidFilter
          ? sql`EXISTS (SELECT 1 FROM detalle_venta dv WHERE dv.venta_id = ${ventasTable.id} AND dv.producto_id = ${pidFilter})`
          : undefined,
      )
    )
    .orderBy(desc(ventasTable.fecha));

  res.json(rows.map(r => {
    const { cantidad_vendida, cantidad_devuelta, ...venta } = r;
    return {
    ...venta,
    fecha: r.fecha.toISOString(),
    estado: r.anulada
      ? "anulada"
      : cantidad_vendida > 0 && cantidad_devuelta >= cantidad_vendida
        ? "devuelta_totalmente"
        : cantidad_devuelta > 0
          ? "devuelta_parcialmente"
          : "sin_devoluciones",
    };
  }));
});

router.post("/ventas", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { apertura_caja_id, metodo_pago, detalle_pago_mixto, detalle, nombre_comprador } = req.body ?? {};

  // ── Input validation ──────────────────────────────────────────────────────
  if (!metodo_pago || !METODOS_PAGO.includes(metodo_pago as MetodoPago)) {
    res.status(400).json({ error: `metodo_pago debe ser uno de: ${METODOS_PAGO.join(", ")}` });
    return;
  }
  if (!Array.isArray(detalle) || detalle.length === 0) {
    res.status(400).json({ error: "detalle debe ser un array con al menos un ítem" });
    return;
  }
  if (detalle.length > 200) {
    res.status(400).json({ error: "Demasiados ítems en la venta" });
    return;
  }

  // Validate each line's shape before any DB operation
  for (const line of detalle) {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      res.status(400).json({ error: "Cada ítem debe ser un objeto válido" });
      return;
    }
    const cantidad = Number(line.cantidad);
    const productoId = Number(line.producto_id);
    if (!Number.isSafeInteger(productoId) || productoId <= 0) {
      res.status(400).json({ error: "Cada ítem debe tener un producto_id válido" });
      return;
    }
    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      res.status(400).json({ error: "La cantidad de cada ítem debe ser un número positivo" });
      return;
    }
    if (cantidad > 100_000) {
      res.status(400).json({ error: "Cantidad excede el límite permitido" });
      return;
    }
  }

  // ── Consolidar líneas que tengan el mismo producto_id antes de validar y guardar ──
  const lineasConsolidadasMap = new Map<number, number>();
  for (const line of detalle) {
    const pid = Number(line.producto_id);
    const cant = Number(line.cantidad);
    const prevCant = lineasConsolidadasMap.get(pid) ?? 0;
    lineasConsolidadasMap.set(pid, Math.round((prevCant + cant) * 1000) / 1000);
  }

  const detalleConsolidado = Array.from(lineasConsolidadasMap.entries()).map(([producto_id, cantidad]) => ({
    producto_id,
    cantidad,
  }));
  if (detalleConsolidado.some(line => line.cantidad > 100_000)) {
    res.status(400).json({ error: "Cantidad total excede el límite permitido" });
    return;
  }

  if (nombre_comprador != null && (typeof nombre_comprador !== "string" || nombre_comprador.length > 200)) {
    res.status(400).json({ error: "nombre_comprador inválido" });
    return;
  }

  // Validate and write against one serialized snapshot so concurrent sales
  // cannot both consume the same available stock.
  let venta: typeof ventasTable.$inferSelect | undefined;
  try {
    await db.transaction(async (tx) => {
      const session = (req as any).session;
      const [apertura] = await tx
        .select({ id: aperturasCajaTable.id })
        .from(aperturasCajaTable)
        .where(and(
          eq(aperturasCajaTable.usuario_id, session.userId),
          isNull(aperturasCajaTable.cierre_id),
        ))
        .orderBy(desc(aperturasCajaTable.fecha_apertura))
        .limit(1);

      if (!apertura) throw Object.assign(new Error("Debes abrir una caja antes de vender"), { status: 400 });
      if (apertura_caja_id != null && Number(apertura_caja_id) !== apertura.id) {
        throw Object.assign(new Error("La caja indicada no es tu caja abierta"), { status: 400 });
      }

      const productIds = detalleConsolidado.map(line => line.producto_id);
      const productos = await tx
        .select({
          id: productosTable.id,
          precio: productosTable.precio,
          stock: productosTable.stock,
          nombre: productosTable.nombre,
        })
        .from(productosTable)
        .where(and(
          sql`${productosTable.id} IN (${sql.join(productIds.map(id => sql`${id}`), sql`, `)})`,
          eq(productosTable.activo, true),
        ));
      const productoMap = new Map(productos.map(producto => [producto.id, producto]));
      const lineas: { producto_id: number; cantidad: number; precio_unitario: number; subtotal: number }[] = [];

      for (const line of detalleConsolidado) {
        const producto = productoMap.get(line.producto_id);
        if (!producto) throw Object.assign(new Error(`Producto ${line.producto_id} no encontrado o inactivo`), { status: 400 });
        if (producto.stock < line.cantidad) {
          throw Object.assign(new Error(`Stock insuficiente para el producto ${producto.nombre} (disponible: ${producto.stock})`), { status: 400 });
        }
        const precio_unitario = producto.precio;
        lineas.push({
          producto_id: line.producto_id,
          cantidad: line.cantidad,
          precio_unitario,
          subtotal: Math.round(precio_unitario * line.cantidad),
        });
      }

      const [config] = await tx
        .select({
          redondeo_activo: configuracionTable.redondeo_activo,
          redondeo_multiplo: configuracionTable.redondeo_multiplo,
        })
        .from(configuracionTable)
        .limit(1);
      const subtotal = Math.round(lineas.reduce((sum, line) => sum + line.subtotal, 0));
      const { ajusteRedondeo, total } = calcularRedondeo(
        subtotal,
        config?.redondeo_activo ?? true,
        config?.redondeo_multiplo ?? 50,
      );

      let montoEfectivo = 0;
      let montoTarjeta = 0;
      let montoTransferencia = 0;
      if (metodo_pago === "efectivo") montoEfectivo = total;
      else if (metodo_pago === "tarjeta") montoTarjeta = total;
      else if (metodo_pago === "transferencia") montoTransferencia = total;
      else {
        let pagoMixto: Record<string, unknown>;
        try {
          pagoMixto = JSON.parse(detalle_pago_mixto);
        } catch {
          throw Object.assign(new Error("El pago mixto requiere un desglose JSON válido"), { status: 400 });
        }
        if (!pagoMixto || typeof pagoMixto !== "object" || Array.isArray(pagoMixto)) {
          throw Object.assign(new Error("El pago mixto requiere un desglose válido"), { status: 400 });
        }
        const montos = [pagoMixto.efectivo ?? 0, pagoMixto.tarjeta ?? 0, pagoMixto.transferencia ?? 0];
        if (montos.some(monto => typeof monto !== "number" || !Number.isSafeInteger(monto) || monto < 0)) {
          throw Object.assign(new Error("Los montos del pago mixto deben ser enteros no negativos"), { status: 400 });
        }
        [montoEfectivo, montoTarjeta, montoTransferencia] = montos as [number, number, number];
        const totalPagado = montoEfectivo + montoTarjeta + montoTransferencia;
        if (totalPagado !== total) {
          throw Object.assign(new Error(`El pago mixto debe sumar exactamente el total cobrado (${total}). Recibido: ${totalPagado}`), { status: 400 });
        }
      }

      const [maxTicket] = await tx
        .select({ max: sql<number>`COALESCE(MAX(numero_ticket), 0)` })
        .from(ventasTable);
      const [inserted] = await tx.insert(ventasTable).values({
        numero_ticket: (maxTicket?.max ?? 0) + 1,
        usuario_id: session.userId,
        apertura_caja_id: apertura.id,
        nombre_comprador: nombre_comprador?.trim() || null,
        subtotal,
        ajuste_redondeo: ajusteRedondeo,
        total,
        metodo_pago,
        monto_efectivo: montoEfectivo,
        monto_tarjeta: montoTarjeta,
        monto_transferencia: montoTransferencia,
        detalle_pago_mixto: metodo_pago === "mixto" ? detalle_pago_mixto : null,
        anulada: false,
      }).returning();
      venta = inserted;

      for (const linea of lineas) {
        await tx.insert(detalleVentaTable).values({
          venta_id: inserted.id,
          producto_id: linea.producto_id,
          cantidad: linea.cantidad,
          precio_unitario: linea.precio_unitario,
          subtotal: linea.subtotal,
        });
        await tx.update(productosTable)
          .set({ stock: sql`${productosTable.stock} - ${linea.cantidad}` })
          .where(eq(productosTable.id, linea.producto_id));
      }
    }, { behavior: "immediate" });
  } catch (error: any) {
    res.status(typeof error?.status === "number" ? error.status : 400)
      .json({ error: error?.message ?? "No se pudo procesar la venta" });
    return;
  }

  if (!venta) {
    res.status(500).json({ error: "No se pudo procesar la venta" });
    return;
  }

  const [usuario] = await db
    .select({ nombre: usuariosTable.nombre })
    .from(usuariosTable)
    .where(eq(usuariosTable.id, venta!.usuario_id!));

  res.status(201).json({
    ...venta!,
    fecha: venta!.fecha.toISOString(),
    usuario_nombre: usuario?.nombre ?? null,
  });
});

router.get("/ventas/:id", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const session = (req as any).session;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const [venta] = await db
    .select({
      id: ventasTable.id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: ventasTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      apertura_caja_id: ventasTable.apertura_caja_id,
      nombre_comprador: ventasTable.nombre_comprador,
      total_devuelto: sql<number>`COALESCE((SELECT SUM(CASE WHEN d.tipo = 'cambio' THEN d.subtotal ELSE d.total_reembolso END) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id}), 0)`,
      total_reembolsado_efectivo: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'efectivo'), 0)`,
      total_reembolsado_tarjeta: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'tarjeta'), 0)`,
      total_reembolsado_transferencia: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'transferencia'), 0)`,
      subtotal: ventasTable.subtotal,
      ajuste_redondeo: ventasTable.ajuste_redondeo,
      total: ventasTable.total,
      metodo_pago: ventasTable.metodo_pago,
      monto_efectivo: ventasTable.monto_efectivo,
      monto_tarjeta: ventasTable.monto_tarjeta,
      monto_transferencia: ventasTable.monto_transferencia,
      detalle_pago_mixto: ventasTable.detalle_pago_mixto,
      fecha: ventasTable.fecha,
      anulada: ventasTable.anulada,
      anulada_por_usuario: ventasTable.anulada_por_usuario,
      fecha_anulacion: ventasTable.fecha_anulacion,
    })
    .from(ventasTable)
    .leftJoin(usuariosTable, eq(ventasTable.usuario_id, usuariosTable.id))
    .where(and(
      eq(ventasTable.id, id),
      session.rol !== "admin" ? eq(ventasTable.usuario_id, session.userId) : undefined,
    ));

  if (!venta) { res.status(404).json({ error: "Venta not found" }); return; }

  const detalles = await db
    .select({
      id: detalleVentaTable.id,
      venta_id: detalleVentaTable.venta_id,
      producto_id: detalleVentaTable.producto_id,
      producto_nombre: productosTable.nombre,
      unidad_tipo: productosTable.unidad_tipo,
      cantidad: detalleVentaTable.cantidad,
      precio_unitario: detalleVentaTable.precio_unitario,
      subtotal: detalleVentaTable.subtotal,
    })
    .from(detalleVentaTable)
    .leftJoin(productosTable, eq(detalleVentaTable.producto_id, productosTable.id))
    .where(eq(detalleVentaTable.venta_id, id));

  // Obtener cantidades ya devueltas por producto
  const devolucionesPrevias = await db
    .select({
      producto_id: detalleDevolucionTable.producto_id,
      cantidad: detalleDevolucionTable.cantidad,
    })
    .from(detalleDevolucionTable)
    .innerJoin(devolucionesTable, eq(detalleDevolucionTable.devolucion_id, devolucionesTable.id))
    .where(eq(devolucionesTable.venta_id, id));

  const yaDevueltoMap = new Map<number, number>();
  for (const d of devolucionesPrevias) {
    const pid = d.producto_id!;
    yaDevueltoMap.set(pid, (yaDevueltoMap.get(pid) ?? 0) + d.cantidad);
  }

  // Agregar cantidades devueltas a cada detalle
  const detallesConDevoluciones = detalles.map(d => ({
    ...d,
    cantidad_devuelta: yaDevueltoMap.get(d.producto_id!) ?? 0,
    cantidad_devolvible: d.cantidad - (yaDevueltoMap.get(d.producto_id!) ?? 0),
  }));

  // Calcular estado derivado de la venta
  let estado: string;
  if (venta.anulada) {
    estado = "anulada";
  } else {
    const totalDevuelto = await db
      .select({
        total: sql<number>`CASE WHEN ${devolucionesTable.tipo} = 'cambio' THEN ${devolucionesTable.subtotal} ELSE ${devolucionesTable.total_reembolso} END`,
      })
      .from(devolucionesTable)
      .where(eq(devolucionesTable.venta_id, id))
      .then(rows => rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0));

    const cantidadVendida = detallesConDevoluciones.reduce((sum, line) => sum + line.cantidad, 0);
    const cantidadDevuelta = detallesConDevoluciones.reduce((sum, line) => sum + line.cantidad_devuelta, 0);
    if (cantidadDevuelta === 0) {
      estado = "sin_devoluciones";
    } else if (cantidadVendida > 0 && cantidadDevuelta >= cantidadVendida) {
      estado = "devuelta_totalmente";
    } else {
      estado = "devuelta_parcialmente";
    }
  }

  const [config] = await db
    .select({ horas_limite: configuracionTable.horas_limite_devolucion })
    .from(configuracionTable)
    .limit(1);
  const fechaVencimiento = new Date(venta.fecha.getTime() + (config?.horas_limite ?? 48) * 60 * 60 * 1000);

  res.json({ 
    ...venta, 
    fecha: venta.fecha.toISOString(), 
    estado,
    fecha_vencimiento: fechaVencimiento.toISOString(),
    esta_vencida: new Date() > fechaVencimiento,
    detalle: detallesConDevoluciones 
  });
});

// ── GET /ventas/ticket/:numero ─────────────────────────────────────────────
router.get("/ventas/ticket/:numero", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const session = (req as any).session;
  
  const numero = parseId(req.params.numero);
  if (numero === null) { res.status(400).json({ error: "Número de ticket inválido" }); return; }

  const [venta] = await db
    .select({
      id: ventasTable.id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: ventasTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      apertura_caja_id: ventasTable.apertura_caja_id,
      nombre_comprador: ventasTable.nombre_comprador,
      total_devuelto: sql<number>`COALESCE((SELECT SUM(CASE WHEN d.tipo = 'cambio' THEN d.subtotal ELSE d.total_reembolso END) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id}), 0)`,
      total_reembolsado_efectivo: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'efectivo'), 0)`,
      total_reembolsado_tarjeta: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'tarjeta'), 0)`,
      total_reembolsado_transferencia: sql<number>`COALESCE((SELECT SUM(d.total_reembolso) FROM devoluciones d WHERE d.venta_id = ${ventasTable.id} AND d.metodo_reembolso = 'transferencia'), 0)`,
      subtotal: ventasTable.subtotal,
      ajuste_redondeo: ventasTable.ajuste_redondeo,
      total: ventasTable.total,
      metodo_pago: ventasTable.metodo_pago,
      monto_efectivo: ventasTable.monto_efectivo,
      monto_tarjeta: ventasTable.monto_tarjeta,
      monto_transferencia: ventasTable.monto_transferencia,
      detalle_pago_mixto: ventasTable.detalle_pago_mixto,
      fecha: ventasTable.fecha,
      anulada: ventasTable.anulada,
      anulada_por_usuario: ventasTable.anulada_por_usuario,
      fecha_anulacion: ventasTable.fecha_anulacion,
    })
    .from(ventasTable)
    .leftJoin(usuariosTable, eq(ventasTable.usuario_id, usuariosTable.id))
    .where(and(
      eq(ventasTable.numero_ticket, numero),
      session.rol !== "admin" ? eq(ventasTable.usuario_id, session.userId) : undefined,
    ));

  if (!venta) { res.status(404).json({ error: "Venta no encontrada" }); return; }

  const detalles = await db
    .select({
      id: detalleVentaTable.id,
      venta_id: detalleVentaTable.venta_id,
      producto_id: detalleVentaTable.producto_id,
      producto_nombre: productosTable.nombre,
      unidad_tipo: productosTable.unidad_tipo,
      cantidad: detalleVentaTable.cantidad,
      precio_unitario: detalleVentaTable.precio_unitario,
      subtotal: detalleVentaTable.subtotal,
    })
    .from(detalleVentaTable)
    .leftJoin(productosTable, eq(detalleVentaTable.producto_id, productosTable.id))
    .where(eq(detalleVentaTable.venta_id, venta.id));

  // Obtener cantidades ya devueltas por producto
  const devolucionesPrevias = await db
    .select({
      producto_id: detalleDevolucionTable.producto_id,
      cantidad: detalleDevolucionTable.cantidad,
    })
    .from(detalleDevolucionTable)
    .innerJoin(devolucionesTable, eq(detalleDevolucionTable.devolucion_id, devolucionesTable.id))
    .where(eq(devolucionesTable.venta_id, venta.id));

  const yaDevueltoMap = new Map<number, number>();
  for (const d of devolucionesPrevias) {
    const pid = d.producto_id!;
    yaDevueltoMap.set(pid, (yaDevueltoMap.get(pid) ?? 0) + d.cantidad);
  }

  // Agregar cantidades devueltas a cada detalle
  const detallesConDevoluciones = detalles.map(d => ({
    ...d,
    cantidad_devuelta: yaDevueltoMap.get(d.producto_id!) ?? 0,
    cantidad_devolvible: d.cantidad - (yaDevueltoMap.get(d.producto_id!) ?? 0),
  }));

  // Calcular estado derivado de la venta
  let estado: string;
  if (venta.anulada) {
    estado = "anulada";
  } else {
    const totalDevuelto = await db
      .select({
        total: sql<number>`CASE WHEN ${devolucionesTable.tipo} = 'cambio' THEN ${devolucionesTable.subtotal} ELSE ${devolucionesTable.total_reembolso} END`,
      })
      .from(devolucionesTable)
      .where(eq(devolucionesTable.venta_id, venta.id))
      .then(rows => rows.reduce((sum, r) => sum + (Number(r.total) || 0), 0));

    const cantidadVendida = detallesConDevoluciones.reduce((sum, line) => sum + line.cantidad, 0);
    const cantidadDevuelta = detallesConDevoluciones.reduce((sum, line) => sum + line.cantidad_devuelta, 0);
    if (cantidadDevuelta === 0) {
      estado = "sin_devoluciones";
    } else if (cantidadVendida > 0 && cantidadDevuelta >= cantidadVendida) {
      estado = "devuelta_totalmente";
    } else {
      estado = "devuelta_parcialmente";
    }
  }

  // Calcular vencimiento del plazo de devolución
  const [config] = await db
    .select({ horas_limite: configuracionTable.horas_limite_devolucion })
    .from(configuracionTable)
    .limit(1);
  const horasLimite = config?.horas_limite ?? 48;
  const fechaVencimiento = new Date(venta.fecha.getTime() + horasLimite * 60 * 60 * 1000);
  const estaVencida = new Date() > fechaVencimiento;

  res.json({ 
    ...venta, 
    fecha: venta.fecha.toISOString(), 
    estado,
    fecha_vencimiento: fechaVencimiento.toISOString(),
    esta_vencida: estaVencida,
    detalle: detallesConDevoluciones 
  });
});

router.delete("/ventas/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  try {
    await db.transaction(async (tx) => {
      const [venta] = await tx
        .select({
          id: ventasTable.id,
          numero_ticket: ventasTable.numero_ticket,
          total: ventasTable.total,
          anulada: ventasTable.anulada,
          apertura_caja_id: ventasTable.apertura_caja_id,
        })
        .from(ventasTable)
        .where(eq(ventasTable.id, id));
      if (!venta) throw Object.assign(new Error("Venta no encontrada"), { status: 404 });
      if (venta.anulada) throw Object.assign(new Error("Esta venta ya fue anulada"), { status: 400 });

      const [devolucion] = await tx
        .select({ id: devolucionesTable.id })
        .from(devolucionesTable)
        .where(eq(devolucionesTable.venta_id, id))
        .limit(1);
      if (devolucion) {
        throw Object.assign(new Error("No se puede anular una venta que ya tiene devoluciones. Usa la devolución en su lugar."), { status: 400 });
      }

      if (!venta.apertura_caja_id) {
        throw Object.assign(new Error("No se puede anular una venta sin una caja asociada. Usa la devolución en su lugar."), { status: 400 });
      }
      const [apertura] = await tx
        .select({ cierre_id: aperturasCajaTable.cierre_id })
        .from(aperturasCajaTable)
        .where(eq(aperturasCajaTable.id, venta.apertura_caja_id))
        .limit(1);
      if (!apertura || apertura.cierre_id !== null) {
        throw Object.assign(new Error("No se puede anular una venta de una caja ya cerrada. Usa la devolución en su lugar."), { status: 400 });
      }

      const detalles = await tx.select().from(detalleVentaTable).where(eq(detalleVentaTable.venta_id, id));
      for (const line of detalles) {
        await tx
          .update(productosTable)
          .set({ stock: sql`${productosTable.stock} + ${line.cantidad}` })
          .where(eq(productosTable.id, line.producto_id!));
      }
      await tx.update(ventasTable).set({
        anulada: true,
        anulada_por_usuario: (req as any).session.userId,
        fecha_anulacion: new Date(),
      }).where(and(eq(ventasTable.id, id), eq(ventasTable.anulada, false)));

      await tx.insert(auditoriaTable).values({
        usuario_id: (req as any).session.userId,
        accion: "anulacion_venta",
        entidad: "venta",
        entidad_id: id,
        detalle: `Anulación de venta #${venta.numero_ticket}`,
        monto: venta.total,
      });
    }, { behavior: "immediate" });
  } catch (error: any) {
    res.status(typeof error?.status === "number" ? error.status : 400)
      .json({ error: error?.message ?? "No se pudo anular la venta" });
    return;
  }

  res.json({ ok: true });
});

export default router;
