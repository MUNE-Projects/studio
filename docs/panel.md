# MUNE Studio (Panel de administración): mapa completo

El Panel es la parte web de **MUNE Studio**, el entorno interno de MUNE (decisión 39): el cuadro de mandos de la administradora. Las promotoras tienen su propio portal (Fase 1) para subir documentación, validar planos y ver sus versiones. En el Panel se ve todo, se decide todo y se lanza el trabajo.

Cada botón dispara una de dos cosas:

- **Una acción automática**, sin Claude: publicar, volver atrás, cambiar mobiliario del catálogo, regenerar planos…
- **Una petición a Claude**, para lo que requiere criterio: interpretar documentación, interiorismo libre, resolver incoherencias…

Este documento es la referencia: todo lo que se construya en el Panel sigue este mapa.

## Navegación (desde la Etapa 2)

Menú fijo arriba: **Inicio · Promotoras · Sistema · Salir**, y arriba de cada página «dónde estás» (*Promotoras › Promotora › Promoción*).

- `#/` **Inicio**: avisos del sistema; versiones pendientes con el estado de sus planos (lista para publicar, cambios pedidos, enviar planos, esperando a la promotora); documentación por revisar y peticiones abiertas, cada una con enlace a su sitio.
- `#/promotoras` **Promotoras**: la lista y el alta.
- `#/promotora/<id>` **Una promotora**: sus promociones, quién tiene acceso a todas, sus datos y su actividad (la suya y la de todas sus promociones).
- `#/promocion/<id>/<pestaña>` **Una promoción**, con pestañas: *Resumen y versiones* (publicar, volver atrás, estado), *Equipo*, *Documentación*, *Ficha y datos*, *Compradores* (códigos de comprador, receta 24), *Peticiones de cambios* y *Actividad*.
- `#/sistema` **Sistema**: llaves con su caducidad (*Ya la he renovado*), espacio usado del plan gratuito, última señal de la vigilancia automática y el registro de actividad completo (auditoría). Y las copias de seguridad: la última copia de la noche y el último simulacro de recuperación (receta 18).

## Secciones

### 1. Inicio: «qué necesita tu atención»

Bandeja con lo pendiente de todas las promociones:

- versiones esperando revisión;
- documentación nueva subida por promotoras;
- versiones pendientes con el estado de su validación (planos comerciales y Experiencia 3D): *Enviar a validar*, *Sin aprobadores definidos*, *Esperando aprobaciones: 1 de 2*, *Cambios pedidos* o *Lista para publicar*;
- peticiones a Claude terminadas;
- avisos del sistema (Etapa 6, receta 19): llaves a punto de caducar, espacio casi lleno, vigilancia automática parada, invitaciones sin aceptar y accesos sin uso. Y las copias: falta la de una noche, falla el simulacro o toca uno (receta 18).

### 2. Promotoras

- Lista, datos y contacto. **Alta de promotora** en un solo formulario (decisión 40): nombre, razón social, CIF, domicilio fiscal, persona de contacto y uno o varios *Administradores de la promotora* (nombre y correo), que reciben la invitación; al terminar se ve el resultado de cada persona.
- Personas con acceso (`020_equipos_y_validaciones.sql`): a todas las promociones o a una, con insignia *Administrador de la promotora* / *Administrador de promoción* o con sus capacidades (Documentación, Planos comerciales, Compradores, Personalización, Materiales, Datos de la promoción). La promotora gestiona su propio equipo en MUNE Portal (Equipo); MUNE Studio lo ve todo y, como soporte, puede dar acceso (función `invitar`), *Cambiar acceso* (capacidades, administración, cargo), quitar y devolver (`cambiar_acceso`) (receta 14).
- Datos fiscales de la promotora y de cada promoción (los suele rellenar la promotora en su portal).
- *Exportar todo (ZIP)* con todas sus promociones. Activar o desactivar; si está desactivada, *Borrar definitivamente* con todas sus promociones (antes descarga la exportación y escribe su nombre).

### 3. Ficha de cada promoción

