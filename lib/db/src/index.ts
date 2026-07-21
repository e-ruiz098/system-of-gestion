import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "path";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";

// When bundled by esbuild, __dirname becomes the dist/ directory, not lib/db/.
// Use SQLITE_DB_PATH env var (set by the api-server dev script) so the path
// always resolves correctly regardless of bundle context.
// Drizzle-kit commands (push) run directly in lib/db/ where __dirname is fine.
const DB_PATH =
  process.env["SQLITE_DB_PATH"] ??
  path.join(__dirname, "../data/local.db");

const DB_DIR = path.dirname(DB_PATH);
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL"); // mejor rendimiento y evita bloqueos

export const db = drizzle(sqlite, { schema });

export * from "./schema";
