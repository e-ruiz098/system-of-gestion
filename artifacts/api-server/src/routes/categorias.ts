import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, categoriasTable } from "@workspace/db";

const router: IRouter = Router();

function requireAdmin(req: any, res: any): boolean {
  if (req.session?.rol !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

router.get("/categorias", async (_req, res): Promise<void> => {
  const cats = await db.select().from(categoriasTable).orderBy(categoriasTable.nombre);
  res.json(cats);
});

router.post("/categorias", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { nombre } = req.body ?? {};
  if (!nombre) {
    res.status(400).json({ error: "nombre is required" });
    return;
  }
  const [cat] = await db.insert(categoriasTable).values({ nombre }).returning();
  res.status(201).json(cat);
});

router.put("/categorias/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { nombre } = req.body ?? {};
  if (!nombre) {
    res.status(400).json({ error: "nombre is required" });
    return;
  }
  const [cat] = await db.update(categoriasTable).set({ nombre }).where(eq(categoriasTable.id, id)).returning();
  if (!cat) {
    res.status(404).json({ error: "Category not found" });
    return;
  }
  res.json(cat);
});

router.delete("/categorias/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  await db.delete(categoriasTable).where(eq(categoriasTable.id, id));
  res.json({ ok: true });
});

export default router;
