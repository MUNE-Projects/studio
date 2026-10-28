# Arquitectura de MUNE · decisiones aprobadas

Aprobada por la administradora el 10/10/2026 (decisión 40 de `docs/arquitectura.md`). Prevalece sobre cualquier documento anterior en lo que trata. Cierra la definición funcional de este bloque.

Se implementa **por pasos**. Cada paso:

- es una propuesta independiente, con pruebas y vista previa;
- se describe a la administradora con qué ha cambiado y qué probar a mano;
- **espera su aprobación (merge)**.

Si al implementar aparece una contradicción real con estas decisiones, se para y se consulta. Nunca se cambia un flujo en silencio.

---

## 1. Capas y nombres

| Capa | Qué es |
|---|---|
| **MUNE Projects** | La empresa |
| **MUNE** | La plataforma y la marca comercial |
| **MUNE Studio** | Todo el entorno interno donde MUNE se construye, produce, administra y opera: el repositorio, Claude y sus herramientas, el Editor 3D, la construcción, la publicación, las automatizaciones, la base de datos y la **aplicación de MUNE Studio** (la interfaz operativa) |
| **MUNE Portal** | El espacio de trabajo de cada empresa cliente |
| **MUNE Experience** | La experiencia 3D común. La usan los visitantes, los compradores y el equipo de la promotora, cada uno en su contexto |

**«Panel», «taller» y «escaparate» no se usan** como nombres de arquitectura. Solo los conservan los registros históricos que no se pueden cambiar:

- el registro de versiones;
- el registro de actividad;
- las etiquetas de Git;
- los emails y avisos ya enviados.

### Estructura técnica (paso 1)

**GitHub**

- `MUNE-Projects/studio` (antes `taller`): todo lo interno, el Portal y el motor de la Experience.
- `MUNE-Projects/experience` (antes `escaparate`): solo lo publicado. La rama `main` es producción y la rama `revision` es la vista previa.

**Carpetas de `studio`**

- `app/`: la aplicación de MUNE Studio.
- `portal/`
- `experience/`
- `editor/`: el Editor 3D.
- `supabase/`
- `herramientas/`
- `promociones/`
- `biblioteca/`
- `docs/`

**Cloudflare**

| Worker | Antes | Qué sirve |
|---|---|---|
| `studio` | `panel` | La aplicación de MUNE Studio |
| `portal` | Sin cambio | MUNE Portal |
| `experience` | `escaparate` | MUNE Experience |

Cada uno tiene su vista previa en `revision-…`. Los Workers antiguos se mantienen una semana y después se borran, sin redirecciones.

**Supabase**

- El nombre visible pasa de `mune-inmobiliarias` a `mune`. No cambia ni la dirección ni el funcionamiento.

**Código del móvil (2FA)**

El nombre que aparece en la app del móvil pasa de «MUNE Panel» a «MUNE Studio» con una migración segura:

1. Se añade la entrada nueva.
2. Se comprueba con un código.
3. Solo entonces se retira la entrada antigua.

**Llaves**

- La llave A no se renueva.
- La llave B se sustituye por `EXPERIENCE_TOKEN`, con *Contents: read/write* solo sobre `experience`.

---

## 2. MUNE Experience dentro de MUNE Portal

Cada promoción del Portal tiene la sección **Experiencia 3D**: la **misma** Experience que verá el público, integrada en la página. No hay un segundo visor.

**Qué incluye:**

- navegación 3D;
- tipologías, variantes y viviendas;
- vistas guiadas, estancias y exteriores;
- modo Plano;
- versión publicada y versión en revisión;
- pantalla completa;
- «Abrir en una pestaña nueva», si técnicamente hace falta.

**Cómo se entra:**

- sin segunda identificación;
- sin código profesional.

**Las herramientas profesionales** dependen de las capacidades de la persona.

### Acceso profesional desde MUNE Portal

- El Portal pasa el contexto profesional a la Experience integrada, mediante un mensaje entre las dos páginas.
- La Experience solo se deja integrar en MUNE Portal y en MUNE Studio, y solo acepta mensajes de esas direcciones.
- La autorización dura **mientras la Experience esté abierta dentro de una sesión válida del Portal**.

**No existe:**

- límite de renders;
- límite de accesos;
- límite de tiempo de trabajo;
- código adicional;
- credencial visible.

