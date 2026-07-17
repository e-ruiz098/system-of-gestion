import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, ventasTable, detalleVentaTable, productosTable, usuariosTable } from "@workspace/db";

const router: IRouter = Router();

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

router.get("/ventas", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { fecha_desde, fecha_hasta, usuario_id, producto_id } = req.query as Record<string, string>;

  const rows = await db
    .select({
      id: ventasTable.id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: ventasTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      apertura_caja_id: ventasTable.apertura_caja_id,
      total: ventasTable.total,
      metodo_pago: ventasTable.metodo_pago,
      detalle_pago_mixto: ventasTable.detalle_pago_mixto,
      fecha: ventasTable.fecha,
      anulada: ventasTable.anulada,
    })
    .from(ventasTable)
    .leftJoin(usuariosTable, eq(ventasTable.usuario_id, usuariosTable.id))
    .where(
      and(
        fecha_desde ? gte(ventasTable.fecha, new Date(fecha_desde)) : undefined,
        fecha_hasta ? lte(ventasTable.fecha, new Date(fecha_hasta)) : undefined,
        usuario_id ? eq(ventasTable.usuario_id, parseInt(usuario_id, 10)) : undefined,
        producto_id
          ? sql`EXISTS (SELECT 1 FROM detalle_venta dv WHERE dv.venta_id = ${ventasTable.id} AND dv.producto_id = ${parseInt(producto_id, 10)})`
          : undefined,
      )
    )
    .orderBy(desc(ventasTable.fecha));

  res.json(rows.map(r => ({ ...r, fecha: r.fecha.toISOString() })));
});

router.post("/ventas", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const { apertura_caja_id, total, metodo_pago, detalle_pago_mixto, detalle } = req.body ?? {};
  if (!total || !metodo_pago || !Array.isArray(detalle) || detalle.length === 0) {
    res.status(400).json({ error: "total, metodo_pago and detalle are required" });
    return;
  }

  // Get next ticket number
  const [maxTicket] = await db.select({ max: sql<number>`COALESCE(MAX(numero_ticket), 0)` }).from(ventasTable);
  const numero_ticket = (maxTicket?.max ?? 0) + 1;

  const [venta] = await db.insert(ventasTable).values({
    numero_ticket,
    usuario_id: (req as any).session.userId,
    apertura_caja_id: apertura_caja_id ?? null,
    total,
    metodo_pago,
    detalle_pago_mixto: detalle_pago_mixto ?? null,
    anulada: false,
  }).returning();

  // Insert detail lines and update stock
  for (const line of detalle) {
    await db.insert(detalleVentaTable).values({
      venta_id: venta.id,
      producto_id: line.producto_id,
      cantidad: line.cantidad,
      precio_unitario: line.precio_unitario,
      subtotal: line.subtotal,
    });
    // Deduct stock
    await db
      .update(productosTable)
      .set({ stock: sql`${productosTable.stock} - ${line.cantidad}` })
      .where(eq(productosTable.id, line.producto_id));
  }

  const [usuario] = await db.select({ nombre: usuariosTable.nombre }).from(usuariosTable).where(eq(usuariosTable.id, venta.usuario_id!));
  res.status(201).json({
    ...venta,
    fecha: venta.fecha.toISOString(),
    usuario_nombre: usuario?.nombre ?? null,
  });
});

router.get("/ventas/:id", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [venta] = await db
    .select({
      id: ventasTable.id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: ventasTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      apertura_caja_id: ventasTable.apertura_caja_id,
      total: ventasTable.total,
      metodo_pago: ventasTable.metodo_pago,
      detalle_pago_mixto: ventasTable.detalle_pago_mixto,
      fecha: ventasTable.fecha,
      anulada: ventasTable.anulada,
    })
    .from(ventasTable)
    .leftJoin(usuariosTable, eq(ventasTable.usuario_id, usuariosTable.id))
    .where(eq(ventasTable.id, id));

  if (!venta) {
    res.status(404).json({ error: "Venta not found" });
    return;
  }

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
    .where(eq(detalleVentaTable.venta_id, id));

  res.json({
    ...venta,
    fecha: venta.fecha.toISOString(),
    detalle: detalles,
  });
});

router.delete("/ventas/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  // Restore stock
  const detalles = await db.select().from(detalleVentaTable).where(eq(detalleVentaTable.venta_id, id));
  for (const line of detalles) {
    await db
      .update(productosTable)
      .set({ stock: sql`${productosTable.stock} + ${line.cantidad}` })
      .where(eq(productosTable.id, line.producto_id!));
  }

  await db.update(ventasTable).set({ anulada: true }).where(eq(ventasTable.id, id));
  res.json({ ok: true });
});

export default router;
