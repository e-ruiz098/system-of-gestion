import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { productosTable } from "./productos";
import { usuariosTable } from "./usuarios";

export const movimientosStockTable = sqliteTable("movimientos_stock", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  producto_id: integer("producto_id").notNull().references(() => productosTable.id),
  usuario_id: integer("usuario_id").notNull().references(() => usuariosTable.id),
  stock_anterior: real("stock_anterior").notNull(),
  renglones: text("renglones").notNull(), // JSON string e.g. "[12.4, 11.8, 13.1, 10.7]"
  total_ingresado: real("total_ingresado").notNull(),
  stock_resultante: real("stock_resultante").notNull(),
  fecha: integer("fecha", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export type MovimientoStock = typeof movimientosStockTable.$inferSelect;
