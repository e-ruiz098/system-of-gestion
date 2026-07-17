import { Router, type IRouter } from "express";
import { eq, and, isNull, sum, count, sql, desc } from "drizzle-orm";
import {
  db, aperturasCajaTable, cierresCajaTable, ventasTable, usuariosTable,
  productosTable, configuracionTable,
} from "@workspace/db";

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

router.post("/caja/apertura", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const { fondo_inicial } = req.body ?? {};
  if (fondo_inicial == null) {
    res.status(400).json({ error: "fondo_inicial is required" });
    return;
  }

  // Check for existing open session for this user
  const [existing] = await db
    .select({ id: aperturasCajaTable.id })
    .from(aperturasCajaTable)
    .where(and(
      eq(aperturasCajaTable.usuario_id, (req as any).session.userId),
      isNull(aperturasCajaTable.cierre_id),
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Already has an open cash register" });
    return;
  }

  const [apertura] = await db.insert(aperturasCajaTable).values({
    usuario_id: (req as any).session.userId,
    fondo_inicial,
  }).returning();

  const [usuario] = await db.select({ nombre: usuariosTable.nombre }).from(usuariosTable).where(eq(usuariosTable.id, apertura.usuario_id!));

  res.status(201).json({
    ...apertura,
    fecha_apertura: apertura.fecha_apertura.toISOString(),
    usuario_nombre: usuario?.nombre ?? null,
  });
});

router.get("/caja/activa", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const [apertura] = await db
    .select()
    .from(aperturasCajaTable)
    .where(and(
      eq(aperturasCajaTable.usuario_id, (req as any).session.userId),
      isNull(aperturasCajaTable.cierre_id),
    ))
    .orderBy(desc(aperturasCajaTable.fecha_apertura))
    .limit(1);

  if (!apertura) {
    res.status(404).json({ error: "No active cash register" });
    return;
  }

  // Compute totals
  const ventasEnSesion = await db
    .select({ metodo_pago: ventasTable.metodo_pago, total: ventasTable.total })
    .from(ventasTable)
    .where(and(
      eq(ventasTable.apertura_caja_id, apertura.id),
      eq(ventasTable.anulada, false),
    ));

  let total_efectivo = 0, total_tarjeta = 0, total_transferencia = 0, total_ventas = 0;
  let cantidad_ventas = 0;
  for (const v of ventasEnSesion) {
    total_ventas += v.total;
    cantidad_ventas++;
    if (v.metodo_pago === "efectivo") total_efectivo += v.total;
    else if (v.metodo_pago === "tarjeta") total_tarjeta += v.total;
    else if (v.metodo_pago === "transferencia") total_transferencia += v.total;
    else if (v.metodo_pago === "mixto") {
      // Count all as efectivo for expected calculation - simplified
      total_efectivo += v.total;
    }
  }

  const total_esperado = apertura.fondo_inicial + total_efectivo;
  const [usuario] = await db.select({ nombre: usuariosTable.nombre }).from(usuariosTable).where(eq(usuariosTable.id, apertura.usuario_id!));

  res.json({
    apertura: {
      ...apertura,
      fecha_apertura: apertura.fecha_apertura.toISOString(),
      usuario_nombre: usuario?.nombre ?? null,
    },
    total_efectivo,
    total_tarjeta,
    total_transferencia,
    total_ventas,
    cantidad_ventas,
    total_esperado,
  });
});

