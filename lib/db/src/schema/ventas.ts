import { sqliteTable, integer, real, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { usuariosTable } from "./usuarios";
import { aperturasCajaTable } from "./caja";
import { productosTable } from "./productos";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const ventasTable = sqliteTable("ventas", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  numero_ticket: integer("numero_ticket").unique(),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  apertura_caja_id: integer("apertura_caja_id").references(() => aperturasCajaTable.id),
  nombre_comprador: text("nombre_comprador"),
  subtotal: real("subtotal").notNull().default(0),
  ajuste_redondeo: real("ajuste_redondeo").notNull().default(0),
  total: real("total").notNull(),
  metodo_pago: text("metodo_pago", { enum: ["efectivo", "tarjeta", "transferencia", "mixto", "cambio"] }),
  monto_efectivo: real("monto_efectivo").notNull().default(0),
  monto_tarjeta: real("monto_tarjeta").notNull().default(0),
  monto_transferencia: real("monto_transferencia").notNull().default(0),
  detalle_pago_mixto: text("detalle_pago_mixto"),
  fecha: integer("fecha", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
  anulada: integer("anulada", { mode: "boolean" }).notNull().default(false),
  anulada_por_usuario: integer("anulada_por_usuario").references(() => usuariosTable.id),
  fecha_anulacion: integer("fecha_anulacion", { mode: "timestamp" }),
});

export const detalleVentaTable = sqliteTable("detalle_venta", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  venta_id: integer("venta_id").references(() => ventasTable.id),
  producto_id: integer("producto_id").references(() => productosTable.id),
  cantidad: real("cantidad").notNull(),
  precio_unitario: real("precio_unitario").notNull(),
  subtotal: real("subtotal").notNull(),
});

export const insertVentaSchema = createInsertSchema(ventasTable).omit({ id: true, fecha: true, numero_ticket: true });
export type InsertVenta = z.infer<typeof insertVentaSchema>;
export type Venta = typeof ventasTable.$inferSelect;

export const insertDetalleVentaSchema = createInsertSchema(detalleVentaTable).omit({ id: true });
export type InsertDetalleVenta = z.infer<typeof insertDetalleVentaSchema>;
export type DetalleVenta = typeof detalleVentaTable.$inferSelect;
