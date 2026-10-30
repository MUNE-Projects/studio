# Web pública de las promociones (Worker «experience» de Cloudflare)

Aquí solo están las **páginas fijas** de la web pública, que son código:

- `publico/index.html`: la portada vacía (no hay lista pública de promociones);
- `publico/404.html`: la página de «no encontrado»;
- `publico/acceso/`: la puerta del comprador («Accede a tu vivienda»);
- `publico/_headers`: las cabeceras que necesitan MUNE Studio y MUNE Portal;
- `wrangler.jsonc`: la configuración de Cloudflare.

La web de cada promoción **no está en GitHub**: cada versión preparada se guarda
en Supabase (almacén privado «versiones», `036_publicacion.sql`). Al publicar,
`herramientas/desplegar.mjs` monta `publico/` con estas páginas y la versión que
toca de cada promoción, y lo envía a Cloudflare: la publicada a
https://experience.mune-projects.workers.dev y la de la vista previa a
https://revision-experience.mune-projects.workers.dev (decisión 60).