Si la persona vuelve otro día, todo se activa solo.

**Registro:** quién abre la Experience profesional, quién descarga cada Render HD y cuándo.

### Desaparece de la Experience pública

- el botón «Acceso profesional», su ventana y la etiqueta de perfil;
- los enlaces `#promotora-…` y `#studio-…`;
- las huellas de código.

### Previsualización profesional de la personalización

Desde el Portal, una persona autorizada puede comprobar:

- materiales y acabados;
- alternativas de distribución;
- opciones;
- precios, si tiene `personalizacion`.

Es **una simulación**. Nunca:

- crea ni cambia una selección real de comprador;
- genera histórico;
- formaliza nada;
- cierra una fase;
- toca datos reales de comprador.

---

## 3. Personas, administración y capacidades

**Un administrador cliente nunca ve ni gestiona otras promotoras.** Solo MUNE Studio tiene acceso entre empresas, como soporte, y queda registrado.

Hay **una sola cuenta por persona**, con un **alcance de administración**. No se duplican perfiles.

### Administrador de la promotora

Su alcance es **toda su empresa** (es «global» dentro de ella, nunca de MUNE). Tiene automáticamente:

- todas las promociones, actuales y futuras;
- todas las capacidades de trabajo;
- el equipo: invitar, retirar, dar accesos y capacidades;
- la configuración de aprobadores;
- los datos generales de la promotora;
- la posibilidad de nombrar a otros administradores de la promotora y a administradores de promoción.

### Administrador de promoción

Su alcance son **una o varias promociones concretas** de su empresa. Las elige el administrador de la promotora.

Dentro de su alcance tiene automáticamente todas las capacidades de trabajo, y además:

- gestiona personas;
- asigna capacidades;
- define aprobadores;
- gestiona los datos de esas promociones.

No puede:

- acceder fuera de su alcance;
- cambiar los datos generales de la promotora;
- nombrar administradores de la promotora;
- ver otra empresa.

Ejemplo:

- **Laura:** administradora de la promotora (A, B, C y las futuras).
- **Carlos:** administrador de promoción (A).
- **Ana:** administradora de promoción (B y C).

### Personas sin administración

Solo tienen las capacidades que les asigna un administrador, en cada promoción. Pueden tener una, varias o todas. El campo *cargo* es solo informativo. **No hay roles de departamento.**

### Capacidades de trabajo

| Capacidad | Permite |
|---|---|
| `documentacion` | Ver los requisitos, subir documentos y descargarlos |
| `planos` | Ver los planos comerciales. Validarlos si la persona está entre sus aprobadores |
| `compradores` | Ver las viviendas necesarias para gestionar códigos. Generar y cambiar códigos (mismo comprador o comprador nuevo). **No** da acceso a las selecciones |
| `personalizacion` | Ver las selecciones, el histórico, lo formalizado y los importes formalizados. Gestionar el contacto de formalización y los datos de transferencia. Exportar personalizaciones. En la Fase 2, también catálogo, opciones, precios y fases o grupos |
| `materiales` | Herramientas profesionales de la Experiencia 3D (Render HD, plano en PDF o PNG) y descarga de materiales |
| `datos` | Ficha de la promoción y sus datos fiscales |
| `marca` | Reservada para la Fase 2 |

**Reglas de la base de datos:**

- Las selecciones, su histórico y `guardar_formalizacion` dependen de `personalizacion`, **no** de `compradores`.
- Los administradores tienen todas las capacidades dentro de su alcance, sin configurarlas una a una.

### Alta de una promotora

1. MUNE Projects la da de alta en MUNE Studio, en un solo formulario:
   - los **datos de la empresa**: razón social, CIF, domicilio fiscal y persona de contacto (nombre, email o teléfono);
   - sus **administradores de la promotora**, que reciben la invitación.
2. A partir de ahí, la propia promotora gestiona su equipo desde **Equipo**, en MUNE Portal.
3. Si algún dato de la empresa cambia, el administrador de la promotora puede corregirlo desde el Portal.

MUNE Studio ve siempre a todas las personas de cada promotora, con sus accesos y capacidades.

---

## 4. Validaciones obligatorias

La promotora configura las listas de aprobadores. No las decide MUNE Projects.

- Se guardan **personas concretas**, nunca departamentos.
- Cada lista se configura dentro del alcance de cada administrador.
- Hay dos tipos de validación, cada uno con su propia lista de aprobadores (pueden ser personas distintas):

