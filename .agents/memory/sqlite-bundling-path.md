---
name: SQLite DB path in esbuild bundle
description: How to resolve the better-sqlite3 database path correctly when lib/db is bundled into api-server by esbuild.
---

# SQLite DB path resolution when bundled by esbuild

## The rule
`lib/db/src/index.ts` must use `process.env.SQLITE_DB_PATH` as the primary path source — not `__dirname` — because esbuild inlines the file into `artifacts/api-server/dist/index.mjs`, where `__dirname` resolves to the dist directory instead of `lib/db/`.

**Why:** `better-sqlite3` is externalized in `build.mjs` but `@workspace/db` code is bundled inline. After bundling, the banner sets `globalThis.__dirname` to the directory of the output file (`artifacts/api-server/dist/`), so any `path.join(__dirname, ...)` inside the db module resolves there, not in `lib/db/`.

**How to apply:**
- `lib/db/src/index.ts` reads `process.env.SQLITE_DB_PATH` first, falls back to `__dirname`-relative path (correct for drizzle-kit which runs un-bundled directly in `lib/db/`).
- `artifacts/api-server/package.json` `dev` script exports `SQLITE_DB_PATH=/home/runner/workspace/lib/db/data/local.db`.
- `lib/db/drizzle.config.ts` uses `path.join(__dirname, "./data/local.db")` — this is fine because drizzle-kit runs un-bundled with the real `__dirname`.
- `better-sqlite3` must be listed in both `lib/db/package.json` dependencies AND `artifacts/api-server/package.json` dependencies — pnpm only links it into the api-server's node_modules if it's declared there, and it's needed at runtime since esbuild externalizes it.
- Add `better-sqlite3` to `onlyBuiltDependencies` in `pnpm-workspace.yaml` so its native module compiles on `pnpm install`.
