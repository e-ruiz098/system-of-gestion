# Commerce System — Prompts para devoluciones, cambios y caja

Cómo usar este archivo:

1. Antes de empezar, hacé una copia de `lib/db/data/local.db` (los prompts 2, 3, 4 y 5 tocan el esquema o la lógica de dinero).
2. Pegá **un prompt a la vez**, en orden (1 → 2 → 3 → 4 → 5). No pases al siguiente hasta que la verificación final del anterior salga bien en el navegador.
3. Todos asumen que ya están hechos los prompts anteriores del Terminal POS (panel de último producto, Cantidad con F4, modo "Eliminar Productos", blindaje de cantidades y consolidación de productos repetidos).

Reglas de negocio que definimos (los prompts las repiten para que cada uno se entienda solo):

- Una devolución **no anula ni modifica** el ticket original. Funciona como una **nota de crédito** ligada a ese ticket.
- El dinero de una devolución **sale de la caja abierta en el momento de devolver**, nunca de la caja del día de la venta (que puede estar cerrada).
- Plazo para devolver: **48 horas** desde la venta (configurable).
- Un producto devuelto **vuelve al stock solo si está en condiciones de revenderse**.
- El **cambio** es una devolución + una venta nueva, cerradas juntas, donde el sistema calcula la diferencia.
- **Redondeo de cobros:** el total de cada venta se redondea **siempre hacia abajo** al múltiplo de 50 Gs (12.358 → 12.350; 12.399 → 12.350; 12.301 → 12.300). Nunca a 100 ni hacia arriba. Aplica también a la diferencia de un cambio y al monto de una devolución.

---

# PROMPT 1 — Corregir tres huecos en el POS y en el servidor de ventas

## Contexto
Se auditó el código actual del Terminal POS (`artifacts/pos-app/src/pages/venta.tsx`) y de la ruta de ventas (`artifacts/api-server/src/routes/ventas.ts`) contra los prompts de "Blindaje de cantidades" y "Consolidar productos repetidos". La mayor parte ya funciona (consolidación en cualquier orden, bloqueo de negativos, aviso de stock). Faltan tres cosas en el frontend y dos en el servidor. **No rehacer lo que ya funciona**; solo corregir esto.

## 1. Restar hasta llegar a cero debe eliminar la fila
Hoy, en los controles de cantidad de cada fila del carrito, si una resta dejaría la cantidad en cero o menos, el sistema simplemente ignora el clic y la fila queda con su cantidad anterior. Lo pedido era distinto: si la cantidad de una fila llega a cero, **la fila se elimina del carrito** (y se actualiza el panel de "Último producto cargado" igual que cuando se elimina desde el modo Eliminar Productos). Tampoco debe quedar nunca una fila con cantidad cero o negativa por ningún camino.

## 2. El aviso de "Stock Insuficiente" no debe depender de un efecto secundario dentro del actualizador de estado
En la función que agrega un producto al carrito, la decisión de "superó el stock" se toma **dentro** de la función que se le pasa a la actualización del carrito, y después se lee una variable externa para decidir si mostrar el modal. Con React 19 ese cálculo puede ejecutarse más tarde de lo que se lee la variable, y el modal a veces no aparece aunque el producto no se haya agregado (o al revés). Rehacer esa lógica para que:

- Primero se calcule, usando el estado actual del carrito, cuánto quedaría en total (cantidad ya en el carrito + cantidad pendiente) y se compare contra el stock del producto.
- Solo si entra dentro del stock se actualice el carrito.
- Si no entra, se muestre el modal de Stock Insuficiente / Producto Agotado (el mismo de siempre, con el nombre del producto y el stock disponible) y el carrito quede exactamente como estaba.
- La misma corrección se revise en los demás puntos donde hoy se dispara ese aviso desde dentro de una actualización de estado (botones de más/menos y edición directa de la cantidad de una fila).

Además, hoy el stock que se compara es una copia guardada en la fila del carrito. Debe compararse contra el stock **actual** del producto (el de la lista de productos cargada), para que si el stock cambió mientras el carrito estaba abierto no se acepte una cantidad que ya no está disponible.

## 3. Verificación en el servidor: consolidar y validar el stock sumado
Hoy `POST /ventas` valida el stock línea por línea. Si llegara un pedido con dos líneas del mismo producto (por un bug futuro, otra pantalla, o alguien llamando a la API directamente), cada línea pasa la validación por separado y en total se vendería más de lo que hay. Corregir para que el servidor:

- **Consolide** las líneas del pedido que tengan el mismo `producto_id` en una sola línea con la cantidad sumada, antes de validar y antes de guardar.
- Valide el stock contra la **cantidad total consolidada**.
- Guarde en `detalle_venta` una sola fila por producto por venta.
- Ignore cualquier precio que venga del cliente (esto ya se hace; no romperlo).

## Verificación final pedida
No alcanza con "compila sin errores". Probar en el navegador:
1. Agregar un producto con cantidad 2 al carrito, restar de a uno con el control de la fila: al llegar a cero la fila desaparece y no queda ninguna fila con cantidad 0.
2. Producto con stock 3: escanear tres veces (queda cantidad 3), escanear una cuarta vez. Debe aparecer el modal de Stock Insuficiente **todas** las veces, sin excepción, y el carrito debe quedar en 3.
3. Cargar una cantidad pendiente (F4) mayor al stock y escanear: modal de Stock Insuficiente y el producto NO se agrega.
4. Llamar directamente a `POST /api/ventas` con dos líneas del mismo producto que juntas superen el stock: debe rechazarse. Con dos líneas que juntas sí entran: debe guardarse una sola fila en `detalle_venta` con la cantidad sumada.

---

# PROMPT 2 — Redondeo de cobros a múltiplos de 50 Gs (siempre hacia abajo)

## Contexto
La moneda del negocio es el guaraní. Las monedas son de 50, 100, 500 y 1.000 Gs, y los billetes de 2.000, 5.000, 10.000, 20.000, 50.000 y 100.000 Gs. No existe nada menor a 50 Gs, así que los totales se ajustan para poder cobrar y dar vuelto sin fracciones imposibles.

**Antes de tocar nada:** leer cómo se calcula hoy el total en `venta.tsx`, en `POST /ventas` (`ventas.ts`), en el ticket y en el cierre de caja. Hacer backup de `lib/db/data/local.db`. Las ventas que ya existen no se modifican (para ellas el redondeo es 0).

## La regla (exacta)
El total de la venta se redondea **siempre hacia abajo al múltiplo de 50 más cercano** que sea menor o igual. **Nunca hacia arriba y nunca a 100.** Ejemplos que deben cumplirse:

