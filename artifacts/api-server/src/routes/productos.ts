import { Router, type IRouter } from "express";
import { eq, and, or, like, lte, sql } from "drizzle-orm";
import { db, productosTable, categoriasTable, configuracionTable, detalleVentaTable } from "@workspace/db";

const router: IRouter = Router();

// ── Aliases for the two categorias joins ──────────────────────────────────────
// We need to join categoriasTable twice (once for categoria, once for subcategoria).
// Drizzle supports aliased table references via .as()
import { alias } from "drizzle-orm/sqlite-core";
const subcategoriasTable = alias(categoriasTable, "subcategorias");

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

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
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

// ── GET /productos ─────────────────────────────────────────────────────────────
// Params:
//   q             — search by name or code
//   categoria_id  — filter by main category (exact match on categoria_id column)
//   subcategoria_id — filter by subcategory (only when categoria_id also provided)
//   activo        — "true" | "false"
//   stock_bajo    — "true"
router.get("/productos", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;

  const { q, categoria_id, subcategoria_id, activo, stock_bajo } = req.query as Record<string, string>;
  const umbral = await getStockUmbral();

  let catId: number | undefined;
  if (categoria_id !== undefined && categoria_id !== "") {
    catId = parseInt(categoria_id, 10);
    if (Number.isNaN(catId) || catId <= 0) {
      res.status(400).json({ error: "categoria_id inválido" }); return;
    }
  }

  let subCatId: number | undefined;
  if (subcategoria_id !== undefined && subcategoria_id !== "") {
    subCatId = parseInt(subcategoria_id, 10);
    if (Number.isNaN(subCatId) || subCatId <= 0) {
      res.status(400).json({ error: "subcategoria_id inválido" }); return;
    }
  }

  const search = q && typeof q === "string" ? q.slice(0, 200) : undefined;

  const rows = await db
    .select({
      id: productosTable.id,
      codigo: productosTable.codigo,
      nombre: productosTable.nombre,
      precio: productosTable.precio,
      costo: productosTable.costo,
      stock: productosTable.stock,
      stock_minimo: productosTable.stock_minimo,
      unidad_tipo: productosTable.unidad_tipo,
      categoria_id: productosTable.categoria_id,
      categoria_nombre: categoriasTable.nombre,
      subcategoria_id: productosTable.subcategoria_id,
      subcategoria_nombre: subcategoriasTable.nombre,
      activo: productosTable.activo,
      imagen: productosTable.imagen,
      creado_en: productosTable.creado_en,
    })
    .from(productosTable)
    .leftJoin(categoriasTable,    eq(productosTable.categoria_id,    categoriasTable.id))
    .leftJoin(subcategoriasTable, eq(productosTable.subcategoria_id, subcategoriasTable.id))
    .where(
      and(
        activo !== undefined ? eq(productosTable.activo, activo === "true") : undefined,
        search   ? or(like(productosTable.nombre, `%${search}%`), like(productosTable.codigo, `%${search}%`)) : undefined,
        catId    ? eq(productosTable.categoria_id,    catId)    : undefined,
        subCatId ? eq(productosTable.subcategoria_id, subCatId) : undefined,
        stock_bajo === "true"
          ? lte(productosTable.stock, sql`COALESCE(${productosTable.stock_minimo}, ${umbral})`)
          : undefined,
      )
    )
    .orderBy(productosTable.nombre);

  res.json(rows.map(r => ({
    ...r,
    creado_en: r.creado_en.toISOString(),
    stock_estado: stockEstado(r.stock, r.stock_minimo, umbral),
    costo: (req as any).session?.rol === "admin" ? r.costo : undefined,
  })));
});

