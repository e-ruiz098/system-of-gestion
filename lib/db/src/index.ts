import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client/sqlite3";
import path from "path";
import { mkdirSync, existsSync } from "fs";
import * as schema from "./schema";

const DB_PATH =
  process.env["SQLITE_DB_PATH"] ??
  path.join(__dirname, "../data/local.db");

const DB_DIR = path.dirname(DB_PATH);
if (!existsSync(DB_DIR)) {
  mkdirSync(DB_DIR, { recursive: true });
}

const absolutePath = path.resolve(DB_PATH);
const fileUrl = absolutePath.startsWith("file:") ? absolutePath : `file:${absolutePath}`;

const client = createClient({
  url: fileUrl,
});

export const db = drizzle(client, { schema });

export * from "./schema";