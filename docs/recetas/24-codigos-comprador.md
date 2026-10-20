# Receta 24 · Códigos de comprador

**Lo dices así:** «Dame un código para el 2ºB de Residencial X» (o lo hace la promotora desde su portal).
**Tipo:** sin Claude. Lo hace la **promotora** en su portal (pestaña **Compradores**). En el Panel, la administradora consulta; generar o cambiar queda plegado en «Ayudar con un código», para cuando le escriben pidiendo ayuda.

## Cómo funciona
- **Un código por vivienda** (`c-` y 12 cifras). Solo se ve **al generarlo**: en Supabase queda su huella, nunca el código (decidido el 10/10/2026: si un comprador lo olvida, se cambia, no se busca).
- **Todos a la vez:** «Generar los códigos de todas las viviendas y descargar el Excel» crea los que faltan y descarga un **Excel (.xlsx)** con vivienda, portal, planta, código y enlace directo. También uno a uno, con *Copiar código*, *Copiar mensaje para el comprador* y *Descargar en Excel*. Hay un buscador de viviendas.
- Se lo da la promotora o el comercial al comprador. Con él entra en la web pública: «¿Ya eres comprador? Entra para personalizar tu vivienda», o directamente con el enlace `…/<promoción>/#c-…`.
- **Cambiar código** pregunta para quién es:
  - **mismo comprador** (lo ha perdido): conserva lo que tenía formalizado;
  - **comprador nuevo** (venta cancelada y vendida a otra persona): empieza de cero; lo del anterior queda en el historial (solo MUNE y la promotora).
  El código anterior deja de valer al momento.
- **No caducan:** valen hasta que se cambian o se borra la promoción.
- **Límite de intentos:** 10 fallos en 15 minutos desde la misma dirección (o 300 en una hora en la promoción) bloquean un rato.
- La pestaña muestra si el comprador ya ha entrado, cuándo fue la última vez y cuántas veces.
- En la web, el comprador ve **su vivienda** («Portal 3 · Bajo A»), no la tipología de la que sale.
- **Ningún dato personal:** el código no se asocia a nombre, DNI ni email (el comercial sabe a quién se lo da). El nombre y el DNI que el comprador escribe antes de descargar su PDF solo van al PDF; no se guardan en ningún sitio.
- **Formalización:** el contacto al que el comprador envía su documento firmado y los datos de la transferencia los configura la promotora en MUNE Portal (*Ficha y datos → Formalización de la personalización*). Solo llegan a la experiencia pública con un código válido (`016_formalizacion.sql`).
- El comprador ve el **total de su personalización**, nunca el precio de la vivienda (la plataforma no lo conoce: decisión 37).
- *Copiar mensaje para el comprador* copia un texto listo para pegar en WhatsApp o en un email: el código, la dirección de la web y el enlace directo.

## Piezas
- `supabase/014_codigos_comprador.sql`: códigos (huella), selecciones formalizadas de cada comprador, intentos, `generar_codigo_comprador`, `codigos_de_promocion`, `entrar_comprador` (la llama la web pública, sin sesión).
- La web pública ya no lleva códigos ni selecciones (`vite.config.ts` los quita siempre). Lista pública de viviendas: `viviendas.json`, que genera `publicacion.mjs` en cada versión.
- Lo formalizado por cada comprador vive en `selecciones_comprador` (por ahora lo registra la administradora; su pantalla llegará con las personalizaciones, Fase 2).

## Errores
- «No se ha podido comprobar el código ahora mismo»: Supabase no responde (por ejemplo, dormido tras 7 días sin uso). Despertarlo desde su panel.
