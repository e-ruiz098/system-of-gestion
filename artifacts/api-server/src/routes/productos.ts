import { Router, type IRouter } from "express";
import { eq, and, or, ilike, lte, sql } from "drizzle-orm";
import { db, productosTable, categoriasTable, configuracionTable, detalleVentaTable } from "@workspace/db";

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

async function getStockUmbral(): Promise<number> {
  const [config] = await db.select({ umbral: configuracionTable.stock_bajo_umbral_global }).from(configuracionTable);
  return config?.umbral ?? 5;
}

function stockEstado(stock: number, minimo: number | null | undefined, umbral: number): "rojo" | "amarillo" | "verde" {
  if (stock === 0) return "rojo";
  const threshold = minimo ?? umbral;
  if (stock <= threshold) return "amarillo";
  return "verde";
}

router.get("/productos", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { q, categoria_id, activo, stock_bajo } = req.query as Record<string, string>;
  const umbral = await getStockUmbral();

  const rows = await db
    .select({
      id: productosTable.id,
      codigo: productosTable.codigo,
      nombre: productosTable.nombre,
      precio: productosTable.precio,
      costo: productosTable.costo,
      stock: productosTable.stock,
      stock_minimo: productosTable.stock_minimo,
      categoria_id: productosTable.categoria_id,
      categoria_nombre: categoriasTable.nombre,
      activo: productosTable.activo,
      creado_en: productosTable.creado_en,
    })
    .from(productosTable)
    .leftJoin(categoriasTable, eq(productosTable.categoria_id, categoriasTable.id))
    .where(
      and(
        activo !== undefined ? eq(productosTable.activo, activo === "true") : undefined,
        q ? or(ilike(productosTable.nombre, `%${q}%`), ilike(productosTable.codigo, `%${q}%`)) : undefined,
        categoria_id ? eq(productosTable.categoria_id, parseInt(categoria_id, 10)) : undefined,
        stock_bajo === "true"
          ? lte(productosTable.stock, sql`COALESCE(${productosTable.stock_minimo}, ${umbral})`)
          : undefined,
      )
    )
    .orderBy(productosTable.nombre);

  const result = rows.map(r => ({
    ...r,
    creado_en: r.creado_en.toISOString(),
    stock_estado: stockEstado(r.stock, r.stock_minimo, umbral),
    // Hide costo from vendedores
    costo: (req as any).session?.rol === "admin" ? r.costo : undefined,
  }));

  res.json(result);
});

router.post("/productos", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { codigo, nombre, precio, costo, stock, stock_minimo, categoria_id } = req.body ?? {};
  if (!nombre || precio == null || stock == null) {
    res.status(400).json({ error: "nombre, precio and stock are required" });
    return;
  }
  const [p] = await db.insert(productosTable).values({
    codigo: codigo ?? null,
    nombre,
    precio,
    costo: costo ?? null,
    stock,
    stock_minimo: stock_minimo ?? null,
    categoria_id: categoria_id ?? null,
    activo: true,
  }).returning();

  const umbral = await getStockUmbral();
  const [cat] = categoria_id
    ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, categoria_id))
    : [{ nombre: null }];

  res.status(201).json({
    ...p,
    creado_en: p.creado_en.toISOString(),
    categoria_nombre: cat?.nombre ?? null,
    stock_estado: stockEstado(p.stock, p.stock_minimo, umbral),
  });
});

router.get("/productos/import", async (_req, res): Promise<void> => {
  res.json({ ok: true });
});

