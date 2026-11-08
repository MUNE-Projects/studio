# Inventario de conservación · qué guarda cada sistema

Preparado el 3/11/2026 (decisión 70). **No fija plazos:** los plazos de 30 días para cuentas, 90 días para emails y 12 meses para el registro **no están aprobados** y no se han aplicado. No hay borrados masivos. Este inventario sirve para decidir, caso por caso, qué se conserva y cuánto.

Lo que se guarda es de dos tipos, y no se tratan igual:

- **Avisos automáticos y registros técnicos.** Emails «lista para revisar», «documentación nueva», alertas de vigilancia, historial y registros de GitHub Actions, registros de Supabase y Cloudflare. Sirven para que funcione y para investigar un fallo. No prueban nada frente a terceros.
- **Lo que tiene valor de prueba.** Contratos, facturas, aprobaciones relevantes (validaciones de planos y de la Experiencia 3D, publicaciones, autorizaciones de portfolio, peticiones de eliminar sin exportación) y comunicaciones de incidencias o reclamaciones. Hoy los contratos y las facturas **no están en MUNE**: están en el correo y la contabilidad de MUNE Projects. Las aprobaciones relevantes sí están en Supabase (tablas de abajo).

## 1. Supabase (proyecto `mune`, plan gratuito)

| Qué | Para qué | Datos personales | Cuánto se guarda hoy | Decisión pendiente |
|---|---|---|---|---|
| Cuentas (`auth.users`, factores del móvil) | Entrar en MUNE Studio y MUNE Portal | email, contraseña cifrada, código del móvil | Hasta que se borra la cuenta | Cuándo se borra la cuenta de una persona que ya no tiene acceso (hoy, a mano) |
| Accesos (`miembros`) | Quién de la promotora entra y a qué | nombre, email, cargo | Hasta que se elimina la promotora o el acceso; retirar un acceso lo desactiva y no lo borra | Si un acceso retirado se borra y cuándo |
| Registro de actividad (`registro`) | Saber quién hizo qué (publicar, volver atrás, validar, eliminar…) | identificador de la persona y detalle | Sin plazo | Plazo del registro (propuesta de 12 meses **no aprobada**). Mezcla actividad técnica con aprobaciones relevantes: si se fija un plazo, las aprobaciones deberían quedar fuera |
| Validaciones, aprobaciones y versiones (`validaciones`, `aprobaciones`, `versiones_promocion`) | **Prueba** de qué aprobó la promotora y qué se publicó | nombre de quien aprueba | Hasta que se elimina la promoción (entonces van en la exportación para la promotora) | Si MUNE debe guardar su propia copia de las aprobaciones tras eliminar una promoción (hoy no la guarda) |
| Autorizaciones de portfolio (`portfolio_autorizaciones`) | **Prueba** de lo que la promotora autoriza enseñar | nombre de quien autoriza, documento | Mientras exista; si se retira, queda la fecha de retirada | Ninguna por ahora |
| Peticiones de eliminar sin exportación (`eliminaciones_sin_exportacion`) | **Prueba** de que la promotora lo pidió | quién lo pidió y cómo | Sin plazo | Plazo (relacionado con el contrato) |
| Eliminaciones (`eliminaciones`) | Que una copia antigua no reabra nada | ninguno (solo huellas) | Sin plazo, a propósito | Ninguna |
| Avisos enviados (`avisos_enviados`) | No repetir avisos por email | a quién y de qué | Sin plazo | Plazo (es técnico) |
| Exportaciones (`exportaciones` y almacén `exportaciones`) | El enlace de descarga de la promotora | número de destinatarios (no sus emails) | Archivos: hasta que caducan (30 días por defecto) o se revocan. La fila queda como constancia | Ninguna |
| Documentación, entregables, fotos de referencia, versiones, entorno, portfolio | El servicio | lo que contengan los documentos | Hasta que se elimina la promoción (el portfolio, mientras dure la autorización) | Ninguna |
| Registros internos de Supabase (API, entrada) | Fallos | dirección IP, email al entrar | **Depende del proveedor y del plan** (en el gratuito, muy pocos días) | No se puede configurar en el plan gratuito |

## 2. GitHub (`MUNE-Projects/studio` y `MUNE-Projects/copias`, privados)

