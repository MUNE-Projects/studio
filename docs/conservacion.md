# Conservación · qué guarda cada sistema y cuánto

Política aprobada por la administradora el 10/11/2026 (decisión 73), sobre el inventario del 3/11/2026 (decisión 70). Los plazos automáticos los aplica cada noche el proceso *Aplicar los plazos de conservación* (`conservacion.yml`, `048_conservacion.sql`), con la cuenta «ejecutor». Con una copia recuperada sin comprobar no borra nada.

## Plazos

| Qué | Plazo | Cómo |
|---|---|---|
| Acceso de una persona de la promotora | **Se revoca al momento** | *Retirar el acceso* en MUNE Studio o MUNE Portal: deja de entrar en ese instante |
| Su cuenta (email, contraseña, código del móvil) | **Se elimina a los 30 días** de quedarse sin ningún acceso activo (ni a una promoción activa ni a una promotora activa) | Automático. Antes se guarda aparte quién era (nombre, cargo, email y a qué tenía acceso, en `personas_retiradas`) para que sus aprobaciones, entregas y selecciones sigan teniendo nombre. Las cuentas internas (administradora, robot de Claude, «ejecutor», copias) nunca se eliminan solas |
| Registro técnico de actividad (entradas, descargas, peticiones del Panel, marcas de trabajo de Claude…: lista `acciones_tecnicas()`) | **90 días** | Automático. Lo que no está en esa lista se conserva |
| Pruebas rutinarias (copias y simulacros en `copias_hechas`) | **90 días** (siempre queda la última de cada tipo) | Automático |
| Registros de GitHub Actions (cada paso de cada proceso) | **90 días** | Ajuste de GitHub (*Settings → Actions → General*); 90 es el valor por defecto |
| Registros de avisos automáticos de MUNE (`avisos_enviados` y «avisa a la promotora por email» del registro) | **12 meses** | Automático |
| Avisos de GitHub («lista para revisar», «⚠️ …») | **12 meses** cerrados | A mano por ahora: borrar una incidencia exige una llave con permiso de administración. Se añade al renovar las llaves (7/10/2027), cuando los primeros cumplan 12 meses |
| Buzón de emails pendientes (`correos_pendientes`) | 2 días como mucho | Automático (decisión 71) |
| Copias de seguridad | 31 días | Receta 18 (sin cambios) |
| Gmail de MUNE (`hello.muneprojects@gmail.com`) | **Se mantienen** los correos que hay | No se borra nada |
| **Pruebas** (ver abajo) | **Sin plazo automático: se conservan aparte** | Nada las borra solo |

### Qué es prueba y se conserva aparte

- **Autorizaciones de portfolio** (`portfolio_autorizaciones`), también la fecha de retirada.
- **Contrato**: hoy en el correo y la contabilidad de MUNE Projects (fuera de MUNE).
- **Entrega**: documentación que subió la promotora y quién la subió (`documentos`), planos y materiales entregados (`entregables`), exportaciones enviadas (`exportaciones`).
- **Aprobación**: validaciones de planos y de la Experiencia 3D (`validaciones`, `aprobaciones`), versiones publicadas y vueltas atrás (`versiones_promocion` y el registro), selecciones de los compradores, peticiones de eliminar sin exportación (`eliminaciones_sin_exportacion`), eliminaciones (`eliminaciones`, solo huellas) y quién era cada persona retirada (`personas_retiradas`).
- Del registro de actividad, todo lo que no es técnico (publicar, volver atrás, enviar a validar, altas, accesos dados, exportaciones, eliminaciones, correcciones de comentarios…).

Siguen la regla de siempre al **eliminar una promoción o una promotora** (decisión 70): sus validaciones, aprobaciones y documentos se van en la exportación para la promotora y se borran de Supabase. **Pendiente de decidir:** si MUNE debe guardar su propia copia de esas pruebas tras eliminarla (hoy no la guarda).

## Datos personales en los archivos y los comentarios

Los planos y las memorias son documentación técnica: no necesitan datos de personas. Por eso (decisión 73):

