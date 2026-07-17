import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, devolucionesTable, detalleDevolucionTable, productosTable, usuariosTable, ventasTable } from "@workspace/db";

const router: IRouter = Router();

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

router.get("/devoluciones", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const { fecha_desde, fecha_hasta } = req.query as Record<string, string>;

  const rows = await db
    .select({
      id: devolucionesTable.id,
      venta_id: devolucionesTable.venta_id,
      numero_ticket: ventasTable.numero_ticket,
      usuario_id: devolucionesTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      motivo: devolucionesTable.motivo,
      fecha: devolucionesTable.fecha,
    })
    .from(devolucionesTable)
    .leftJoin(usuariosTable, eq(devolucionesTable.usuario_id, usuariosTable.id))
    .leftJoin(ventasTable, eq(devolucionesTable.venta_id, ventasTable.id))
    .where(
      and(
        fecha_desde ? gte(devolucionesTable.fecha, new Date(fecha_desde)) : undefined,
        fecha_hasta ? lte(devolucionesTable.fecha, new Date(fecha_hasta)) : undefined,
      )
    )
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
      })
      .from(detalleDevolucionTable)
      .leftJoin(productosTable, eq(detalleDevolucionTable.producto_id, productosTable.id))
      .where(eq(detalleDevolucionTable.devolucion_id, row.id));
    result.push({ ...row, fecha: row.fecha.toISOString(), detalle: detalles });
  }

  res.json(result);
});

router.post("/devoluciones", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const { venta_id, motivo, detalle } = req.body ?? {};
  if (!venta_id || !Array.isArray(detalle) || detalle.length === 0) {
    res.status(400).json({ error: "venta_id and detalle are required" });
    return;
  }

  const [dev] = await db.insert(devolucionesTable).values({
    venta_id,
    usuario_id: (req as any).session.userId,
    motivo: motivo ?? null,
  }).returning();

  const detallesResult = [];
  for (const line of detalle) {
    const [d] = await db.insert(detalleDevolucionTable).values({
      devolucion_id: dev.id,
      producto_id: line.producto_id,
      cantidad: line.cantidad,
    }).returning();
    // Restore stock
    await db
      .update(productosTable)
      .set({ stock: sql`${productosTable.stock} + ${line.cantidad}` })
      .where(eq(productosTable.id, line.producto_id));
    const [prod] = await db.select({ nombre: productosTable.nombre }).from(productosTable).where(eq(productosTable.id, line.producto_id));
    detallesResult.push({ ...d, producto_nombre: prod?.nombre ?? null });
  }

  const [venta] = await db.select({ numero_ticket: ventasTable.numero_ticket }).from(ventasTable).where(eq(ventasTable.id, venta_id));
  const [usuario] = await db.select({ nombre: usuariosTable.nombre }).from(usuariosTable).where(eq(usuariosTable.id, dev.usuario_id!));

  res.status(201).json({
    ...dev,
    fecha: dev.fecha.toISOString(),
    numero_ticket: venta?.numero_ticket ?? null,
    usuario_nombre: usuario?.nombre ?? null,
    detalle: detallesResult,
  });
});

export default router;
