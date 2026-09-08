# Sistema de Gestión Comercial (SGC) — POS + Inventario

Full-stack commercial management system (point-of-sale + inventory) for small businesses. Built as a pnpm monorepo with a React frontend and an Express API backend.

## Stack

- **Frontend**: React 19 + Vite + Tailwind CSS + shadcn/ui (`artifacts/pos-app`)
- **API**: Express 5 + Pino logger + express-session (`artifacts/api-server`)
- **Database**: SQLite via Drizzle ORM + better-sqlite3 (`lib/db`)
- **Shared libs**: OpenAPI spec (`lib/api-spec`), Zod schemas (`lib/api-zod`), React Query client (`lib/api-client-react`)

## Prerequisites

- [Node.js](https://nodejs.org/) v20+
- [pnpm](https://pnpm.io/) v9+

## Installation

```bash
pnpm install
```

## Running the project

Open two terminals and run each command in a separate one:

```bash
# Terminal 1 — API server (Express, port 8080 by default)
pnpm --filter @workspace/api-server run dev

# Terminal 2 — Frontend (Vite, port 5173 by default)
API_PORT=8080 pnpm --filter @workspace/pos-app run dev
```

The frontend will be available at <http://localhost:5173>.

## Environment variables

### API server (`artifacts/api-server/.env.example`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Port the Express server listens on |
| `SESSION_SECRET` | — | Secret for signing session cookies (required) |
| `SQLITE_DB_PATH` | auto-computed | Absolute path to the SQLite file. Set automatically by `dev.mjs`; override for custom locations |

### Frontend (`artifacts/pos-app/.env.example`)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5173` | Port the Vite dev server listens on |
| `BASE_PATH` | `/` | URL base path for the app |
| `API_PORT` | — | When set, Vite proxies `/api/*` to `http://localhost:<API_PORT>` |

## Database

Uses **SQLite** (`lib/db/data/local.db`) — no external service required. The file is created automatically on first run.

To apply schema changes after editing `lib/db/src/schema/`:

```bash
pnpm --filter @workspace/db run push
```

## Features

- **Terminal POS**: product search by name/barcode, cart management, multi-payment methods (cash, card, transfer, mixed)
- **Inventory**: product catalog with categories, stock levels, low-stock alerts
- **Cash register**: open/close shifts, cash count reconciliation, audit trail
- **Sales history**: full transaction log with return/refund support
- **User roles**: Admin (full access) and Cajero/Vendedor (restricted to POS + cash register)
- **Configuration**: business info, receipt printer, currency format, color themes
