import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { categoriasTable } from "./categorias";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const productosTable = sqliteTable("productos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  codigo: text("codigo").unique(),
  nombre: text("nombre").notNull(),
  precio: real("precio").notNull(),
  costo: real("costo"),
  stock: real("stock").notNull().default(0),
  stock_minimo: real("stock_minimo"),
  unidad_tipo: text("unidad_tipo").notNull().default("unidad"),
  categoria_id: integer("categoria_id").references(() => categoriasTable.id),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  creado_en: integer("creado_en", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const insertProductoSchema = createInsertSchema(productosTable).omit({ id: true, creado_en: true });
export type InsertProducto = z.infer<typeof insertProductoSchema>;
export type Producto = typeof productosTable.$inferSelect;