1. **Aviso en MUNE Portal**, de una línea, junto a cada subida de archivos (documentación y adjuntos de las opciones) y cada comentario (comentarios, «Pedir cambios» de planos y de la Experiencia 3D): que no incluyan datos personales.
2. **Si se detecta alguno, se corrige solo ese archivo o ese comentario antes de pasarlo a Claude:**
   - **Comentario:** `documentos.mjs` no le enseña a Claude un comentario, una petición de cambios ni la descripción de una opción si parece llevar un correo, un teléfono, un DNI/NIE o una cuenta bancaria: sale como «retenido». La administradora lo corrige en MUNE Studio con *Quitar un dato personal* (solo ese comentario; en el registro queda que se corrigió, sin copiar el original). Los nombres no se pueden detectar solos: si la administradora ve uno, lo corrige igual.
   - **Archivo:** si la administradora o Claude ven datos personales en un documento, Claude no los copia a ningún sitio (modelo, notas, resúmenes), borra su copia local de ese archivo y propone rechazarlo con la nota «Sube una versión sin datos personales (nombres, correos, teléfonos o firmas)». Con el OK de la administradora, la promotora sustituye solo ese archivo; los demás siguen.
3. Lo que ya hace `archivo-robot` (decisiones 67 y 72): sin metadatos, sin notas pegadas encima de los PDF y sin el nombre de archivo de la promotora.
4. **Aparcado:** el prototipo que borra líneas del PDF (cajetines con nombres). No se usa: podría estropear la lectura de cotas y medidas.

## GitHub: ejecuciones antiguas con correos

Hasta el 8/11/2026 (decisión 71), *aviso a la promotora*, *aviso a MUNE* y *publicar* recibían los correos como datos de entrada, que siguen en la ficha y el registro de esas ejecuciones. El proceso *Borrar ejecuciones antiguas con correos* (`limpiar-ejecuciones.yml`, a mano) **simula** por defecto: lista cada ejecución anterior al 9/11/2026, mira si su registro lleva algún correo (solo los cuenta) y dice cuáles se borrarían. Con *borrar* marcado y `BORRAR` escrito, borra solo las que llevan correos.

Revisión del 10/11/2026 (antes de borrar nada):

- *aviso a la promotora*: 13 ejecuciones (10/10 a 3/11). **No son prueba**: lo avisado consta en `avisos_enviados` de Supabase y en *Enviados* de Gmail.
- *publicar*: 4 ejecuciones (aprobar v8 y volver a v7 el 6/10, aprobar v10 el 12/10 y v12 el 25/10, todas de la demo). Son de la demo (ningún cliente real) y lo publicado consta también en el historial de git («Registro: residencial-demo vN publicada») y en el registro de Supabase. **No hace falta conservarlas como prueba.** Las del 6/10 son anteriores a que *publicar* recibiera correos: la simulación debe decir que se quedan.
- *aviso a MUNE*: GitHub no lista ninguna ejecución.

## Qué guarda cada sistema

### Supabase (proyecto `mune`, plan gratuito)

| Qué | Para qué | Datos personales | Cuánto |
|---|---|---|---|
| Cuentas (`auth.users`, factores del móvil) | Entrar en MUNE Studio y MUNE Portal | email, contraseña cifrada, código del móvil | Hasta 30 días después de quedarse sin acceso |
| Accesos (`miembros`) | Quién de la promotora entra y a qué | nombre, email, cargo | Retirar lo desactiva al momento; se borran con la cuenta (quién era queda en `personas_retiradas`) |
| Personas retiradas (`personas_retiradas`) | Dar nombre a las pruebas de una cuenta eliminada | nombre, cargo, email | Prueba: sin plazo automático |
| Registro de actividad (`registro`) | Quién hizo qué | identificador y detalle | Técnico: 90 días; avisos: 12 meses; el resto (prueba), sin plazo |
| Validaciones, aprobaciones y versiones | Prueba de qué se aprobó y publicó | quién aprueba | Hasta que se elimina la promoción (van en la exportación) |
| Autorizaciones de portfolio | Prueba de lo autorizado | quién autoriza, documento | Sin plazo, también retiradas |
| Peticiones de eliminar sin exportación, eliminaciones | Prueba | quién lo pidió / solo huellas | Sin plazo |
| Avisos enviados (`avisos_enviados`) | No repetir avisos | a quién (número) y de qué | 12 meses |
| Copias y simulacros (`copias_hechas`), noches de conservación (`conservacion_hecha`) | Técnico | ninguno | 90 días |
| Exportaciones | Enlace de la promotora | número de destinatarios | Archivos hasta que caducan (30 días) o se revocan; la fila queda como prueba |
| Documentación, entregables, fotos de referencia, versiones, entorno, portfolio | El servicio | lo que contengan | Hasta que se elimina la promoción (el portfolio, mientras dure la autorización) |
| Registros internos de Supabase | Fallos | IP, email al entrar | Los fija el proveedor (en el plan gratuito, pocos días) |

