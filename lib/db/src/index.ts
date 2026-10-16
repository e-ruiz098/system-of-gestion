import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client/sqlite3";
import path from "path";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";

function resolveDbPath(): string {
  if (process.env["SQLITE_DB_PATH"]) {
    return process.env["SQLITE_DB_PATH"];
  }

  let curr = __dirname;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(curr, "lib/db/data/local.db");
    if (existsSync(candidate)) return candidate;
    const ws = path.join(curr, "pnpm-workspace.yaml");
    if (existsSync(ws)) return path.join(curr, "lib/db/data/local.db");
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  curr = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(curr, "lib/db/data/local.db");
    if (existsSync(candidate)) return candidate;
    const ws = path.join(curr, "pnpm-workspace.yaml");
    if (existsSync(ws)) return path.join(curr, "lib/db/data/local.db");
    const parent = path.dirname(curr);
    if (parent === curr) break;
    curr = parent;
  }

  return path.join(__dirname, "../data/local.db");
}

const DB_PATH = resolveDbPath();

const DB_DIR = path.dirname(DB_PATH);
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const absolutePath = path.resolve(DB_PATH);
const fileUrl = absolutePath.startsWith("file:") ? absolutePath : `file:${absolutePath}`;

const client = createClient({
  url: fileUrl,
});

// Run schema migration checks safely
async function runMigrations() {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS movimientos_stock (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        producto_id INTEGER NOT NULL REFERENCES productos(id),
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id),
        tipo TEXT NOT NULL DEFAULT 'ingreso',
        motivo TEXT,
        stock_anterior REAL NOT NULL,
        renglones TEXT NOT NULL,
        total_ingresado REAL NOT NULL,
        stock_resultante REAL NOT NULL,
        fecha INTEGER NOT NULL DEFAULT (unixepoch()),
        anulado INTEGER NOT NULL DEFAULT 0,
        motivo_anulacion TEXT,
        anulado_por_usuario INTEGER REFERENCES usuarios(id),
        fecha_anulacion INTEGER
      );
    `);
    await client.execute(`ALTER TABLE movimientos_stock ADD COLUMN tipo TEXT NOT NULL DEFAULT 'ingreso';`).catch(() => {});
    await client.execute(`ALTER TABLE movimientos_stock ADD COLUMN motivo TEXT;`).catch(() => {});
    await client.execute(`ALTER TABLE movimientos_stock ADD COLUMN anulado INTEGER NOT NULL DEFAULT 0;`).catch(() => {});
    await client.execute(`ALTER TABLE movimientos_stock ADD COLUMN motivo_anulacion TEXT;`).catch(() => {});
    await client.execute(`ALTER TABLE movimientos_stock ADD COLUMN anulado_por_usuario INTEGER REFERENCES usuarios(id);`).catch(() => {});
    await client.execute(`ALTER TABLE movimientos_stock ADD COLUMN fecha_anulacion INTEGER;`).catch(() => {});

    // Migration: Identify historical decimal products and set unidad_tipo = 'kg' ("Admite decimales = Sí")
    await client.execute(`
      UPDATE productos
      SET unidad_tipo = 'kg'
      WHERE id IN (
        SELECT id FROM productos WHERE (stock % 1) != 0
        UNION
        SELECT DISTINCT producto_id FROM detalle_venta WHERE (cantidad % 1) != 0 AND producto_id IS NOT NULL
        UNION
        SELECT DISTINCT producto_id FROM detalle_devolucion WHERE (cantidad % 1) != 0 AND producto_id IS NOT NULL
      );
    `).catch(() => {});
  } catch (err) {
    // ignore
  }
}

runMigrations();

export const db = drizzle(client, { schema });

export * from "./schema";
export * from "./utils/rounding";
export * from "./utils/caja-montos";