| Tipo | Unidad de validación |
|---|---|
| **Validación de planos comerciales** | Cada plano comercial |
| **Validación de Experiencia 3D** | Cada **tipología o variante 3D**. Además, «Entorno y elementos generales» **solo si existe** (entorno, zonas comunes). Nunca una validación por vista |

### Reglas comunes

- **Sin aprobadores no se valida.** Si no hay aprobadores definidos, el Portal muestra «Para poder publicar, alguien tiene que validar los planos comerciales, y todavía no hay nadie designado.» (o el equivalente de la Experiencia 3D) y no permite cerrar la validación. **No existe** la regla de «basta una persona».
- **Validado:** cuando **todos** los aprobadores requeridos han aprobado. Se muestra el avance como «{n} de {total} aprobaciones».
- **Pedir cambios:** el comentario es obligatorio.
  - En la Experiencia 3D, además, se puede indicar la vista o zona (opcional). Por ejemplo: «Tipología A · Dormitorio principal · La ventana debe llegar hasta…».
- **Trazabilidad:**
  - quién aprobó, con fecha y hora;
  - quién está pendiente;
  - quién pidió cambios y su comentario;
  - la versión;
  - la huella exacta del archivo o del contenido;
  - el histórico completo.
- **Entre versiones:** un elemento que **no cambia** (misma huella) conserva sus aprobaciones; uno que **cambia** vuelve a requerirlas.
  - En los planos se usa la huella de los datos del dibujo, que ya existe.
  - En la Experiencia 3D, una huella de todo lo que forma la tipología o variante: geometría, materiales, mobiliario, vistas y entorno.
- **Diseño reutilizable:** las tablas y funciones se guardan por *tipo de elemento*, para poder aprobar otros elementos en el futuro sin rehacerlas. **Ahora solo se usan para planos comerciales y Experiencia 3D.**

### Publicar una versión

Solo se puede publicar cuando están completamente validados:

- todos los planos comerciales;
- todas las tipologías o variantes de la Experiencia 3D;
- el bloque general, si existe.

El resumen de la versión muestra:

```
Validación de v8
Planos comerciales     4 de 4 aprobados ✓
Experiencia 3D         2 de 3 tipologías aprobadas
Pendiente: Tipología C
```

Con todo aprobado aparece «Lista para publicar».

### Emails de validación

Van **solo a quien tiene que actuar**:

- los aprobadores de planos comerciales;
- los aprobadores de la Experiencia 3D.

Cada email indica la promoción, la versión, qué hay que revisar, el enlace a MUNE Portal y, si hay varias aprobaciones, el avance («1 de 2 aprobaciones completadas.»).

### Textos de la validación

**Planos comerciales**

- Títulos: siempre «Planos comerciales» y «Validación de planos comerciales».
- Secciones: «Aprobar» y «Pedir cambios».
- Confirmación: «¿Aprobar el plano «{título}»? Una vez aprobado quedará validado para esta versión. Si más adelante detectas algo que corregir, el equipo de MUNE preparará una versión nueva.»
- Con varios aprobadores, el texto deja claro:
  - si es tu aprobación y faltan otras;
  - cuándo el plano queda completamente validado.

**Experiencia 3D**

- Títulos: «Validación de Experiencia 3D», «Experiencia 3D · {tipología}» y «Experiencia 3D · Entorno y elementos generales».
- Estados: *Pendiente de validar*, *Parcialmente aprobada*, *Aprobada* y *Cambios pedidos*.
- Botones: «Aprobar Experiencia 3D» y «Pedir cambios».

---

## 4 bis. Textos legales de la promotora

La promotora escribe sus propios textos legales en MUNE Portal (*Ficha y datos*, con la capacidad `datos` o como administrador):

| Texto | Dónde aparece |
|---|---|
| Planos comerciales | Al pie de cada plano comercial (PDF y PNG) |
| Imágenes y renders | En cada Render HD |
| Experiencia 3D | En pequeño, siempre visible mientras se navega por MUNE Experience |
| Personalización | En el configurador del comprador y en el documento de selección (PDF) |

- Hoy esos textos vienen fijos en los datos de cada promoción, que prepara MUNE. Pasan a guardarse en Supabase, por promoción.
- Entran en la siguiente versión que se prepare, como cualquier otro cambio: se revisan en la vista previa y se publican con la versión.
- Se implementan en el **paso 2**. Su uso en la Experience, los planos y los renders llega con la siguiente versión preparada.

