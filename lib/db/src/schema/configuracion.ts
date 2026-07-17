import { pgTable, integer, text, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const configuracionTable = pgTable("configuracion", {
  id: integer("id").primaryKey().default(1),
  nombre_empresa: text("nombre_empresa").notNull(),
  logo_path: text("logo_path"),
  direccion: text("direccion"),
  telefono: text("telefono"),
  identificador_fiscal: text("identificador_fiscal"),
  email: text("email"),
  moneda: text("moneda").notNull().default("$"),
  emite_tickets: boolean("emite_tickets").notNull().default(true),
  impresora_seleccionada: text("impresora_seleccionada"),
  dias_retencion_tickets: integer("dias_retencion_tickets").notNull().default(90),
  tema_color: text("tema_color").notNull().default("default"),
  stock_bajo_umbral_global: integer("stock_bajo_umbral_global").notNull().default(5),
  fecha_instalacion: text("fecha_instalacion"),
  activa_kg: boolean("activa_kg").notNull().default(false),
  mostrar_decimales: boolean("mostrar_decimales").notNull().default(false),
});

export const insertConfiguracionSchema = createInsertSchema(configuracionTable).omit({ id: true });
export type InsertConfiguracion = z.infer<typeof insertConfiguracionSchema>;
export type Configuracion = typeof configuracionTable.$inferSelect;
