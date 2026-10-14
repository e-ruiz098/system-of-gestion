import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoriasTable = sqliteTable("categorias", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull().unique(),
  parent_id: integer("parent_id"), // null = categoría principal; set = subcategoría
});

export const insertCategoriaSchema = createInsertSchema(categoriasTable).omit({ id: true });
export type InsertCategoria = z.infer<typeof insertCategoriaSchema>;
export type Categoria = typeof categoriasTable.$inferSelect;
