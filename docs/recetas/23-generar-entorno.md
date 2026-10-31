# Receta 23 · Generar el entorno real de una promoción

**Para qué:** que el 3D de la promoción tenga alrededor lo que de verdad hay (edificios, calles, árboles, relieve y la foto aérea), de fuentes públicas y gratuitas (decisión 64).

**Quién:** la administradora, desde MUNE Studio. También se puede lanzar desde GitHub, sin Claude.

## Pasos
1. En MUNE Studio, abre la promoción → pestaña **Ficha y datos**.
2. Comprueba que la ficha tiene la **referencia catastral** de la parcela (14 o 20 caracteres; la da la promotora en MUNE Portal o está en la escritura o en la Sede Electrónica del Catastro).
3. Baja hasta **Entorno real** y pulsa **Generar el entorno** (o **Volver a generar el entorno**).
4. Espera unos minutos y vuelve a la pestaña: verás el plano con la parcela en naranja, los edificios de alrededor, las calles y los árboles.
5. Revisa que la parcela es la buena. Si no lo es, corrige la referencia catastral en la ficha y vuelve a generarlo.

**Sin MUNE Studio:** GitHub → `MUNE-Projects/studio` → **Actions** → **Generar el entorno** → **Run workflow** → escribe el identificador de la promoción (y, si hace falta, la referencia catastral) → **Run workflow**.

## Qué hace
- `herramientas/entorno.mjs generar <promoción>` (en GitHub Actions, con la cuenta «ejecutor»):
  - parcela y edificios con sus plantas del **Catastro** (INSPIRE);
  - calles, árboles y zonas verdes de **OpenStreetMap**;
  - relieve (MDT05) y ortofoto (PNOA) del **IGN**;
  - lo guarda en el almacén privado `entornos` de Supabase (`<promoción>/entorno.json` y `orto.jpg`).
- Si una fuente no responde, guarda el resto y lo dice en **Avisos**; se puede volver a generar más tarde.
- Para probar sin Supabase: `node herramientas/entorno.mjs prueba --referencia <RC>`.

## En el 3D
- Al **preparar la versión siguiente** (`publicacion.mjs preparar`), el entorno entra en ella (`entorno/` dentro de la web, sin la referencia catastral ni las coordenadas). Si no se ha generado, la versión sale sin entorno y sin casilla.
- En la Experiencia 3D (MUNE Studio, MUNE Portal y la pública) aparece la casilla **Entorno real**, sin marcar al abrir. Al marcarla se descarga y la vivienda se ve en su sitio de la parcela, con los edificios de alrededor, los árboles, el relieve y la foto aérea; también desde dentro, por las ventanas. Al desmarcarla, vuelve a verse sola.
- El sitio de cada unidad (posición, giro y altura de su suelo) se apunta en `promocion.json` → `situacion` al interpretar la documentación (receta 1). Si falta, «preparar» lo avisa y la vivienda se ve en el centro de la parcela, en planta baja.
- Los renders HD y la descarga por lotes salen con el entorno si la casilla está marcada.

## Garantías
- Solo fuentes públicas y gratuitas, con su licencia y atribución (la visita las enseña).
- La promotora no ve el plano del entorno en MUNE Portal: lo ve en el 3D cuando se prepara la versión siguiente.
- Se borra con la promoción.
