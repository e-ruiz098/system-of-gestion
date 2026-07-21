import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usuariosTable } from "./usuarios";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const aperturasCajaTable = sqliteTable("aperturas_caja", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  fondo_inicial: real("fondo_inicial").notNull(),
  fecha_apertura: integer("fecha_apertura", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  cierre_id: integer("cierre_id"),
});

export const cierresCajaTable = sqliteTable("cierres_caja", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  apertura_caja_id: integer("apertura_caja_id").references(() => aperturasCajaTable.id),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  total_esperado: real("total_esperado").notNull(),
  total_contado: real("total_contado").notNull(),
  diferencia: real("diferencia").notNull(),
  fecha_cierre: integer("fecha_cierre", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  snapshot_stock: text("snapshot_stock"),
});

export const insertAperturaCajaSchema = createInsertSchema(aperturasCajaTable).omit({ id: true, fecha_apertura: true });
export type InsertAperturaCaja = z.infer<typeof insertAperturaCajaSchema>;
export type AperturaCaja = typeof aperturasCajaTable.$inferSelect;

export const insertCierreCajaSchema = createInsertSchema(cierresCajaTable).omit({ id: true, fecha_cierre: true });
export type InsertCierreCaja = z.infer<typeof insertCierreCajaSchema>;
export type CierreCaja = typeof cierresCajaTable.$inferSelect;
