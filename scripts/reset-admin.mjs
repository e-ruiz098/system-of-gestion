import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const bcrypt = require(path.resolve(rootDir, 'artifacts/api-server/node_modules/bcryptjs'));
const { createClient } = require(path.resolve(rootDir, 'lib/db/node_modules/@libsql/client'));

const dbPath = path.resolve(rootDir, 'lib/db/data/local.db');
const client = createClient({ url: `file:${dbPath}` });

const username = process.argv[2] || 'ER';
const password = process.argv[3] || 'admin123';

async function main() {
  const hash = bcrypt.hashSync(password, 10);
  const existing = await client.execute(
    `SELECT * FROM usuarios WHERE nombre = '${username.replace(/'/g, "''")}'`
  );

  if (existing.rows.length > 0) {
    await client.execute(
      `UPDATE usuarios SET password_hash = '${hash}', rol = 'admin', activo = 1 WHERE nombre = '${username.replace(/'/g, "''")}'`
    );
    console.log(`✓ Contraseña del usuario administrador "${username}" actualizada exitosamente.`);
  } else {
    await client.execute(
      `INSERT INTO usuarios (nombre, password_hash, rol, activo) VALUES ('${username.replace(/'/g, "''")}', '${hash}', 'admin', 1)`
    );
    console.log(`✓ Usuario administrador "${username}" creado exitosamente.`);
  }
  console.log(`  Usuario: "${username}"`);
  console.log(`  Contraseña: "${password}"`);
}

main().catch((err) => {
  console.error("Error al restablecer administrador:", err);
  process.exit(1);
});