- 12.358 → 12.350
- 12.399 → 12.350
- 12.301 → 12.300
- 12.350 → 12.350 (ya es múltiplo, no cambia)
- 12.349 → 12.300
- 12.050 → 12.050
- Si el subtotal es menor a 50 Gs, no se redondea a cero: se cobra el monto exacto.

## Dónde se aplica
1. **Terminal POS:** en la zona del total, mostrar el subtotal exacto, una línea chica "Redondeo" (por ejemplo −8) y el **Total a cobrar** ya redondeado, en grande. Todo lo que sigue (efectivo recibido, vuelto, pago mixto, tarjeta, transferencia) trabaja con el **Total a cobrar**. El vuelto es lo que entrega el cliente menos el Total a cobrar. En pago mixto, las partes deben sumar exactamente el Total a cobrar.
2. **Servidor (`POST /ventas`):** recalcular siempre el subtotal desde los precios reales de los productos, aplicar la regla y guardar tres datos por venta: **subtotal exacto**, **ajuste por redondeo** (número negativo o cero) y **total cobrado**. Se ignora cualquier total que mande el cliente. Validar los pagos contra el total cobrado.
3. **Ticket y PDF del historial:** mostrar subtotal, redondeo y total cobrado.
4. **Caja, dashboard e historial:** trabajan con el **total cobrado** (el efectivo esperado del cierre se calcula con lo realmente cobrado). En el cierre de caja, mostrar como dato informativo la suma de "Redondeos aplicados" del período.
5. **Todos los métodos de pago:** el total de la venta se redondea una sola vez, sin importar el método (efectivo, tarjeta, transferencia o mixto). No se hace un redondeo distinto por método.
6. **Configuración:** una opción "Redondeo de cobros" activada por defecto, con el valor del múltiplo (50) editable. La dirección (hacia abajo) queda fija. Con la opción apagada, el sistema cobra el total exacto como hasta ahora.
7. **Precios de productos:** no se tocan. El precio unitario guardado en cada línea de la venta sigue siendo el exacto; el redondeo se aplica solo al total de la venta.
8. **Devoluciones y cambios:** el monto a devolver o la diferencia de un cambio se redondean con la misma regla (hacia abajo, al múltiplo de 50, sobre el valor absoluto) y nunca pueden superar lo realmente cobrado. Esto se implementa en los Prompts 3, 4 y 5; en este prompt solo dejá una función única de redondeo reutilizable en el servidor y otra en el frontend, con el mismo comportamiento, para que todo el sistema use la misma.

## Detalles técnicos
- Una sola función de redondeo por lado (servidor y cliente), con la regla arriba, usada en todos los lugares. Nada de repetir la cuenta a mano en cada pantalla.
- Trabajar con enteros (los guaraníes no tienen decimales), evitando errores de coma flotante.
- Actualizar `openapi.yaml` y regenerar los tipos y hooks del cliente con el mecanismo que ya usa el proyecto.

## Verificación final pedida
Probar en el navegador, creando productos de prueba con estos precios:
1. Total 12.358: el POS muestra subtotal 12.358, redondeo −8 y **Total a cobrar 12.350**. Cobrar en efectivo con 20.000: el vuelto es **7.650**.
2. Total 12.399 → cobra **12.350**. Total 12.301 → cobra **12.300**. Total 12.350 → cobra **12.350** sin redondeo.
3. Pago mixto sobre un total redondeado a 12.350: 10.000 efectivo + 2.350 tarjeta se acepta; 10.000 + 2.358 se rechaza.
4. Llamar directamente a `POST /api/ventas` mandando un total distinto al real: el servidor lo ignora y guarda su propio cálculo.
5. El ticket muestra subtotal, redondeo y total cobrado; el historial muestra el total cobrado.
6. Cerrar una caja con ventas redondeadas: el efectivo esperado suma los totales cobrados (12.350, no 12.358) y el cierre muestra los redondeos aplicados.
7. Apagar la opción en Configuración: una venta de 12.358 se cobra exacta. Volver a encenderla después.
8. Las ventas viejas se ven igual que antes.

---

# PROMPT 3 — Base contable: caja, pagos, anulaciones y notas de crédito (backend)

## Objetivo
Que devoluciones, cambios y anulaciones **cuadren siempre con la caja**, y que el sistema no pueda quedar en un estado inconsistente (devolver dos veces lo mismo, anular dos veces, sumar stock de más). Este prompt es principalmente de base de datos y servidor; casi no toca pantallas (solo dos cambios chicos en el POS, indicados abajo).

**Antes de tocar nada:** leer `lib/db/src/schema/` (ventas, caja, devoluciones, configuracion, auditoria), `artifacts/api-server/src/routes/` (ventas, devoluciones, caja, dashboard, config) y `lib/api-spec/openapi.yaml`. Hacer un backup de `lib/db/data/local.db`. Los cambios de esquema deben conservar todos los datos existentes (columnas nuevas con valor por defecto o nulas) y las ventas viejas deben seguir funcionando.

## Problemas encontrados en el código actual (hay que corregirlos)
1. **Se puede devolver la misma venta muchas veces.** Al validar una devolución solo se compara contra lo vendido originalmente, sin restar lo ya devuelto antes. Cada devolución suma stock otra vez.
2. **La devolución no afecta a la caja.** No guarda ningún monto ni de qué caja salió la plata, así que el cierre de caja no la ve y va a faltar plata.
3. **Se puede anular dos veces la misma venta**, y cada anulación vuelve a sumar el stock.
4. **Anular una venta de una caja ya cerrada no cambia nada en ninguna caja**, aunque el mensaje de la pantalla dice que el monto se descuenta de la caja actual.
5. **El pago "mixto" no guarda el desglose.** El POS elige "mixto" pero no envía cuánto se pagó en cada método, y el cierre de caja cuenta el total de una venta mixta como si fuera todo efectivo. Eso ya hoy puede hacer que la caja no cuadre.
6. **El dashboard** suma las ventas sin descontar devoluciones.

## 1. Pago mixto con desglose real
- En el POS, cuando se elige "mixto", pedir cuánto se paga en efectivo, cuánto en tarjeta y cuánto en transferencia. La suma debe ser exactamente el total a cobrar; si no coincide, no se puede cobrar.
- Guardar en cada venta **cuánto se cobró realmente por cada método** (por ejemplo, tres montos o una tabla de pagos; elegir lo más simple y coherente con el esquema actual). Para ventas normales (no mixtas) el monto cobrado es el total en su único método.
- Las ventas viejas que no tienen desglose se tratan como hoy (mixto = todo efectivo), sin romper el historial.
- El cierre de caja debe calcular el efectivo esperado usando **solo el efectivo realmente cobrado**.

