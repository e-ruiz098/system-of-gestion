import { Router, type IRouter } from "express";
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import {
  db, aperturasCajaTable, cierresCajaTable, ventasTable, usuariosTable,
  productosTable, configuracionTable, devolucionesTable, montosVenta,
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

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = Number(s);
  return !Number.isSafeInteger(n) || n <= 0 ? null : n;
}


router.post("/caja/apertura", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { fondo_inicial } = req.body ?? {};
  if (fondo_inicial == null) {
    res.status(400).json({ error: "fondo_inicial is required" });
    return;
  }
  const fondoN = Number(fondo_inicial);
  if (!Number.isSafeInteger(fondoN) || fondoN < 0) {
    res.status(400).json({ error: "fondo_inicial debe ser un número positivo" });
    return;
  }

  const [existing] = await db
    .select({ id: aperturasCajaTable.id })
    .from(aperturasCajaTable)
    .where(and(
      eq(aperturasCajaTable.usuario_id, (req as any).session.userId),
      isNull(aperturasCajaTable.cierre_id),
    ))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Ya tienes una caja abierta" });
    return;
  }

  const [apertura] = await db.insert(aperturasCajaTable).values({
    usuario_id: (req as any).session.userId,
    fondo_inicial: fondoN,
  }).returning();

  const [usuario] = await db
    .select({ nombre: usuariosTable.nombre })
    .from(usuariosTable)
    .where(eq(usuariosTable.id, apertura.usuario_id!));

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

  const ventasEnSesion = await db
    .select({ 
      metodo_pago: ventasTable.metodo_pago, 
      total: ventasTable.total, 
      ajuste_redondeo: ventasTable.ajuste_redondeo,
      monto_efectivo: ventasTable.monto_efectivo,
      monto_tarjeta: ventasTable.monto_tarjeta,
      monto_transferencia: ventasTable.monto_transferencia,
    })
    .from(ventasTable)
    .where(and(
      eq(ventasTable.apertura_caja_id, apertura.id),
      eq(ventasTable.anulada, false),
    ));

  let total_efectivo = 0, total_tarjeta = 0, total_transferencia = 0, total_ventas = 0;
  let cantidad_ventas = 0;
  let suma_redondeos = 0;
  for (const v of ventasEnSesion) {
    total_ventas += v.total;
    cantidad_ventas++;
    suma_redondeos += v.ajuste_redondeo || 0;
    const montos = montosVenta(v);
    total_efectivo += montos.efectivo;
    total_tarjeta += montos.tarjeta;
    total_transferencia += montos.transferencia;
  }

  // Devoluciones en esta caja
  const devolucionesEnSesion = await db
    .select({
      metodo_reembolso: devolucionesTable.metodo_reembolso,
      total_reembolso: devolucionesTable.total_reembolso,
    })
    .from(devolucionesTable)
    .where(eq(devolucionesTable.apertura_caja_id, apertura.id));

  let total_reembolsado_efectivo = 0, total_reembolsado_tarjeta = 0, total_reembolsado_transferencia = 0;
  for (const d of devolucionesEnSesion) {
    if (d.metodo_reembolso === "efectivo") total_reembolsado_efectivo += d.total_reembolso || 0;
    if (d.metodo_reembolso === "tarjeta") total_reembolsado_tarjeta += d.total_reembolso || 0;
    if (d.metodo_reembolso === "transferencia") total_reembolsado_transferencia += d.total_reembolso || 0;
  }

  const total_esperado = apertura.fondo_inicial + total_efectivo - total_reembolsado_efectivo;
  const [usuario] = await db
    .select({ nombre: usuariosTable.nombre })
    .from(usuariosTable)
    .where(eq(usuariosTable.id, apertura.usuario_id!));

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
    suma_redondeos,
    total_reembolsado_efectivo,
    total_reembolsado_tarjeta,
    total_reembolsado_transferencia,
  });
});