## 5. Selecciones de personalización y su exportación (11/10/2026)

Nadie registra nada a mano: ni la promotora ni el comprador hacen ningún paso más.

- **Al descargar el PDF** de su selección, la experiencia guarda sola en MUNE la selección del comprador (opciones, importe y fecha) para su vivienda y ese pack. Si descarga varias veces, cuenta la última.
- **Mientras el pack está abierto**, la selección está **«Seleccionada»**. **Al terminar el periodo del pack**, la última selección descargada pasa sola a **«Cerrada»**, queda bloqueada para el comprador y es su histórico al volver con el código. Si no descargó nada, se queda con lo incluido de serie.
- **Cada pack por separado**: lo cerrado de un pack no cambia cuando se abre el siguiente.
- **Los importes los calcula MUNE** con el catálogo guardado en Supabase, nunca el navegador del comprador. Por eso se construye junto con los datos privados (bloque C, paso 5).

**Exportar personalizaciones** (MUNE Portal, *Personalización*; administradores dentro de su alcance y quien tenga `personalizacion`): Excel con

1. **Resumen**: una fila por vivienda con tipología, número de packs con selección cerrada, fecha de la última, **importe de la selección cerrada** de la vivienda y, al final, el importe total de la promoción (y un resumen por pack).
2. **Detalle**: una fila por opción (vivienda, tipología, pack, estado *Seleccionada* o *Cerrada*, fecha, categoría, opción, detalle, importe; las incluidas con 0 €).

Nunca «formalizado», «cobrado», «ingresado» ni «pagado»: MUNE no comprueba la firma ni el pago. Sin datos personales (ni nombre, DNI/NIE, email, teléfono, justificantes ni IBAN) ni costes internos.

**Fechas de los packs desde MUNE Portal**: se hará en la **Fase 2**, junto con la gestión del catálogo, las opciones, los precios y los packs desde el Portal, para que esté todo junto (decisión del 11/10/2026). Hasta entonces, las fechas las prepara MUNE con cada versión.

## 6. Datos privados (bloque C)

La Experience pública lleva **solo lo necesario para la visita pública** y sigue siendo estática. Salen de los archivos públicos:

- los precios de las mejoras;
- las opciones no incluidas;
- las alternativas de distribución;
- los packs y sus fechas;
- las restricciones por vivienda;
- la lista de viviendas;
- los planos y variantes privados;
- las notas internas y la procedencia de los datos;
- las versiones antiguas;
- los muebles no usados;
- cualquier dato reservado al comprador o al equipo.

**Quién recibe qué:**

- El **comprador** recibe solo lo de su vivienda, después de validar su código.
- El **equipo de la promotora** lo recibe con su sesión de MUNE Portal y según sus permisos.

**Cómo llega a Supabase:**

1. `preparar` guarda el contenido privado de la versión en el repositorio `studio`.
2. La función `ejecutar` lo carga en Supabase. Solo puede hacerlo la administradora.
3. La llave A gana *Contents: read* sobre `studio`.

---

## 7. Packs

**No se cambia la arquitectura actual.** Se mantienen:

- los estados disponible, próximamente y finalizado;
- el histórico;
- lo formalizado y su bloqueo.

La evolución hacia fases o grupos configurables se revisará aparte. Hasta entonces, el término «pack» se mantiene.

---

## 8. Requisitos previos al primer cliente real

- **Remitente de los emails:** `hello.muneprojects@gmail.com` debe sustituirse por una dirección con dominio propio de MUNE. Es una decisión con coste, que se consultará antes.
- Las demás decisiones del primer cliente siguen en `docs/arquitectura.md`. Por ejemplo, Supabase Pro.
- **Partes activables por promoción (pedido el 11/10/2026, pendiente de propuesta):** al dar de alta una promoción, la administradora pregunta antes a la promotora (fase del proyecto, si tiene personalizaciones por vivienda…). En MUNE Studio podrá activar o desactivar partes de cada promoción (por ejemplo Personalización o Compradores); lo desactivado no aparece en MUNE Portal ni en la experiencia pública. La fase del proyecto la puede indicar ella al dar de alta o la promotora, y cambiarse después (ya hecho).

