import { Router, type IRouter } from "express";
import { eq, and, or, like, lte, sql } from "drizzle-orm";
import { db, productosTable, categoriasTable, configuracionTable, detalleVentaTable, movimientosStockTable, auditoriaTable, usuariosTable } from "@workspace/db";
import { alias } from "drizzle-orm/sqlite-core";

const router: IRouter = Router();

const subcategoriasTable = alias(categoriasTable, "subcategorias");

function requireAdmin(req: any, res: any): boolean {
  if ((req as any).session?.rol !== "admin") {
    res.status(403).json({ error: "Admin solo para esta operación" });
    return false;
  }
  return true;
}

function requireAuth(req: any, res: any): boolean {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return false;
  }
  return true;
}

function parseId(raw: string | string[]): number | null {
  const s = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(s, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

export function isDecimalAllowed(unidadTipo: string | null | undefined): boolean {
  if (!unidadTipo) return false;
  const t = unidadTipo.trim().toLowerCase();
  return t !== "unidad" && t !== "unidades" && t !== "u" && t !== "entero";
}

export function parseStrictNumber(val: any): { num: number; error?: string } {
  if (val === null || val === undefined) {
    return { num: NaN, error: "El valor no puede estar vacío." };
  }
  if (typeof val === "number") {
    if (!Number.isFinite(val)) return { num: NaN, error: "Número no válido." };
    return { num: val };
  }
  const str = String(val).trim();
  if (str === "") return { num: NaN, error: "El valor no puede estar vacío." };

  if (!/^-?\d+([.,]\d+)?$/.test(str)) {
    return { num: NaN, error: `El valor '${val}' no es válido. Use solo dígitos con un separador decimal opcional (ej. 12.4).` };
  }

  if (/^\d+[.,]\d{3}$/.test(str)) {
    return { num: NaN, error: `El formato '${val}' es ambiguo (puede interpretarse como mil o decimal). Escriba '1500' para mil quinientos o '1.5' para decimales.` };
  }

  const normalized = str.replace(",", ".");
  const num = parseFloat(normalized);
  if (!Number.isFinite(num)) {
    return { num: NaN, error: `El valor '${val}' no es un número válido.` };
  }
  return { num };
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

  const { codigo, nombre, precio, costo, stock, stock_minimo, unidad_tipo, categoria_id, subcategoria_id, imagen } = req.body ?? {};

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
    res.status(400).json({ error: "nombre, precio y stock son requeridos" }); return;
  }
  if (typeof nombre !== "string" || nombre.trim().length === 0 || nombre.length > 200) {
    res.status(400).json({ error: "nombre inválido" }); return;
  }

  const parsedPrecio = parseStrictNumber(precio);
  if (parsedPrecio.error || parsedPrecio.num < 0) {
    res.status(400).json({ error: parsedPrecio.error || "precio inválido" }); return;
  }

  const parsedStock = parseStrictNumber(stock);
  if (parsedStock.error || parsedStock.num < 0) {
    res.status(400).json({ error: parsedStock.error || "stock inválido" }); return;
  }

  const finalUnidadTipo = typeof unidad_tipo === "string" && unidad_tipo.trim() ? unidad_tipo.trim() : "unidad";

  if (!isDecimalAllowed(finalUnidadTipo) && parsedStock.num % 1 !== 0) {
    res.status(400).json({ error: `El producto '${nombre}' no admite cantidades decimales` });
    return;
  }

  const precioN = Math.round(parsedPrecio.num * 100) / 100;
  const stockN = Math.round(parsedStock.num * 1000) / 1000;

  const catIdN    = categoria_id    != null ? parseInt(categoria_id,    10) : null;
  const subCatIdN = subcategoria_id != null ? parseInt(subcategoria_id, 10) : null;

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
    const userId = (req as any).session.userId;

    const result = await db.transaction(async (tx) => {
      const [p] = await tx.insert(productosTable).values({
        codigo:          codigoFinal,
        nombre:          nombre.trim(),
        precio:          precioN,
        costo:           costo  != null ? Number(costo) : null,
        stock:           stockN,
        stock_minimo:    stock_minimo != null ? Number(stock_minimo) : null,
        unidad_tipo:     finalUnidadTipo,
        categoria_id:    catIdN,
        subcategoria_id: subCatIdN,
        activo:          true,
        imagen:          imagen ?? null,
      }).returning();

      if (stockN > 0) {
        await tx.insert(movimientosStockTable).values({
          producto_id: p.id,
          usuario_id: userId,
          tipo: "stock_inicial",
          motivo: "Alta de producto con stock inicial",
          stock_anterior: 0,
          renglones: JSON.stringify([stockN]),
          total_ingresado: stockN,
          stock_resultante: stockN,
        });

        await tx.insert(auditoriaTable).values({
          usuario_id: userId,
          accion: "stock_inicial",
          entidad: "producto",
          entidad_id: p.id,
          detalle: `Alta de producto con stock inicial: +${stockN}`,
          monto: stockN,
        });
      }

      return p;
    });

    const umbral = await getStockUmbral();
    const [cat]    = catIdN    ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, catIdN)) : [{ nombre: null }];
    const [subcat] = subCatIdN ? await db.select({ nombre: categoriasTable.nombre }).from(categoriasTable).where(eq(categoriasTable.id, subCatIdN)) : [{ nombre: null }];

    res.status(201).json({
      ...result,
      creado_en:          result.creado_en.toISOString(),
      categoria_nombre:   cat?.nombre    ?? null,
      subcategoria_nombre: subcat?.nombre ?? null,
      stock_estado:       stockEstado(result.stock, result.stock_minimo, umbral),
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
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "Error interno del servidor" : err?.message || "Error al crear producto" });
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
  if (!Array.isArray(rows)) { res.status(400).json({ error: "rows debe ser un arreglo" }); return; }
  if (rows.length > 5000)   { res.status(400).json({ error: "Máximo 5000 filas por importación" }); return; }

  const userId = (req as any).session.userId;
  let created = 0, updated = 0, errors = 0;

  for (const row of rows) {
    try {
      const { codigo, nombre, precio, costo, stock, categoria, unidad_tipo } = row;
      if (!nombre || typeof nombre !== "string" || precio == null) { errors++; continue; }

      const parsedPrecio = parseStrictNumber(precio);
      if (parsedPrecio.error || parsedPrecio.num < 0) { errors++; continue; }

      let stockN = 0;
      if (stock !== undefined && stock !== null) {
        const parsedStock = parseStrictNumber(stock);
        if (parsedStock.error || parsedStock.num < 0) { errors++; continue; }
        stockN = Math.round(parsedStock.num * 1000) / 1000;
      }

      const finalUnidadTipo = typeof unidad_tipo === "string" && unidad_tipo.trim() ? unidad_tipo.trim() : "unidad";
      if (!isDecimalAllowed(finalUnidadTipo) && stockN % 1 !== 0) {
        errors++; continue;
      }

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
          const stockDiff = Math.round((stockN - existing.stock) * 1000) / 1000;

          await db.update(productosTable)
            .set({ nombre: nombre.trim(), precio: parsedPrecio.num, costo: costo != null ? Number(costo) : null, stock: stockN, categoria_id, unidad_tipo: finalUnidadTipo })
            .where(eq(productosTable.id, existing.id));

          if (Math.abs(stockDiff) > 0.0001) {
            await db.insert(movimientosStockTable).values({
              producto_id: existing.id,
              usuario_id: userId,
              tipo: "ajuste",
              motivo: "Ajuste por importación de productos",
              stock_anterior: existing.stock,
              renglones: JSON.stringify([stockDiff]),
              total_ingresado: stockDiff,
              stock_resultante: stockN,
            });
          }
          updated++; continue;
        }
      }

      const [newProd] = await db.insert(productosTable).values({
        codigo: codigo ?? null, nombre: nombre.trim().slice(0, 200),
        precio: parsedPrecio.num, costo: costo != null ? Number(costo) : null,
        stock: stockN, unidad_tipo: finalUnidadTipo, categoria_id, activo: true,
      }).returning();

      if (stockN > 0) {
        await db.insert(movimientosStockTable).values({
          producto_id: newProd.id,
          usuario_id: userId,
          tipo: "stock_inicial",
          motivo: "Stock inicial por importación",
          stock_anterior: 0,
          renglones: JSON.stringify([stockN]),
          total_ingresado: stockN,
          stock_resultante: stockN,
        });
      }

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

  if (!p) { res.status(404).json({ error: "Producto no encontrado" }); return; }
  res.json({
    ...p,
    creado_en: p.creado_en.toISOString(),
    stock_estado: stockEstado(p.stock, p.stock_minimo, umbral),
    costo: (req as any).session?.rol === "admin" ? p.costo : undefined,
  });
});

