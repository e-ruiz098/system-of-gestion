import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, configuracionTable, usuariosTable } from "@workspace/db";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

// ── GET /config ────────────────────────────────────────────────────────────────
// Two response shapes:
//   • Unauthenticated: returns only the minimal public fields needed by the
//     frontend to decide whether setup is complete (nombre_empresa, tema_color).
//     This is intentional — the setup wizard and login page need to know if the
//     system has been configured, and what name/theme to display.
//   • Authenticated (admin): returns the full config row.
//
// Sensitive fields (email, identificador_fiscal, printer, etc.) are NEVER sent
// to unauthenticated callers.
router.get("/config", async (req, res): Promise<void> => {
  const [config] = await db.select().from(configuracionTable);
  if (!config) {
    res.status(404).json({ error: "Not configured" });
    return;
  }

  const session = (req as any).session;
  if (session?.rol === "admin") {
    // Full config for authenticated admins
    res.json(config);
    return;
  }

  // Public-safe subset — just enough for the UI shell
  res.json({
    nombre_empresa: config.nombre_empresa,
    tema_color: config.tema_color,
    moneda: config.moneda,
    emite_tickets: config.emite_tickets,
    redondeo_activo: config.redondeo_activo,
    redondeo_multiplo: config.redondeo_multiplo,
    horas_limite_devolucion: config.horas_limite_devolucion,
    devoluciones_requieren_ticket: config.devoluciones_requieren_ticket,
  });
});

