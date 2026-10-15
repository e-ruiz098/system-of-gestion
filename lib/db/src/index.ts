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
client.execute(`
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
    fecha INTEGER NOT NULL DEFAULT (unixepoch())
  );
`).then(() => {
  client.execute(`ALTER TABLE movimientos_stock ADD COLUMN tipo TEXT NOT NULL DEFAULT 'ingreso';`).catch(() => {});
  client.execute(`ALTER TABLE movimientos_stock ADD COLUMN motivo TEXT;`).catch(() => {});
}).catch(() => {});

export const db = drizzle(client, { schema });

export * from "./schema";
export * from "./utils/rounding";
export * from "./utils/caja-montos";
