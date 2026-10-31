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

## Garantías
- Solo fuentes públicas y gratuitas, con su licencia y atribución (la visita las enseña).
- La promotora no ve el entorno en MUNE Portal: lo ve en el 3D cuando se prepara la versión siguiente.
- Se borra con la promoción.