// ── POST /productos/:id/stock-ingreso ──────────────────────────────────────────
router.post("/productos/:id/stock-ingreso", async (req, res): Promise<void> => {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID de producto inválido" }); return; }

  const [prod] = await db.select().from(productosTable).where(eq(productosTable.id, id));
  if (!prod) { res.status(404).json({ error: "Producto no encontrado" }); return; }

  const { renglones, cantidades } = req.body ?? {};
  const rawList = Array.isArray(renglones) ? renglones : Array.isArray(cantidades) ? cantidades : [];

  if (rawList.length === 0) {
    res.status(400).json({ error: "Debes ingresar al menos una cantidad válida mayor a cero" });
    return;
  }

  if (rawList.length > 100) {
    res.status(400).json({ error: "Máximo 100 renglones por ingreso de stock" });
    return;
  }

  const validQuantities: number[] = [];
  for (const raw of rawList) {
    const parsed = parseStrictNumber(raw);
    if (parsed.error) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    if (parsed.num <= 0) {
      res.status(400).json({ error: `La cantidad '${raw}' no es válida. Debe ser un número mayor a cero.` });
      return;
    }
    if (!isDecimalAllowed(prod.unidad_tipo) && parsed.num % 1 !== 0) {
      res.status(400).json({ error: `El producto '${prod.nombre}' no admite cantidades decimales` });
      return;
    }
    if (parsed.num > 100_000) {
      res.status(400).json({ error: `La cantidad '${raw}' supera el límite máximo permitido (100.000 por renglón)` });
      return;
    }
    const rounded = Math.round(parsed.num * 1000) / 1000;
    validQuantities.push(rounded);
  }

  if (validQuantities.length === 0) {
    res.status(400).json({ error: "Debes ingresar al menos una cantidad válida mayor a cero" });
    return;
  }

  const totalIngresado = Math.round(validQuantities.reduce((sum, q) => sum + q, 0) * 1000) / 1000;

  try {
    const userId = (req as any).session.userId;

    const result = await db.transaction(async (tx) => {
      if (!prod.activo) {
        throw Object.assign(new Error("El producto está inactivo"), { status: 400 });
      }

      const stockAnterior = prod.stock;

      await tx.run(sql`UPDATE productos SET stock = ROUND(stock + ${totalIngresado}, 3) WHERE id = ${id}`);

      const [updatedProd] = await tx.select({ stock: productosTable.stock }).from(productosTable).where(eq(productosTable.id, id));
      const stockResultante = updatedProd.stock;

      const [insertedMov] = await tx.insert(movimientosStockTable).values({
        producto_id: id,
        usuario_id: userId,
        tipo: "ingreso",
        motivo: null,
        stock_anterior: stockAnterior,
        renglones: JSON.stringify(validQuantities),
        total_ingresado: totalIngresado,
        stock_resultante: stockResultante,
      }).returning();

      const formattedQtyList = validQuantities.map(q => `+${q}`).join(" ");
      await tx.insert(auditoriaTable).values({
        usuario_id: userId,
        accion: "ingreso_stock",
        entidad: "producto",
        entidad_id: id,
        detalle: `Ingreso de stock acumulativo: anterior ${stockAnterior} -> (${formattedQtyList}) = total +${totalIngresado} -> resultante ${stockResultante}`,
        monto: totalIngresado,
      });

      return {
        id,
        movimiento_id: insertedMov.id,
        nombre: prod.nombre,
        stock_anterior: stockAnterior,
        total_ingresado: totalIngresado,
        stock_resultante: stockResultante,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "Error interno del servidor" : err?.message || "Error al registrar el ingreso de stock" });
  }
});

// ── POST /productos/:id/stock-ingreso/:movimientoId/deshacer (Admin Only, 30s) ──
router.post("/productos/:id/stock-ingreso/:movimientoId/deshacer", async (req, res): Promise<void> => {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const id = parseId(req.params.id);
  const movimientoId = parseId(req.params.movimientoId);
  if (id === null || movimientoId === null) {
    res.status(400).json({ error: "IDs inválidos" }); return;
  }

  try {
    const userId = (req as any).session.userId;

    const result = await db.transaction(async (tx) => {
      const [mov] = await tx.select().from(movimientosStockTable).where(and(eq(movimientosStockTable.id, movimientoId), eq(movimientosStockTable.producto_id, id)));
      if (!mov) {
        throw Object.assign(new Error("Movimiento de ingreso no encontrado"), { status: 404 });
      }

      if (mov.anulado) {
        throw Object.assign(new Error("Este ingreso ya se encuentra deshecho o anulado"), { status: 400 });
      }

      if (mov.tipo !== "ingreso") {
        throw Object.assign(new Error("Solo se pueden deshacer movimientos de tipo ingreso"), { status: 400 });
      }

      const elapsedSeconds = (Date.now() - new Date(mov.fecha).getTime()) / 1000;
      if (elapsedSeconds > 35) {
        throw Object.assign(new Error("El tiempo de 30 segundos para deshacer este ingreso ha expirado"), { status: 400 });
      }

      const [prod] = await tx.select().from(productosTable).where(eq(productosTable.id, id));
      if (!prod) {
        throw Object.assign(new Error("Producto no encontrado"), { status: 404 });
      }

      const updateResult = await tx.run(sql`UPDATE productos SET stock = ROUND(stock - ${mov.total_ingresado}, 3) WHERE id = ${id} AND stock >= ${mov.total_ingresado}`);

      if (updateResult.rowsAffected === 0) {
        throw Object.assign(new Error(`Stock insuficiente para deshacer el ingreso. Stock actual: ${prod.stock}, ingreso a deshacer: ${mov.total_ingresado}`), { status: 400 });
      }

      const stockAnterior = prod.stock;
      const [updatedProd] = await tx.select({ stock: productosTable.stock }).from(productosTable).where(eq(productosTable.id, id));
      const stockResultante = updatedProd.stock;

      await tx.update(movimientosStockTable).set({
        anulado: true,
        motivo_anulacion: "Deshecho en ventana de 30 segundos",
        anulado_por_usuario: userId,
        fecha_anulacion: new Date(),
      }).where(eq(movimientosStockTable.id, movimientoId));

      await tx.insert(movimientosStockTable).values({
        producto_id: id,
        usuario_id: userId,
        tipo: "anulacion",
        motivo: `Deshecho de ingreso #${movimientoId}`,
        stock_anterior: stockAnterior,
        renglones: JSON.stringify([-mov.total_ingresado]),
        total_ingresado: -mov.total_ingresado,
        stock_resultante: stockResultante,
      });

      await tx.insert(auditoriaTable).values({
        usuario_id: userId,
        accion: "deshacer_ingreso_stock",
        entidad: "producto",
        entidad_id: id,
        detalle: `Deshecho de ingreso #${movimientoId}: stock anterior ${stockAnterior} -> deshecho -${mov.total_ingresado} -> resultante ${stockResultante}`,
        monto: mov.total_ingresado,
      });

      return {
        id,
        movimiento_id: movimientoId,
        stock_resultante: stockResultante,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "Error interno del servidor" : err?.message || "Error al deshacer el ingreso de stock" });
  }
});

// ── POST /productos/:id/stock-historial/:movimientoId/anular (Admin Only) ───────
router.post("/productos/:id/stock-historial/:movimientoId/anular", async (req, res): Promise<void> => {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const id = parseId(req.params.id);
  const movimientoId = parseId(req.params.movimientoId);
  if (id === null || movimientoId === null) {
    res.status(400).json({ error: "IDs inválidos" }); return;
  }

  const { motivo } = req.body ?? {};
  if (!motivo || typeof motivo !== "string" || motivo.trim().length === 0) {
    res.status(400).json({ error: "Debe especificar un motivo obligatorio para anular el ingreso de stock" });
    return;
  }

  try {
    const userId = (req as any).session.userId;

    const result = await db.transaction(async (tx) => {
      const [mov] = await tx.select().from(movimientosStockTable).where(and(eq(movimientosStockTable.id, movimientoId), eq(movimientosStockTable.producto_id, id)));
      if (!mov) {
        throw Object.assign(new Error("Movimiento de stock no encontrado"), { status: 404 });
      }

      if (mov.anulado) {
        throw Object.assign(new Error("Este ingreso ya se encuentra anulado"), { status: 400 });
      }

      if (mov.tipo !== "ingreso") {
        throw Object.assign(new Error("Solo se pueden anular movimientos de tipo ingreso"), { status: 400 });
      }

      const [prod] = await tx.select().from(productosTable).where(eq(productosTable.id, id));
      if (!prod) {
        throw Object.assign(new Error("Producto no encontrado"), { status: 404 });
      }

      const updateResult = await tx.run(sql`UPDATE productos SET stock = ROUND(stock - ${mov.total_ingresado}, 3) WHERE id = ${id} AND stock >= ${mov.total_ingresado}`);

      if (updateResult.rowsAffected === 0) {
        throw Object.assign(new Error(`Stock insuficiente para anular el ingreso. Stock actual: ${prod.stock}, ingreso a anular: ${mov.total_ingresado}`), { status: 400 });
      }

      const stockAnterior = prod.stock;
      const [updatedProd] = await tx.select({ stock: productosTable.stock }).from(productosTable).where(eq(productosTable.id, id));
      const stockResultante = updatedProd.stock;

      const motivoText = motivo.trim();

      await tx.update(movimientosStockTable).set({
        anulado: true,
        motivo_anulacion: motivoText,
        anulado_por_usuario: userId,
        fecha_anulacion: new Date(),
      }).where(eq(movimientosStockTable.id, movimientoId));

      await tx.insert(movimientosStockTable).values({
        producto_id: id,
        usuario_id: userId,
        tipo: "anulacion",
        motivo: `Anulación de ingreso #${movimientoId}: ${motivoText}`,
        stock_anterior: stockAnterior,
        renglones: JSON.stringify([-mov.total_ingresado]),
        total_ingresado: -mov.total_ingresado,
        stock_resultante: stockResultante,
      });

      await tx.insert(auditoriaTable).values({
        usuario_id: userId,
        accion: "anular_ingreso_stock",
        entidad: "producto",
        entidad_id: id,
        detalle: `Anulación de ingreso #${movimientoId}: stock anterior ${stockAnterior} -> deshecho -${mov.total_ingresado} -> resultante ${stockResultante} (motivo: ${motivoText})`,
        monto: mov.total_ingresado,
      });

      return {
        id,
        movimiento_id: movimientoId,
        stock_resultante: stockResultante,
      };
    });

    res.json({ ok: true, ...result });
  } catch (err: any) {
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "Error interno del servidor" : err?.message || "Error al anular el ingreso de stock" });
  }
});