## 2. Modelo de nota de crédito (devolución)
Una devolución es un documento propio, ligado al ticket original, que **no modifica** ni anula la venta original. Debe guardar como mínimo:
- El ticket/venta original, el usuario que la hizo y la fecha y hora.
- El **motivo** (texto obligatorio, mínimo unos pocos caracteres reales, no solo espacios).
- El **nombre del comprador** (obligatorio al devolver; si la venta ya tenía nombre cargado, viene precargado y se puede corregir).
- El **tipo**: "devolución" o "cambio".
- La **caja (apertura) en la que se procesó** la devolución: siempre la caja abierta del usuario en ese momento, no la de la venta.
- El **total a reembolsar** y el **método de reembolso** (efectivo, tarjeta o transferencia).
- Por cada producto devuelto: cantidad, **precio unitario que pagó el cliente** (tomado de `detalle_venta`, no del precio actual del producto), subtotal, y un indicador **"vuelve al stock: sí/no"**.

## 3. Reglas de validación (todas en el servidor, no solo en la pantalla)
- **Cantidad acumulada:** para cada producto de la venta, lo que se devuelve ahora + lo ya devuelto en devoluciones anteriores no puede superar lo vendido. Esta validación y la escritura deben ocurrir dentro de la misma transacción, para que dos devoluciones simultáneas no puedan pasarse.
- **Plazo:** solo se puede devolver dentro de las **48 horas** posteriores a la fecha de la venta, medido con el reloj del servidor. El plazo es configurable en Configuración (campo nuevo, por defecto 48 horas). Si está vencido, el mensaje debe decir cuándo venció.
- **Venta anulada:** no se puede devolver una venta anulada.
- **Caja abierta:** para procesar una devolución con reembolso en efectivo, el usuario debe tener una caja abierta. Si no la tiene, se rechaza con un mensaje claro.
- **Permisos:** igual que hoy — el vendedor solo devuelve ventas propias, el admin cualquiera.
- **Método de reembolso:** por defecto es el mismo método con el que se pagó. Venta pagada en efectivo → reembolso en efectivo; tarjeta → tarjeta; transferencia → transferencia. En ventas mixtas, el vendedor elige el método del reembolso, pero **el monto reembolsado por cada método no puede superar lo que se cobró por ese método en la venta original, menos lo ya reembolsado por ese método**.
- **Nombre y ticket:** en Configuración agregar la opción "Las devoluciones requieren ticket" (activada por defecto). Si el negocio no emite tickets y la opción está activada, no se permiten devoluciones y el servidor responde con un mensaje claro. Si la opción está desactivada, se puede devolver igual, buscando por número de venta. El nombre del comprador se exige siempre al devolver.
- **Stock:** por cada línea con "vuelve al stock: sí" se suma la cantidad al stock del producto. Con "no" (producto defectuoso, vencido, sin gas, etc.) el stock no se toca; igual queda registrado en la devolución. Los demás productos de la venta no se tocan en absoluto.

## 4. Impacto en la caja
- Cuando el reembolso es en efectivo, el cierre de caja calcula: **fondo inicial + efectivo cobrado en ventas − efectivo reembolsado en devoluciones**, siempre dentro de la caja en la que se procesó la devolución.
- Reembolsos por tarjeta o transferencia no cambian el efectivo esperado, pero sí deben verse en el resumen.
- La pantalla y el detalle del cierre de caja (`/caja/cierre`, historial de cierres) deben mostrar un renglón claro de **"Devoluciones en efectivo"** restando, y el cierre debe guardar ese total.
- `GET /caja/activa` debe devolver también el total de reembolsos, para que el vendedor lo vea antes de cerrar.
- Ejemplo que debe cumplirse: el día 12 se vende una gaseosa de 10.000 en efectivo y se cierra esa caja. El día 13, en una caja nueva con fondo de 50.000, el cliente la devuelve. El cierre del día 13 debe esperar **40.000** (no 50.000), y el cierre del día 12 no debe cambiar.

## 4b. Redondeo en devoluciones (usa la función del Prompt 2)
- El **total a reembolsar** de una devolución se calcula sumando `precio unitario pagado × cantidad` de cada línea devuelta y luego se redondea **hacia abajo al múltiplo de 50** (mismo criterio que el cobro).
- La suma de todos los reembolsos de una venta **nunca puede superar el total cobrado** de esa venta (el ya redondeado). Validarlo en el servidor, dentro de la misma transacción.
- El monto de reembolso redondeado es el que se guarda y el que afecta a la caja.

## 5. Anulaciones (más estrictas)
- Una venta ya anulada no se puede anular otra vez.
- Una venta que ya tiene devoluciones no se puede anular (para eso está la devolución).
- Solo se puede anular una venta cuya caja **sigue abierta**. Si esa caja ya se cerró, la única vía es la devolución, porque una anulación no modifica un cierre ya hecho. El mensaje debe explicarlo.
- Al anular sigue devolviéndose el stock, como hoy. El texto de confirmación de la pantalla de historial debe reflejar lo que realmente pasa.

## 6. Estado de cada venta y reportes
- Cada venta tiene un estado derivado: **sin devoluciones**, **devuelta parcialmente** o **devuelta totalmente**, calculado a partir de las devoluciones. Mostrarlo como etiqueta en el historial de ventas y en el detalle de la venta.
- El dashboard debe mostrar las ventas **netas** (ventas menos devoluciones) y dejar visible el total devuelto.

## 7. Nombre del comprador en la venta (opcional)
- Solo cuando el negocio emite tickets, agregar en el momento de cobrar un campo **opcional** "Nombre del comprador". No debe frenar el cobro ni requerir clics extra si se deja vacío. Se guarda en la venta.
- Si el negocio no emite tickets, este campo no aparece.

## 8. Auditoría
Registrar en la tabla `auditoria` cada devolución, cambio y anulación: usuario, acción, ticket, montos y fecha.

## Detalles técnicos
- Actualizar `openapi.yaml` y regenerar los tipos y hooks del cliente con el mecanismo que ya usa el proyecto.
- Todas las cuentas de dinero deben redondearse igual que en el resto del sistema (sin errores de decimales); respetar la opción de mostrar decimales y el formato de moneda existentes.
- Ante cualquier duda de diseño, elegir la opción más simple, y avisar qué se decidió.

