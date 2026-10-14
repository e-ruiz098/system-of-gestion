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
import fs from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// This file lives at artifacts/api-server/dev.mjs
// Workspace root is two levels up: api-server → artifacts → workspace root
const workspaceRoot = resolve(__dirname, '..', '..');

const envFile = resolve(__dirname, '.env');
if (fs.existsSync(envFile)) {
  const content = fs.readFileSync(envFile, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      const v = trimmed.slice(idx + 1).trim();
      process.env[k] ??= v;
    }
  }
}

process.env.NODE_ENV ??= 'development';
process.env.PORT ??= '8080';
process.env.SESSION_SECRET ??= 'commerce_system_session_secret_12345';
process.env.SQLITE_DB_PATH ??= resolve(workspaceRoot, 'lib', 'db', 'data', 'local.db');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd: __dirname,
      stdio: 'inherit',
      env: process.env,
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
