# CLAUDE.md · MUNE Inmobiliarias

Contexto permanente para cualquier sesión de Claude que trabaje en este almacén. **Léelo entero antes de actuar.** Las decisiones detalladas están en `docs/arquitectura.md` (sobre todo el apartado final «Decisiones posteriores aprobadas», que prevalece) y el mapa del Panel en `docs/panel.md`.

## Con quién trabajas

- La propietaria es **Carolina (MUNE Projects)**. No es técnica.
- Háblale **en español, en sencillo**, sin jerga. Si hace falta un término técnico, explícalo en una frase.
- Cuando tenga que hacer algo, dale **pasos numerados y seguidos**, uno por acción, con la URL exacta y el texto exacto de cada botón. Si algo puede no coincidir con lo que ve, pídele una captura.
- Nunca le pidas contraseñas, llaves ni secretos por el chat.

## El producto

«Inmobiliarias» de MUNE Projects es una plataforma para **promotoras inmobiliarias**. Cada promoción tiene **una representación digital viva** de la que sale todo:

- la visita pública 3D (visor Three.js en `src/`);
- los renders, los planos comerciales, los packs de personalización y los PDF.

Claude se usa **solo en producción** (preparar, interpretar, revisar), **nunca por visitante**.

- **Modelo:** Promoción → Tipología → Variante (modificación fija: espejo, bajo, ático…) → Unidad (vivienda concreta). *Alternativa* = elección del comprador. En las plurifamiliares se produce por tipología y variante; en las unifamiliares, más individual por unidad. **No se gestionan disponibilidad ni precios de venta.**
- **Códigos de comprador** (Fase 1): se validan en Supabase. Se guarda solo su hash, con límite de intentos, regeneración y revocación. La web pública es estática y no depende de Supabase.
- **Entorno en tres capas** (A precisa, B próxima, C lejana), con su fiabilidad indicada. Fuentes: generación propia, Catastro, IGN/PNOA/LiDAR y OSM. Google 3D Tiles queda excluido salvo aprobación expresa. Dron: descartado (decisión 49).
- **3D híbrido:** la arquitectura se genera desde datos; el mobiliario y los objetos son GLB reutilizables de la biblioteca. Se permiten assets externos gratuitos (también modelos 3D) si su licencia permite uso comercial y redistribución, y siempre registrados.
- **Marca (decisión 39):** MUNE Projects = la empresa; **MUNE** = la plataforma y la marca visible («The agile visual platform»). Capas: **MUNE Portal** (la promotora), **MUNE Studio** (lo interno de MUNE: el Panel y el Studio) y la **experiencia pública de la promoción** (marca blanca). «Escaparate» es solo un nombre técnico interno. Textos: claros, directos, poco técnicos; tú en singular; «MUNE» para la plataforma y «el equipo de MUNE» para las personas; versiones «v7»; nunca errores técnicos a la vista. Arquitectura completa aprobada (decisión 40) en `docs/arquitectura-mune.md`: se implementa siguiendo su **lista maestra** (apartado 10, decisión 41), una propuesta por paso; en el paso de nombres definitivos desaparecen «Panel», «taller» y «escaparate» como nombres técnicos.
- **Personas:**
  - la **administradora** (Carolina) usa **MUNE Studio** (el Panel);
  - las **promotoras** usan **MUNE Portal**: documentación, planos, compradores, ficha y formalización; marca y catálogo, antes del primer cliente (decisión 49);
  - los **compradores** ven la experiencia pública y, con código, su parte privada (personalización, histórico y formalización).

## Reglas que nunca se rompen

1. **Ninguna publicación sin su aprobación explícita.** Ella revisa la vista previa y da su visto bueno al pulsar *Enviar a validar a la promotora*: si la promoción está en «Publicar al aprobar la promotora» (por defecto), se publica sola cuando la promotora valida todo; si está en «Publico yo», publica ella desde MUNE Studio (decisión 41).
2. **Nada de pago sin su aprobación.** Si una decisión técnica introduce suscripción, pago por uso, dominio, email de pago, GPU, licencia u otro servicio con coste: **detente y explícaselo antes.** Antes de crear cualquier cuenta, dile qué es, para qué sirve y si es gratis. **Nunca se activa automáticamente una GPU de pago.** No compramos dominio mientras se desarrolla.
3. **Ninguna clave sensible**:
   - en el frontend;
   - en GitHub;
   - en una web pública;
   - en documentación visible;
   - en el chat.

   En el navegador solo van la URL de Supabase y la clave *publishable*.