---

## 8 bis. Documentación de la promoción

- **Fase del proyecto:** la promotora indica arriba de *Documentación* si el proyecto está en *anteproyecto*, *proyecto básico* o *proyecto de ejecución*, y la cambia ahí cuando avanza («Cambiar de fase», con historial). No es un documento que entregar. Sin fase indicada no se puede subir nada, y cada documento subido queda marcado con la fase de ese momento (`018_fase_proyecto.sql`, `019_cambio_fase.sql`). MUNE Studio ve la fase en la cabecera de cada promoción y en su Documentación.
- **Memoria de calidades técnica:** es el nombre del documento. En el Portal aparece con su explicación: no es la memoria comercial, sino la documentación técnica de lo que hay que reproducir.

## 9. Documentación técnica con varios archivos (aprobado: paso 2)

**Hoy:** cada requisito de la lista de documentos guarda **una cadena de versiones**. Cada archivo nuevo **sustituye** al anterior, que se conserva en el historial. Por eso la «Documentación técnica de materiales, acabados y equipamiento» solo puede tener un archivo vigente.

**Propuesta, la más sencilla:** algunos requisitos admiten **varios archivos**.

- **Base de datos:** en `requisitos`, una casilla `varios_archivos`. En `documentos`, una referencia `sustituye_a` (el archivo al que reemplaza). El historial de versiones pasa a ser por archivo, y no por requisito.
- **MUNE Portal**, en esos requisitos:
  - el botón «Añadir archivo» está siempre disponible;
  - cada archivo tiene su «Sustituir» y su propio estado (en revisión, aceptado o rechazado).
- **Los demás requisitos** funcionan exactamente igual que hoy.
- **Se activa** en la documentación técnica y en «Proyecto básico o de ejecución», donde la información suele venir repartida en varios archivos: memoria técnica, cuadros de carpinterías y acabados, detalles y fichas técnicas.
- **Herramientas:** la herramienta de revisión (`documentos.mjs`) y MUNE Studio muestran cada archivo por separado. La revisión es por archivo, como ahora.

- **Nombrar cada archivo:** al añadir un archivo, la persona indica qué contiene. Lo elige de una lista propia de ese documento (por ejemplo, para la memoria de calidades técnica: *Memoria técnica*, *Cuadro de carpinterías*, *Cuadro de acabados*, *Detalles constructivos*, *Fichas técnicas de fabricantes*, *Otro*) y, si quiere, lo detalla («Ventanas fachada sur»). Así cada archivo llega identificado para preparar el proyecto y el 3D, sin depender del nombre del archivo.

Se implementa dentro del **paso 2**.

---

## 10. Lista maestra y orden (aprobada el 12/10/2026)

Sustituye al orden de pasos 0–5 anterior (los pasos 0, 2 y 3 de equipos y validaciones ya están hechos).

### A. Principios permanentes

- **Flexibilidad por configuración**, reglas o módulos reutilizables; nunca un MUNE distinto por cliente (validaciones, aprobadores, permisos, forma de personalizar, periodos, terminología, flujos visuales).
- **Clasificar cada necesidad nueva:** CORE · CONFIGURACIÓN · MÓDULO · INTEGRACIÓN · FUERA DE ALCANCE.
- **Fuera de alcance:** CRM, ERP, leads, pipeline, stock, reservas, facturación, contabilidad, financiación, pedidos y CPQ. Con ellos, solo exportación, importación o integración.
- **Claude forma parte del flujo:** lee directamente la documentación del cliente; nadie de MUNE la transcribe.
- **Sin plantillas MUNE obligatorias.** La lista de documentos es de información, no de archivos: un archivo puede cubrir varios requisitos y un requisito puede ir en varios archivos.
- **Las fases del proyecto son fases, no documentos** (anteproyecto, proyecto básico, proyecto de ejecución).
- **MUNE Experience no es la web comercial de la promotora:** precios de venta, disponibilidad, formularios y CRM siguen en su web; MUNE es la capa visual.
- **La Experience pública siempre invita a personalizar** (22/10/2026): con la Experience pública y el Acceso comprador activos, la web pública (también insertada en la web de la promotora) lleva siempre una llamada visible a «Personaliza tu vivienda» para el comprador, porque es un reclamo comercial; al pulsarla se pasa a la parte privada con el código. La web pública nunca lleva opciones, packs ni precios.
- **Un motor, tres contextos:** público (si Experience pública está activa), comprador (si Acceso comprador está activo) y profesional (siempre, en MUNE Portal).
- **Alcance cerrado:** promoción; tipología ↔ promoción; vivienda del comprador ↔ promoción. Nunca catálogo ni selector de tipologías.
- **Personalización con dos estados:** Seleccionada (el comprador descarga el PDF) y Cerrada (termina el periodo; queda bloqueada como histórico). Cada fase o grupo por separado. Sin «formalizada» ni validación manual del comercial.

