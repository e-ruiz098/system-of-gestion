import { sqliteTable, integer, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usuariosTable = sqliteTable("usuarios", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  nombre: text("nombre").notNull(),
  password_hash: text("password_hash").notNull(),
  rol: text("rol", { enum: ["admin", "vendedor"] }).notNull(),
  activo: integer("activo", { mode: "boolean" }).notNull().default(true),
  creado_en: integer("creado_en", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const insertUsuarioSchema = createInsertSchema(usuariosTable).omit({ id: true, creado_en: true });
export type InsertUsuario = z.infer<typeof insertUsuarioSchema>;
export type Usuario = typeof usuariosTable.$inferSelect;