4. **El robot de Claude** (usuario normal de Supabase, sin clave maestra):
   - puede leer peticiones, fotos de referencia y promociones; cambiar el estado, la nota y el enlace de una petición; y anotar en el registro;
   - desde la Fase 1 (aprobado el 6/10/2026), también leer requisitos, documentos subidos y entregables, y marcar documentos como vigentes o rechazados, con nota (preguntándole antes, en la receta 2);
   - desde el paso 5a (aprobado el 22/10/2026), también guardar los datos privados de una versión (catálogo con precios, packs y viviendas) al prepararla, solo mientras no se haya enviado a validar (`guardar_datos_privados`, `024_datos_privados.sql`);
   - desde el paso 8a (propuesta del 28/10/2026), también leer las personalizaciones y mejoras que añaden las promotoras y sus documentos adjuntos, para preparar su aspecto en el 3D (`029_catalogo_promotora.sql`); no puede cambiarlas;
   - desde la auditoría de seguridad (aprobado el 29/10/2026), también leer y guardar el **modelo de cada promoción** (lo que se saca de sus planos y su memoria) y la copia de cada versión que prepara (`guardar_modelo_promocion`, `035_modelo_promocion.sql`), y **subir la web construida de cada versión que prepara** al almacén privado «versiones» y dejarla en revisión (`preparar_version`, `036_publicacion.sql`); no puede cambiar ni borrar las de una versión ya preparada, ni publicarla;
   - desde el paso 8c (propuesta del 28/10/2026), también leer la marca de cada promotora y promoción (nombre, logo, colores, tipografía y contacto) y descargar los archivos de su tipografía al preparar una versión (`031_marca.sql`); no puede cambiarla;
   - desde los comentarios visuales (propuesta del 29/10/2026), también leer los comentarios de las promotoras y las notas de MUNE (planos, 3D, personalización y versiones) y, al preparar una versión que aún no se ha enviado a validar, marcar como resueltos los que arregla (`resolver_comentarios`, `038_comentarios.sql`); no puede escribir, responder ni borrarlos;
   - **no** puede borrar, subir archivos, validar planos, publicar, crear administradores, cambiar reglas ni ver usuarios;
   - todo lo que hace queda registrado y se revoca al instante.
5. **No hay lista pública de promociones ni de promotoras.** Es información del negocio y vive en Supabase.
6. **Independencia de Claude:** todo debe poder operarse y entregarse sin Claude (recetas documentadas, Panel, ejecutor en GitHub Actions).
7. **Stack:** el visor usa Vite + TypeScript + Three.js r186 (WebGPU/TSL con respaldo WebGL2). El Panel es TypeScript sin frameworks + supabase-js. No introduzcas frameworks ni dependencias sin una necesidad real.

## Piezas y direcciones

| Pieza | Dónde |
|---|---|
| Código (MUNE Studio en `app/`, MUNE Portal en `portal/`, base de datos en `supabase/`), recetas | GitHub `MUNE-Projects/studio` (privado, antes `taller`), este almacén |
| Datos de cada promoción (el modelo: lo que se saca de sus planos y su memoria) | Supabase, `modelo_promocion` (decisión 59). Claude trabaja en `trabajo/<id>/`, que no va a GitHub: `node herramientas/promociones.mjs bajar <id>` y `subir <id> --nota "…"` |
| Entorno real de cada promoción | Supabase, almacén privado `entornos` (`<id>/entorno.json` y `orto.jpg`, decisión 64): lo descarga de Catastro, IGN y OpenStreetMap el proceso «Generar el entorno» de GitHub (`entorno.yml`, `herramientas/entorno.mjs`, cuenta «ejecutor»), desde la referencia catastral de la ficha; receta 23. «preparar» lo mete en cada versión (`entorno/`) y el 3D lo enseña con la casilla «Entorno real», sin marcar al abrir; el sitio de cada unidad en la parcela va en `promocion.json` → `situacion` (receta 1) |
| Copias de seguridad | GitHub `MUNE-Projects/copias` (privado): cada noche, datos, usuarios y archivos cifrados, como releases en borrador (fuera del historial de git); se conservan 31 días (receta 18, decisión 56) |
| La web de cada versión y el registro de versiones | Supabase: almacén privado «versiones» (`<id>/<vN>/sitio.tar.gz`) y `versiones_promocion` (decisión 60). `herramientas/desplegar.mjs` la envía a Cloudflare (Worker `experience`) desde GitHub Actions, con la cuenta «ejecutor» y la llave C; las páginas fijas (portada, 404, puerta del comprador, cabeceras) están en `experiencia-publica/`. El almacén `MUNE-Projects/experience` ya no se usa y se borra (decisión 61). Al borrar una promoción en MUNE Studio se borra todo lo suyo y se retira de la web (función `ejecutar`, acción `retirar`) |
| Web pública | https://experience.mune-projects.workers.dev/residencial-demo/ |
| Vista previa | https://revision-experience.mune-projects.workers.dev/residencial-demo/ |
| Puerta del comprador | https://experience.mune-projects.workers.dev/acceso/ («Accede a tu vivienda»: con su código, a su promoción; `experiencia-publica/publico/acceso/`) |
| MUNE Studio | https://studio.mune-projects.workers.dev (vista previa: https://revision-studio.mune-projects.workers.dev) |
| MUNE Portal | https://portal.mune-projects.workers.dev (vista previa: https://revision-portal.mune-projects.workers.dev), código en `portal/` |
| Base de datos y usuarios | Supabase, proyecto `mune` (antes `mune-inmobiliarias`; UE, Irlanda), plan gratuito: `https://iowtdenlkxjqzlpwizgb.supabase.co` |
| Alojamiento | Cloudflare Workers (cuenta con subdominio `mune-projects`), plan gratuito |

