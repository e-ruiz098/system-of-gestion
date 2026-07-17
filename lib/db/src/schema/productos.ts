import { pgTable, serial, text, real, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { categoriasTable } from "./categorias";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productosTable = pgTable("productos", {
  id: serial("id").primaryKey(),
  codigo: text("codigo").unique(),
  nombre: text("nombre").notNull(),
  precio: real("precio").notNull(),
  costo: real("costo"),
  stock: real("stock").notNull().default(0),
  stock_minimo: real("stock_minimo"),
  unidad_tipo: text("unidad_tipo").notNull().default("unidad"),
  categoria_id: integer("categoria_id").references(() => categoriasTable.id),
  activo: boolean("activo").notNull().default(true),
  creado_en: timestamp("creado_en", { withTimezone: true }).notNull().defaultNow(),
});

export const insertProductoSchema = createInsertSchema(productosTable).omit({ id: true, creado_en: true });
export type InsertProducto = z.infer<typeof insertProductoSchema>;
export type Producto = typeof productosTable.$inferSelect;
