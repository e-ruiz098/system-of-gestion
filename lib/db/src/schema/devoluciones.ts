import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { ventasTable } from "./ventas";
import { usuariosTable } from "./usuarios";
import { productosTable } from "./productos";
import { aperturasCajaTable } from "./caja";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const devolucionesTable = sqliteTable("devoluciones", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  venta_id: integer("venta_id").references(() => ventasTable.id),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  apertura_caja_id: integer("apertura_caja_id").references(() => aperturasCajaTable.id),
  tipo: text("tipo", { enum: ["devolucion", "cambio"] }).notNull().default("devolucion"),
  nombre_comprador: text("nombre_comprador").notNull(),
  motivo: text("motivo").notNull(),
  metodo_reembolso: text("metodo_reembolso", { enum: ["efectivo", "tarjeta", "transferencia"] }).notNull(),
  subtotal: real("subtotal").notNull().default(0),
  ajuste_redondeo: real("ajuste_redondeo").notNull().default(0),
  total_reembolso: real("total_reembolso").notNull(),
  venta_nueva_id: integer("venta_nueva_id").references(() => ventasTable.id),
  fecha: integer("fecha", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});

export const detalleDevolucionTable = sqliteTable("detalle_devolucion", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  devolucion_id: integer("devolucion_id").references(() => devolucionesTable.id),
  producto_id: integer("producto_id").references(() => productosTable.id),
  cantidad: real("cantidad").notNull(),
  precio_unitario: real("precio_unitario").notNull(),
  subtotal: real("subtotal").notNull(),
  reingresa_stock: integer("reingresa_stock").notNull().default(1),
});

export const insertDevolucionSchema = createInsertSchema(devolucionesTable).omit({ id: true, fecha: true });
export type InsertDevolucion = z.infer<typeof insertDevolucionSchema>;
export type Devolucion = typeof devolucionesTable.$inferSelect;

export const insertDetalleDevolucionSchema = createInsertSchema(detalleDevolucionTable).omit({ id: true });
export type InsertDetalleDevolucion = z.infer<typeof insertDetalleDevolucionSchema>;
export type DetalleDevolucion = typeof detalleDevolucionTable.$inferSelect;