## Cómo se trabaja

- **Propuestas:** los cambios del taller se suben a la rama **`revision`** y se abre una propuesta (PR) hacia `main`. La descripción lleva arriba el enlace de **vista previa**, una lista «Qué revisar» y «Para aprobar: Merge pull request → Confirm merge». Ella revisa y aprueba. El nombre de la rama de trabajo de la sesión no debe aparecer en direcciones que ella vea.
- **Vistas previas:** `revision-studio`, `revision-portal` y `revision-experience` se construyen desde la rama `revision`. Cloudflare construye cada commit una sola vez: sube primero a `revision` y después a la rama de la sesión, o la vista previa de `revision` no se actualiza.
- **Nueva versión de una promoción** (recetas 9 y 10):
  1. `node herramientas/publicacion.mjs preparar <id> --cambios "…" --confirmar`, con las credenciales del robot (`ROBOT_EMAIL`, `ROBOT_CLAVE`) y los datos de `trabajo/<id>/` iguales a los guardados en Supabase: guarda en Supabase los datos privados de la versión (catálogo con precios, packs y viviendas), que ya no van en la web pública, y la copia exacta del modelo de la versión con el commit del código; genera los planos comerciales (`herramientas/planos.mjs`) y guarda la web construida en Supabase, «en revisión».
  2. (ya no hay `git push` de ningún escaparate)
  3. Lanzar el proceso `avisar.yml` del taller (`promocion`, `version`, `cambios`): envía la vista previa a Cloudflare y GitHub le manda el email «… lista para revisar».
  4. Tras revisar la vista previa, ella pulsa *Enviar los planos a la promotora*, y la promotora los aprueba en su portal (receta en `docs/recetas/09-10-planos-y-publicar.md`).
  5. **Publicación** (solo con todo validado: planos comerciales y Experiencia 3D): en modo «Publicar al aprobar la promotora», la última aprobación arranca sola `publicar.yml` (función `aviso-subida`); en modo «Publico yo», ella pulsa *Publicar vN* → función `ejecutar` → `publicar.yml`. `publicar.yml` lo apunta en Supabase y envía la web a Cloudflare (`desplegar.mjs ambas`). Solo se publica la versión revisada.
