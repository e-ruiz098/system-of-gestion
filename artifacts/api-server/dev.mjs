/**
 * Cross-platform dev launcher for api-server.
 * Works on Windows (PowerShell / cmd), macOS, and Linux.
 *
 * - Computes SQLITE_DB_PATH relative to this file so no path is ever hardcoded.
 * - Sets NODE_ENV=development if not already set.
 * - Runs `pnpm run build` then `pnpm run start` in sequence.
 */

import { spawn } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// This file lives at artifacts/api-server/dev.mjs
// Workspace root is two levels up: api-server → artifacts → workspace root
const workspaceRoot = resolve(__dirname, '..', '..');

process.env.NODE_ENV ??= 'development';
process.env.SQLITE_DB_PATH ??= resolve(workspaceRoot, 'lib', 'db', 'data', 'local.db');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      stdio: 'inherit',
      // On Windows, pnpm must be invoked through the shell.
      shell: process.platform === 'win32',
    });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`"${cmd} ${args.join(' ')}" exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

try {
  await run('pnpm', ['run', 'build']);
  await run('pnpm', ['run', 'start']);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
