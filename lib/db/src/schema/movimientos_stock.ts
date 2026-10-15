import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { productosTable } from "./productos";
import { usuariosTable } from "./usuarios";

export const movimientosStockTable = sqliteTable("movimientos_stock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  producto_id: integer("producto_id").notNull().references(() => productosTable.id),
  usuario_id: integer("usuario_id").notNull().references(() => usuariosTable.id),
  tipo: text("tipo").notNull().default("ingreso"), // "stock_inicial" | "ingreso" | "ajuste" | "anulacion"
  motivo: text("motivo"), // Motivo si disminuye stock o ajuste manual
  stock_anterior: real("stock_anterior").notNull(),
  renglones: text("renglones").notNull(), // JSON string e.g. "[12.4, 11.8, 13.1, 10.7]"
  total_ingresado: real("total_ingresado").notNull(),
  stock_resultante: real("stock_resultante").notNull(),
  fecha: integer("fecha", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  anulado: integer("anulado", { mode: "boolean" }).notNull().default(false),
  motivo_anulacion: text("motivo_anulacion"),
  anulado_por_usuario: integer("anulado_por_usuario").references(() => usuariosTable.id),
  fecha_anulacion: integer("fecha_anulacion", { mode: "timestamp" }),
});

export type MovimientoStock = typeof movimientosStockTable.$inferSelect;
