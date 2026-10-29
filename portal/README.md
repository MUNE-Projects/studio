# MUNE Portal

El espacio de trabajo de las promotoras (antes «Portal de promotoras»). Es una
web privada donde cada persona entra con su correo, su contraseña (la elige al
aceptar la invitación) y el código de 6 cifras de la app del móvil (lo vincula
la primera vez; `032_movil_promotoras.sql`), y ve solo las promociones de su
promotora: la
documentación que tiene que entregar (y la sube), sus planos y entregables, y
la versión publicada.

Cada promoción va por pestañas: *Resumen*, *Documentación*, *Planos* (validar
los planos comerciales de cada versión: aprobar o pedir cambios), *Compradores*
(códigos de comprador de cada vivienda) y *Ficha y datos* (ficha, datos
fiscales y formalización de la personalización).

- Código: `src/main.ts` (pantallas), `src/planos.ts` (validación de planos),
  `src/compradores.ts` (códigos de comprador), `src/formalizacion.ts`
  (formalización de la personalización), `src/xlsx.ts` y `src/zip.ts` (Excel y
  ZIP descargables) y `src/comun.ts` (sesión y utilidades), en TypeScript sin
  frameworks + `@supabase/supabase-js`.
- Reglas de la base de datos: `panel/supabase/005_portal.sql` y `006_accesos.sql`.
  Las comprueba el servidor; la página no decide nada.
- Accesos: los da la administradora desde la sección *Promotoras* del Panel (MUNE Studio),
  con la función `invitar` de Supabase (`panel/supabase/funciones/invitar`).
- Emails (invitación y contraseña nueva): textos en `panel/supabase/emails/`,
  pegados en Supabase → Authentication → Emails.
- Publicación: Cloudflare Workers (`wrangler.jsonc`), proyecto `portal`, solo
  archivos estáticos, con vista previa por cada propuesta (rama `revision`).

## Seguridad

- En el navegador solo hay datos públicos: la dirección del proyecto y la clave
  «publishable».
- Los archivos no tienen dirección pública: se descargan con enlaces que
  caducan en 1 minuto y que solo se crean para quien tiene permiso.
- Nadie puede borrar ni sobrescribir: si algo está mal, se sube una versión
  nueva y las anteriores se conservan.
- La sesión vive en la pestaña y se cierra tras 1 hora sin actividad; al
  volver a la pantalla de entrada se avisa de por qué.
- Cabeceras: sin indexar, sin iframes, CSP estricta (`public/_headers`).

## Desarrollo

```sh
cd portal
npm install
npm run dev
```

Para probarlo contra el Supabase local de `panel/pruebas`:
`VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_CLAVE=<clave publishable local> npx vite --port 5174`.
