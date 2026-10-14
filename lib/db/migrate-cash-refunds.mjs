import { createClient } from "@libsql/client";
import { fileURLToPath } from "node:url";

const databasePath = fileURLToPath(new URL("./data/local.db", import.meta.url));
const client = createClient({ url: `file:${databasePath}` });

try {
  const columns = await client.execute("PRAGMA table_info(cierres_caja)");
  if (!columns.rows.length) {
    throw new Error("No se encontró la tabla cierres_caja. Inicializa primero el esquema.");
  }

  if (!columns.rows.some(column => column.name === "total_reembolsado_efectivo")) {
    await client.execute(
      "ALTER TABLE cierres_caja ADD COLUMN total_reembolsado_efectivo REAL NOT NULL DEFAULT 0",
    );
    console.log("Columna total_reembolsado_efectivo agregada; los cierres existentes conservan valor 0.");
  } else {
    console.log("La columna total_reembolsado_efectivo ya existe.");
  }
} finally {
  await client.close();
}