// ── GET /productos/:id/stock-historial (Admin Only) ───────────────────────────
router.get("/productos/:id/stock-historial", async (req, res): Promise<void> => {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID de producto inválido" }); return; }

  const rows = await db
    .select({
      id: movimientosStockTable.id,
      producto_id: movimientosStockTable.producto_id,
      usuario_id: movimientosStockTable.usuario_id,
      usuario_nombre: usuariosTable.nombre,
      tipo: movimientosStockTable.tipo,
      motivo: movimientosStockTable.motivo,
      stock_anterior: movimientosStockTable.stock_anterior,
      renglones: movimientosStockTable.renglones,
      total_ingresado: movimientosStockTable.total_ingresado,
      stock_resultante: movimientosStockTable.stock_resultante,
      fecha: movimientosStockTable.fecha,
      anulado: movimientosStockTable.anulado,
      motivo_anulacion: movimientosStockTable.motivo_anulacion,
      anulado_por_usuario: movimientosStockTable.anulado_por_usuario,
      fecha_anulacion: movimientosStockTable.fecha_anulacion,
    })
    .from(movimientosStockTable)
    .leftJoin(usuariosTable, eq(movimientosStockTable.usuario_id, usuariosTable.id))
    .where(eq(movimientosStockTable.producto_id, id))
    .orderBy(sql`${movimientosStockTable.fecha} DESC`)
    .limit(100);

  res.json(rows.map(r => {
    let parsedRenglones: number[] = [];
    try {
      parsedRenglones = JSON.parse(r.renglones);
    } catch (_) {}
    return {
      ...r,
      fecha: r.fecha.toISOString(),
      fecha_anulacion: r.fecha_anulacion ? r.fecha_anulacion.toISOString() : null,
      renglones_parsed: parsedRenglones,
    };
  }));
});