- **Volver atrás:** también desde MUNE Studio (*Volver a una anterior*, con motivo).
- **El registro de versiones** (`versiones_promocion` en Supabase): «en revisión» lo pone `preparar` (robot); publicar y volver atrás, solo la administradora o la cuenta «ejecutor» (`publicar.yml`). Para volver a enviar a Cloudflare lo que dice el registro: Actions → *Enviar la web a Cloudflare*.
- **Documentación de las promotoras** (recetas 2 y 13, `docs/recetas/`): «revisa lo nuevo de X» → `node herramientas/documentos.mjs pendientes | bajar <id> | estado <id> vigente|rechazado --nota "…"`; «¿hay algo nuevo?» → `node herramientas/documentos.mjs novedades`; «mira los comentarios de X» → `node herramientas/documentos.mjs comentarios <id>` (solo lo enviado: lo que la promotora mandó con «Pedir cambios» y las notas que ella devolvió a Claude); al preparar la versión nueva, `… comentarios <id> resolver <ids> --version vN` con los que arregla. **Nunca marques un documento sin su OK.**
- **Peticiones del Panel:** de momento **solo cuando ella lo pide** («revisa las peticiones del Panel»). Herramienta: `node herramientas/peticiones.mjs listar | fotos <id> | estado <id> …`, con las credenciales del robot en las variables del entorno (`ROBOT_EMAIL`, `ROBOT_CLAVE`). Con el primer cliente real, Claude lo revisará todo **cada hora** (peticiones, documentación nueva y avisos), como pidió ella el 25/10/2026: es una tarea programada que consume plan de Claude, así que se le recuerda y se confirma antes de activarla.
- **Base de datos:** los cambios de estructura van en `supabase/00N_*.sql`. Ella los pega en el SQL Editor; dale el SQL completo en el chat.
- Antes de proponer algo, **pruébalo** (por ejemplo, el Panel con datos simulados en Playwright, o las herramientas en copias aparte) y enséñale capturas o resultados.

## Estado (6 de octubre de 2026)

**Fase 0 terminada:**

- taller multipromoción, con el Studio fuera de la web pública;
- escaparate y Cloudflare, con vista previa;
- versiones numeradas;
- Panel con entrada segura (contraseña + código del móvil);
- lista privada de promociones;
- pedir cambios con fotos de referencia;
- registro de actividad;
- robot con permisos limitados;
- **publicar y volver atrás desde el Panel** (probado de verdad: v8 publicada y vuelta a v7);
- aviso por email de cada versión lista para revisar.

Ahora la web pública está en **v7**, y la **v8** (de prueba, idéntica) sigue en la vista previa.

**Pendientes conocidos:**

- Las llaves del ejecutor caducan el **7/10/2027**:
  - llave A: `GITHUB_EJECUTOR` en Supabase, con *Actions: read/write* sobre `studio` (antes `taller`);
  - llave B: `ESCAPARATE_TOKEN` en los secretos de `studio`, con *Contents: read/write* sobre `copias` (antes también sobre `experience`, que ya no se usa: decisión 61); conserva su nombre hasta la renovación;
  - llave C: `CLOUDFLARE_API_TOKEN` en los secretos de `studio` (enviar la web al Worker `experience`, decisión 60), y la contraseña de la cuenta «ejecutor» en `EJECUTOR_CLAVE`.

  MUNE Studio avisa en Inicio a 60 y 30 días, y la vigilancia manda email a 30 días (receta 19). Al renovarlas, apuntar la fecha en *Sistema → Ya la he renovado*.
- La protección de ramas en almacenes privados es de pago: no está activada.
- **Antes del primer cliente real:** sustituir el remitente `hello.muneprojects@gmail.com` por una dirección con dominio propio de MUNE (tiene coste: consultar antes). En ese momento, **recordarle** que cambie también a dónde llegan sus avisos de MUNE (secreto `AVISOS_MUNE_PARA` de GitHub; hoy sin crear, así que llegan a hello.muneprojects@gmail.com) y que hará una dirección para las promotoras.
- El plan gratuito de Supabase se duerme tras 7 días sin uso; `vigilancia.yml` lo mantiene despierto. Si aun así se duerme, se despierta gratis desde el panel de Supabase.

**Ahora: Fase 1 · Portal seguro**, aprobada por etapas (decisiones 17–25 de `docs/arquitectura.md`, que prevalecen):