## Verificación final pedida
No alcanza con "compila". Probar en el navegador y/o con llamadas a la API:
1. **Cuadre entre dos días:** abrir caja A con fondo 100.000, vender un producto de 10.000 en efectivo, cerrar (esperado 110.000). Abrir caja B con fondo 50.000, devolver ese producto en efectivo: en la caja B el esperado debe ser 40.000; contando 40.000 la diferencia es 0. El cierre de la caja A no cambió.
2. **Devolución parcial:** venta con 30 unidades de un producto; devolver 1. Solo esa unidad suma al stock; el ticket original sigue igual y ahora aparece "devuelta parcialmente".
3. **Acumulado:** intentar devolver más unidades que las vendidas (en una o en varias devoluciones seguidas): debe rechazarse.
4. **Plazo:** para probarlo sin esperar, bajar el plazo en Configuración a 0 horas (o ajustar la fecha de una venta de prueba); la devolución debe rechazarse diciendo cuándo venció. Volver al valor de 48 después.
5. **Sin stock:** devolver con "vuelve al stock: no": el stock no cambia, pero la devolución y el reembolso quedan registrados.
6. **Anulaciones:** anular dos veces la misma venta (la segunda se rechaza), anular una venta con devoluciones (se rechaza), anular una venta de una caja cerrada (se rechaza con mensaje claro).
7. **Pago mixto:** vender con mixto (por ejemplo 6.000 efectivo + 4.000 tarjeta) y verificar que el esperado del cierre solo suma 6.000 de esa venta.
8. **Sin caja abierta:** intentar una devolución en efectivo sin caja abierta: rechazada con mensaje claro.
9. **Redondeo:** vender por 12.358 (cobrado 12.350) y devolver todo: el reembolso es 12.350, nunca más de lo cobrado; devolver una línea de 5.008: el reembolso es 5.000.
10. Las ventas y devoluciones que ya existían en la base siguen apareciendo bien.

---

# PROMPT 4 — Pantalla de Devoluciones (botones por producto y "Devolver todo")

## Objetivo
Rediseñar la pantalla `Devoluciones` (`artifacts/pos-app/src/pages/devoluciones.tsx`) para que sea rápida y difícil de usar mal. Usa el backend del Prompt 3 (ya hecho) y el redondeo del Prompt 2. No cambiar las reglas de negocio del servidor; la pantalla solo las refleja y muestra sus mensajes de error tal cual.

## 1. Buscar el ticket
- Un campo para buscar por **número de ticket** (con Enter o botón Buscar). Mantener la búsqueda por producto solo si ya existe y no molesta; lo principal es el ticket.
- Al encontrar la venta, mostrar el encabezado: número de ticket, fecha y hora, método de pago, total, vendedor, nombre del comprador (si tiene) y la etiqueta de estado (sin devoluciones / devuelta parcialmente / devuelta totalmente).
- Mostrar de forma visible el **tiempo restante para devolver** (por ejemplo "Quedan 31 h para devolver") o, si ya venció, un aviso rojo diciendo cuándo venció. Si está vencida o anulada, los botones de acción quedan deshabilitados con el motivo a la vista.
- Si el negocio no emite tickets y la opción "Las devoluciones requieren ticket" está activada, mostrar un mensaje claro en lugar del buscador.

## 2. Lista de productos de la venta, con dos botones por fila
Mostrar la venta como tabla de productos con: nombre, cantidad vendida, **cantidad ya devuelta**, cantidad que todavía se puede devolver, precio unitario pagado y subtotal. A la derecha de cada fila, **dos botones con íconos grandes y su texto**:
- **"Devolución del producto"**: ícono de bolsa amarilla con círculo rojo y flecha de retorno.
- **"Cambio del producto"**: ícono de bolsa amarilla con círculo verde y flechas de intercambio.

Si a una fila ya no le queda nada por devolver, los dos botones se deshabilitan y la fila lo dice ("Ya devuelto").

Arriba de la tabla, un botón **"Devolver todo"** que abre el mismo formulario con todas las líneas pendientes.

## 3. Formulario de devolución (ventana modal)
Se abre al tocar "Devolución del producto" en una fila (con esa fila) o "Devolver todo" (con todas las filas devolvibles). Debe pedir:
- **Cantidad a devolver** por producto: por defecto todo lo devolvible. Solo enteros para productos por unidad; decimales para productos por kg. No puede ser cero, negativa ni superar lo devolvible.
- **Motivo** (obligatorio, texto libre; se pueden ofrecer atajos como "No le gustó", "Producto en mal estado", "Error en la venta", pero el texto sigue editable).
- **Nombre del comprador** (obligatorio, precargado si la venta ya lo tenía).
- Por cada producto: interruptor **"Vuelve al stock"** (sí por defecto). Con una ayuda corta: "Desactivar si el producto está fallado, vencido o no se puede revender".
- **Método de reembolso**: por defecto el mismo método de la venta. En ventas mixtas se puede elegir; mostrar cuánto se cobró originalmente por cada método para que el vendedor sepa el máximo.

Y mostrar siempre, bien grande y en un recuadro destacado, el **"Total a devolver al comprador"** (por ejemplo 10.000 Gs), calculado con el precio que el cliente realmente pagó y actualizado al cambiar las cantidades. Si el redondeo (hacia abajo, múltiplo de 50) cambia el monto, mostrar una línea chica con el valor exacto y el redondeo, igual que en el POS, y usar la función de redondeo ya existente en el frontend. Debajo, si el reembolso es en efectivo, una línea que diga que ese monto se descontará del efectivo de la caja actual.

Botones: "Confirmar devolución" y "Cancelar". Al confirmar:
- Si el reembolso es en efectivo y no hay caja abierta, mostrar el aviso y no permitir continuar (con enlace a abrir caja).
- Mostrar los errores del servidor con su mensaje exacto (plazo vencido, cantidad excedida, etc.).
- En caso de éxito, cerrar el modal, refrescar la venta (cantidades ya devueltas, estado, stock) y mostrar una confirmación con el total devuelto.
- Bloquear el botón mientras se envía, para que un doble clic no genere dos devoluciones.

## 4. Comprobante de devolución
Si el negocio emite tickets, al confirmar ofrecer imprimir un **comprobante de devolución** (nota de crédito) que muestre: número del ticket original, fecha, productos devueltos con cantidad y precio, total devuelto, método de reembolso, motivo y nombre del comprador. Reutilizar el mecanismo de impresión de tickets que ya existe; si no hubiera uno reutilizable, generar una vista imprimible simple.

