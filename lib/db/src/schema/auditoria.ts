import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usuariosTable } from "./usuarios";

export const auditoriaTable = sqliteTable("auditoria", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  accion: text("accion"),
  detalle: text("detalle"),
  fecha: integer("fecha", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type Auditoria = typeof auditoriaTable.$inferSelect;
