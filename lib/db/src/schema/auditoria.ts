import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usuariosTable } from "./usuarios";

export const auditoriaTable = sqliteTable("auditoria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  accion: text("accion").notNull(),
  entidad: text("entidad").notNull(), // venta, devolucion, anulacion, etc.
  entidad_id: integer("entidad_id").notNull(), // ID de la entidad afectada
  detalle: text("detalle"),
  monto: real("monto"), // Monto relevante de la operación
  fecha: integer("fecha", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type Auditoria = typeof auditoriaTable.$inferSelect;
