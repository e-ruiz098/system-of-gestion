import { Router, type IRouter } from "express";
import { and, gte, eq, lte, isNull, desc, sql, count, sum } from "drizzle-orm";
import {
  db, ventasTable, productosTable, configuracionTable,
  detalleVentaTable, aperturasCajaTable, usuariosTable,
} from "@workspace/db";

const router: IRouter = Router();

function requireAdmin(req: any, res: any): boolean {
  if (req.session?.rol !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

function requireAuth(req: any, res: any): boolean {
  if (!req.session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return false;
  }
  return true;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

router.get("/dashboard", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);

  const [config] = await db.select({ umbral: configuracionTable.stock_bajo_umbral_global }).from(configuracionTable);
  const umbral = config?.umbral ?? 5;

  const [ventasHoy] = await db
    .select({ cnt: count(), total: sum(ventasTable.total) })
    .from(ventasTable)
    .where(and(gte(ventasTable.fecha, todayStart), eq(ventasTable.anulada, false)));

  const [ventasMes] = await db
    .select({ cnt: count(), total: sum(ventasTable.total) })
    .from(ventasTable)
    .where(and(gte(ventasTable.fecha, monthStart), eq(ventasTable.anulada, false)));

  const [productosActivos] = await db
    .select({ cnt: count() })
    .from(productosTable)
    .where(eq(productosTable.activo, true));

  const [agotados] = await db
    .select({ cnt: count() })
    .from(productosTable)
    .where(and(eq(productosTable.activo, true), eq(productosTable.stock, 0)));

  const [stockBajo] = await db
    .select({ cnt: count() })
    .from(productosTable)
    .where(and(
      eq(productosTable.activo, true),
      sql`${productosTable.stock} > 0 AND ${productosTable.stock} <= COALESCE(${productosTable.stock_minimo}, ${umbral})`,
    ));

  // Check active caja for current user
  const [cajaActiva] = await db
    .select({ id: aperturasCajaTable.id })
    .from(aperturasCajaTable)
    .where(and(
      eq(aperturasCajaTable.usuario_id, (req as any).session.userId),
      isNull(aperturasCajaTable.cierre_id),
    ))
    .limit(1);

  res.json({
    ventas_hoy: ventasHoy?.cnt ?? 0,
    ingresos_hoy: parseFloat(String(ventasHoy?.total ?? 0)),
    ventas_mes: ventasMes?.cnt ?? 0,
    ingresos_mes: parseFloat(String(ventasMes?.total ?? 0)),
    productos_activos: productosActivos?.cnt ?? 0,
    productos_stock_bajo: stockBajo?.cnt ?? 0,
    productos_agotados: agotados?.cnt ?? 0,
    caja_activa: !!cajaActiva,
  });
});

router.get("/dashboard/ventas-por-dia", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const rows = await db
    .select({
      fecha: sql<string>`DATE(${ventasTable.fecha})`,
      total_ventas: count(),
      ingresos: sum(ventasTable.total),
    })
    .from(ventasTable)
    .where(and(gte(ventasTable.fecha, thirtyDaysAgo), eq(ventasTable.anulada, false)))
    .groupBy(sql`DATE(${ventasTable.fecha})`)
    .orderBy(sql`DATE(${ventasTable.fecha})`);

  res.json(rows.map(r => ({
    fecha: r.fecha,
    total_ventas: r.total_ventas,
    ingresos: parseFloat(String(r.ingresos ?? 0)),
  })));
});

router.get("/dashboard/productos-top", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const rows = await db
    .select({
      producto_id: detalleVentaTable.producto_id,
      nombre: productosTable.nombre,
      cantidad_vendida: sum(detalleVentaTable.cantidad),
      ingresos: sum(detalleVentaTable.subtotal),
    })
    .from(detalleVentaTable)
    .leftJoin(productosTable, eq(detalleVentaTable.producto_id, productosTable.id))
    .leftJoin(ventasTable, eq(detalleVentaTable.venta_id, ventasTable.id))
    .where(and(gte(ventasTable.fecha, thirtyDaysAgo), eq(ventasTable.anulada, false)))
    .groupBy(detalleVentaTable.producto_id, productosTable.nombre)
    .orderBy(desc(sum(detalleVentaTable.cantidad)))
    .limit(10);

  res.json(rows.map(r => ({
    producto_id: r.producto_id,
    nombre: r.nombre ?? "",
    cantidad_vendida: parseInt(String(r.cantidad_vendida ?? 0)),
    ingresos: parseFloat(String(r.ingresos ?? 0)),
  })));
});

router.get("/dashboard/stock-alerta", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const [config] = await db.select({ umbral: configuracionTable.stock_bajo_umbral_global }).from(configuracionTable);
  const umbral = config?.umbral ?? 5;

  const agotados = await db
    .select({
      id: productosTable.id,
      codigo: productosTable.codigo,
      nombre: productosTable.nombre,
      precio: productosTable.precio,
      stock: productosTable.stock,
      stock_minimo: productosTable.stock_minimo,
      categoria_id: productosTable.categoria_id,
      activo: productosTable.activo,
      creado_en: productosTable.creado_en,
    })
    .from(productosTable)
    .where(and(eq(productosTable.activo, true), eq(productosTable.stock, 0)));

  const stockBajo = await db
    .select({
      id: productosTable.id,
      codigo: productosTable.codigo,
      nombre: productosTable.nombre,
      precio: productosTable.precio,
      stock: productosTable.stock,
      stock_minimo: productosTable.stock_minimo,
      categoria_id: productosTable.categoria_id,
      activo: productosTable.activo,
      creado_en: productosTable.creado_en,
    })
    .from(productosTable)
    .where(and(
      eq(productosTable.activo, true),
      sql`${productosTable.stock} > 0 AND ${productosTable.stock} <= COALESCE(${productosTable.stock_minimo}, ${umbral})`,
    ));

  const mapProd = (p: any) => ({
    ...p,
    costo: null,
    categoria_nombre: null,
    creado_en: p.creado_en.toISOString(),
    stock_estado: p.stock === 0 ? "rojo" : "amarillo",
  });

  res.json({ agotados: agotados.map(mapProd), stock_bajo: stockBajo.map(mapProd) });
});

export default router;