## 5. Historial
En la misma pantalla (pestaña o sección), listar las devoluciones y cambios hechos: fecha, ticket, tipo, productos, total, motivo, comprador, usuario y método de reembolso. El vendedor solo ve las suyas; el admin ve todas.

## 6. Cuidado con esto
- Los botones de cambio ("Cambio del producto") en este prompt solo necesitan **existir y llamar a una función pendiente** (se completan en el Prompt 5). Que hoy muestren un aviso "Próximamente" está bien.
- Usar el formato de moneda del sistema (`useCurrency`), sin inventar otro.
- Todos los textos en español, consistentes con el resto de la app.

## Verificación final pedida
Probar en el navegador, como vendedor y como admin:
1. Buscar un ticket de una venta con varios productos; verificar el tiempo restante y el estado.
2. Devolver **una sola unidad** de un producto con 30 unidades: el total a devolver muestra el precio de esa unidad; al confirmar, solo ese producto suma 1 al stock y los demás no cambian.
3. Volver a abrir el mismo ticket: la cantidad ya devuelta aparece, y no se puede devolver más de lo que queda.
4. "Devolver todo" en otro ticket: pide motivo y nombre, muestra el total completo, y el estado pasa a "devuelta totalmente".
5. Devolver con "Vuelve al stock" desactivado: el stock no cambia.
6. Devolución en efectivo: al cerrar la caja, el esperado descuenta ese monto.
7. Ticket vencido (bajar el plazo en Configuración a 0 horas para probar): botones deshabilitados y mensaje de vencimiento.
8. Hacer doble clic rápido en "Confirmar devolución": se crea una sola devolución.

---

# PROMPT 5 — Cambio de producto (devolución + venta nueva en un solo paso)

## Objetivo
Que el botón **"Cambio del producto"** de la pantalla de Devoluciones lleve al Terminal POS con el producto a devolver ya cargado como **crédito**, el vendedor agregue el producto nuevo, y el sistema muestre la **diferencia** y cierre todo como una compra normal, cuadrando siempre con la caja. Usa el backend del Prompt 3 y la pantalla del Prompt 4 (y el redondeo del Prompt 2).

## Flujo esperado
1. En Devoluciones, el vendedor toca **"Cambio del producto"** en la fila del producto. Se abre un formulario corto que pide: cantidad a cambiar (por defecto todo lo devolvible de esa fila), **motivo** (obligatorio), **nombre del comprador** (obligatorio, precargado si existe) y **"Vuelve al stock"** (sí/no). Al continuar, el sistema **no guarda nada todavía** y lleva al Terminal POS.
2. En el Terminal POS aparece un bloque bien visible de **"Cambio en curso"** con el ticket original, el producto que se devuelve, la cantidad y el **crédito a favor del cliente**. El crédito lo **calcula el sistema** con el precio que el cliente realmente pagó (tomado del detalle de la venta original); el vendedor **no puede escribirlo ni modificarlo**.
3. El vendedor agrega, con el escáner o la búsqueda, el/los producto(s) nuevos como en una venta normal (con todas las validaciones de stock y consolidación que ya existen).
4. El POS muestra en tiempo real, junto al total: **Total de productos nuevos**, **Crédito del producto devuelto** y el resultado en grande:
   - Si el total nuevo es **mayor** que el crédito: "**El cliente debe pagar: X**". El cobro se hace con los métodos de pago normales (efectivo con cálculo de vuelto, tarjeta, transferencia o mixto con desglose), pero solo sobre la diferencia.
   - Si el total nuevo es **menor**: "**Devolver al cliente: X**". Se elige el método de reembolso (por defecto el original) y, si es efectivo, sale de la caja actual.
   - Si es **igual**: "Sin diferencia". Se confirma sin cobrar ni devolver nada.
   - En todos los casos, la diferencia se **redondea hacia abajo al múltiplo de 50** (sobre su valor absoluto, tanto si el cliente paga como si se le devuelve), usando la misma función del Prompt 2. Mostrar la diferencia exacta, el redondeo y el monto final. Registrar el ajuste de redondeo en la venta nueva.
5. Al confirmar, todo se guarda **en una sola transacción**: la devolución (tipo "cambio", con su motivo, comprador y "vuelve al stock"), la venta nueva con sus líneas (que **descuenta el stock** de los productos nuevos) y el vínculo entre ambas. Si algo falla, no se guarda nada.
6. Un botón **"Cancelar cambio"** limpia el bloque y devuelve el POS a su modo normal, sin haber tocado nada en la base de datos. Si el vendedor cierra la pestaña o cambia de pantalla, tampoco queda nada guardado.

## Reglas
- Se aplican **las mismas reglas** que a una devolución: plazo de 48 horas, cantidad acumulada devuelta, venta no anulada, nombre y motivo obligatorios, y permisos del vendedor/admin.
- La venta nueva queda con su **total completo** registrado, más el **crédito aplicado**, más lo **realmente cobrado por cada método** (solo la diferencia). El cierre de caja cuenta únicamente el efectivo que realmente entró o salió: fondo + efectivo cobrado − efectivo reembolsado.
- La venta nueva tiene su propio número de ticket, y ese ticket debe mostrar claramente el crédito aplicado y lo que pagó el cliente ("Total: 15.000 · Crédito por cambio del ticket #123: −10.000 · Pagado: 5.000").
- En el historial de ventas, la venta original queda con su estado derivado (devuelta parcial o totalmente) y el cambio se ve como devolución de tipo "cambio", enlazada con la venta nueva.
- Mientras hay un cambio en curso, el POS no debe permitir cobrar como venta normal sin el crédito, ni perder el cambio en curso por recargar accidentalmente sin avisar (pedir confirmación si hay un cambio en curso al salir).
- Si el producto que se devuelve es el mismo que el cliente quiere llevar otra vez (por ejemplo cambiar una gaseosa fallada por otra igual), debe funcionar sin problemas con las validaciones de stock: el stock del producto devuelto solo se repone si "vuelve al stock" está en sí, y el stock del producto nuevo se valida y se descuenta normalmente.
- Registrar el cambio en la tabla de `auditoria`.