### B. Núcleo, en este orden

1. ✔ **Comprobar** el flujo real (v9 y v10 de Residencial Demo, 12/10/2026).
2. ✔ **Documentación, onboarding y módulos de cada promoción** (022): lista de información; un archivo cubre varios requisitos; relación de viviendas sin plantilla; alta guiada en Studio; módulos **Experience pública**, **Acceso comprador** y **Personalización** (independientes y combinables; «Compradores» sigue siendo solo una capacidad); modo de publicación (**Publicar al aprobar la promotora**, por defecto, o **Publico yo**); avisos a MUNE por el Gmail de MUNE.
3. ✔ **Nombres definitivos** (studio, experience, Workers, carpetas, 2FA, Supabase; 20/10/2026), preparados para pasar al dominio propio sin rehacer nada. Antes de entregar ninguna dirección pública ni código de inserción.
4. ✔ **Copias de seguridad y simulacro**, antes de mover datos: cada noche, datos, usuarios y archivos cifrados en el almacén privado `copias`; cada tres meses, simulacro automático de recuperación (decisión 42, receta 18, `023_copias.sql`). ✔ 22/10/2026.
5. **Datos privados, personalización y Excel:** catálogo, precios, packs y viviendas servidos de forma privada; selecciones Seleccionada → Cerrada; Excel con las selecciones cerradas y sus importes; estructura preparada para fases y grupos; **puerta general del comprador** («Accede a tu vivienda»: el código, único en todo MUNE y con límite de intentos global, identifica promotora, promoción y vivienda). Decidido (22/10/2026): la selección hecha por el comercial desde el Portal también queda como Seleccionada (lo habitual será que la haga el comprador). En tres propuestas: **5a** ✔ datos privados fuera de la web pública (decisión 43, `024_datos_privados.sql`); **5b** ✔ Seleccionada → Cerrada, pestaña Personalización y Excel (decisión 44, `025_selecciones.sql`); **5c** ✔ puerta general del comprador en `experience…/acceso/` (decisión 45, `026_puerta_comprador.sql`). **MUNE nunca elige ni cambia una selección**: la hace el comprador y, si lo necesita (por ejemplo, una persona mayor), el equipo de la promotora desde el Portal; MUNE Studio solo la consulta.
6. **MUNE Experience con sus tres contextos:** visor con alcance («Ver promoción» / «Volver a…»); Portal → Experiencia 3D con promoción general y cada tipología (estado, validación, cambios, Render HD, imágenes, modo profesional, vista previa de la personalización; **renders de una vivienda con su personalización: solo la promotora, desde el Portal**, decidido el 22/10/2026; **el comercial elige o cambia la personalización en nombre del comprador viendo la vivienda en 3D y descarga el mismo documento PDF que el comprador, para dárselo**, decidido el 22/10/2026); con Experience pública activa, «Copiar URL pública» y «Copiar código de inserción» (en cualquier web, sin lista de dominios); apagada, la Experience sigue existiendo y solo dejan de funcionar las direcciones públicas; botón «Solicitar información» con una URL de la promotora; fin del acceso profesional público. En dos propuestas: **6a** 3D profesional desde el Portal con un pase personal, elegir en nombre del comprador con «Gestionar personalizaciones» y fin del acceso profesional público (decisión 46, `027_profesional.sql`) ✔; **6b** URL pública, código de inserción, «Solicitar información», Experience pública apagada, un enlace por tipología y sin pasar a otras tipologías desde la web pública (decisión 47, `028_experiencia_publica.sql`) ✔.
7. ✔ **Comprobar** con una promoción ficticia y documentación sintética (varias versiones, una contradicción a propósito, los tres contextos y varias combinaciones de módulos). Hecho en una copia local el 25/10/2026 (decisión 48).
7b. **Interpretar cada promoción** (decisión 48): huecos de todo tipo; alturas, techos y dúplex; exteriores; acabados desde la memoria de calidades y equipamiento; receta 1 «Interpretar la documentación» (`docs/recetas/01-interpretar-documentacion.md`, con la orden `publicacion.mjs comprobar`). Antes del primer cliente.

