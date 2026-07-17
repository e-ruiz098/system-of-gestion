import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { usuariosTable } from "./usuarios";

export const auditoriaTable = pgTable("auditoria", {
  id: serial("id").primaryKey(),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  accion: text("accion"),
  detalle: text("detalle"),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
});

export type Auditoria = typeof auditoriaTable.$inferSelect;