## Verificación final pedida
Probar en el navegador:
1. **Diferencia a favor de la tienda:** cambiar una gaseosa de 10.000 por un producto de 15.000. El POS muestra "El cliente debe pagar: 5.000". Cobrar en efectivo. La caja cuenta solo 5.000 de esa operación.
2. **Diferencia a favor del cliente:** cambiar un producto de 15.000 por uno de 10.000. El POS muestra "Devolver al cliente: 5.000". Al cerrar la caja, el esperado descuenta 5.000.
3. **Sin diferencia:** cambiar por un producto del mismo precio: se confirma sin movimiento de dinero y el stock queda bien en ambos productos.
4. **Cancelar:** empezar un cambio y cancelar antes de confirmar: no debe quedar ninguna devolución ni venta nueva en la base.
5. **Stock:** cambiar un producto fallado con "vuelve al stock: no": el stock del producto devuelto no cambia; el del producto nuevo baja.
6. **Reglas:** intentar un cambio sobre un ticket vencido, sobre una cantidad ya devuelta, o sin nombre/motivo: todo se rechaza con mensaje claro.
7. **Redondeo:** cambiar un producto de 10.000 por uno de 12.358: la diferencia exacta es 2.358 y el POS cobra **2.350**. Cambiar uno de 12.358 por uno de 10.000: la diferencia exacta es 2.358 y se devuelve **2.350**.
8. **Cuadre final:** hacer una devolución, un cambio con diferencia a favor de la tienda y un cambio con diferencia a favor del cliente en la misma caja; cerrarla contando el efectivo real y verificar que la diferencia sea cero.





DESPUES DE TERMINAR EL PROMT 5 QUIERO QUE VEAS ESTOS CASOS PARA EMPEZAR A IMPLEMENTAR PASO A PASO:
PROMPT — OPTIMIZACIÓN PROFESIONAL DE POS / TERMINAL DE VENTAS Y DISPOSITIVOS

Antes de continuar con el Prompt 5, necesito hacer un ajuste independiente en la experiencia de uso del POS / Terminal de ventas.

NO implementar todavía el Prompt 5.

Este trabajo es exclusivamente de UX, distribución visual, teclado, lector de códigos, scroll y dispositivos del POS.

OBJETIVO GENERAL

Quiero que la pantalla de ventas esté diseñada como un terminal POS profesional, pensado principalmente para:

teclado;
lector de códigos de barras;
operaciones rápidas;
mínimo uso posible del mouse;
mínimo scroll;
información visible de inmediato;
distribución clara y estable.

La IA debe auditar primero cómo está construida actualmente la pantalla y decidir técnicamente la mejor distribución visual.

No quiero que simplemente mueva componentes de manera mecánica.

Quiero que determine dónde conviene colocar cada elemento para que el flujo de venta sea rápido y profesional.

1. NO MODIFICAR EL FLUJO GENERAL DE VENTA

La pantalla POS ya tiene un flujo que quiero conservar.

Cuando se escanea/escribe un código y se presiona Enter:

Código → Enter → producto agregado al carrito

Ese comportamiento debe mantenerse.

No modificar innecesariamente:

creación de venta;
cálculo de precios;
stock;
pagos;
redondeo;
caja;
lógica del carrito.

Este trabajo es principalmente de interfaz y ergonomía.

2. POSICIÓN DE CANTIDAD Y CÓDIGO

Actualmente tengo:

[ LECTOR / CÓDIGO ]    [ CANTIDAD ]

Quiero exactamente lo contrario:

[ CANTIDAD ]    [ CÓDIGO / LECTOR ]

Es decir:

Izquierda

Cantidad

Derecha

Código / lector

La razón es la siguiente:

Por defecto la cantidad siempre comienza en:

1

El flujo normal es:

1 unidad
↓
escaneo código
↓
Enter
↓
producto agregado

Cuando necesito cambiar la cantidad, utilizo:

F4

y entonces el foco pasa al campo de cantidad para modificarla.

Quiero conservar esa lógica.

Resultado visual deseado

Algo conceptualmente similar a:

┌───────────────────┐   ┌──────────────────────────────┐
│ CANTIDAD          │   │ CÓDIGO / LECTOR             │
│ 1                 │   │ Escanear o escribir código  │
└───────────────────┘   └──────────────────────────────┘

La implementación visual final queda a criterio de la IA siempre que respete:

Cantidad a la izquierda y código a la derecha.

3. TECLADO Y F4

El POS debe estar pensado para funcionar sin mouse siempre que sea posible.

Mantener y mejorar:

Flujo normal
Código
↓
Enter
↓
Producto agregado
↓
foco listo para siguiente código
F4
F4
↓
foco en Cantidad
↓
usuario modifica cantidad
↓
Enter
↓
continuar flujo de venta

No quiero que después de agregar un producto el usuario tenga que buscar manualmente con el mouse dónde escribir el siguiente código.

El foco debe quedar preparado para continuar la venta.

4. CARRITO — ELIMINAR CONTROLES +/- DE LA FILA

Actualmente, en la lista de productos agregados al carrito, la cantidad todavía tiene controles:

[-]  cantidad  [+]

Quiero eliminar esos botones - y + de la fila del carrito.

La cantidad debe mostrarse simplemente como información editable/controlada mediante el flujo de teclado del POS.

Por ejemplo:

N° | FOTO | PRODUCTO | CANTIDAD | P.UNIDAD | SUBTOTAL

Y en:

CANTIDAD

no quiero:

[-] 1 [+]

sino solamente la cantidad.

IMPORTANTE

Esto no significa eliminar la posibilidad de modificar cantidades.

La modificación debe seguir siendo posible mediante el flujo establecido:

F4 → cantidad → Enter

El objetivo es evitar controles visuales innecesarios que obliguen al uso del mouse.

5. TABLA DEL CARRITO

Mantener la información:

N°
Foto
Nombre
Cantidad
P. Unidad
Subtotal

Pero optimizar la distribución para que sea clara y compacta.

La cantidad debe ser fácilmente visible.

El precio unitario y subtotal deben tener suficiente espacio.

No agregar elementos visuales innecesarios.

6. ELIMINAR SCROLL INNECESARIO DEL POS

Este punto es MUY importante.

Quiero que la pantalla de ventas esté diseñada para que prácticamente no sea necesario hacer scroll con el mouse.

Especialmente:

no quiero scroll vertical innecesario;
no quiero que la zona principal del carrito genere scroll por diseño;
no quiero que aparezcan elementos fuera de la pantalla solamente porque la interfaz no está correctamente distribuida.

La pantalla debe aprovechar correctamente:

altura disponible;
ancho disponible;
paneles;
áreas fijas;
encabezados;
carrito;
resumen;
teclado.
7. IMÁGENES DEL ÚLTIMO PRODUCTO

Actualmente la sección donde se muestran las imágenes/información del último producto agregado puede generar scroll.

No quiero eso.

Revisar específicamente la zona de:

último producto cargado

y rediseñarla para que:

no genere scroll innecesario;
la imagen quede contenida dentro de un área fija;
no crezca descontroladamente;
no obligue a desplazar la pantalla para ver información;
se adapte al tamaño disponible.

