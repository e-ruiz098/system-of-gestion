#!/usr/bin/env node
/**
 * reset-admin.mjs
 * ───────────────
 * Recuperación de acceso local — resetea la contraseña del administrador
 * sin borrar ningún dato (ventas, productos, caja, etc.).
 *
 * Uso:
 *   node reset-admin.mjs
 *
 * También podés pasar usuario y contraseña directo:
 *   node reset-admin.mjs admin NuevaPassword123
 */

import { createClient } from "@libsql/client/sqlite3";
import { createInterface } from "readline";
import { createHash, randomBytes } from "crypto";
import path from "path";
import { existsSync } from "fs";
import { fileURLToPath } from "url";

// ── Localizar la base de datos ────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.join(__dirname, "lib/db/data/local.db");

if (!existsSync(DB_PATH)) {
  console.error(`\n❌ No se encontró la base de datos en:\n   ${DB_PATH}\n`);
  console.error("Asegúrate de haber iniciado el sistema al menos una vez.");
  process.exit(1);
}

// ── Función para leer input en la terminal (oculta el password) ───────────────
function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    if (hidden && process.stdin.isTTY) {
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      process.stdin.resume();
      let input = "";
      process.stdin.on("data", (char) => {
        char = char.toString();
        if (char === "\n" || char === "\r" || char === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write("\n");
          rl.close();
          resolve(input);
        } else if (char === "\u0003") {
          process.exit();
        } else if (char === "\u007f") {
          if (input.length > 0) {
            input = input.slice(0, -1);
            process.stdout.clearLine(0);
            process.stdout.cursorTo(0);
            process.stdout.write(question + "●".repeat(input.length));
          }
        } else {
          input += char;
          process.stdout.write("●");
        }
      });
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

// ── Hash bcrypt simple (implementación nativa sin dependencias extra) ─────────
// Usamos el módulo bcryptjs que ya está instalado en el workspace
async function hashPassword(password) {
  // Importar bcryptjs desde el workspace
  const bcryptPath = path.join(__dirname, "artifacts/api-server/node_modules/bcryptjs/dist/bcrypt.js");
  if (!existsSync(bcryptPath)) {
    // Fallback: buscar en node_modules raíz
    const { default: bcrypt } = await import("bcryptjs");
    return bcrypt.hash(password, 12);
  }
  const { default: bcrypt } = await import(bcryptPath);
  return bcrypt.hash(password, 12);
}

// ── Main ──────────────────────────────────────────────────────────────────────
console.log("\n╔══════════════════════════════════════════════╗");
console.log("║   RECUPERACIÓN DE ACCESO — Sistema Comercial ║");
console.log("╚══════════════════════════════════════════════╝\n");

const client = createClient({ url: `file:${DB_PATH}` });

// Listar admins disponibles
const { rows: admins } = await client.execute(
  "SELECT id, nombre FROM usuarios WHERE rol = 'admin' AND activo = 1"
);

if (admins.length === 0) {
  console.error("❌ No hay usuarios administradores activos en la base de datos.");
  console.error("   El sistema no fue configurado aún o todos los admins fueron desactivados.\n");
  await client.close();
  process.exit(1);
}

console.log("Administradores disponibles:");
admins.forEach((a, i) => console.log(`  [${i + 1}] ${a.nombre}`));
console.log();

// Obtener usuario del argumento o preguntar
let nombreUsuario = process.argv[2];
if (!nombreUsuario) {
  nombreUsuario = await prompt("Usuario a resetear: ");
}
nombreUsuario = nombreUsuario.trim();

const admin = admins.find(a => a.nombre === nombreUsuario);
if (!admin) {
  console.error(`\n❌ No se encontró el administrador "${nombreUsuario}".\n`);
  await client.close();
  process.exit(1);
}

// Obtener nueva contraseña del argumento o preguntar
let newPassword = process.argv[3];
if (!newPassword) {
  newPassword = await prompt("Nueva contraseña (mín. 8 caracteres): ", true);
}

if (!newPassword || newPassword.length < 8) {
  console.error("\n❌ La contraseña debe tener al menos 8 caracteres.\n");
  await client.close();
  process.exit(1);
}

if (newPassword.length > 200) {
  console.error("\n❌ La contraseña es demasiado larga (máximo 200 caracteres).\n");
  await client.close();
  process.exit(1);
}

// Confirmar contraseña
let confirmPassword = process.argv[3]; // si vino por arg no pedimos confirmación
if (!confirmPassword) {
  confirmPassword = await prompt("Confirmar contraseña: ", true);
  if (newPassword !== confirmPassword) {
    console.error("\n❌ Las contraseñas no coinciden.\n");
    await client.close();
    process.exit(1);
  }
}

// Hashear y actualizar
console.log("\n⏳ Aplicando cambio...");
try {
  const hash = await hashPassword(newPassword);
  await client.execute({
    sql: "UPDATE usuarios SET password_hash = ? WHERE id = ? AND rol = 'admin'",
    args: [hash, admin.id],
  });

  console.log(`\n✅ Contraseña de "${nombreUsuario}" actualizada correctamente.`);
  console.log("   Podés iniciar sesión ahora con la nueva contraseña.\n");
} catch (err) {
  console.error("\n❌ Error al actualizar la contraseña:", err.message, "\n");
  process.exit(1);
} finally {
  await client.close();
}
