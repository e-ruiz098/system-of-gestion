import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usuariosTable } from "@workspace/db";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

function requireAdmin(req: any, res: any): boolean {
  if (req.session?.rol !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return false;
  }
  return true;
}

router.get("/usuarios", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const users = await db.select({
    id: usuariosTable.id,
    nombre: usuariosTable.nombre,
    rol: usuariosTable.rol,
    activo: usuariosTable.activo,
    creado_en: usuariosTable.creado_en,
  }).from(usuariosTable).orderBy(usuariosTable.id);
  res.json(users);
});

router.post("/usuarios", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const { nombre, password, rol } = req.body ?? {};
  if (!nombre || !password || !rol) {
    res.status(400).json({ error: "nombre, password and rol are required" });
    return;
  }
  const hash = await bcrypt.hash(password, 10);
  const [user] = await db.insert(usuariosTable).values({
    nombre, password_hash: hash, rol, activo: true,
  }).returning({
    id: usuariosTable.id,
    nombre: usuariosTable.nombre,
    rol: usuariosTable.rol,
    activo: usuariosTable.activo,
    creado_en: usuariosTable.creado_en,
  });
  res.status(201).json(user);
});

router.put("/usuarios/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  const { nombre, password, rol, activo } = req.body ?? {};
  const updates: Record<string, unknown> = {};
  if (nombre != null) updates.nombre = nombre;
  if (rol != null) updates.rol = rol;
  if (activo != null) updates.activo = activo;
  if (password) updates.password_hash = await bcrypt.hash(password, 10);

  const [user] = await db.update(usuariosTable)
    .set(updates)
    .where(eq(usuariosTable.id, id))
    .returning({
      id: usuariosTable.id,
      nombre: usuariosTable.nombre,
      rol: usuariosTable.rol,
      activo: usuariosTable.activo,
      creado_en: usuariosTable.creado_en,
    });
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.delete("/usuarios/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);
  // Don't allow deleting self
  if (id === (req as any).session?.userId) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }
  await db.delete(usuariosTable).where(eq(usuariosTable.id, id));
  res.json({ ok: true });
});

export default router;