// ── POST /productos ────────────────────────────────────────────────────────────
router.post("/productos", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const { codigo, nombre, precio, costo, stock, stock_minimo, categoria_id, subcategoria_id, imagen } = req.body ?? {};

  // ── Validate codigo — always treated as string, never coerced to number ──
  let codigoFinal: string | null = null;
  if (codigo !== undefined && codigo !== null && codigo !== "") {
    if (typeof codigo !== "string") {
      res.status(400).json({ error: "El código de barras debe ser texto" }); return;
    }
    const trimmed = codigo.trim();
    if (trimmed.length > 100) {
      res.status(400).json({ error: "El código es demasiado largo (máximo 100 caracteres)" }); return;
    }
    codigoFinal = trimmed.length > 0 ? trimmed : null;
  }

  if (!nombre || precio == null || stock == null) {
    res.status(400).json({ error: "nombre, precio and stock are required" }); return;
  }
  if (typeof nombre !== "string" || nombre.trim().length === 0 || nombre.length > 200) {
    res.status(400).json({ error: "nombre inválido" }); return;
  }
  const precioN = Number(precio);
  const stockN  = Number(stock);
  if (!Number.isFinite(precioN) || precioN < 0) { res.status(400).json({ error: "precio inválido" }); return; }
  if (!Number.isFinite(stockN)  || stockN  < 0) { res.status(400).json({ error: "stock inválido" }); return; }

  const catIdN    = categoria_id    != null ? parseInt(categoria_id,    10) : null;
  const subCatIdN = subcategoria_id != null ? parseInt(subcategoria_id, 10) : null;

  // ── Duplicate barcode validation ──
  if (codigoFinal) {
    const [existing] = await db
      .select({ id: productosTable.id, nombre: productosTable.nombre })
      .from(productosTable)
      .where(eq(productosTable.codigo, codigoFinal));
    if (existing) {
      res.status(409).json({ error: "Ese código de barras ya está registrado" });
      return;
    }
  }

  try {
    const [p] = await db.insert(productosTable).values({
      codigo:          codigoFinal,
      nombre:          nombre.trim(),
      precio:          precioN,
      costo:           costo  != null ? Number(costo) : null,
      stock:           stockN,
      stock_minimo:    stock_minimo != null ? Number(stock_minimo) : null,
      categoria_id:    catIdN,
      subcategoria_id: subCatIdN,
      activo:          true,
      imagen:          imagen ?? null,
    }).returning();

    const umbral = await getStockUmbral();
    const [cat]    = catIdN    ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, catIdN)) : [{ nombre: null }];
    const [subcat] = subCatIdN ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, subCatIdN)) : [{ nombre: null }];

    res.status(201).json({
      ...p,
      creado_en:          p.creado_en.toISOString(),
      categoria_nombre:   cat?.nombre    ?? null,
      subcategoria_nombre: subcat?.nombre ?? null,
      stock_estado:       stockEstado(p.stock, p.stock_minimo, umbral),
    });
  } catch (err: any) {
    if (
      err?.message?.includes("UNIQUE constraint failed") ||
      err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      err?.code === "SQLITE_CONSTRAINT"
    ) {
      res.status(409).json({ error: "Ese código de barras ya está registrado" });
      return;
    }
    throw err;
  }
});

// ── GET /productos/import ──────────────────────────────────────────────────────
router.get("/productos/import", async (_req, res): Promise<void> => {
  res.json({ ok: true });
});

// ── POST /productos/import ─────────────────────────────────────────────────────
router.post("/productos/import", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { rows } = req.body ?? {};
  if (!Array.isArray(rows)) { res.status(400).json({ error: "rows must be an array" }); return; }
  if (rows.length > 5000)   { res.status(400).json({ error: "Máximo 5000 filas por importación" }); return; }

  let created = 0, updated = 0, errors = 0;
  for (const row of rows) {
    try {
      const { codigo, nombre, precio, costo, stock, categoria } = row;
      if (!nombre || typeof nombre !== "string" || precio == null) { errors++; continue; }
      const precioN = Number(precio);
      if (!Number.isFinite(precioN) || precioN < 0) { errors++; continue; }

      let categoria_id: number | null = null;
      if (categoria && typeof categoria === "string") {
        const [cat] = await db.select().from(categoriasTable).where(eq(categoriasTable.nombre, categoria));
        if (cat) {
          categoria_id = cat.id;
        } else {
          const [newCat] = await db.insert(categoriasTable).values({ nombre: categoria.slice(0, 100) }).returning();
          categoria_id = newCat.id;
        }
      }

      if (codigo && typeof codigo === "string") {
        const [existing] = await db.select().from(productosTable).where(eq(productosTable.codigo, codigo));
        if (existing) {
          await db.update(productosTable)
            .set({ nombre: nombre.trim(), precio: precioN, costo: costo != null ? Number(costo) : null, stock: stock ?? existing.stock, categoria_id })
            .where(eq(productosTable.id, existing.id));
          updated++; continue;
        }
      }
      await db.insert(productosTable).values({
        codigo: codigo ?? null, nombre: nombre.trim().slice(0, 200),
        precio: precioN, costo: costo != null ? Number(costo) : null,
        stock: stock ?? 0, categoria_id, activo: true,
      });
      created++;
    } catch { errors++; }
  }
  res.json({ created, updated, errors });
});

// ── GET /productos/:id ─────────────────────────────────────────────────────────
router.get("/productos/:id", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

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
      unidad_tipo: productosTable.unidad_tipo,
      categoria_id: productosTable.categoria_id,
      categoria_nombre: categoriasTable.nombre,
      subcategoria_id: productosTable.subcategoria_id,
      subcategoria_nombre: subcategoriasTable.nombre,
      activo: productosTable.activo,
      imagen: productosTable.imagen,
      creado_en: productosTable.creado_en,
    })
    .from(productosTable)
    .leftJoin(categoriasTable,    eq(productosTable.categoria_id,    categoriasTable.id))
    .leftJoin(subcategoriasTable, eq(productosTable.subcategoria_id, subcategoriasTable.id))
    .where(eq(productosTable.id, id));

  if (!p) { res.status(404).json({ error: "Product not found" }); return; }
  res.json({
    ...p,
    creado_en: p.creado_en.toISOString(),
    stock_estado: stockEstado(p.stock, p.stock_minimo, umbral),
    costo: (req as any).session?.rol === "admin" ? p.costo : undefined,
  });
});