// ── POST /config/setup ─────────────────────────────────────────────────────────
// First-time configuration. Wrapped in a serialized DB transaction to prevent
// the TOCTOU race condition where two concurrent requests both pass the
// "already configured?" check and create duplicate admin accounts.
router.post("/config/setup", async (req, res): Promise<void> => {
  const {
    nombre_empresa, logo_path, direccion, telefono, identificador_fiscal, email,
    moneda, emite_tickets, impresora_seleccionada, dias_retencion_tickets,
    tema_color, stock_bajo_umbral_global, admin_nombre, admin_password,
  } = req.body ?? {};

  if (!nombre_empresa || !admin_nombre || !admin_password) {
    res.status(400).json({ error: "nombre_empresa, admin_nombre, and admin_password are required" });
    return;
  }

  // Basic length guards
  if (
    typeof admin_nombre !== "string" || admin_nombre.length > 100 ||
    typeof admin_password !== "string" || admin_password.length > 200 ||
    typeof nombre_empresa !== "string" || nombre_empresa.length > 200
  ) {
    res.status(400).json({ error: "Datos inválidos" });
    return;
  }

  // Minimum password length
  if (admin_password.length < 8) {
    res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres" });
    return;
  }

  // Validate allowed tema_color values
  const ALLOWED_TEMAS = ["default", "azul", "esmeralda", "ambar"] as const;
  const temaFinal = ALLOWED_TEMAS.includes(tema_color) ? tema_color : "default";

  // ── Atomic transaction: check + insert in one operation ───────────────────
  // libsql/sqlite serializes writes, so this transaction eliminates the
  // check-then-insert race condition.
  let admin: { id: number; nombre: string; rol: string } | undefined;

  try {
    const now = new Date().toISOString();
    const hash = await bcrypt.hash(admin_password, 12); // cost 12 for new installs

    await db.transaction(async (tx) => {
      // Re-check inside the transaction
      const [existing] = await tx.select({ id: configuracionTable.id }).from(configuracionTable);
      if (existing) {
        // Throw a typed error to surface as 409 outside the transaction
        const err = new Error("Already configured") as any;
        err.statusCode = 409;
        throw err;
      }

      await tx.insert(configuracionTable).values({
        id: 1,
        nombre_empresa,
        logo_path: logo_path ?? null,
        direccion: direccion ?? null,
        telefono: telefono ?? null,
        identificador_fiscal: identificador_fiscal ?? null,
        email: email ?? null,
        moneda: moneda ?? "$",
        emite_tickets: emite_tickets ?? true,
        impresora_seleccionada: impresora_seleccionada ?? null,
        dias_retencion_tickets: dias_retencion_tickets ?? 90,
        tema_color: temaFinal,
        stock_bajo_umbral_global: stock_bajo_umbral_global ?? 5,
        fecha_instalacion: now,
        redondeo_activo: true,
        redondeo_multiplo: 50,
      });

      const [inserted] = await tx.insert(usuariosTable).values({
        nombre: admin_nombre,
        password_hash: hash,
        rol: "admin",
        activo: true,
      }).returning();

      admin = { id: inserted.id, nombre: inserted.nombre, rol: inserted.rol };
    });
  } catch (err: any) {
    if (err?.statusCode === 409) {
      res.status(409).json({ error: "El sistema ya fue configurado" });
      return;
    }
    throw err; // re-throw to global error handler
  }

  // Session regenerate after setup (same protection as login)
  await new Promise<void>((resolve, reject) => {
    (req as any).session.regenerate((err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });

  (req as any).session.userId = admin!.id;
  (req as any).session.rol = admin!.rol;

  res.status(201).json({ id: admin!.id, nombre: admin!.nombre, rol: admin!.rol });
});

// ── PUT /config/update ─────────────────────────────────────────────────────────
router.put("/config/update", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.rol !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }

  const ALLOWED_TEMAS = ["default", "azul", "esmeralda", "ambar"];
  const ALLOWED_METODOS = ["efectivo", "tarjeta", "transferencia", "mixto"];

  const {
    nombre_empresa, logo_path, direccion, telefono, identificador_fiscal, email,
    moneda, emite_tickets, impresora_seleccionada, dias_retencion_tickets,
    tema_color, stock_bajo_umbral_global, activa_kg, mostrar_decimales,
    redondeo_activo, redondeo_multiplo, horas_limite_devolucion,
    devoluciones_requieren_ticket,
  } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (nombre_empresa != null) {
    if (typeof nombre_empresa !== "string" || nombre_empresa.length > 200) {
      res.status(400).json({ error: "nombre_empresa inválido" });
      return;
    }
    updates.nombre_empresa = nombre_empresa;
  }
  if (logo_path !== undefined) updates.logo_path = logo_path ?? null;
  if (direccion !== undefined) updates.direccion = direccion ?? null;
  if (telefono !== undefined) updates.telefono = telefono ?? null;
  if (identificador_fiscal !== undefined) updates.identificador_fiscal = identificador_fiscal ?? null;
  if (email !== undefined) updates.email = email ?? null;
  if (moneda != null) updates.moneda = String(moneda).slice(0, 5); // max 5 chars
  if (emite_tickets != null) updates.emite_tickets = Boolean(emite_tickets);
  if (impresora_seleccionada !== undefined) updates.impresora_seleccionada = impresora_seleccionada ?? null;
  if (dias_retencion_tickets != null) {
    const v = Number(dias_retencion_tickets);
    if (!Number.isInteger(v) || (v !== -1 && (v < 1 || v > 3650))) {
      res.status(400).json({ error: "dias_retencion_tickets inválido" });
      return;
    }
    updates.dias_retencion_tickets = v;
  }
  if (tema_color != null) {
    if (!ALLOWED_TEMAS.includes(tema_color)) {
      res.status(400).json({ error: `tema_color debe ser uno de: ${ALLOWED_TEMAS.join(", ")}` });
      return;
    }
    updates.tema_color = tema_color;
  }
  if (stock_bajo_umbral_global != null) {
    const v = Number(stock_bajo_umbral_global);
    if (!Number.isFinite(v) || v < 0) {
      res.status(400).json({ error: "stock_bajo_umbral_global inválido" });
      return;
    }
    updates.stock_bajo_umbral_global = v;
  }
  if (activa_kg != null) updates.activa_kg = Boolean(activa_kg);
  if (mostrar_decimales != null) updates.mostrar_decimales = Boolean(mostrar_decimales);

  const { activa_cajon } = req.body ?? {};
  if (activa_cajon != null) updates.activa_cajon = Boolean(activa_cajon);

  if (redondeo_activo != null) updates.redondeo_activo = Boolean(redondeo_activo);
  if (redondeo_multiplo != null) {
    const v = Number(redondeo_multiplo);
    if (!Number.isInteger(v) || v < 1 || v > 10000) {
      res.status(400).json({ error: "redondeo_multiplo debe ser un entero entre 1 y 10000" });
      return;
    }
    updates.redondeo_multiplo = v;
  }
  if (horas_limite_devolucion != null) {
    const v = Number(horas_limite_devolucion);
    if (!Number.isInteger(v) || v < 0 || v > 8760) {
      res.status(400).json({ error: "horas_limite_devolucion debe ser un entero entre 0 y 8760" });
      return;
    }
    updates.horas_limite_devolucion = v;
  }
  if (devoluciones_requieren_ticket != null) {
    if (typeof devoluciones_requieren_ticket !== "boolean") {
      res.status(400).json({ error: "devoluciones_requieren_ticket debe ser booleano" });
      return;
    }
    updates.devoluciones_requieren_ticket = devoluciones_requieren_ticket;
  }

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No hay campos para actualizar" });
    return;
  }

  const [config] = await db
    .update(configuracionTable)
    .set(updates)
    .where(eq(configuracionTable.id, 1))
    .returning();

  res.json(config);
});

export default router;