### C. Más adelante

**Actualizado el 26/10/2026 (decisión 49):** todo este apartado pasa a ser **antes del primer cliente**, salvo la analítica de uso (punto 12), que queda para después. Además, antes del primer cliente: un 3D mucho más realista y renders con calidad de fotografía bajo demanda y sin límite. Descartado: dron, realidad virtual, firma electrónica y pago con tarjeta.

8. Personalización configurable y Fase 2 (fases o grupos, opciones, restricciones, aplicabilidad, apertura y cierre; la promotora gestiona catálogo, precios, fechas y marca). En tres propuestas: 8a catálogo, precios, packs y fechas (`029_catalogo_promotora.sql`, decisión 52); 8b restricciones por tipología (no por vivienda ni entre opciones; `030_tipologias_en_preparacion.sql`, decisión 53); 8c marca.
9. Comparación entre versiones, impacto de cambios y vigencia (Vigente / Requiere actualizar / Pendiente de validar).
10. Comentarios visuales en planos y Experience, unidos a su versión (no dependen del 9).
11. Generación de materiales por lotes (depende del 6).
12. Analítica del uso de MUNE, agregada y por contexto (importes de selecciones cerradas, opciones más elegidas, tipologías y vistas más vistas…).
13. Entorno real (ubicación, orientación, parcela, vistas), sin soleamiento.
14. «Solicitar información» más específico, solo si hace falta.

### D. I+D

15. Comprobar BIM / IFC / DWG (qué procesa Claude, qué aporta frente al PDF). Mientras, no se promete ni se pide.
16. Trazabilidad de fuentes y detección automática de cambios.

### E. Antes del primer cliente

1. Decidir y comprar el dominio principal de MUNE (solo ese; tiene coste: consultar antes), antes de repartir ninguna URL real. Después, los subdominios de producción.
2. Remitente de email con ese dominio (coste: consultar antes). Al hacerlo, **recordar a la administradora** que cambie también a dónde le llegan los avisos de MUNE: el secreto `AVISOS_MUNE_PARA` de GitHub (hoy no existe y llegan a hello.muneprojects@gmail.com). Ella creará una dirección propia para las promotoras.
3. Valorar Supabase de pago (coste: consultar antes).
4. Decidir si las peticiones se revisan solas.
5. Bloque B terminado y probado.

Fecha fija: las llaves del sistema caducan el 7/10/2027.

## 11. Módulos de la promoción y publicación al aprobar la promotora (paso 2, 022)

- `promociones.modulos` (`experiencia_publica`, `acceso_comprador`, `personalizacion`) y `promociones.publicacion` (`automatica` | `manual`). Solo MUNE Studio los cambia (`guardar_modulos`), en el alta o en *Resumen y versiones*.
- **Acceso comprador apagado:** no se crean códigos (disparador `codigo_con_acceso`) y `entrar_comprador` no deja entrar; el Portal oculta *Compradores*.
- **Personalización apagada:** el Portal oculta *Personalización*. La web pública deja de ofrecerla cuando sus datos sean privados (paso 5).
- **Experience pública:** se guarda ya; actúa en el paso 6, cuando el Portal tenga su propia Experience privada.
- **Publicación al aprobar la promotora:** el visto bueno de MUNE es *Enviar a validar a la promotora*. Cuando la promotora valida todo lo enviado de la versión en revisión, la función `aviso-subida` arranca el ejecutor con esa misma versión; al terminar, email «publicada» al equipo de la promotora y a MUNE. *Volver a una anterior* sigue en MUNE Studio. Con «Publico yo», como antes.
- **Avisos a MUNE** (documentación nueva y cada validación): `aviso-mune.yml`, desde el Gmail de MUNE, un email por aviso, a la dirección del secreto `AVISOS_MUNE_PARA`.
- **Documentos:** `documento_cubre` (qué otros requisitos cubre un archivo; la versión nueva cubre lo mismo) y `cubrir_requisitos`. La relación de viviendas pasa a «Relación de viviendas, tipologías y superficies», en el formato del cliente.
