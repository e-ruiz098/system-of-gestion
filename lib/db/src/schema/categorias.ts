import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const categoriasTable = pgTable("categorias", {
  id: serial("id").primaryKey(),
  nombre: text("nombre").notNull().unique(),
});

export const insertCategoriaSchema = createInsertSchema(categoriasTable).omit({ id: true });
export type InsertCategoria = z.infer<typeof insertCategoriaSchema>;
export type Categoria = typeof categoriasTable.$inferSelect;
