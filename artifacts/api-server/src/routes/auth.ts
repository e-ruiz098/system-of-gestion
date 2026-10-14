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
  const [user] = await db
    .select({ id: usuariosTable.id, nombre: usuariosTable.nombre, rol: usuariosTable.rol })
    .from(usuariosTable)
    .where(eq(usuariosTable.id, session.userId));

  if (!user) {
    // Session points to a deleted user — destroy it
    (req as any).session.destroy(() => {});
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

  // Enforce reasonable string lengths to prevent abuse
  if (typeof nombre !== "string" || typeof password !== "string" ||
      nombre.length > 100 || password.length > 200) {
    res.status(400).json({ error: "Invalid credentials" });
    return;
  }

  const [user] = await db
    .select()
    .from(usuariosTable)
    .where(eq(usuariosTable.nombre, nombre));

  // Always run bcrypt.compare even if user not found to prevent timing attacks.
  // Use a dummy hash so the comparison takes the same time regardless.
  const DUMMY_HASH = "$2b$10$abcdefghijklmnopqrstuuABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
  const hashToCompare = user?.password_hash ?? DUMMY_HASH;
  const valid = await bcrypt.compare(password, hashToCompare);

  if (!user || !user.activo || !valid) {
    // Identical message for all failure cases — no username enumeration
    res.status(401).json({ error: "Invalid credentials" });
    return;
  }

  // ── Session fixation protection ──────────────────────────────────────────
  // Regenerate the session ID on every successful login so a pre-seeded
  // session ID cannot be used by an attacker to hijack the authenticated session.
  await new Promise<void>((resolve, reject) => {
    (req as any).session.regenerate((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

  (req as any).session.userId = user.id;
  (req as any).session.rol = user.rol;

  res.json({ id: user.id, nombre: user.nombre, rol: user.rol });
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  (req as any).session.destroy((err: Error | null) => {
    if (err) {
      res.status(500).json({ error: "Error al cerrar sesión" });
      return;
    }
    // Clear the cookie on the client side as well
    res.clearCookie("sid");
    res.json({ ok: true });
  });
});

export default router;
