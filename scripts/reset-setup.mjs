import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const { createClient } = require(path.resolve(rootDir, 'lib/db/node_modules/@libsql/client'));
const dbPath = path.resolve(rootDir, 'lib/db/data/local.db');
const client = createClient({ url: `file:${dbPath}` });

async function main() {
  await client.execute('DELETE FROM configuracion');
  await client.execute('DELETE FROM usuarios');
  console.log('✓ Se ha restablecido el estado de instalación inicial.');
  console.log('  Ahora puedes abrir http://localhost:5173/ y realizar el asistente de configuración (pasos 1 a 6) desde cero.');
}

main().catch((err) => {
  console.error("Error al reiniciar configuración:", err);
  process.exit(1);
});
