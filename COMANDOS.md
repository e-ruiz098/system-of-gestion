# Comandos del Sistema Comercial

## Iniciar el sistema

```bash
pnpm dev
```

Esto arranca los dos servicios al mismo tiempo:
- **API** → `http://localhost:8080`
- **App** → `http://localhost:5173` ← esta es la que abrís en el navegador

---

## Si el puerto 8080 ya está en uso (error EADDRINUSE)

Pasa cuando cerraste la terminal sin apagar el servidor. Ejecutá esto antes de `pnpm dev`:

```bash
lsof -ti:8080 | xargs kill -9
```

---

## Olvidaste la contraseña del administrador

Con el servidor **apagado**, ejecutá desde la carpeta del proyecto:

```bash
node reset-admin.mjs
```

El script te va a preguntar:
1. El nombre de usuario del admin (por ejemplo: `admin`)
2. La nueva contraseña (mínimo 8 caracteres, se muestra oculta con ●●●)
3. Confirmar la contraseña

Si ya sabés qué vas a poner, podés pasarlo todo de una:

```bash
node reset-admin.mjs admin NuevaPassword123
```

> ⚠️ Este comando **no borra ningún dato** — ventas, productos, caja, todo queda intacto.

---

## Resetear todo desde cero (como si fuera la primera vez)

Esto **borra todo**: usuarios, configuración, ventas, productos, caja, devoluciones.

Con el servidor **apagado**:

```bash
node --input-type=module << 'EOF'
import { createClient } from "@libsql/client/sqlite3";
const client = createClient({ url: "file:lib/db/data/local.db" });
for (const t of ["detalle_devolucion","devoluciones","detalle_venta","ventas","cierres_caja","aperturas_caja","productos","categorias","usuarios","configuracion","sqlite_sequence"]) {
  try { await client.execute(`DELETE FROM ${t}`); } catch {}
}
console.log("✅ Base de datos limpia.");
await client.close();
EOF
```

Después de esto, la próxima vez que abras `http://localhost:5173` te va a aparecer el wizard de configuración inicial (6 pasos).

---

## Estructura del proyecto

```
Commerce-Systemzip/
├── artifacts/
│   ├── api-server/     ← Backend (Express + SQLite)
│   └── pos-app/        ← Frontend (React + Vite)
├── lib/
│   └── db/
│       └── data/
│           └── local.db  ← Base de datos SQLite (todos los datos están acá)
├── reset-admin.mjs     ← Script para resetear contraseña
└── COMANDOS.md         ← Este archivo
```

---

## Cargar categorías de productos

Si borraste la base de datos o querés repoblar las categorías desde cero:

```bash
node cargar-categorias.mjs
```

Carga 110+ categorías organizadas (Carnicería, Verduras, Fideos, Lácteos, Limpieza, etc.). Si ya existen las salta, así que se puede correr más de una vez sin problema.

---

## Hacer una copia de seguridad de los datos

La base de datos es un solo archivo. Copialo a donde quieras:

```bash
cp lib/db/data/local.db ~/Escritorio/backup-$(date +%Y%m%d).db
```

Para restaurar un backup, reemplazá el archivo:

```bash
cp ~/Escritorio/backup-20260925.db lib/db/data/local.db
```

## Actualizar el esquema de caja sin perder cierres

Antes de iniciar una versión que guarda los reembolsos en efectivo en el cierre,
hacé una copia de seguridad y ejecutá la migración aditiva e idempotente:

```bash
pnpm --filter @workspace/db run migrate:cash-refunds
```