Si la imagen es demasiado grande:

reducirla/encajarla, no generar scroll.

Usar técnicas como:

object-fit
max-height
max-width
overflow controlado

o la solución que técnicamente sea más apropiada.

8. REGLA GENERAL DE SCROLL

Aplicar esta filosofía a todo el POS:

Permitido

Scroll únicamente cuando sea realmente inevitable por una cantidad excepcional de productos o por una resolución extremadamente pequeña.

No permitido como comportamiento normal

Scroll para:

buscar el código;
cambiar cantidad;
ver el carrito principal;
ver el último producto;
acceder al total;
acceder al botón de cobro;
moverse entre los controles principales.

La pantalla debe intentar mantener las operaciones principales visibles simultáneamente.

9. MOUSE COMO ELEMENTO SECUNDARIO

No eliminar completamente el soporte de mouse.

Pero diseñar el POS bajo esta prioridad:

1. Teclado
2. Lector de códigos
3. Mouse

Las acciones principales deben poder ejecutarse sin mouse.

Especialmente:

ingresar código;
agregar producto;
cambiar cantidad;
eliminar producto;
avanzar;
cobrar;
cancelar cuando corresponda.

Si ya existen atajos de teclado, conservarlos.

No inventar atajos que entren en conflicto con los existentes.

10. DISPOSITIVOS — CONFIGURACIÓN

En:

Configuración → Dispositivos

actualmente aparece algo equivalente a:

Todos los dispositivos se leerán automáticamente

Quiero mejorar esto.

No quiero que simplemente diga:

Automático

Quiero que la aplicación muestre, cuando el sistema operativo/browser lo permita, qué dispositivo está realmente conectado/identificado.

Tenemos como mínimo:

Impresora

Mostrar:

Marca
Modelo
Estado
Lector de códigos

Mostrar:

Marca
Modelo
Estado
Cajón de dinero

Mostrar:

Marca
Modelo
Estado
11. IDENTIFICACIÓN REAL DEL HARDWARE

MUY IMPORTANTE:

NO inventar marcas ni modelos.

Si el navegador o sistema operativo proporciona información real:

mostrarla.

Si únicamente proporciona información parcial:

mostrar solamente lo que realmente se conoce.

Por ejemplo:

Lector de códigos
Estado: Conectado
Identificación: Honeywell ...

Si solamente puede saberse:

Estado: Conectado
Tipo: dispositivo HID

mostrar eso.

No inventar:

Marca: Zebra
Modelo: XXXX

si no existe evidencia real.

12. LIMITACIONES DEL NAVEGADOR

Antes de implementar esto, investigar técnicamente qué información puede obtener realmente la aplicación según el mecanismo utilizado actualmente.

Especialmente:

WebUSB;
WebHID;
WebSerial;
APIs de impresión;
navegador;
sistema operativo.

Si una API no permite conocer la marca/modelo:

no falsificar la información.

Mostrar algo como:

Identificación del dispositivo no disponible desde el navegador

pero mantener:

Estado: conectado / no detectado

si eso sí puede determinarse.

13. INTERFAZ DE DISPOSITIVOS

Quiero que la sección se vea profesional.

Por ejemplo, conceptualmente:

DISPOSITIVOS

┌─────────────────────────────────────┐
│ 🖨 Impresora                        │
│ Estado: ● Conectada                 │
│ Marca: XXXXX                        │
│ Modelo: XXXXX                       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ ▣ Lector de códigos                 │
│ Estado: ● Conectado                 │
│ Marca: XXXXX                        │
│ Modelo: XXXXX                       │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ 💵 Cajón de dinero                  │
│ Estado: ● Conectado                 │
│ Marca: XXXXX                        │
│ Modelo: XXXXX                       │
└─────────────────────────────────────┘

Pero la distribución final queda a criterio de la IA.

14. NO ROMPER DISPOSITIVOS EXISTENTES

Antes de tocar esta sección verificar cómo funciona actualmente:

impresora;
lector;
cajón.

No romper las integraciones actuales.

La mejora debe ser principalmente:

identificación + estado + presentación.

Si actualmente un dispositivo funciona mediante una abstracción que no permite obtener marca/modelo, mantener esa abstracción y mostrar honestamente la información disponible.

15. RESPONSIVE

Optimizar especialmente para una pantalla de caja/POS.

No diseñar pensando primero en celular.

Prioridad:

Desktop POS
↓
Pantalla horizontal
↓
Teclado + lector

La configuración sí puede utilizar scroll cuando sea necesario.

La restricción fuerte de casi cero scroll aplica principalmente a la pantalla de ventas/POS.

16. AUDITORÍA ANTES DE MODIFICAR

Antes de escribir código:

revisar:

artifacts/pos-app/src/pages/venta.tsx

y todos los componentes que realmente intervengan en:

código;
cantidad;
carrito;
imágenes;
teclado;
dispositivos.

Determinar qué ya está implementado.

No rehacer código que ya funciona.

17. CRITERIO DE DISEÑO

Quiero que la IA tome decisiones de UX profesional.

No quiero que simplemente siga literalmente cada píxel que describí.

Mis requisitos funcionales son:

Obligatorio
cantidad izquierda;
código derecha;
F4 para cantidad;
eliminar +/- del carrito;
minimizar mouse;
minimizar scroll en POS;
eliminar scroll innecesario de imagen/último producto;
identificar dispositivos cuando técnicamente sea posible;
no inventar información de hardware.
Decisión de diseño

La IA debe decidir:

tamaños;
espacios;
proporciones;
ancho de columnas;
posición exacta de resumen;
posición de botones;
distribución de imagen;
cómo aprovechar la pantalla;
cómo evitar scroll.

La prioridad debe ser:

velocidad + claridad + teclado + lector + profesionalismo.

18. PRUEBAS OBLIGATORIAS

Después de implementar:

Prueba 1

Abrir POS.

Confirmar visualmente:

Cantidad ← izquierda
Código ← derecha
Prueba 2

Sin tocar mouse:

Cantidad = 1
Código → Enter

Confirmar que el producto entra correctamente.

Prueba 3

Presionar:

F4

Modificar cantidad.

Presionar:

Enter

Confirmar que funciona.

Prueba 4

Revisar el carrito.

Confirmar que ya no existen botones:

-
+

junto a cantidad.

Prueba 5

Agregar varios productos.

Confirmar que la operación normal no requiere scroll para acceder a los controles principales.

Prueba 6

Verificar imagen del último producto.

