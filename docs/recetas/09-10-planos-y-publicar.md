# Recetas 9 y 10 · Versión, validación de planos y publicación

**Lo dices así:** «Prepara la versión de Residencial X» y, cuando la promotora haya aprobado los planos, «publica Residencial X» (o lo publicas tú desde el Panel).
**Tipo:** automática, con tres puntos de control: tu revisión, la aprobación de la promotora y tu publicación.

## Pasos
1. **Preparar** (Claude): `node herramientas/publicacion.mjs preparar <id> --cambios "…" --confirmar`, con el escaparate en la rama `revision`.
   - Construye la web pública (sin Studio ni secretos).
   - **Genera los planos comerciales** de la versión con `herramientas/planos.mjs`: uno por tipología y variante (espejo…) y por cada distribución alternativa; en las unifamiliares (`"tipo": "unifamiliar"` en `promocion.json`), uno por vivienda. Quedan en `planos/` de la vista previa, con `planos.json` (títulos, viviendas y huellas).
   - Con los planos, **genera las unidades de la Experiencia 3D** (`experiencia/experiencia.json` de la vista previa): una por tipología y variante (las distribuciones alternativas van dentro de su tipología); en las unifamiliares, una por vivienda; y «Entorno y elementos generales» si existe `promociones/<id>/entorno/`. Cada unidad lleva su huella (si no cambia, su validación sigue valiendo) y sus vistas guiadas. Para revisar una unidad concreta en la visita: `?ver=<clave>` (por ejemplo, `?ver=a-espejo`).
   - **Datos privados** (paso 5a, `024_datos_privados.sql`): el catálogo con sus precios, los packs, lo que admite cada tipología y la lista de viviendas **no van en la web pública** (que solo lleva la opción incluida de cada categoría, sin precios, y una vivienda de muestra por unidad). Se guardan en Supabase con la versión, con el robot (`ROBOT_EMAIL` y `ROBOT_CLAVE`, **obligatorias**), antes de tocar el escaparate, y solo mientras la versión no se haya enviado a validar. El comprador recibe los de su vivienda al entrar con su código; MUNE Studio y el Portal sacan de ahí la lista de viviendas para los códigos.
   - **Textos legales:** si están las credenciales del robot (`ROBOT_EMAIL` y `ROBOT_CLAVE`), usa los que la promotora ha escrito en MUNE Portal (planos, renders, experiencia y personalización) en lugar de los de `promocion.json`; los vacíos no cambian nada. Sin credenciales avisa y sigue con los de `promocion.json`. La web pública sigue sin consultar Supabase: los textos van dentro de cada versión, así que un cambio de texto necesita una versión nueva.
2. `git push` de `revision` del escaparate y aviso «… lista para revisar» (`avisar.yml`).
3. **Tu revisión:** abres la vista previa. Si está bien, en el Panel → promoción → *Resumen y versiones* → **Enviar los planos a la promotora**. El Panel copia los planos al almacén privado (comprobando su huella) y la promoción pasa a «Planos para validar», y el equipo de la promotora recibe un email (función `avisar-promotora`). Hasta entonces la promotora no ve nada.
4. **La promotora** (portal → pestaña *Planos*): cada plano se aprueba (con la casilla «He revisado…») o se piden cambios explicando qué corregir. Te llega un email por cada uno, y otro cuando están todos aprobados.
   - Si piden cambios: se corrige y se prepara una **versión nueva** (vuelta al paso 1). Los planos que no cambian (misma huella de datos) conservan su aprobación: solo se validan los que cambian.
   - **Nada nuevo que validar** (los planos y la Experiencia 3D, iguales que en la versión publicada, ya aprobada; por ejemplo, cuando la versión solo trae una mejora de MUNE): MUNE Studio no ofrece *Enviar a validar* y dice «Nada nuevo que validar». La publicas tú con *Publicar vN*, en cualquiera de los dos modos. Al publicar, el Panel apunta los elementos para la promotora sin avisarla (conservan su aprobación) y la función `ejecutar` lo comprueba igual; la promotora solo recibe el email «versión publicada». Si aun así quedara algo por validar (por ejemplo, porque la promotora ha añadido aprobadores), se le envía a validar como siempre y no se publica.
5. **Publicar:** el botón *Publicar vN* del Panel solo se activa con **todos** los planos aprobados (lo comprueba también la función `ejecutar`). Lo pulsas tú, o me pides que lo haga. Al terminar, el equipo de la promotora recibe el email «versión publicada».

## Garantías
- Queda registrado quién aprobó cada plano, cuándo y la huella del archivo exacto. Una validación no se puede cambiar ni repetir, y solo se validan los planos de la última versión enviada.
- Las versiones preparadas antes de existir los planos (sin `planos.json`) se publican como antes.

## Sin Claude
`publicacion.mjs` y `planos.mjs` funcionan en cualquier ordenador con Node y Chromium (variable `CHROMIUM` si no está en la ruta habitual). Lo demás se hace desde el Panel y el portal.
