import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriasTable } from "@workspace/db";

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
  const n = parseInt(s, 10);
  return Number.isNaN(n) || n <= 0 ? null : n;
}

// Any authenticated user can list categories (needed for the POS sale screen)
router.get("/categorias", async (req, res): Promise<void> => {
  if (!requireAuth(req, res)) return;
  const cats = await db.select().from(categoriasTable).orderBy(categoriasTable.nombre);
  res.json(cats);
});

router.post("/categorias", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { nombre } = req.body ?? {};
  if (!nombre || typeof nombre !== "string" || nombre.trim().length === 0) {
    res.status(400).json({ error: "nombre is required" });
    return;
  }
  if (nombre.length > 100) {
    res.status(400).json({ error: "nombre demasiado largo (máximo 100 caracteres)" });
    return;
  }
  const [cat] = await db.insert(categoriasTable).values({ nombre: nombre.trim() }).returning();
  res.status(201).json(cat);
});

router.put("/categorias/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const { nombre } = req.body ?? {};
  if (!nombre || typeof nombre !== "string" || nombre.trim().length === 0) {
    res.status(400).json({ error: "nombre is required" });
    return;
  }
  if (nombre.length > 100) {
    res.status(400).json({ error: "nombre demasiado largo (máximo 100 caracteres)" });
    return;
  }

  const [cat] = await db
    .update(categoriasTable)
    .set({ nombre: nombre.trim() })
    .where(eq(categoriasTable.id, id))
    .returning();

  if (!cat) { res.status(404).json({ error: "Category not found" }); return; }
  res.json(cat);
});

router.delete("/categorias/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  await db.delete(categoriasTable).where(eq(categoriasTable.id, id));
  res.json({ ok: true });
});

export default router;