| Pestaña | Contenido y acciones |
|---|---|
| **Resumen** | Estado, versión publicada, versión pendiente, enlaces a la visita y a la vista previa. Bloque *Validación de vN*: planos comerciales («x de y aprobados ✓») y Experiencia 3D («x de y tipologías aprobadas»), lo pendiente, quién valida cada parte (con *Editar* como soporte) y el detalle de cada elemento por persona. *Enviar a validar a la promotora* envía los planos (`planos/planos.json`) y la Experiencia 3D (`experiencia/experiencia.json`) de la vista previa; *Publicar* solo se activa con las dos partes validadas (las versiones sin uno de esos archivos no necesitan esa parte). *Exportar todo (ZIP)*. Desactivar o activar; si está desactivada, *Borrar definitivamente* (antes descarga la exportación y escribe su nombre) |
| **Documentación** | Lista de lo que tiene que entregar la promotora, con lo recibido, versiones y estado (por revisar, vigente, rechazado con nota). En los documentos de varios archivos, cada archivo con lo que contiene y su historial, y se revisa archivo a archivo. Descargar, marcar como vigente o rechazar. Ajustar la lista (también documentos que admiten varios archivos, con sus opciones de «¿Qué contiene?»). «Revisa lo nuevo de X» → Claude (receta 2) |
| **Tipologías y viviendas** | Tipología → Variante → Unidad, superficies. Códigos de comprador: generar, regenerar y revocar (Fase 1, receta 24) |
| **Mobiliario y acabados** | Por tipología y estancia, estilos y piezas del catálogo (por ejemplo «Nórdico claro» o «Contemporáneo»; sofá A o sofá B; suelo roble o gris) con vista previa automática, sin Claude (receta 21). **«Estilo a partir de una foto»**: se adjuntan fotos de referencia y llega a Claude como petición de interiorismo |
| **Personalización** | Packs y alternativas del comprador, con fechas y precios. Pestaña *Personalización* de cada promoción (solo consulta): estado de cada vivienda por pack (Seleccionada / Cerrada), importe y Excel de las cerradas (`025_selecciones.sql`). MUNE no elige ni cambia selecciones. Debajo, *Catálogo y precios* (`029_catalogo_promotora.sql`): lo mismo que ve la promotora, para ayudarla (nombres, descripciones, precios mientras su pack no se ha abierto, qué se ofrece y en qué tipologías), y las *Opciones nuevas* que pide, para marcarlas como añadidas o descartadas. En Inicio, la tarjeta *Opciones nuevas pedidas* |
| **Versiones** | Historial (vN, fecha, quién aprobó, qué cambió), vista previa, **Publicar** y **Volver a una anterior** desde el Panel (recetas 10 y 11) |
| **Entregables** | Planos PDF/PNG, renders y PDF de muestra: descargar y regenerar (receta 7) |
| **Validación de planos** | Qué ha aprobado o rechazado la promotora, con sus comentarios |
| **Marca e información** | Logo, colores, contacto y textos legales de la promotora (receta 16) |
| **Ficha y datos** | Ficha, datos fiscales de la promoción, formalización y *Textos legales* (planos comerciales, imágenes y renders, Experiencia 3D, personalización), que se aplican en la próxima versión que se prepare |
| **Compradores** | Un código por vivienda: generar, cambiar (mismo comprador o comprador nuevo) y ver si ha entrado (receta 24). La promotora tiene la misma pestaña en su portal |
| **Peticiones a Claude** | Las peticiones de esta promoción y su estado |

### 4. Peticiones a Claude

- Cola completa con su estado: pendiente → en curso → lista para revisar (con enlace), o descartada.
- Texto y **fotos de referencia** (JPG, PNG o WebP; hasta 5 por petición, 10 MB cada una).
- Claude las atiende **cuando la administradora se lo pide**. Cuando haya clientes, se valorará una revisión automática periódica, que consume plan de Claude.

### 5. Biblioteca

Muebles, materiales y texturas disponibles, con la **licencia registrada** de cada uno. Es la fuente de las opciones de «Mobiliario y acabados».

### 6. Sistema

- Registro de actividad completo.
- Copias de seguridad y simulacro de recuperación (receta 18).
- Informe: cuotas, costes y caducidad de credenciales (receta 19).
- Robots y llaves: qué existe, con qué permisos, y botón para revocar.

## Orden de construcción

| Cuándo | Qué | Qué necesita |
|---|---|---|
| **Hecho** | Entrada con doble verificación, promociones con estado, pedir cambios con fotos de referencia, registro, **Publicar** y **Volver a una anterior** desde el Panel | Brazo ejecutor (ver abajo) |
| **Fase 1 · hecho** | Promotoras y accesos por promoción o a todas (dar, quitar, devolver, reenviar), datos fiscales, promociones de cada promotora (alta, estado visible, activar), lista de documentos que debe entregar; portal con documentación, entregables, datos fiscales y versión publicada | Función `invitar`, portal en Cloudflare |
| **Fase 1** | Inicio, Promotoras y accesos, Documentación, Validación de planos, códigos de comprador, copias de seguridad | Portal de promotoras, almacén de archivos en Supabase, copias en un almacén privado de GitHub (`copias`) |
| **Fase 2** | Mobiliario y acabados (catálogo y estilo a partir de foto), Personalización, Entregables, Marca, Biblioteca | Catálogo de estilos y recetas automáticas |
| **Fase 3** | Renders premium bajo demanda | Prueba piloto y decisión sobre costes |

