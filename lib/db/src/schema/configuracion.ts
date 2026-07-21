import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const configuracionTable = sqliteTable("configuracion", {
  id: integer("id").primaryKey().default(1),
  nombre_empresa: text("nombre_empresa").notNull(),
  logo_path: text("logo_path"),
  direccion: text("direccion"),
  telefono: text("telefono"),
  identificador_fiscal: text("identificador_fiscal"),
  email: text("email"),
  moneda: text("moneda").notNull().default("$"),
  emite_tickets: integer("emite_tickets", { mode: "boolean" }).notNull().default(true),
  impresora_seleccionada: text("impresora_seleccionada"),
  dias_retencion_tickets: integer("dias_retencion_tickets").notNull().default(90),
  tema_color: text("tema_color").notNull().default("default"),
  stock_bajo_umbral_global: integer("stock_bajo_umbral_global").notNull().default(5),
  fecha_instalacion: text("fecha_instalacion"),
  activa_kg: integer("activa_kg", { mode: "boolean" }).notNull().default(false),
  mostrar_decimales: integer("mostrar_decimales", { mode: "boolean" }).notNull().default(false),
});

export const insertConfiguracionSchema = createInsertSchema(configuracionTable).omit({ id: true });
export type InsertConfiguracion = z.infer<typeof insertConfiguracionSchema>;
export type Configuracion = typeof configuracionTable.$inferSelect;
