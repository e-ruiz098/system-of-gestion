#!/usr/bin/env node
/**
 * cargar-categorias.mjs
 * ─────────────────────
 * Resetea y recarga las 15 categorías principales + 78 subcategorías en la BD.
 * ⚠ BORRA todas las categorías existentes y pone categoria_id = NULL en productos.
 *
 * Uso:
 *   node cargar-categorias.mjs
 */

import { createClient } from "@libsql/client/sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "lib/db/data/local.db");

const ESTRUCTURA = [
  { nombre: "Alimentos Frescos",       subs: ["Verduras", "Frutas", "Huevos", "Tofu y Alternativas Vegetales"] },
  { nombre: "Carnes y Pescados",        subs: ["Vacuno", "Cerdo", "Pollo y Aves", "Cordero y Cabrito", "Achuras y Menudencias", "Pescados", "Mariscos", "Fiambres y Embutidos"] },
  { nombre: "Lácteos y Quesos",         subs: ["Leche", "Yogur", "Quesos", "Manteca y Crema", "Bebidas Lácteas"] },
  { nombre: "Panadería y Repostería",   subs: ["Pan Fresco", "Facturas y Medialunas", "Tortas y Budines", "Galletitas Dulces", "Galletitas Saladas"] },
  { nombre: "Bebidas",                  subs: ["Aguas y Sodas", "Gaseosas", "Jugos y Néctares", "Energizantes e Isotónicas", "Vinos", "Cervezas", "Espirituosas", "Aperitivos"] },
  { nombre: "Almacén",                  subs: ["Arroz y Fideos", "Harinas", "Azúcar y Sal", "Aceites y Aderezos", "Conservas y Enlatados", "Legumbres y Cereales", "Sopas y Caldos", "Desayuno y Merienda"] },
  { nombre: "Snacks y Golosinas",       subs: ["Papas Fritas y Snacks", "Chocolates", "Alfajores", "Caramelos y Chicles", "Barras de Cereal"] },
  { nombre: "Congelados",               subs: ["Verduras Congeladas", "Carnes Congeladas", "Precocidos y Empanados", "Helados y Postres Fríos"] },
  { nombre: "Limpieza del Hogar",       subs: ["Detergentes y Lavandinas", "Limpiadores Multiuso", "Papel Higiénico y Servilletas", "Bolsas y Film", "Desodorantes de Ambiente"] },
  { nombre: "Higiene Personal",         subs: ["Jabones y Shampoo", "Desodorantes", "Cepillos y Pastas Dentales", "Afeitado y Depilación", "Protección Solar y Cremas"] },
  { nombre: "Bebé y Maternidad",        subs: ["Pañales", "Toallitas Húmedas", "Leche de Fórmula", "Alimentos para Bebé", "Cuidado e Higiene Bebé"] },
  { nombre: "Mascotas",                 subs: ["Alimento para Perros", "Alimento para Gatos", "Alimento para Otras Mascotas", "Accesorios y Juguetes"] },
  { nombre: "Ferretería y Hogar",       subs: ["Herramientas", "Pilas y Electricidad", "Utensilios de Cocina", "Almacenamiento y Organización"] },
  { nombre: "Salud y Cuidado Personal", subs: ["Medicamentos sin Receta", "Vitaminas y Suplementos", "Primeros Auxilios", "Cuidado de la Vista", "Cuidado Íntimo"] },
  { nombre: "Otros",                    subs: ["Tabaquería", "Librería y Bazar", "Estacional"] },
];

const client = createClient({ url: `file:${DB_PATH}` });

console.log("\n⚠  Limpiando categorías existentes...");
await client.execute("UPDATE productos SET categoria_id = NULL");
await client.execute("DELETE FROM categorias");
await client.execute("DELETE FROM sqlite_sequence WHERE name = 'categorias'");

console.log("📦 Cargando categorías...\n");
let main = 0, sub = 0;

for (const cat of ESTRUCTURA) {
  const r = await client.execute({ sql: "INSERT INTO categorias (nombre, parent_id) VALUES (?, NULL)", args: [cat.nombre] });
  const parentId = Number(r.lastInsertRowid);
  main++;
  console.log(`  ✅ [${parentId}] ${cat.nombre}`);
  for (const s of cat.subs) {
    const rs = await client.execute({ sql: "INSERT INTO categorias (nombre, parent_id) VALUES (?, ?)", args: [s, parentId] });
    sub++;
    console.log(`       ↳ [${rs.lastInsertRowid}] ${s}`);
  }
}

await client.close();
console.log(`\n✅ Listo: ${main} categorías principales, ${sub} subcategorías.\n`);