1. ✔ cimientos de datos y prueba de aislamiento (`005_portal.sql`, `supabase/pruebas/`, `aislamiento.yml`);
2. ✔ portal de promotoras y accesos (receta 14): `portal/`, sección *Promotoras* del Panel, función `invitar`, `006_accesos.sql`, `007_equipos.sql` (equipos por promoción, sin roles, datos fiscales: decisión 28) y `008_ficha_promocion.sql` (ficha y lista estándar de documentos: decisión 29);
3. ✔ documentación (recetas 2 y 13, email de subida): pestaña *Documentación* del Panel, `009_aviso_subida.sql`, `010_borrar.sql` (exportar todo en ZIP y borrar promociones o promotoras desactivadas: decisión 33), función `aviso-subida` + `aviso-mune.yml` (Gmail de MUNE desde el paso 2 de la arquitectura MUNE), `herramientas/documentos.mjs` y `docs/recetas/`;
4. ✔ validación de planos (decisión 34): `herramientas/planos.mjs` (planos de cada versión, al preparar), *Enviar los planos a la promotora* en el Panel, pestaña *Planos* del portal, `011_planos.sql`, aviso por email de cada validación (`aviso-mune.yml`); solo se publica con todos aprobados. Avisos por email a la promotora (decisión 35): función `avisar-promotora`, `aviso-promotora.yml` (Gmail de MUNE, secreto `AVISOS_GMAIL_CLAVE`), `012_avisos_promotora.sql` y `013_permisos_funciones.sql` (en el proyecto real, la cuenta `service_role` de las funciones necesita `grant` explícito en cada tabla que use);
5. ✔ códigos de comprador (receta 24, decisión 36): pestaña *Compradores* del Panel y del portal, `014_codigos_comprador.sql` (`entrar_comprador` desde el botón de la web pública); la web pública ya no lleva códigos ni selecciones. Sin precio de la vivienda ni datos personales del comprador (decisión 37): el comprador solo ve el total de su personalización, y su nombre y DNI van solo al PDF;
6. ✔ bandeja de Inicio y avisos del sistema (receta 19, decisión 38): `015_sistema.sql` (llaves con caducidad, `latido`, `avisos_sistema`, `estado_sistema`), `app/src/sistema.ts`, `vigilancia.yml` (cada 3 días: mantiene despierto Supabase y avisa por email de llaves y caídas);
7. ✔ copias en el almacén privado `copias` de GitHub y simulacro (receta 18, paso 4 de la lista maestra, 22/10/2026): `023_copias.sql`, `supabase/copias/`, `copias.yml` (cada noche) y `simulacro.yml` (cada trimestre);
8. alta de promoción (receta 1) y ensayo con una promotora ficticia.

**Desde el 12/10/2026 se sigue la lista maestra** de `docs/arquitectura-mune.md` (apartado 10): paso 1 (prueba real del flujo) ✔; paso 2 (documentación, módulos de cada promoción y publicación al aprobar la promotora, `022_modulos_y_documentos.sql`) ✔; paso 3 (nombres definitivos: `studio`, `experience`, `app/`, `supabase/`) ✔ el 20/10/2026; paso 4 (copias y simulacro, `023_copias.sql`) ✔ el 22/10/2026; paso 5 (datos privados, personalización y Excel) en tres propuestas: 5a (datos privados fuera de la web pública, `024_datos_privados.sql`) ✔, 5b (Seleccionada → Cerrada, pestaña Personalización y Excel, `025_selecciones.sql`; el equipo de la promotora también puede seleccionar desde el Portal; **MUNE nunca elige ni cambia una selección**) ✔ y 5c (puerta general del comprador, `026_puerta_comprador.sql` y `publico/acceso/` de `experience`) ✔; paso 6 (MUNE Experience con sus tres contextos) en dos propuestas: 6a (3D profesional desde el Portal con un pase personal, elegir en nombre del comprador con «Gestionar personalizaciones» y fin del acceso profesional público, `027_profesional.sql`, decisión 46) ✔ y 6b (enlace público y código de inserción por tipología, sin pasar a otras tipologías; «Solicitar información»; Experience pública apagada; `028_experiencia_publica.sql`, decisión 47) ✔. Paso 7 (ensayo con una promotora ficticia) ✔ en una copia local el 25/10/2026; ahora 7b: **cada promoción se interpreta desde sus planos y su memoria, nada atado a la demo** (decisión 48), y «preparar» se detiene si las superficies no cuadran con las oficiales. Renders de una vivienda personalizada: solo la promotora, desde el Portal. Las direcciones antiguas `panel.…` y `escaparate.…` (Workers `panel` y `escaparate`) se retiran el 27/10/2026: las funciones ya no las aceptan. Las etapas 7 y 8 de arriba quedan dentro de esa lista (copias = paso 4; ensayo ficticio = paso 7).

Cada etapa es una propuesta con su OK. Decisiones clave: Supabase gratuito hasta el primer cliente; promotoras con usuario y contraseña; emails con un Gmail dedicado; la prueba de aislamiento corre en un Supabase local dentro de GitHub (sin segundo proyecto ni llaves).
