# Panel de administración

Centro de control interno (no lo ven los compradores). Fase 0, paso 1: entrada
con contraseña + código del móvil y registro de actividad.

- Código: `src/main.ts` (TypeScript sin frameworks) + `@supabase/supabase-js`.
- Base de datos: los archivos de `supabase/` se ejecutan una vez, en orden, en Supabase → SQL Editor:
  - `001_panel.sql`: administradoras y registro de actividad;
  - `002_promociones.sql`: lista privada de promotoras y promociones;
  - `003_peticiones.sql`: peticiones de cambios y usuario robot de Claude;
  - `004_referencias.sql`: almacén privado de fotos de referencia;
  - `005_portal.sql`: portal de promotoras (miembros, requisitos, documentos, entregables, validaciones y sus almacenes privados);
  - `006_accesos.sql`: accesos de las promotoras (para la sección *Promotoras* y la función `invitar`);
  - `007_equipos.sql`: equipos por promoción (o acceso a todas las de la promotora), sin roles, y datos fiscales de promotoras y promociones;
  - `008_ficha_promocion.sql`: ficha de la promoción y lista estándar de documentos;
  - `009_aviso_subida.sql`: aviso por email de cada documento subido (una sola vez por documento).
  - `014_codigos_comprador.sql`: códigos de comprador (solo su huella), límite de intentos, lo formalizado por cada comprador y `entrar_comprador` para la web pública (receta 24).
  - `015_sistema.sql`: llaves con su caducidad, `latido` (vigilancia automática), `avisos_sistema` y `estado_sistema` para el Inicio y la sección Sistema (receta 19).
  - `018_fase_proyecto.sql` y `019_cambio_fase.sql`: fase del proyecto (anteproyecto, básico o ejecución) con su historial; cada documento queda marcado con la fase de ese momento; «Memoria de calidades técnica».
  - `017_textos_requisitos.sql`: textos de la lista estándar de documentos (en singular; «Documentación técnica de materiales, acabados y equipamiento»).
  - `016_formalizacion.sql`: contacto y datos de pago de la formalización de cada promoción (`guardar_formalizacion`), que `entrar_comprador` devuelve solo con un código válido (decisión 39).
  - `013_permisos_funciones.sql`: permisos de la cuenta interna de las funciones (service_role) sobre las tablas que usa `avisar-promotora`. **Ojo:** en el proyecto real esa cuenta no tiene permisos por defecto en las tablas nuevas; cada función que use la clave de servicio necesita su `grant`.
  - `012_avisos_promotora.sql`: avisos por email al equipo de la promotora (planos para validar, documento rechazado, versión publicada), sin repetir.
  - `011_planos.sql`: validación de planos por la promotora (planos de cada versión, aprobación heredada si no cambian, publicar solo con todo aprobado).
  - `020_equipos_y_validaciones.sql`: administradores de la promotora y de promoción, capacidades por acceso, equipo gestionado por la promotora (`dar_acceso`, `cambiar_acceso`), aprobadores por promoción y tipo, validación de planos comerciales y de Experiencia 3D por varias personas, documentos con varios archivos y textos legales. Después de pegarlo hay que volver a desplegar las funciones `invitar`, `avisar-promotora`, `aviso-subida` y `ejecutar`.
  - `010_borrar.sql`: borrar desde el Panel una promoción o una promotora desactivada, con todo lo suyo (antes obliga a descargar la exportación).

  Ojo: volver a lanzar `002` después de `005` quita los permisos de escritura de la administradora; en ese caso, relanzar `005`.
- Prueba de aislamiento entre promotoras: `bash pruebas/lanzar.sh` (necesita Docker y psql). Levanta un Supabase local vacío, aplica estos archivos y hace las comprobaciones. En GitHub se lanza sola en cada propuesta (`.github/workflows/aislamiento.yml`).
- Función de Supabase `invitar` (`supabase/funciones/invitar/index.ts`): dar acceso al portal (receta 14), desde MUNE Studio y desde MUNE Portal (Equipo) para quien administra. Comprueba `puede_dar_acceso` y da el acceso con `dar_acceso` usando la sesión de quien llama; crea la cuenta y Supabase envía el email de invitación con la clave de servicio que Supabase da a la función, que no sale de sus servidores.
- Función de Supabase `aviso-subida` (`supabase/funciones/aviso-subida/index.ts`): la llama el portal tras cada subida (lanza `.github/workflows/aviso-documento.yml`) y tras cada validación de planos comerciales o de Experiencia 3D (lanza `.github/workflows/aviso-plano.yml`, con el avance «1 de 2 aprobaciones» y la zona). GitHub te manda el email.
- Textos de los emails del portal (invitación y contraseña nueva): `supabase/emails/`.
- Función de Supabase `avisar-promotora` (`supabase/funciones/avisar-promotora/index.ts`): emails a la promotora: planos comerciales y Experiencia 3D para validar (solo a sus aprobadores; si no hay, a quien administra la promoción para que los defina), documento rechazado (a quien tiene «Documentación» o administra) y versión publicada (a todo el equipo) a través de `.github/workflows/aviso-promotora.yml` y el Gmail de MUNE.
- Función de Supabase `ejecutar` (`supabase/funciones/ejecutar/index.ts`): botones Publicar y Volver, a través de `.github/workflows/publicar.yml`. Publicar exige planos comerciales y Experiencia 3D validados.
- Mapa completo del Panel y brazo ejecutor: `docs/panel.md`.
- Versiones: el Panel lee el `version.json` de cada promoción en producción y en la vista previa del escaparate. No existe ninguna lista pública de promociones.
- Publicación: Cloudflare Workers (`wrangler.jsonc`), solo archivos estáticos.

## Seguridad

- En el navegador solo hay datos públicos: la dirección del proyecto y la clave
  «publishable». Ninguna clave secreta vive aquí.
- Las reglas de la base de datos exigen sesión con doble verificación (`aal2`)
  y estar en la tabla `administradores`. La lista de administradores no se
  puede cambiar desde el Panel.
- El registro solo admite añadir apuntes; no se edita ni se borra.
- El alta de usuarios está cerrada en Supabase: solo se crean a mano.
- La sesión vive en la pestaña y caduca a los 30 minutos sin actividad.
- Cabeceras: sin indexar, sin iframes, CSP estricta (`public/_headers`).

## Desarrollo

```sh
cd panel
npm install
npm run dev
```

## Publicación

Cloudflare Workers Builds (almacén `taller`, directorio raíz `panel`):
`npm run build` y `npx wrangler deploy`. Cada propuesta de GitHub recibe su
vista previa; la versión definitiva sale al aprobar la propuesta en `main`.