router.post("/caja/cierre", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { total_contado } = req.body ?? {};
  if (total_contado == null) {
    res.status(400).json({ error: "total_contado is required" });
    return;
  }
  const totalContadoN = Number(total_contado);
  if (!Number.isSafeInteger(totalContadoN) || totalContadoN < 0) {
    res.status(400).json({ error: "total_contado debe ser un número positivo" });
    return;
  }

  let cierre: typeof cierresCajaTable.$inferSelect | undefined;
  let apertura: typeof aperturasCajaTable.$inferSelect | undefined;
  try {
    await db.transaction(async (tx) => {
      const [activeApertura] = await tx
        .select()
        .from(aperturasCajaTable)
        .where(and(
          eq(aperturasCajaTable.usuario_id, (req as any).session.userId),
          isNull(aperturasCajaTable.cierre_id),
        ))
        .orderBy(desc(aperturasCajaTable.fecha_apertura))
        .limit(1);
      if (!activeApertura) throw Object.assign(new Error("No active cash register to close"), { status: 404 });
      apertura = activeApertura;

      const ventasEnSesion = await tx
        .select({
          metodo_pago: ventasTable.metodo_pago,
          total: ventasTable.total,
          ajuste_redondeo: ventasTable.ajuste_redondeo,
          monto_efectivo: ventasTable.monto_efectivo,
          monto_tarjeta: ventasTable.monto_tarjeta,
          monto_transferencia: ventasTable.monto_transferencia,
        })
        .from(ventasTable)
        .where(and(eq(ventasTable.apertura_caja_id, activeApertura.id), eq(ventasTable.anulada, false)));

      let totalEfectivo = 0;
      let sumaRedondeos = 0;
      for (const v of ventasEnSesion) {
        totalEfectivo += montosVenta(v).efectivo;
        sumaRedondeos += v.ajuste_redondeo || 0;
      }

      const devolucionesEnSesion = await tx
        .select({ metodo_reembolso: devolucionesTable.metodo_reembolso, total_reembolso: devolucionesTable.total_reembolso })
        .from(devolucionesTable)
        .where(eq(devolucionesTable.apertura_caja_id, activeApertura.id));
      const totalReembolsadoEfectivo = devolucionesEnSesion
        .filter(d => d.metodo_reembolso === "efectivo")
        .reduce((sum, d) => sum + (d.total_reembolso || 0), 0);

      const totalEsperado = activeApertura.fondo_inicial + totalEfectivo - totalReembolsadoEfectivo;
      const [config] = await tx.select({ umbral: configuracionTable.stock_bajo_umbral_global }).from(configuracionTable);
      const umbral = config?.umbral ?? 5;
      const productos = await tx
        .select({ id: productosTable.id, nombre: productosTable.nombre, stock: productosTable.stock, stock_minimo: productosTable.stock_minimo })
        .from(productosTable)
        .where(eq(productosTable.activo, true));
      const snapshot = productos.map(p => ({
        id: p.id,
        nombre: p.nombre,
        stock: p.stock,
        estado: p.stock === 0 ? "rojo" : p.stock <= (p.stock_minimo ?? umbral) ? "amarillo" : "verde",
      }));

      const [inserted] = await tx.insert(cierresCajaTable).values({
        apertura_caja_id: activeApertura.id,
        usuario_id: (req as any).session.userId,
        total_esperado: totalEsperado,
        total_contado: totalContadoN,
        diferencia: totalContadoN - totalEsperado,
        suma_redondeos: sumaRedondeos,
        total_reembolsado_efectivo: totalReembolsadoEfectivo,
        snapshot_stock: JSON.stringify(snapshot),
      }).returning();
      cierre = inserted;
      await tx.update(aperturasCajaTable)
        .set({ cierre_id: inserted.id })
        .where(and(eq(aperturasCajaTable.id, activeApertura.id), isNull(aperturasCajaTable.cierre_id)));
    }, { behavior: "immediate" });
  } catch (error: any) {
    res.status(typeof error?.status === "number" ? error.status : 400)
      .json({ error: error?.message ?? "No se pudo cerrar la caja" });
    return;
  }

  if (!cierre || !apertura) {
    res.status(500).json({ error: "No se pudo cerrar la caja" });
    return;
  }

  const [usuario] = await db
    .select({ nombre: usuariosTable.nombre })
    .from(usuariosTable)
    .where(eq(usuariosTable.id, cierre!.usuario_id!));

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
      suma_redondeos: cierresCajaTable.suma_redondeos,
      total_reembolsado_efectivo: cierresCajaTable.total_reembolsado_efectivo,
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

  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const session = (req as any).session;

  const [c] = await db
    .select({
      id: cierresCajaTable.id,
      apertura_caja_id: cierresCajaTable.apertura_caja_id,
      usuario_id: cierresCajaTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      total_esperado: cierresCajaTable.total_esperado,
      total_contado: cierresCajaTable.total_contado,
      diferencia: cierresCajaTable.diferencia,
      suma_redondeos: cierresCajaTable.suma_redondeos,
      total_reembolsado_efectivo: cierresCajaTable.total_reembolsado_efectivo,
      fecha_cierre: cierresCajaTable.fecha_cierre,
      snapshot_stock: cierresCajaTable.snapshot_stock,
    })
    .from(cierresCajaTable)
    .leftJoin(usuariosTable, eq(cierresCajaTable.usuario_id, usuariosTable.id))
    .where(eq(cierresCajaTable.id, id));

  if (!c) { res.status(404).json({ error: "Cierre not found" }); return; }

  // Cashiers can only see their own closures; admins see all
  if (session.rol !== "admin" && c.usuario_id !== session.userId) {
    res.status(403).json({ error: "Acceso denegado" });
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
