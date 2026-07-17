import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { ventasTable } from "./ventas";
import { usuariosTable } from "./usuarios";
import { productosTable } from "./productos";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const devolucionesTable = pgTable("devoluciones", {
  id: serial("id").primaryKey(),
  venta_id: integer("venta_id").references(() => ventasTable.id),
  usuario_id: integer("usuario_id").references(() => usuariosTable.id),
  motivo: text("motivo"),
  fecha: timestamp("fecha", { withTimezone: true }).notNull().defaultNow(),
});

export const detalleDevolucionTable = pgTable("detalle_devolucion", {
  id: serial("id").primaryKey(),
  devolucion_id: integer("devolucion_id").references(() => devolucionesTable.id),
  producto_id: integer("producto_id").references(() => productosTable.id),
  cantidad: integer("cantidad").notNull(),
});

export const insertDevolucionSchema = createInsertSchema(devolucionesTable).omit({ id: true, fecha: true });
export type InsertDevolucion = z.infer<typeof insertDevolucionSchema>;
export type Devolucion = typeof devolucionesTable.$inferSelect;

export const insertDetalleDevolucionSchema = createInsertSchema(detalleDevolucionTable).omit({ id: true });
export type InsertDetalleDevolucion = z.infer<typeof insertDetalleDevolucionSchema>;
export type DetalleDevolucion = typeof detalleDevolucionTable.$inferSelect;