router.post("/productos/import", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { rows } = req.body ?? {};
  if (!Array.isArray(rows)) {
    res.status(400).json({ error: "rows must be an array" });
    return;
  }
  let created = 0, updated = 0, errors = 0;
  for (const row of rows) {
    try {
      const { codigo, nombre, precio, costo, stock, categoria } = row;
      if (!nombre || precio == null) { errors++; continue; }

      // Find or create category
      let categoria_id = null;
      if (categoria) {
        const [cat] = await db.select().from(categoriasTable).where(eq(categoriasTable.nombre, categoria));
        if (cat) {
          categoria_id = cat.id;
        } else {
          const [newCat] = await db.insert(categoriasTable).values({ nombre: categoria }).returning();
          categoria_id = newCat.id;
        }
      }

      if (codigo) {
        const [existing] = await db.select().from(productosTable).where(eq(productosTable.codigo, codigo));
        if (existing) {
          await db.update(productosTable).set({ nombre, precio, costo: costo ?? null, stock: stock ?? existing.stock, categoria_id }).where(eq(productosTable.id, existing.id));
          updated++;
          continue;
        }
      }
      await db.insert(productosTable).values({ codigo: codigo ?? null, nombre, precio, costo: costo ?? null, stock: stock ?? 0, categoria_id, activo: true });
      created++;
    } catch {
      errors++;
    }
  }
  res.json({ created, updated, errors });
});

router.get("/productos/:id", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const umbral = await getStockUmbral();

  const [p] = await db
    .select({
      id: productosTable.id,
      codigo: productosTable.codigo,
      nombre: productosTable.nombre,
      precio: productosTable.precio,
      costo: productosTable.costo,
      stock: productosTable.stock,
      stock_minimo: productosTable.stock_minimo,
      categoria_id: productosTable.categoria_id,
      categoria_nombre: categoriasTable.nombre,
      activo: productosTable.activo,
      creado_en: productosTable.creado_en,
    })
    .from(productosTable)
    .leftJoin(categoriasTable, eq(productosTable.categoria_id, categoriasTable.id))
    .where(eq(productosTable.id, id));

  if (!p) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  res.json({
    ...p,
    creado_en: p.creado_en.toISOString(),
    stock_estado: stockEstado(p.stock, p.stock_minimo, umbral),
    costo: (req as any).session?.rol === "admin" ? p.costo : undefined,
  });
});

router.put("/productos/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { codigo, nombre, precio, costo, stock, stock_minimo, categoria_id, activo } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (codigo !== undefined) updates.codigo = codigo;
  if (nombre != null) updates.nombre = nombre;
  if (precio != null) updates.precio = precio;
  if (costo !== undefined) updates.costo = costo;
  if (stock != null) updates.stock = stock;
  if (stock_minimo !== undefined) updates.stock_minimo = stock_minimo;
  if (categoria_id !== undefined) updates.categoria_id = categoria_id;
  if (activo != null) updates.activo = activo;

  const [p] = await db.update(productosTable).set(updates).where(eq(productosTable.id, id)).returning();
  if (!p) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const umbral = await getStockUmbral();
  const [cat] = p.categoria_id
    ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, p.categoria_id))
    : [{ nombre: null }];
  res.json({
    ...p,
    creado_en: p.creado_en.toISOString(),
    categoria_nombre: cat?.nombre ?? null,
    stock_estado: stockEstado(p.stock, p.stock_minimo, umbral),
  });
});

router.delete("/productos/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  // Check if product has sales history
  const [hasSales] = await db.select({ id: detalleVentaTable.id }).from(detalleVentaTable).where(eq(detalleVentaTable.producto_id, id)).limit(1);
  if (hasSales) {
    await db.update(productosTable).set({ activo: false }).where(eq(productosTable.id, id));
    res.json({ action: "deactivated", message: "Product has sales history; deactivated instead of deleted" });
    return;
  }
  await db.delete(productosTable).where(eq(productosTable.id, id));
  res.json({ action: "deleted", message: "Product deleted" });
});

router.patch("/productos/:id/toggle-activo", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const [current] = await db.select({ activo: productosTable.activo }).from(productosTable).where(eq(productosTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Product not found" });
    return;
  }
  const [p] = await db.update(productosTable).set({ activo: !current.activo }).where(eq(productosTable.id, id)).returning();
  const umbral = await getStockUmbral();
  const [cat] = p.categoria_id
    ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, p.categoria_id))
    : [{ nombre: null }];
  res.json({
    ...p,
    creado_en: p.creado_en.toISOString(),
    categoria_nombre: cat?.nombre ?? null,
    stock_estado: stockEstado(p.stock, p.stock_minimo, umbral),
  });
});

export default router;
