import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, configuracionTable, usuariosTable } from "@workspace/db";
import bcrypt from "bcryptjs";

const router: IRouter = Router();

router.get("/config", async (req, res): Promise<void> => {
  const [config] = await db.select().from(configuracionTable);
  if (!config) {
    res.status(404).json({ error: "Not configured" });
    return;
  }
  res.json(config);
});

router.post("/config/setup", async (req, res): Promise<void> => {
  // Check if already configured
  const [existing] = await db.select().from(configuracionTable);
  if (existing) {
    res.status(409).json({ error: "Already configured" });
    return;
  }

  const {
    nombre_empresa, logo_path, direccion, telefono, identificador_fiscal, email,
    moneda, emite_tickets, impresora_seleccionada, dias_retencion_tickets,
    tema_color, stock_bajo_umbral_global, admin_nombre, admin_password,
  } = req.body ?? {};

  if (!nombre_empresa || !admin_nombre || !admin_password) {
    res.status(400).json({ error: "nombre_empresa, admin_nombre, and admin_password are required" });
    return;
  }

  const now = new Date().toISOString();
  await db.insert(configuracionTable).values({
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
    tema_color: tema_color ?? "default",
    stock_bajo_umbral_global: stock_bajo_umbral_global ?? 5,
    fecha_instalacion: now,
  });

  const hash = await bcrypt.hash(admin_password, 10);
  const [admin] = await db.insert(usuariosTable).values({
    nombre: admin_nombre,
    password_hash: hash,
    rol: "admin",
    activo: true,
  }).returning();

  (req as any).session.userId = admin.id;
  (req as any).session.rol = admin.rol;

  res.status(201).json({ id: admin.id, nombre: admin.nombre, rol: admin.rol });
});

router.put("/config/update", async (req, res): Promise<void> => {
  const session = (req as any).session;
  if (session?.rol !== "admin") {
    res.status(403).json({ error: "Admin only" });
    return;
  }
  const {
    nombre_empresa, logo_path, direccion, telefono, identificador_fiscal, email,
    moneda, emite_tickets, impresora_seleccionada, dias_retencion_tickets,
    tema_color, stock_bajo_umbral_global,
  } = req.body ?? {};

  const updates: Record<string, unknown> = {};
  if (nombre_empresa != null) updates.nombre_empresa = nombre_empresa;
  if (logo_path !== undefined) updates.logo_path = logo_path;
  if (direccion !== undefined) updates.direccion = direccion;
  if (telefono !== undefined) updates.telefono = telefono;
  if (identificador_fiscal !== undefined) updates.identificador_fiscal = identificador_fiscal;
  if (email !== undefined) updates.email = email;
  if (moneda != null) updates.moneda = moneda;
  if (emite_tickets != null) updates.emite_tickets = emite_tickets;
  if (impresora_seleccionada !== undefined) updates.impresora_seleccionada = impresora_seleccionada;
  if (dias_retencion_tickets != null) updates.dias_retencion_tickets = dias_retencion_tickets;
  if (tema_color != null) updates.tema_color = tema_color;
  if (stock_bajo_umbral_global != null) updates.stock_bajo_umbral_global = stock_bajo_umbral_global;
  const { activa_kg, mostrar_decimales } = req.body ?? {};
  if (activa_kg != null) updates.activa_kg = activa_kg;
  if (mostrar_decimales != null) updates.mostrar_decimales = mostrar_decimales;

  const [config] = await db.update(configuracionTable)
    .set(updates)
    .where(eq(configuracionTable.id, 1))
    .returning();

  res.json(config);
});

export default router;