// ── PUT /productos/:id ─────────────────────────────────────────────────────────
router.put("/productos/:id", async (req, res): Promise<void> => {
  if (!(req as any).session?.userId) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!requireAdmin(req, res)) return;

  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const { codigo, nombre, precio, costo, stock, stock_minimo, unidad_tipo, categoria_id, subcategoria_id, activo, imagen, motivo } = req.body ?? {};

  const [currentProd] = await db.select().from(productosTable).where(eq(productosTable.id, id));
  if (!currentProd) { res.status(404).json({ error: "Producto no encontrado" }); return; }

  const updates: Record<string, unknown> = {};

  const nextUnidadTipo = unidad_tipo !== undefined && typeof unidad_tipo === "string" ? unidad_tipo.trim() : currentProd.unidad_tipo;

  // RULE: Switch from "Sí" (decimals allowed) to "No" (non-decimal) MUST be rejected if current stock has decimals
  if (isDecimalAllowed(currentProd.unidad_tipo) && !isDecimalAllowed(nextUnidadTipo)) {
    if (currentProd.stock % 1 !== 0) {
      res.status(400).json({ error: "No se puede desactivar decimales mientras el stock actual tenga decimales" });
      return;
    }
  }

  if (unidad_tipo !== undefined) {
    updates.unidad_tipo = nextUnidadTipo;
  }

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
    const parsedPrecio = parseStrictNumber(precio);
    if (parsedPrecio.error || parsedPrecio.num < 0) { res.status(400).json({ error: parsedPrecio.error || "precio inválido" }); return; }
    updates.precio = Math.round(parsedPrecio.num * 100) / 100;
  }
  if (costo !== undefined) updates.costo = costo != null ? Number(costo) : null;

  let stockChanged = false;
  let stockDifference = 0;
  let newStockVal = currentProd.stock;

  if (stock != null) {
    const parsedStock = parseStrictNumber(stock);
    if (parsedStock.error || parsedStock.num < 0) { res.status(400).json({ error: parsedStock.error || "stock inválido" }); return; }

    if (!isDecimalAllowed(nextUnidadTipo) && parsedStock.num % 1 !== 0) {
      res.status(400).json({ error: `El producto '${currentProd.nombre}' no admite cantidades decimales` });
      return;
    }

    newStockVal = Math.round(parsedStock.num * 1000) / 1000;
    stockDifference = Math.round((newStockVal - currentProd.stock) * 1000) / 1000;

    if (Math.abs(stockDifference) > 0.0001) {
      stockChanged = true;
      if (stockDifference < 0) {
        if (!motivo || typeof motivo !== "string" || motivo.trim().length === 0) {
          res.status(400).json({ error: "Debe especificar un motivo obligatorio para disminuir el stock" });
          return;
        }
      }
    }
    updates.stock = newStockVal;
  }

  if (stock_minimo   !== undefined) updates.stock_minimo   = stock_minimo != null ? Number(stock_minimo) : null;
  if (categoria_id   !== undefined) updates.categoria_id   = categoria_id   != null ? parseInt(categoria_id,   10) : null;
  if (subcategoria_id !== undefined) updates.subcategoria_id = subcategoria_id != null ? parseInt(subcategoria_id, 10) : null;
  if (activo  != null)              updates.activo         = Boolean(activo);
  if (imagen  !== undefined)        updates.imagen         = imagen;

  try {
    const userId = (req as any).session.userId;

    const p = await db.transaction(async (tx) => {
      const [updated] = await tx.update(productosTable).set(updates).where(eq(productosTable.id, id)).returning();

      if (stockChanged) {
        const motivoText = motivo && typeof motivo === "string" ? motivo.trim() : "Ajuste manual de stock";

        await tx.insert(movimientosStockTable).values({
          producto_id: id,
          usuario_id: userId,
          tipo: "ajuste",
          motivo: motivoText,
          stock_anterior: currentProd.stock,
          renglones: JSON.stringify([stockDifference]),
          total_ingresado: stockDifference,
          stock_resultante: newStockVal,
        });

        await tx.insert(auditoriaTable).values({
          usuario_id: userId,
          accion: "ajuste_stock",
          entidad: "producto",
          entidad_id: id,
          detalle: `Ajuste manual de stock: anterior ${currentProd.stock} -> resultante ${newStockVal} (motivo: ${motivoText})`,
          monto: Math.abs(stockDifference),
        });
      }

      return updated;
    });

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
    const status = typeof err?.status === "number" ? err.status : 500;
    res.status(status).json({ error: status === 500 ? "Error interno del servidor" : err?.message || "Error al actualizar producto" });
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
    res.json({ action: "deactivated", message: "El producto tiene historial de ventas; fue desactivado en lugar de eliminado" });
    return;
  }
  await db.delete(productosTable).where(eq(productosTable.id, id));
  res.json({ action: "deleted", message: "Producto eliminado" });
});

// ── PATCH /productos/:id/toggle-activo ─────────────────────────────────────────
router.patch("/productos/:id/toggle-activo", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const [current] = await db.select({ activo: productosTable.activo }).from(productosTable).where(eq(productosTable.id, id));
  if (!current) { res.status(404).json({ error: "Producto no encontrado" }); return; }

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