| Qué | Para qué | Datos personales | Cuánto se guarda hoy | Decisión pendiente |
|---|---|---|---|---|
| Copias de seguridad (releases en borrador de `copias`) | Recuperar tras una pérdida | todo, cifrado | **31 días** (receta 18) | Ninguna |
| Lista de eliminaciones (release «eliminaciones») | Que una copia no reabra lo eliminado | ninguno (solo huellas) | Sin plazo, a propósito | Ninguna |
| Historial de procesos (Actions): título y datos de entrada | Ver qué se lanzó | Hasta el 8/11/2026, en `aviso-promotora` y `publicar` los emails de destino iban como datos de entrada (siguen en la ficha de esas ejecuciones antiguas, solo para quien tiene acceso al almacén); desde la decisión 71, ninguno | **Depende de GitHub**: los registros de cada paso se borran a los 90 días por defecto (en un almacén privado se puede configurar de 1 a 400 días en *Settings → Actions → General*); la ficha de la ejecución puede quedarse más | Plazo de los registros de Actions. Desde la decisión 71 (`046_correos.sql`), los avisos ya no pasan correos ni textos a GitHub: solo el número del email del buzón de Supabase, que se borra al enviarlo |
| Avisos de GitHub (issues «lista para revisar», «⚠️ …») | Avisar por email | ninguno o el nombre de la promoción | Sin plazo (se cierran, no se borran) | Si se borran los cerrados |

**Reducido en esta propuesta:** el título de «Publicar desde el Panel» ya no lleva el nombre de quien aprueba (queda en Supabase), el de «aviso a MUNE» no lleva el asunto, y el email de la exportación (`aviso-exportacion.yml`) solo recibe el identificador de la exportación: ni los correos ni el enlace pasan por GitHub.

## 3. Cloudflare (Workers `experience`, `revision-experience`, `studio`, `portal`)

| Qué | Para qué | Datos personales | Cuánto se guarda hoy | Decisión pendiente |
|---|---|---|---|---|
| La web publicada y la vista previa | El servicio | lo que se publica (sin datos privados) | Hasta que se retira la promoción | Ninguna |
| Versiones antiguas de cada Worker | Historial de Cloudflare | lo que se publicó en su día | **Depende de Cloudflare** (guarda un historial de versiones). Tenían dirección pública propia; con esta propuesta dejan de tenerla (`preview_urls: false`) | Si hace falta pedir a Cloudflare que las borre (solo se borran todas, borrando el Worker) |
| Registros de visitas | Fallos | dirección IP | **Depende de Cloudflare**; en el plan gratuito no se guardan si no se activan | Ninguna |

## 4. Gmail de MUNE (`hello.muneprojects@gmail.com`)

| Qué | Para qué | Datos personales | Cuánto se guarda hoy | Decisión pendiente |
|---|---|---|---|---|
| Avisos enviados (carpeta *Enviados*) | Constancia de lo que se avisó | emails y nombres de las promotoras | **Sin plazo** (Gmail no borra solo) | Plazo para avisos automáticos (propuesta de 90 días **no aprobada**). Separar antes los que sean incidencias o reclamaciones |
| Avisos recibidos de GitHub y de MUNE | Avisar a la administradora | nombres de promociones | Sin plazo | Igual que arriba |
| Respuestas de las promotoras | Incidencias, reclamaciones, peticiones | lo que escriban | Sin plazo | Deben conservarse mientras puedan hacer falta (relacionado con el contrato) |

**Duplicado:** cada aviso queda a la vez en *Enviados* de Gmail, en `avisos_enviados` de Supabase y en el historial de GitHub Actions. El que tiene valor es el de Supabase (sin el texto); los otros dos son técnicos.

## 5. Claude (Anthropic)

Lo que Claude recibe se describe en el informe «Qué información llega a Claude». Cuánto lo guarda Anthropic **depende de sus condiciones y de la configuración de la cuenta**, y **no está resuelto**: es una de las preguntas abiertas sobre el contrato.

## 6. El ordenador de la administradora

Lo que descargue (exportaciones internas «Exportar todo (ZIP)», planos, PDF). Con esta propuesta, la exportación para la promotora **ya no pasa por su ordenador**. Decisión pendiente: si las descargas internas se borran después de usarlas.

## Qué alcance tiene cada eliminación

| Se elimina | Desaparece al momento | Copias que quedan y cuándo caducan |
|---|---|---|
| Una **promoción** (o una **promotora**, con todas sus promociones) | En Supabase, sus datos y archivos; se retira de la web pública y de la vista previa | En las copias de seguridad, hasta **31 días**. La exportación de la promotora, hasta que caduca (30 días por defecto) o se revoca. El portfolio, solo lo autorizado y hasta que se retire la autorización. Lo ya enviado por email o descargado, y el historial de GitHub y de Cloudflare: según cada proveedor (arriba) |
| Un **acceso** (retirarlo) | La persona deja de entrar; su fila sigue, desactivada | Su cuenta sigue (sin acceso) hasta que se borre a mano |
| Un **código de comprador** (revocarlo) | Deja de funcionar | En las copias, hasta 31 días (y nunca vuelve a funcionar al recuperar una copia) |

No hay un «borrado universal en 31 días»: los 31 días son solo los de las copias de seguridad.
