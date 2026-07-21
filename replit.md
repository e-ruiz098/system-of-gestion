# Sistema de Gestión Comercial (SGC) — POS + Inventario

A full-stack commercial management system (point-of-sale + inventory) for small businesses. Built as a pnpm monorepo with a React frontend and an Express API backend.

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS + shadcn/ui (`artifacts/pos-app`)
- **API**: Express 5 + Pino logger + express-session (`artifacts/api-server`)
- **Database**: PostgreSQL via Drizzle ORM (`lib/db`)
- **Shared libs**: OpenAPI spec (`lib/api-spec`), Zod schemas (`lib/api-zod`), React Query client (`lib/api-client-react`)

## Running the project

Two workflows run concurrently:

| Workflow | Command | Description |
|---|---|---|
| `artifacts/pos-app: web` | `pnpm --filter @workspace/pos-app run dev` | Vite dev server for the React frontend |
| `artifacts/api-server: API Server` | `pnpm --filter @workspace/api-server run dev` | Builds and starts the Express API |

## Environment variables / secrets

| Name | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string — already provisioned |
| `SESSION_SECRET` | Yes | Express session secret — already set as a Replit secret |

## Database

Uses **SQLite** via `better-sqlite3` (local file, no external service required). The database file lives at `lib/db/data/local.db`.

Managed with Drizzle ORM. To apply schema changes:

```bash
pnpm --filter @workspace/db run push
```

The API server dev script sets `SQLITE_DB_PATH=/home/runner/workspace/lib/db/data/local.db` so the bundled output resolves the file correctly regardless of `__dirname` in the esbuild bundle.

## Features

- **Terminal POS**: product search by name/barcode, cart management, multi-payment methods (cash, card, transfer, mixed)
- **Inventory**: product catalog with categories, stock levels, low-stock alerts
- **Cash register**: open/close shifts, cash count reconciliation, audit trail
- **Sales history**: full transaction log with return/refund support
- **User roles**: Admin (full access) and Cajero/Vendedor (restricted to POS + cash register)
- **Configuration**: business info, receipt printer, currency format, color themes

## User preferences

<!-- Add user preferences here as they are stated -->