// ── PUT /productos/:id ─────────────────────────────────────────────────────────
router.put("/productos/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const { codigo, nombre, precio, costo, stock, stock_minimo, categoria_id, subcategoria_id, activo, imagen } = req.body ?? {};
  const updates: Record<string, unknown> = {};

  if (codigo !== undefined) {
    if (codigo === null || codigo === "") {
      updates.codigo = null;
    } else {
      if (typeof codigo !== "string") {
        res.status(400).json({ error: "El código de barras debe ser texto" }); return;
      }
      const trimmed = codigo.trim();
      if (trimmed.length > 100) {
        res.status(400).json({ error: "El código es demasiado largo (máximo 100 caracteres)" }); return;
      }
      const codigoFinal = trimmed.length > 0 ? trimmed : null;
      if (codigoFinal) {
        const [existing] = await db
          .select({ id: productosTable.id })
          .from(productosTable)
          .where(and(eq(productosTable.codigo, codigoFinal), sql`${productosTable.id} != ${id}`));
        if (existing) {
          res.status(409).json({ error: "Ese código de barras ya está registrado" });
          return;
        }
      }
      updates.codigo = codigoFinal;
    }
  }
  if (nombre != null) {
    if (typeof nombre !== "string" || nombre.trim().length === 0 || nombre.length > 200) {
      res.status(400).json({ error: "nombre inválido" }); return;
    }
    updates.nombre = nombre.trim();
  }
  if (precio != null) {
    const v = Number(precio);
    if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: "precio inválido" }); return; }
    updates.precio = v;
  }
  if (costo !== undefined)         updates.costo          = costo != null ? Number(costo) : null;
  if (stock != null) {
    const v = Number(stock);
    if (!Number.isFinite(v) || v < 0) { res.status(400).json({ error: "stock inválido" }); return; }
    updates.stock = v;
  }
  if (stock_minimo   !== undefined) updates.stock_minimo   = stock_minimo != null ? Number(stock_minimo) : null;
  if (categoria_id   !== undefined) updates.categoria_id   = categoria_id   != null ? parseInt(categoria_id,   10) : null;
  if (subcategoria_id !== undefined) updates.subcategoria_id = subcategoria_id != null ? parseInt(subcategoria_id, 10) : null;
  if (activo  != null)              updates.activo         = Boolean(activo);
  if (imagen  !== undefined)        updates.imagen         = imagen;

  try {
    const [p] = await db.update(productosTable).set(updates).where(eq(productosTable.id, id)).returning();
    if (!p) { res.status(404).json({ error: "Product not found" }); return; }

    const umbral = await getStockUmbral();
    const [cat]    = p.categoria_id    ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, p.categoria_id))    : [{ nombre: null }];
    const [subcat] = p.subcategoria_id ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, p.subcategoria_id)) : [{ nombre: null }];

    res.json({
      ...p,
      creado_en:           p.creado_en.toISOString(),
      categoria_nombre:    cat?.nombre    ?? null,
      subcategoria_nombre: subcat?.nombre ?? null,
      stock_estado:        stockEstado(p.stock, p.stock_minimo, umbral),
    });
  } catch (err: any) {
    if (
      err?.message?.includes("UNIQUE constraint failed") ||
      err?.code === "SQLITE_CONSTRAINT_UNIQUE" ||
      err?.code === "SQLITE_CONSTRAINT"
    ) {
      res.status(409).json({ error: "Ese código de barras ya está registrado" });
      return;
    }
    throw err;
  }
});

// ── DELETE /productos/:id ──────────────────────────────────────────────────────
router.delete("/productos/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const [hasSales] = await db.select({ id: detalleVentaTable.id }).from(detalleVentaTable).where(eq(detalleVentaTable.producto_id, id)).limit(1);
  if (hasSales) {
    await db.update(productosTable).set({ activo: false }).where(eq(productosTable.id, id));
    res.json({ action: "deactivated", message: "Product has sales history; deactivated instead of deleted" });
    return;
  }
  await db.delete(productosTable).where(eq(productosTable.id, id));
  res.json({ action: "deleted", message: "Product deleted" });
});

// ── PATCH /productos/:id/toggle-activo ─────────────────────────────────────────
router.patch("/productos/:id/toggle-activo", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const [current] = await db.select({ activo: productosTable.activo }).from(productosTable).where(eq(productosTable.id, id));
  if (!current) { res.status(404).json({ error: "Product not found" }); return; }

  const [p] = await db.update(productosTable).set({ activo: !current.activo }).where(eq(productosTable.id, id)).returning();
  const umbral = await getStockUmbral();
  const [cat] = p.categoria_id ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, p.categoria_id)) : [{ nombre: null }];

  res.json({
    ...p,
    creado_en:        p.creado_en.toISOString(),
    categoria_nombre: cat?.nombre ?? null,
    stock_estado:     stockEstado(p.stock, p.stock_minimo, umbral),
  });
});

export default router;