router.post("/caja/cierre", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const { total_contado } = req.body ?? {};
  if (total_contado == null) {
    res.status(400).json({ error: "total_contado is required" });
    return;
  }

  const [apertura] = await db
    .select()
    .from(aperturasCajaTable)
    .where(and(
      eq(aperturasCajaTable.usuario_id, (req as any).session.userId),
      isNull(aperturasCajaTable.cierre_id),
    ))
    .limit(1);

  if (!apertura) {
    res.status(404).json({ error: "No active cash register to close" });
    return;
  }

  // Compute expected
  const ventasEnSesion = await db
    .select({ metodo_pago: ventasTable.metodo_pago, total: ventasTable.total })
    .from(ventasTable)
    .where(and(eq(ventasTable.apertura_caja_id, apertura.id), eq(ventasTable.anulada, false)));

  let total_efectivo = 0;
  for (const v of ventasEnSesion) {
    if (v.metodo_pago === "efectivo" || v.metodo_pago === "mixto") total_efectivo += v.total;
  }
  const total_esperado = apertura.fondo_inicial + total_efectivo;
  const diferencia = total_contado - total_esperado;

  // Snapshot stock
  const [config] = await db.select({ umbral: configuracionTable.stock_bajo_umbral_global }).from(configuracionTable);
  const umbral = config?.umbral ?? 5;
  const productos = await db.select({ id: productosTable.id, nombre: productosTable.nombre, stock: productosTable.stock, stock_minimo: productosTable.stock_minimo }).from(productosTable).where(eq(productosTable.activo, true));
  const snapshot = productos.map(p => ({
    id: p.id,
    nombre: p.nombre,
    stock: p.stock,
    estado: p.stock === 0 ? "rojo" : p.stock <= (p.stock_minimo ?? umbral) ? "amarillo" : "verde",
  }));

  const [cierre] = await db.insert(cierresCajaTable).values({
    apertura_caja_id: apertura.id,
    usuario_id: (req as any).session.userId,
    total_esperado,
    total_contado,
    diferencia,
    snapshot_stock: JSON.stringify(snapshot),
  }).returning();

  // Mark apertura as closed
  await db.update(aperturasCajaTable).set({ cierre_id: cierre.id }).where(eq(aperturasCajaTable.id, apertura.id));

  const [usuario] = await db.select({ nombre: usuariosTable.nombre }).from(usuariosTable).where(eq(usuariosTable.id, cierre.usuario_id!));

  res.status(201).json({
    ...cierre,
    fecha_cierre: cierre.fecha_cierre.toISOString(),
    usuario_nombre: usuario?.nombre ?? null,
    apertura: {
      ...apertura,
      fecha_apertura: apertura.fecha_apertura.toISOString(),
      usuario_nombre: usuario?.nombre ?? null,
    },
  });
});

router.get("/caja/cierres", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const cierres = await db
    .select({
      id: cierresCajaTable.id,
      apertura_caja_id: cierresCajaTable.apertura_caja_id,
      usuario_id: cierresCajaTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      total_esperado: cierresCajaTable.total_esperado,
      total_contado: cierresCajaTable.total_contado,
      diferencia: cierresCajaTable.diferencia,
      fecha_cierre: cierresCajaTable.fecha_cierre,
      snapshot_stock: cierresCajaTable.snapshot_stock,
    })
    .from(cierresCajaTable)
    .leftJoin(usuariosTable, eq(cierresCajaTable.usuario_id, usuariosTable.id))
    .orderBy(desc(cierresCajaTable.fecha_cierre));

  const result = [];
  for (const c of cierres) {
    const [ap] = await db.select().from(aperturasCajaTable).where(eq(aperturasCajaTable.id, c.apertura_caja_id!));
    result.push({
      ...c,
      fecha_cierre: c.fecha_cierre.toISOString(),
      apertura: ap ? { ...ap, fecha_apertura: ap.fecha_apertura.toISOString(), usuario_nombre: c.usuario_nombre } : null,
    });
  }
  res.json(result);
});

router.get("/caja/cierres/:id", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [c] = await db
    .select({
      id: cierresCajaTable.id,
      apertura_caja_id: cierresCajaTable.apertura_caja_id,
      usuario_id: cierresCajaTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      total_esperado: cierresCajaTable.total_esperado,
      total_contado: cierresCajaTable.total_contado,
      diferencia: cierresCajaTable.diferencia,
      fecha_cierre: cierresCajaTable.fecha_cierre,
      snapshot_stock: cierresCajaTable.snapshot_stock,
    })
    .from(cierresCajaTable)
    .leftJoin(usuariosTable, eq(cierresCajaTable.usuario_id, usuariosTable.id))
    .where(eq(cierresCajaTable.id, id));

  if (!c) {
    res.status(404).json({ error: "Cierre not found" });
    return;
  }
  const [ap] = await db.select().from(aperturasCajaTable).where(eq(aperturasCajaTable.id, c.apertura_caja_id!));
  res.json({
    ...c,
    fecha_cierre: c.fecha_cierre.toISOString(),
    apertura: ap ? { ...ap, fecha_apertura: ap.fecha_apertura.toISOString(), usuario_nombre: c.usuario_nombre } : null,
  });
});

export default router;
