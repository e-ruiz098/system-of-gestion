import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usuariosTable } from "@workspace/db";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

// Allowed role values — must match the DB enum
const ALLOWED_ROLES = ["admin", "vendedor"] as const;
type Rol = typeof ALLOWED_ROLES[number];

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

router.get("/usuarios", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;
  const users = await db
    .select({
      id: usuariosTable.id,
      nombre: usuariosTable.nombre,
      rol: usuariosTable.rol,
      activo: usuariosTable.activo,
      creado_en: usuariosTable.creado_en,
    })
    .from(usuariosTable)
    .orderBy(usuariosTable.id);
  res.json(users);
});

router.post("/usuarios", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const { nombre, password, rol } = req.body ?? {};

  if (!nombre || !password || !rol) {
    res.status(400).json({ error: "nombre, password and rol are required" });
    return;
  }

  // Type and length guards
  if (typeof nombre !== "string" || nombre.length > 100) {
    res.status(400).json({ error: "nombre inválido (máximo 100 caracteres)" });
    return;
  }
  if (typeof password !== "string" || password.length < 8 || password.length > 200) {
    res.status(400).json({ error: "password debe tener entre 8 y 200 caracteres" });
    return;
  }

  // Validate rol against allowed enum — prevents garbage roles from entering the DB
  if (!ALLOWED_ROLES.includes(rol as Rol)) {
    res.status(400).json({ error: `rol debe ser uno de: ${ALLOWED_ROLES.join(", ")}` });
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const [user] = await db
    .insert(usuariosTable)
    .values({ nombre, password_hash: hash, rol, activo: true })
    .returning({
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

  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  const { nombre, password, rol, activo } = req.body ?? {};
  const updates: Record<string, unknown> = {};

  if (nombre != null) {
    if (typeof nombre !== "string" || nombre.length > 100) {
      res.status(400).json({ error: "nombre inválido" }); return;
    }
    updates.nombre = nombre;
  }

  if (rol != null) {
    // Strictly validate against the allowed enum — no arbitrary strings
    if (!ALLOWED_ROLES.includes(rol as Rol)) {
      res.status(400).json({ error: `rol debe ser uno de: ${ALLOWED_ROLES.join(", ")}` });
      return;
    }
    // Prevent the last admin from demoting themselves
    if (rol !== "admin" && id === (req as any).session?.userId) {
      res.status(400).json({ error: "No puedes cambiar tu propio rol" });
      return;
    }
    updates.rol = rol;
  }

  if (activo != null) updates.activo = Boolean(activo);

  if (password) {
    if (typeof password !== "string" || password.length < 8 || password.length > 200) {
      res.status(400).json({ error: "password debe tener entre 8 y 200 caracteres" }); return;
    }
    updates.password_hash = await bcrypt.hash(password, 12);
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No hay campos para actualizar" });
    return;
  }

  const [user] = await db
    .update(usuariosTable)
    .set(updates)
    .where(eq(usuariosTable.id, id))
    .returning({
      id: usuariosTable.id,
      nombre: usuariosTable.nombre,
      rol: usuariosTable.rol,
      activo: usuariosTable.activo,
      creado_en: usuariosTable.creado_en,
    });

  if (!user) { res.status(404).json({ error: "User not found" }); return; }
  res.json(user);
});

router.delete("/usuarios/:id", async (req, res): Promise<void> => {
  if (!requireAdmin(req, res)) return;

  const id = parseId(req.params.id);
  if (id === null) { res.status(400).json({ error: "ID inválido" }); return; }

  if (id === (req as any).session?.userId) {
    res.status(400).json({ error: "No puedes eliminarte a ti mismo" });
    return;
  }

  await db.delete(usuariosTable).where(eq(usuariosTable.id, id));
  res.json({ ok: true });
});

export default router;