## Piezas técnicas

- Código: `panel/` (TypeScript sin frameworks + `@supabase/supabase-js`). Web estática en Cloudflare Workers (`panel`), con vista previa por cada propuesta desde la rama `revision`.
- Base de datos y reglas: `supabase/00N_*.sql`, ejecutados en orden en el SQL Editor de Supabase.
- Portal (Fase 1): `supabase/005_portal.sql` crea miembros (desde `007_equipos.sql`, por promoción o a todas y sin roles), requisitos, documentos, entregables, validaciones y los almacenes privados `documentos` y `entregables`, con las reglas de aislamiento.
- Portal de promotoras: `portal/` (TypeScript sin frameworks + supabase-js), proyecto `portal` de Cloudflare Workers. Accesos desde la sección *Promotoras* del Panel con la función `invitar` (`supabase/funciones/invitar`) y `006_accesos.sql`.
- Prueba de aislamiento: `supabase/pruebas/aislamiento.mjs`, sobre un Supabase local (`bash supabase/pruebas/lanzar.sh`), y en cada propuesta con `.github/workflows/aislamiento.yml`. Si sale en rojo, la propuesta no se aprueba.
- Herramienta del robot: `herramientas/peticiones.mjs` (`listar`, `fotos <id>`, `estado <id> …`), con credenciales en las variables del entorno de Claude (`ROBOT_EMAIL`, `ROBOT_CLAVE`).

## Brazo ejecutor (Publicar y Volver)

```
Panel (botón) → función «ejecutar» de Supabase → GitHub Actions «publicar.yml» del taller → escaparate (main) → Cloudflare
```

| Pieza | Dónde | Qué comprueba o permite |
|---|---|---|
| Función `ejecutar` | `supabase/funciones/ejecutar/index.ts`, en Supabase → Edge Functions | Que quien pulsa es administradora con doble verificación (`es_admin()`); valida la orden; para publicar exige `validacion_lista` = `listos` en planos comerciales y Experiencia 3D (salvo versiones sin esa parte en la vista previa); anota en el registro |
| Llave A `GITHUB_EJECUTOR` | Secreto de Supabase (Edge Functions → Secrets) | Solo arrancar procesos del almacén `taller` (Actions: lectura y escritura). Caduca el 7/10/2027: aviso en Inicio y por email un mes antes (receta 19) |
| Proceso `publicar.yml` | `.github/workflows/publicar.yml` | Ejecuta `herramientas/publicacion.mjs aprobar` o `volver`; uno detrás de otro, nunca dos a la vez |
| Llave B `ESCAPARATE_TOKEN` | Secreto del almacén `taller` (Settings → Secrets → Actions) | Solo escribir en `escaparate` (Contents: lectura y escritura). Caduca el 7/10/2027: aviso en Inicio y por email un mes antes (receta 19) |
| `GITHUB_TOKEN` | Automática de GitHub | Guardar el registro de versiones en el taller; solo dura ese proceso |

Flujo de versiones:

1. Claude **prepara** una versión (`publicacion.mjs preparar`) en la rama `revision` del escaparate, que es la vista previa.
2. Claude lanza el proceso `avisar.yml`. GitHub abre un aviso «<promoción> vN · lista para revisar» con los enlaces a la vista previa y al Panel, y **envía el email**. Lo crea github-actions, no la propia cuenta, porque GitHub no avisa de lo que hace uno mismo.
3. La administradora revisa la vista previa y pulsa **Publicar vN** en el Panel. **Solo se publica la versión revisada:** si la vista previa ha cambiado entretanto, el ejecutor se niega.
4. El ejecutor pasa la versión a `main`, guarda el registro y cierra el aviso.

El registro `promociones/<id>/publicaciones.json` solo lo escribe el ejecutor, en `main`.

Para recibir los emails, la cuenta de la administradora debe **vigilar** el almacén `taller` (botón *Watch* → *All Activity*, o al menos *Issues*), con el email activado en las notificaciones de GitHub.