### GitHub (`MUNE-Projects/studio` y `MUNE-Projects/copias`, privados)

| Qué | Cuánto |
|---|---|
| Copias de seguridad (releases en borrador de `copias`) | 31 días |
| Lista de eliminaciones (release «eliminaciones») | Sin plazo, a propósito (solo huellas) |
| Registros de cada ejecución | 90 días (ajuste de GitHub); la ficha de la ejecución puede quedarse más. Desde la decisión 71, sin correos ni textos |
| Ejecuciones anteriores al 9/11/2026 con correos | Se borran con `limpiar-ejecuciones.yml` (arriba) |
| Avisos de GitHub (issues) | 12 meses cerrados (a mano por ahora) |

### Cloudflare (Workers `experience`, `revision-experience`, `studio`, `portal`)

La web publicada y la vista previa, hasta que se retira la promoción. Versiones antiguas de cada Worker: historial de Cloudflare, sin dirección propia (`preview_urls: false`); solo se borran todas, borrando el Worker. Registros de visitas: en el plan gratuito no se guardan si no se activan.

### Gmail de MUNE

Se mantienen los correos existentes: avisos enviados, avisos recibidos y respuestas de las promotoras (estas, mientras puedan hacer falta por el contrato). Cada aviso queda también en `avisos_enviados` de Supabase, que es el que cuenta como constancia.

### Claude (Anthropic)

Lo que recibe Claude se describe en el informe «Qué información llega a Claude» y en las decisiones 67 y 72. Cuánto guarda Anthropic depende de sus condiciones y de la configuración de la cuenta: la administradora comprueba en su cuenta de Claude que la opción de usar sus conversaciones para mejorar los modelos está desactivada. Las condiciones del proveedor siguen siendo una pregunta abierta del contrato.

### El ordenador de la administradora

Lo que descargue (ZIP interno, planos, PDF). La exportación para la promotora ya no pasa por él. Pendiente: si las descargas internas se borran después de usarlas.

## Qué alcance tiene cada eliminación

| Se elimina | Desaparece al momento | Copias que quedan y cuándo caducan |
|---|---|---|
| Una **promoción** (o una **promotora**, con todas sus promociones) | En Supabase, sus datos y archivos; se retira de la web pública y de la vista previa | En las copias, hasta **31 días**. La exportación de la promotora, hasta que caduca o se revoca. El portfolio, solo lo autorizado. Lo ya enviado por email o descargado, y el historial de GitHub y de Cloudflare: según cada proveedor |
| Un **acceso** (retirarlo) | La persona deja de entrar; su fila sigue, desactivada | Su cuenta se elimina a los 30 días si no le queda ningún acceso activo; en las copias, 31 días más |
| Un **código de comprador** (revocarlo) | Deja de funcionar | En las copias, hasta 31 días (y nunca vuelve a funcionar al recuperar una copia) |

Si se recupera una copia, una cuenta ya eliminada puede volver sin ningún acceso (sus accesos retirados se vuelven a retirar, receta 18) y el proceso de cada noche la elimina de nuevo.
