import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usuariosTable } from "@workspace/db";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

router.get("/auth/me", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (!session?.userId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db.select({
    id: usuariosTable.id,
    nombre: usuariosTable.nombre,
    rol: usuariosTable.rol,
  }).from(usuariosTable).where(eq(usuariosTable.id, session.userId));
  if (!user) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json(user);
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const { nombre, password } = req.body ?? {};
  if (!nombre || !password) {
    res.status(400).json({ error: "nombre and password required" });
    return;
  }
  const [user] = await db.select().from(usuariosTable).where(eq(usuariosTable.nombre, nombre));
  if (!user || !user.activo) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }
  (req as any).session.userId = user.id;
  (req as any).session.rol = user.rol;
  res.json({ id: user.id, nombre: user.nombre, rol: user.rol });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  (req as any).session.destroy(() => {
    res.json({ ok: true });
  });
});

export default router;