Confirmar que no genera scroll innecesario.

Prueba 7

Probar teclado/lector varias veces consecutivamente:

código
Enter
código
Enter
código
Enter

sin tener que hacer clic con el mouse entre productos.

Prueba 8

Abrir:

Configuración → Dispositivos

Verificar qué información real puede obtenerse de:

impresora;
lector;
cajón.

No inventar marcas/modelos.

Prueba 9

Verificar que las modificaciones NO hayan roto:

agregar productos;
cantidades;
eliminación;
subtotal;
total;
cobro;
lector;
impresión;
caja.
19. IMPORTANTE — NO TOCAR PROMPT 5

Este trabajo es independiente.

NO comenzar todavía la implementación del cambio de producto del Prompt 5.

Primero terminar este ajuste del POS.

Después entregar informe.

20. INFORME FINAL

Entregar:

AUDITORÍA Y OPTIMIZACIÓN POS

1. Estado inicial
2. Archivos revisados
3. Cambios realizados
4. Decisiones de UX tomadas
5. Cambios de teclado
6. Cambios de layout
7. Cambios de scroll
8. Cambios de dispositivos
9. Limitaciones reales de identificación de hardware

PRUEBAS

1. Código derecha / cantidad izquierda — PASS/FAIL
2. F4 cantidad — PASS/FAIL
3. Enter — PASS/FAIL
4. +/- eliminados — PASS/FAIL
5. Mínimo scroll — PASS/FAIL
6. Imagen sin scroll innecesario — PASS/FAIL
7. Flujo sin mouse — PASS/FAIL
8. Dispositivos — PASS/FAIL
9. Regresión POS — PASS/FAIL

Errores encontrados:
...

Correcciones:
...

Estado final:
PASS / PENDIENTE

Empieza directamente auditando el código actual. No me pidas confirmación.

Y una cosa muy importante : no quiero que se invente que puede identificar la marca del lector, impresora o cajón si el navegador no se lo permite. Que muestre marca/modelo real cuando esté disponible y, si no, que sea honesto con “dispositivo HID”, “no disponible”, etc. Eso va a quedar bastante más profesional que mostrar datos falsos.

1 unidad
↓
escaneo código
↓
Enter // aca np necesariamente debe de ser el enter, tipo si el lector lee  que pase directo sin apretar mas enter pero si metemos manualmente si, que sea el enter, es mas profesional esto 
↓
producto agregado

Exactamente. Eso es más profesional y, para un POS con lector, mejor UX.

La lógica debería quedar así:

Flujo de carga de producto

Cantidad por defecto: 1

Cantidad: 1
        ↓
Escanear código
        ↓
¿El código proviene del lector?
   ├─ Sí → agregar producto inmediatamente
   └─ No → esperar Enter
                    ↓
              agregar producto

Es decir:

Lector de código de barras: cuando el lector termina de enviar el código, el producto se agrega automáticamente, sin que el cajero tenga que presionar Enter.
Ingreso manual: el cajero escribe el código y presiona Enter para agregarlo.
Cantidad: empieza siempre en 1.
F4: sigue siendo el acceso para modificar la cantidad antes de cargar el producto.
Después de agregar el producto, el foco debería volver automáticamente al campo de código para permitir el siguiente escaneo.

Esto además permite un flujo real de caja:

Escanear → producto agregado → escanear siguiente → producto agregado → escanear siguiente...

sin tocar teclado ni mouse.

Y hay un detalle importante para el prompt: no conviene simplemente “quitar el Enter”, porque el sistema debe distinguir entre entrada proveniente del lector y escritura manual. Hay que detectar correctamente el patrón de entrada del scanner y mantener Enter como confirmación para entrada manual.

Si querés, te ajusto el prompt anterior de POS incorporando exactamente esta lógica para que Antigravity la implemente sin interpretar mal el comportamiento.

ah, quiero que sepas que esto no sera un sitio web al final. ni un pwa, sera si o si un .exe o para limux directo ya, para armar bien el diseño y tipo cuando yo te diga directo empapelammos en un sotfware y ya no en un sitioweb, que depues debamos a moldear, romper y demas cossas para pasar a un software ejecutable con un clic y ya se abre, ok?

Sí. Y esto cambia una decisión arquitectónica importante.

A partir de ahora, cuando me digas “directo”, voy a interpretar que estamos diseñando un software de escritorio POS, no una web que después haya que convertir.

La dirección debería ser:

Aplicación de escritorio instalable/ejecutable para POS, con experiencia nativa de terminal de ventas, preparada para Windows (.exe) y Linux, y no una PWA disfrazada de aplicación.

Lo que voy a tener en cuenta en los próximos prompts
No diseñar pensando primero en navegador.
No aceptar limitaciones del navegador como si fueran definitivas.
Priorizar teclado + lector de código + dispositivos físicos.
Impresora térmica, lector, cajón de dinero, etc. deben tratarse como hardware del sistema, no simplemente como periféricos web.
La aplicación debe poder abrirse directamente desde un acceso:
Windows → ejecutable/instalador .exe
Linux → aplicación/paquete ejecutable apropiado.
Pensar desde ahora en modo offline/local cuando corresponda, persistencia local, recuperación ante cierres y comunicación directa con dispositivos.
La interfaz debe sentirse como un terminal POS profesional, no como una página web.
Evitar decisiones que después obliguen a rehacer toda la UI para convertirla en escritorio.
Mantener separadas las capas de UI, lógica de negocio, base de datos y comunicación con hardware, para que el empaquetado de escritorio no obligue a romper el sistema.

Y algo especialmente importante para tu caso:

El lector de códigos

El comportamiento objetivo queda:

Cantidad = 1

→ lector escanea
→ el lector termina de enviar el código
→ producto entra automáticamente

Mientras que:

Cantidad = 1

→ usuario escribe código manualmente
→ Enter
→ producto entra.

Así el cajero puede hacer:

BIP → BIP → BIP → BIP → BIP

sin tocar absolutamente nada más.

Y si necesita cambiar cantidad:

F4 → modificar cantidad → escanear/escribir código → agregar.

Eso es mucho más coherente con una terminal POS física.

Sobre el diseño

También voy a dejar de plantear cosas como:

“¿Cómo hacemos que esto funcione bien en el navegador?”

y pasar a pensar:

“¿Cómo debería funcionar este POS si mañana está instalado en una PC de caja con monitor, teclado, lector, impresora y cajón?”

El navegador puede seguir siendo una tecnología interna si resulta conveniente para el proyecto, pero el producto final y sus decisiones de UX/arquitectura no se van a diseñar como una web.
