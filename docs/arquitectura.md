# Arquitectura definitiva — revisión para aprobación

*Versión de trabajo, 5 de octubre de 2026. No se ha implementado, migrado, creado ni publicado nada. La demo actual sigue intacta.*

---

## 0. Resumen en una página

**Veredicto:** la combinación **GitHub + Cloudflare + Supabase + Claude Code** sigue siendo, a mi juicio, la arquitectura mínima adecuada. He comparado las alternativas en el apartado 1 y ninguna mejora el conjunto.

Al revisarla a fondo, propongo **siete ajustes** a mi propuesta anterior. Ninguno añade complejidad para ti; varios la reducen.

1. **Dos almacenes en GitHub en lugar de uno:**
   - el **«taller»**: código, Studio, recetas y datos de las promociones;
   - el **«escaparate»**: únicamente lo que está publicado.

   Cloudflare solo tiene acceso al escaparate, así que nunca ve el Studio ni nada interno.
2. **Cada versión publicada fija también la versión del producto maestro.** Si mejoro el motor, ninguna promoción publicada cambia sin pasar por preview y tu OK.
3. **Cloudflare con «Workers con archivos estáticos» en lugar de «Pages».** Mismo precio (gratis) y mismo funcionamiento para ti, pero Cloudflare ya no invierte en Pages: todo lo nuevo va a Workers.
4. **Un servicio de envío de emails** para los enlaces de acceso del portal. El servicio de email que trae Supabase es solo para pruebas. Puede ser el correo de tu dominio o un servicio gratuito.
5. **Un panel de administración mínimo en el portal**, con bandeja de novedades, activar o desactivar promociones y dar o quitar accesos. Así las operaciones de seguridad no dependen de Claude.
6. **Copia de seguridad de los archivos en Cloudflare R2.** Las copias de Supabase **no incluyen los archivos**, solo la base de datos.
7. **Los renders no se guardan por defecto.** Se generan, se descargan y se descartan, salvo que decidas conservarlos.

**Coste fijo estimado:**

| Situación | Coste aproximado (más tu suscripción de Claude) |
|---|---|
| Desarrollo | ~1 €/mes |
| Primer cliente hasta ~20 promociones | ~26–28 $/mes |
| 50 promociones | ~30–40 $/mes |

**Ninguna tarea técnica habitual recae en ti.** Solo hay tareas puntuales y guiadas: crear cuentas una vez, activar la verificación en dos pasos y, de forma excepcional, un dominio propio de una promotora. El detalle está en el apartado 24.

---

## 1. ¿Es la arquitectura mínima óptima?

### Alternativas que he comparado

| Opción | Qué es | Por qué sí | Por qué no |
|---|---|---|---|
| **GitHub + Cloudflare + Supabase** (propuesta) | Taller, escaparate y oficina con buzón | Cada pieza hace una sola cosa y es líder en ella. Coste fijo y bajo. Todo es estándar y se puede trasladar | Son tres proveedores, además del email |
| Firebase (Google) todo en uno | Alojamiento, usuarios, base de datos y archivos en un solo proveedor | Un único proveedor | El almacenamiento de archivos exige su plan de pago por uso, sin un tope de gasto real. Su base de datos no es estándar, lo que complica migrar. Sus reglas de seguridad son más difíciles de auditar |
| Solo Cloudflare (Workers + D1 + R2) | Todo en Cloudflare | Lo más barato. Un solo proveedor | Los usuarios, el login y los permisos habría que programarlos a mano. Más código propio significa más riesgo y más mantenimiento |
| Vercel + Supabase | Lo que planteabas | Vercel es cómodo | No aporta nada que necesitemos: el portal no requiere servidor propio. Su plan gratuito no permite uso comercial (Pro: 20 $/mes por persona). El tráfico tiene límite. Detalle en el apartado 19 |
| Servidor propio (VPS con Pocketbase o similar) | Un ordenador alquilado con todo dentro | Barato | Alguien tiene que mantenerlo: actualizaciones, seguridad, caídas. Es justo lo que quieres evitar |
| Artifacts de Claude o carpetas de Drive | Lo que descartamos | Sin desarrollo | Sin aspecto de producto. Las promotoras necesitarían cuenta de Claude. Dependencia de Claude |

### Valoración de la propuesta según tus criterios

| Criterio | Valoración |
|---|---|
| 1. Sencillez | Alta. La web pública es un conjunto de archivos, sin servidor. El portal es una página que habla con Supabase. No hay servidor nuestro que mantener |
| 2. Facilidad de uso | Tú hablas con Claude, la promotora usa una web y el comprador abre un enlace |
| 3. Capacidad | Sobrada para cientos de promociones |
| 4. Calidad | No limita la calidad visual, que depende del motor y no del alojamiento |
| 5. Operatividad | Recetas, preview, publicación y vuelta atrás en minutos |
| 6. Seguridad | Permisos comprobados en el servidor, credenciales mínimas y registro de acciones |
| 7. Costes | Fijos y bajos. No hay facturación por visitas en la web pública |
| 8. Mantenimiento | Bajo: los tres servicios están gestionados por sus proveedores |
| 9. Escalabilidad | Una nueva promoción no añade piezas ni cuentas, solo datos |
| 10. Migración futura | Alta. La web son archivos estáticos (sirven en cualquier sitio), la base de datos es Postgres estándar y los archivos son archivos normales |

**Conclusión:** no veo una alternativa claramente mejor. Mantengo la propuesta con los siete ajustes del resumen.

---

## 2. La arquitectura explicada como propietaria del negocio

### La metáfora

| Pieza | Equivale a… |
|---|---|
| **GitHub · taller** | El **archivo y taller** del negocio: los «planos de fabricación» del producto (el código), las fichas de cada promoción, las recetas y el historial completo de cada cambio |
| **GitHub · escaparate** | La **trastienda del escaparate**: solo lo que está a la venta ahora mismo, tal y como se ve |
| **Cloudflare** | El **escaparate a la calle**: sirve las webs al público desde servidores en todo el mundo |
| **Supabase** | La **oficina de recepción con buzón y archivadores bajo llave**: quién puede entrar, qué ha entregado cada promotora, en qué estado está cada promoción |
| **Claude Code** | El **equipo de producción** que trabaja en el taller siguiendo procedimientos escritos (las recetas) |
| **Cloudflare R2** | La **caja fuerte de otro edificio**, donde se guardan copias de seguridad de los archivos |

### Respuestas a tus 17 preguntas

1. **Qué es GitHub.** Un servicio que guarda carpetas de archivos con historial completo: cada cambio queda registrado con fecha y motivo, y se puede volver a cualquier punto del pasado. Lo usaremos en modo privado.
2. **Qué parte de tu producto vive en GitHub.**
   - **Taller:**
     - el producto maestro (visor 3D, plano comercial, configurador, PDFs);
     - el Studio;
     - el Portal (su diseño, no sus datos);
     - las recetas;
     - la biblioteca (materiales, mobiliario procedural, texturas libres);
     - los **datos ya trabajados** de cada promoción (geometría, materiales, marca, packs, precios);
     - el registro de versiones;
     - la estructura y las reglas de seguridad de Supabase, escritas como archivos.
   - **Escaparate:** las webs ya construidas de cada versión publicada.
3. **Qué NO debe vivir en GitHub.**
   - Los documentos originales de las promotoras (planos, memorias, proyecto de ejecución).
   - Datos personales (contactos, emails).
   - Credenciales o claves.
   - Renders pesados que no hayamos decidido conservar.
4. **Qué es Cloudflare.** Una red mundial que sirve páginas web de forma rápida y segura. En el plan gratuito no cobra por visitas a archivos estáticos.
5. **Qué vive en Cloudflare.** Solo una copia de lo que hay en el escaparate:
   - las webs públicas de las promociones;
   - la web del Portal (la página vacía, sin datos).

   Cloudflare no guarda ningún dato privado.
6. **Qué es Supabase.** Un servicio que nos da tres cosas ya hechas:
   - **usuarios** (login con enlace por email);
   - **base de datos** (fichas: promotoras, promociones, documentos, estados);
   - **almacén de archivos** (los documentos subidos).

   Incluye **reglas de seguridad** que el propio servidor aplica a cada petición.
7. **Qué información guarda Supabase.**
   - promotoras y sus usuarios;
   - promociones y su estado;
   - checklist de onboarding;
   - documentos subidos y sus versiones;
   - datos estructurados que rellena la promotora (CIF, IBAN, colores…);
   - validaciones de planos;
   - entregables publicados para la promotora;
   - registro de acciones (quién hizo qué y cuándo).
8. **Dónde están físicamente los archivos que suben las promotoras.**
   - En el almacén de archivos de Supabase, en un centro de datos de la **Unión Europea** que elegimos al crear el proyecto (por ejemplo Fráncfort).
   - Además, una **copia de seguridad diaria** en Cloudflare R2, también con ubicación UE.
9. **Dónde están los modelos 3D.** Esto es importante: **no existen como archivos 3D.** El modelo de cada vivienda se **construye en el navegador** cada vez que alguien abre la web, a partir de los datos (`vivienda.json`, `ambientacion.json`…), que viven en el taller y se publican en el escaparate.
   - Cuando haga falta un archivo 3D (por ejemplo, para Blender), se genera al momento y se descarta.
   - Esto hace que actualizar sea barato: se cambian datos, no modelos.
10. **Dónde están las texturas.**
    - Las de la biblioteca (libres, CC0) están en el taller, en versión optimizada para la web, y se publican con cada web.
    - Las versiones de muy alta resolución, si en la fase 3 se usan para el render premium, irían en el almacén de Supabase dentro de la «biblioteca», no en cada promoción.
11. **Dónde están logos, fuentes, planos y memorias técnicas.**
    - **Originales** (lo que sube la promotora): en Supabase y en su copia de seguridad.
    - **Versión de trabajo** de logos y fuentes (logo SVG limpio, fuente web si su licencia lo permite): en el taller, dentro de la carpeta de la promoción, porque se publican.
    - **Planos y memorias:** **solo** en Supabase. En el taller solo queda lo que se ha extraído de ellos (medidas, superficies, materiales), anotando de qué documento y versión sale cada dato.
12. **Dónde están los datos de cada promoción.**
    - **Datos de producción** (geometría, materiales, packs, precios, marca): en el taller, `promociones/<nombre>/`.
    - **Datos administrativos** (estado, documentos, usuarios): en Supabase.
13. **Dónde está el Studio.** En el taller. **No se publica nunca.** Se abre solo en tu entorno de producción, en una sesión de Claude Code o en local.
14. **Dónde están las recetas.** En el taller, como documentos escritos en español junto con los scripts que ejecutan.
    - Cualquier persona o herramienta puede leerlas: un desarrollador, otra IA, tú misma.
15. **Dónde están las versiones anteriores.** Hay tres registros complementarios:
    - **Taller:** cada versión tiene una «etiqueta» inmutable y su ficha (fecha, documentos, cambios, aprobación).
    - **Escaparate:** el historial guarda exactamente lo que se publicó en cada momento.
    - **Supabase:** el resumen de versiones que ve la promotora.
16. **Dónde está la web que ve el comprador.** En Cloudflare, en una dirección estable, por ejemplo `https://ver.tudominio.com/residencial-x/`. Esa dirección no cambia entre versiones.
17. **Dónde está el Portal Promotora.**
    - **La página:** en Cloudflare, en `https://portal.tudominio.com`.
    - **Sus datos y archivos:** en Supabase.
    - Son dos direcciones separadas a propósito, para que el portal y las webs públicas no compartan nada en el navegador.

---

## 3. Diagrama

```
                         TU ENTORNO DE PRODUCCIÓN (interno, privado)
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  Tú ──habla──▶ CLAUDE CODE (equipo de producción, sigue RECETAS)         │
 │                     │                                                    │
 │                     ▼                                                    │
 │   GITHUB · TALLER (privado)                                              │
 │     producto maestro · Studio · Portal (diseño) · recetas · biblioteca   │
 │     promociones/<nombre>/ (datos trabajados + versiones + diario)        │
 │     estructura y reglas de Supabase · copias y pruebas automáticas      │
 └───────────┬──────────────────────────────────────────▲───────────────────┘
             │ publicar (solo con tu OK)                │ lee documentos nuevos,
             ▼                                          │ escribe estados y entregables
   GITHUB · ESCAPARATE (privado)                        │ (cuenta «robot» con permisos mínimos)
     solo las webs publicadas                           │
             │ copia automática                         │
             ▼                                          │
   CLOUDFLARE (gratis)                       SUPABASE (UE, ~25 $/mes)
   ver.tudominio.com/<promoción>   ◀── no ──▶  usuarios · fichas · documentos
   portal.tudominio.com  ─────── habla con ──▶ reglas de seguridad en el servidor
        ▲            ▲                                  │
   COMPRADOR /    PROMOTORA                            │ copia diaria
   PÚBLICO        (login por email)                     ▼
                                              CLOUDFLARE R2 (copias, UE)
```

Dos ideas clave del diagrama:

- **La web pública no depende de Supabase.** Si Supabase falla, compradores y público no lo notan.
- **Claude no aparece en el lado público.** Ninguna visita genera uso de IA.

---

## 4. Qué ocurre en las operaciones reales

### A. «Da de alta Residencial X para Promotora Y»

1. **Claude comprueba que tiene lo necesario** (receta 1):
   - nombre de la promoción;
   - promotora (nueva o existente);
   - email de la persona de contacto;
   - quién aprobará los planos.

   Si falta algo, se detiene y te lo pregunta. No inventa.
2. **Claude te enseña el resumen y espera tu OK** antes de enviar ninguna invitación.
3. **En Supabase se crea:**
   - la promotora, si es nueva;
   - la promoción, en estado **«Documentación pendiente»** y marcada como **activa**;
   - el **checklist** de onboarding a partir de la plantilla (unos 45 elementos en 6 bloques);
   - la invitación por email a la persona de contacto.
4. **En el taller (GitHub) se crea:**
   - la carpeta `promociones/residencial-x/` a partir de la plantilla, todavía vacía de datos;
   - la primera entrada de su diario.

   Todo en una rama de trabajo, no en lo publicado.
5. **En Cloudflare no se crea nada todavía.** La web pública aparece cuando se publique la v1. No hay que crear un proyecto por promoción: todas viven en el mismo escaparate.
6. **La promotora recibe un email de bienvenida.** Pulsa el enlace, entra en el portal sin contraseña y ve **únicamente** Residencial X, con el checklist al 0 %.
7. **Queda pendiente:** que la promotora suba la documentación.

### B. La promotora sube un plano

1. **Dónde se guarda.** En el portal pulsa «Subir» en «Plano acotado · Tipología A». El archivo viaja directamente desde su navegador al almacén de Supabase, a una ruta como esta:
   `documentos/<promotora>/<promoción>/tecnica/plano-tipologia-a/v2-2026-10-05-plano.pdf`.
   Antes de aceptarlo, el servidor comprueba las reglas: esa persona pertenece a esa promotora, esa promoción es suya y está activa.
2. **Cómo se registra.** Se crea una ficha con estos datos:
   - nombre original, tipo de documento, fecha;
   - quién lo subió y tamaño;
   - **huella digital** del archivo (un código único que demuestra que no se ha alterado);
   - **versión** (2, calculada automáticamente);
   - a qué versión reemplaza (la 1);
   - estado **«Pendiente de revisión»**.
3. **Cómo sabemos qué versión es.** El número lo asigna el sistema, no la promotora.
   - La versión anterior **sigue vigente** hasta que la revisemos: una subida nueva no sustituye nada por sí sola.
   - Tras la revisión, la 2 pasa a «Vigente» y la 1 a «Reemplazado». Ninguna se borra.
4. **Cómo se evita que otra promotora lo vea.** Las reglas del servidor solo dejan ver fichas y archivos de promociones de tu propia promotora. Ver el apartado 8.
5. **Cómo se entera Claude.** Lee las novedades cuando ejecuta «revisa lo nuevo», o en la revisión diaria automática.
6. **Cómo te enteras tú.** Por tres vías:
   - un **email inmediato** al subirse (opcional, recomendado);
   - el **resumen diario**;
   - la **bandeja de novedades** del panel de administración del portal, que funciona incluso sin Claude.

   La promoción pasa a «Documentación recibida» o, si ya estaba publicada, a «Actualización pendiente».

### C. Claude procesa la documentación («Revisa lo nuevo», receta 2)

1. **Qué descarga.** Solo los documentos pendientes de revisión, a su espacio de trabajo temporal. **Nunca los copia al taller.**
2. **Qué interpreta.**
   - Comprueba que cada documento es lo que dice ser: un plano de la tipología A, acotado, legible.
   - Lee cotas, el cuadro de superficies, la memoria técnica (materiales, carpinterías, sanitarios…), la orientación y los datos de marca.
3. **Qué transforma en datos estructurados:**
   - superficies por estancia;
   - lista de estancias;
   - materiales de la memoria técnica emparejados con los del catálogo;
   - colores, logos y textos.

   Cada dato queda anotado con **el documento, la versión y la página de donde sale**.
4. **Qué conserva como original.** Todo. Los documentos originales no se modifican nunca.
5. **Qué deja registrado:**
   - entrada en el diario de la promoción: qué revisó, qué extrajo, qué dudas tiene;
   - lista de incoherencias, por ejemplo «el cuadro dice 11,4 m² y el plano mide 10,9 m²» o «falta la cota del dormitorio 2»;
   - propuesta de qué pasa a «Vigente».

   Ese último cambio **lo confirmas tú.** Si falta información, se pide a la promotora (con una nota visible en su portal) y no se rellena inventando.

### D. «Genera la primera versión» (receta 3)

1. **Comprobación:** ¿están vigentes los documentos mínimos (planos por tipología, cuadro de superficies, memoria técnica, orientación, marca)? Si falta alguno, se para.
2. **Modelo:** Claude traduce cada plano en geometría (muros, huecos, estancias, equipamiento) con la herramienta de extracción y su revisión. Un script compara las superficies con el cuadro oficial (tolerancia del 5 %).
3. **Orientación:** se fija el norte real del proyecto.
4. **Materiales:** cada partida de la memoria técnica se asigna a un material de la biblioteca. Lo que no tiene equivalente se aproxima y **se marca para tu revisión**.
5. **Interiorismo:** Claude propone la ambientación de cada estancia según las referencias de estilo, con el mobiliario procedural de la biblioteca.
6. **Vistas:** se generan las vistas obligatorias (incluidas las automáticas para estancias grandes) y Claude ajusta los encuadres.
7. **Plano comercial:** se genera automáticamente desde la geometría, en PDF y PNG.
8. **Packs:** se cargan los packs, precios y fechas que facilitó la promotora (receta 6).
9. **Marca:** logos, colores y textos legales.
10. **Validación automática** (receta 8): revisión técnica y pruebas en navegador de escritorio y móvil, incluido el modo de respaldo.
11. **Preview** (receta 9): una dirección privada para que lo revises.
12. **Informe para ti:** qué está hecho, qué se ha supuesto y qué conviene mirar. Tú revisas la preview y pides cambios o das el OK.
13. **Tras tu OK:** los planos comerciales se envían a la promotora para su validación formal y el estado pasa a «Pendiente de validación».

### E. «Publica» (receta 10)

1. **Comprobaciones previas.** Si falla cualquiera, no se publica y se te explica por qué.
   - la validación automática se pasó **sobre esta versión exacta**;
   - los planos comerciales están **aprobados por la promotora**, y además los aprobados son exactamente estos (se compara la huella digital);
   - no quedan puntos en rojo en la revisión;
   - fechas de packs, precios y textos legales son coherentes;
   - **tu OK explícito.** Claude te muestra el resumen («Vas a publicar Residencial X v2: cambian 3 superficies y el pack de cocinas…») y espera tu confirmación.
2. **Qué versión se crea.** La siguiente: v1, v2… Se guarda:
   - una etiqueta inmutable en el taller;
   - su ficha (fecha, documentos de origen con su versión, cambios, quién aprobó, planos validados, precios y packs);
   - la web construida.
3. **Dónde se publica.** La web construida se copia al escaparate, en la carpeta de esa promoción, y Cloudflare la sirve en uno o dos minutos. **Las demás promociones no se tocan.**
4. **Qué pasa con la anterior.** Queda archivada con el estado «Sustituida» y se puede recuperar en minutos (rollback).
5. **Qué URL ve el comprador.** La de siempre (`ver.tudominio.com/residencial-x/`). Los enlaces privados de comprador siguen funcionando.
6. **El portal se actualiza:** estado «Publicado · v2» y entregables de la v2 disponibles.

### F. Llega un plano nuevo seis meses después

1. La promotora lo sube como nueva versión del mismo documento. La promoción pasa a «Actualización pendiente» y recibes el aviso.
2. «Revisa lo nuevo» (receta 2): Claude lo compara con el anterior y te resume qué cambia.
3. «Actualiza los planos» (receta 4):
   - se guarda la geometría vigente;
   - se traduce el nuevo plano **conservando los identificadores** de lo que no cambia;
   - la comparación automática lista los cambios (muros, huecos, superficies, equipamiento);
   - la revisión señala qué cámaras, decoración, variantes y packs quedan afectados y **qué compradores con selección formalizada** podrían verse afectados.
4. **Se regenera solo:**
   - geometría;
   - superficies;
   - plano comercial;
   - suelos, rodapiés, mecanismos y luz de ventanas;
   - vistas automáticas.
5. **Solo se repasa lo señalado:** una cámara que ha quedado mal, un mueble que invade un muro, un parche de variante.
6. **No se rehace:** materiales, interiorismo de las estancias que no cambian, packs, marca, textos.
7. **Cierre:** preview → tu OK → validación del nuevo plano por la promotora → publicación de la v3.
8. **Compradores.** Las selecciones formalizadas sobre la v2 siguen asociadas a la v2. Si el cambio les afecta, el informe lo dice para que el comercial de la promotora los contacte.

---

## 5. Independencia de Claude

### Si mañana dejaras de usar Claude

| Elemento | ¿Sigue funcionando? | Dónde vive |
|---|---|---|
| Web pública y del comprador | **Sí** | Cloudflare (archivos estáticos) |
| Portal Promotora (entrar, subir, descargar, ver estados) | **Sí** | Cloudflare + Supabase |
| Usuarios y promociones | **Sí** | Supabase |
| Archivos de las promotoras | **Sí** | Supabase + copia en R2 |
| «Modelos» (datos de cada vivienda) | **Sí** | Taller (GitHub) |
| Base de datos | **Sí** | Supabase |
| Histórico y versiones | **Sí** | GitHub + Supabase |
| Código del producto | **Sí** | GitHub |
| Publicar, volver atrás, construir | **Sí** | Son scripts. Un desarrollador los ejecuta con una orden |
| Avisos de subidas | **Sí**, si activamos el email inmediato | El resumen diario hecho por Claude sí se pierde |
| Activar o desactivar promociones y gestionar accesos | **Sí** | Panel de administración del portal |
| **Producción** (interpretar planos, generar geometría, proponer interiorismo, revisar) | **No de forma automática** | Necesitaría una persona (técnico 3D o desarrollador) siguiendo las recetas, u otra herramienta de IA |

**La distinción:**

- **Infraestructura del producto:** GitHub, Cloudflare y Supabase. No depende de Claude en nada.
- **Herramienta de producción con IA:** Claude. Acelera la producción, pero no guarda nada que no esté también en GitHub o Supabase.
- **Regla de diseño:** ninguna información del negocio vive solo dentro de una conversación de Claude.

### Cómo se entregaría el proyecto a un desarrollador externo

El «paquete de entrega» existe desde el primer día, en el propio taller:

1. `README.md`: qué es el producto, en dos páginas.
2. `docs/arquitectura.md`: este documento, mantenido al día.
3. `docs/operaciones.md`: todas las recetas, paso a paso, en lenguaje normal.
4. `docs/recuperacion.md`: qué hacer ante cada incidente (apartado 17).
5. `docs/decisiones.md`: por qué se decidió cada cosa.
6. `supabase/`: la estructura completa de la base de datos y las reglas de seguridad, reproducibles desde cero.
7. Pruebas automáticas, incluida la de aislamiento entre promotoras.

**Para entregarlo:**

- le das acceso a GitHub, Supabase y Cloudflare con un rol limitado;
- con el manual, debería estar operativo en uno o dos días;
- no necesita esta conversación.

---

## 6. Cuentas y propiedad

### Cuentas que crearías tú (una sola vez, con mi guía paso a paso)

| Cuenta | Para qué | Plan | Coste |
|---|---|---|---|
| **Correo del negocio** (p. ej. `admin@tudominio.com`) | Es la identidad propietaria de todo lo demás | Buzón del proveedor del dominio, o Google Workspace | 0–7 €/mes |
| **Dominio** | `tudominio.com` | Registrador (para `.com`, Cloudflare vende al coste; para `.es`, un registrador español) | ~10–15 €/año |
| **GitHub** | Taller y escaparate | Gratis. Tu cuenta personal + una **organización** del negocio, propietaria de los almacenes | 0 |
| **Cloudflare** | Webs públicas, portal, copias (R2) y DNS | Gratis | 0 (copias: céntimos al crecer) |
| **Supabase** | Usuarios, datos, archivos | **Pro** para producción. Gratis para el proyecto de pruebas, en otra organización | 25 $/mes en producción |
| **Envío de emails** | Enlaces de acceso del portal y avisos | El SMTP de tu correo profesional, o un servicio con plan gratuito (p. ej. Brevo o Resend) | 0 en nuestro volumen |
| **Gestor de contraseñas** | Guardar contraseñas y códigos de recuperación | Bitwarden gratis, o similar | 0 |
| **Claude** | Producción | Tu plan actual | Ya lo pagas |
| *(Solo si en la fase 3 se elige GPU de alquiler)* | Render premium | Prepago por uso | Ver apartado 11 |

### Propiedad y control

- **Propietaria de todo:** tú, con el correo del negocio. No uses un correo personal ni uno que dependa de un tercero. Si usas tu gmail personal, que sea al menos uno dedicado solo al negocio.
- **Verificación en dos pasos en todas las cuentas**, con una app de autenticación. Los **códigos de recuperación** se guardan en el gestor de contraseñas y en papel, en un lugar seguro.
- **Segundo administrador de emergencia** (recomendado): una persona de confianza, o una segunda cuenta tuya, con acceso de propietario en GitHub, Cloudflare y Supabase, por si pierdes el acceso.

### Permisos de terceros

| Quién | Qué acceso | Cómo se quita |
|---|---|---|
| Claude | App de GitHub limitada a los dos almacenes + cuenta robot de Supabase | Desinstalas la app en GitHub y desactivas el robot: 2 minutos |
| Desarrollador | GitHub «escritura» (no administrador). Supabase rol «Developer». Cloudflare con rol limitado | Lo eliminas en las tres cuentas y rotas el robot si lo usaba |
| Promotoras | Solo su usuario del portal | Panel de administración → quitar acceso (inmediato) |
| ChatGPT u otras IA | Ninguno directo. Solo lo que tú les pegues | — |

### Situaciones concretas

- **Si dejas Claude:** no pierdes nada (apartado 5).
- **Si cambia el desarrollador:** quitas accesos, rotas credenciales y el siguiente arranca con el manual.
- **Si pierdes el acceso a una cuenta:** códigos de recuperación, segundo administrador o, en último caso, recuperación por el soporte del proveedor demostrando la propiedad del dominio o correo.

---

## 7. Credenciales y secretos

### Las credenciales que existirán

| # | Credencial | Qué es | Dónde está | ¿Es secreta? |
|---|---|---|---|---|
| A | **Clave pública del portal** | La «dirección» del proyecto de Supabase. La página del portal la necesita para hablar con él | Dentro de la web del portal | **No.** Está diseñada para ser pública: por sí sola no abre nada, porque quien decide es la regla del servidor y el usuario que ha iniciado sesión |
| B | **Cuenta robot de producción** | Un usuario del portal con el rol «producción», como un empleado con llaves limitadas | Secreto del entorno de Claude Code (ajustes del entorno en la nube) | **Sí** |
| C | **Secretos de las copias de seguridad** | Lectura de la base de datos y escritura en el almacén de copias | Secretos cifrados de GitHub. Una vez guardados, ni siquiera un administrador puede volver a verlos | **Sí** |
| D | **Clave maestra de Supabase** (*secret / service role*) | Lo abre todo, saltándose las reglas | **No sale nunca del panel de Supabase.** Nuestro sistema no la usa | Máxima |
| E | *(Fase 3, solo si se elige GPU)* clave del proveedor de GPU | Permite alquilar máquinas | Secretos de GitHub, con límite de gasto | **Sí** |

### La credencial B, en detalle

- **Qué tipo de clave es:** el usuario y la contraseña de una cuenta de servicio del portal. No es la clave maestra.
- **Qué puede hacer:**
  - leer los documentos de las promociones;
  - cambiar estados;
  - marcar documentos como vigentes;
  - subir entregables.
- **Qué NO puede hacer:**
  - borrar nada;
  - cambiar las reglas de seguridad;
  - crear administradores;
  - tocar la estructura de la base de datos;
  - publicar webs (eso pasa por GitHub con tu OK).
- **Por qué Claude la necesita:** para leer las subidas y actualizar el portal durante las recetas.
- **Dónde se guarda:** en los ajustes del entorno de Claude Code, como variable secreta. **Nunca se pega en el chat.** Tú la introduces una vez en esa pantalla, con mi guía.
- **Quién puede verla:**
  - tú, como propietaria del entorno;
  - las sesiones de Claude de ese entorno, mientras trabajan.
- **Qué pasa si se filtra:** quien la tenga podría **leer** la documentación de las promociones y **cambiar estados o subir archivos**. No podría borrar, ni cambiar reglas, ni publicar. Todo lo que hiciera quedaría en el registro de acciones.
- **Cómo se rota:**
  - se cambia la contraseña del robot en Supabase y se actualiza el secreto en el entorno;
  - son 5 minutos, guiados;
  - recomendado una vez al año y siempre que salga alguien del proyecto.
- **Cómo se revoca:** se desactiva el usuario robot en Supabase. El efecto es inmediato. Las webs públicas y el portal siguen funcionando; solo se para la producción automática.
- **¿Puede tener aún menos permisos?** Sí. Podemos separarlo en dos:
  - **robot lector**, para la revisión diaria de novedades;
  - **robot de producción**, para las recetas que escriben.

  Recomiendo empezar con uno y separarlos si el volumen crece.
- **¿Hay un conector oficial?** Sí. Supabase tiene un conector oficial para Claude con acceso por autorización (sin copiar claves), que se puede limitar a un solo proyecto y a solo lectura.
  - **Pero** trabaja a nivel de administrador de la base de datos, por encima de las reglas del portal, y no está pensado para manejar archivos.
  - **Propuesta:** usar el conector oficial **solo durante la construcción** (fase 1) para crear la estructura, con tu autorización en cada sesión, y el robot para el día a día.

### Garantías de que una clave sensible nunca se filtra

1. La clave maestra de Supabase no se copia a ningún sitio.
2. GitHub tiene activada la **protección contra secretos**: bloquea automáticamente cualquier subida que contenga una clave reconocible.
3. **Comprobación automática en cada construcción:** si en la web que se va a publicar aparece algo con forma de secreto, la publicación se cancela.
4. Los archivos de configuración local con secretos están excluidos del taller por norma.
5. La documentación nunca contiene secretos. Dice *dónde* están, nunca *cuáles* son.

---

## 8. Seguridad entre promotoras

### Cómo funcionan las reglas, en lenguaje sencillo

Cada ficha y cada archivo lleva una **etiqueta con la promoción a la que pertenece**, y cada promoción pertenece a una promotora. Cada vez que alguien pide algo, el **servidor** (no la página web) comprueba:

> «¿La persona que pide esto pertenece a la promotora dueña de esta promoción, y la promoción está activa?»

Si la respuesta es no, el servidor responde como si eso no existiera. Las reglas viven en Supabase. Aunque alguien manipule la página desde su navegador, no puede saltárselas.

### Ejemplo

| Promotora | Promociones | Qué ve |
|---|---|---|
| A | Promoción 1, Promoción 2 | Solo la 1 y la 2 |
| B | Promoción 3 | Solo la 3 |

### Qué evita cada regla

| Riesgo | Regla |
|---|---|
| Acceso cruzado | Solo se leen fichas y archivos de promociones de tu promotora |
| Subir a otra promoción | Solo se puede subir a la carpeta de una promoción propia y activa. El servidor comprueba la ruta del archivo |
| Modificar estados | Las promotoras **no tienen permiso de modificación** sobre estados. Solo administración y producción |
| Crear promociones | **Nadie** salvo administración puede crear promociones. No existe el botón, y aunque alguien lo intentara, el servidor lo rechaza |
| Marcar sus documentos como «vigente» | No pueden. Solo pueden **añadir** versiones, que entran como «pendiente de revisión» |
| Borrar | **Nadie puede borrar desde la aplicación**, ni siquiera producción. Los borrados excepcionales (fin de contrato, derecho de supresión) los hace la propietaria con una receta registrada |
| Documentos confidenciales | Los archivos no tienen dirección pública. Se descargan con enlaces temporales (minutos), que solo se generan para quien tiene permiso. Cada descarga se registra |
| Promoción desactivada | Al desactivarla (fin de contrato o impago), la promotora deja de verla al instante |
| Aprobar planos sin estar autorizado | Solo los usuarios con rol **«aprobador»** de esa promotora |

### Prueba automática de aislamiento (obligatoria antes del primer cliente)

- **Dónde se ejecuta:** en un proyecto de pruebas de Supabase (gratis), con datos ficticios.
- **Cuándo se ejecuta:** automáticamente cada vez que se cambie algo del portal o de las reglas. Si falla, no se puede publicar ese cambio.

Con dos promotoras ficticias, A y B, la prueba hace estos intentos. **Todos deben fallar:**

1. A intenta ver la lista de promociones de B.
2. A intenta leer las fichas de documentos de B.
3. A intenta listar los archivos de B.
4. A intenta descargar un archivo de B conociendo su ruta exacta.
5. A intenta subir un archivo a la carpeta de B.
6. A intenta registrar un documento con la promoción de B.
7. A intenta cambiar el estado de su propia promoción.
8. A intenta crear una promoción nueva.
9. A intenta marcar su documento como «vigente».
10. A intenta borrar su propio documento.
11. Un usuario de A sin rol de aprobador intenta aprobar un plano.
12. A intenta ver su promoción después de ser desactivada.
13. Alguien sin sesión intenta leer cualquier cosa.

Y estos intentos **deben funcionar:** A ve sus promociones, sube a su checklist y descarga sus entregables. Así comprobamos que la seguridad no rompe el uso normal.

---

## 9. Qué se guarda en cada sitio

| Tipo | Supabase Storage | Taller (Git) | Escaparate / Cloudflare | Solo Studio o temporal |
|---|---|---|---|---|
| Planos originales, memoria técnica, proyecto de ejecución | ✔ (original y versiones) | — (solo los datos extraídos y su origen) | — | Copia temporal durante el procesado |
| Cuadro de superficies, alzados y secciones | ✔ | Datos extraídos | — | — |
| Logos y manual de marca originales | ✔ | Logo SVG limpio y colores | Logo publicado | — |
| Fuentes tipográficas | ✔ (original) | Fuente web **solo si su licencia lo permite** | Fuente web | — |
| Referencias de interiorismo e imágenes de estilo | ✔ | — | — | Se consultan al producir |
| Datos legales (CIF, IBAN, contacto) | ✔ (ficha) | IBAN y titular **solo** si van en el PDF de pago | En el PDF del pack | — |
| Packs, precios y fechas | ✔ (lo que facilita la promotora) | ✔ (versión trabajada) | ✔ | — |
| Geometría, materiales, ambientación, vistas | — | ✔ | ✔ | — |
| Texturas de biblioteca (versión web) | — | ✔ | ✔ | — |
| Texturas en alta resolución (fase 3) | ✔ (biblioteca) | — | — | — |
| Modelos 3D | — (no existen como archivo) | Datos | Datos | Archivo 3D temporal para Blender |
| Renders libres (navegador) | — | — | — | Se generan y descargan en el navegador. **No se guardan** |
| Renders premium | Solo los **conservados** expresamente | — | Los que se usen en la web | Temporales: caducan a los 7 días |
| Planos comerciales PDF/PNG de cada versión | ✔ (entregables de la versión) | Se pueden regenerar | El estándar descargable | — |
| Fichas de versión | Resumen | ✔ (completa) | — | — |
| Selecciones de comprador | — | ✔ (sin datos personales) | Lo necesario para mostrar el estado | — |
| Datos personales de compradores | **No** | **No** | **No** | **No** (ver apartado 20) |
| Studio | — | ✔ | **Nunca** | ✔ |
| Recetas y scripts | — | ✔ | — | — |
| Credenciales | — | **Nunca** | **Nunca** | Secretos del entorno |

**Principio:** el almacén guarda lo que **no se puede regenerar** (originales de la promotora) y lo que **decidimos conservar** (entregables aprobados). Todo lo que se puede regenerar a partir de los datos no se almacena.

---

## 10. Renders: qué se guarda

**Corrección aplicada:**

- **Render libre** (desde el navegador, en cualquier resolución, incluidas 4K, 6K u 8K):
  - se genera en el ordenador de quien lo pide;
  - se descarga directamente;
  - **nunca pasa por nuestros servidores ni se guarda.**

  Ya funciona así hoy y coste de almacenamiento es cero.
- **Render premium** (fase 3, si se adopta):
  - se genera en el servidor de render y queda en una zona **temporal**, que se vacía automáticamente a los 7 días;
  - la promotora lo descarga desde ahí.
- **Solo se conservan** los renders que marques expresamente como render comercial, entregable de una versión, imagen aprobada o material promocional. Se guardan en «entregables» con su versión.
- **Para los costes:** los únicos renders que ocupan espacio son los conservados, unos 20–40 por promoción y versión, de 2–10 MB cada uno. Eso suma unos 0,1–0,4 GB por promoción.

---

## 11. Blender / render premium

### 1. ¿Se puede automatizar al 100 %?

**Sí, la ejecución.** Blender funciona sin ventana y obedece a un script: abre la escena, aplica materiales y luces, coloca la cámara, renderiza con Cycles, guarda el resultado y se cierra.

Lo que **no** es automático es la **preparación inicial**, que se hace **una vez en el producto**, no por promoción:

- el **traductor de materiales**: cada material del catálogo con su equivalente para Blender;
- las **reglas de iluminación**: lámparas reales en los puntos de luz, cielo y sol según la orientación;
- un **ajuste de calidad** con una escena de referencia.

Después, tú solo dices: **«Genera los renders premium de Residencial X»**. Si una promoción usa un material que aún no está traducido, la receta lo detecta, usa el más parecido y te avisa.

### 2 y 3. ¿Dónde se ejecuta? ¿Y si tu ordenador está apagado?

**Tu ordenador no participa nunca.** Hay dos opciones:

| Opción | Cómo | Tu ordenador | Velocidad |
|---|---|---|---|
| **GitHub Actions** (máquina de GitHub, solo procesador) | La receta encarga el trabajo, GitHub arranca una máquina, instala Blender, renderiza y devuelve las imágenes | Da igual que esté apagado | Lenta |
| **GPU de alquiler por horas** (RunPod, Vast.ai o similar) | Igual, pero en una máquina con tarjeta gráfica que se alquila solo durante el render y se apaga sola | Da igual que esté apagado | Rápida |

### 4 y 5. GitHub Actions y sus límites

- **Incluido:** 2.000 minutos al mes gratis en almacenes privados.
- **Después:** unos 0,006 $ por minuto.
- **Máquina:** solo procesador, unos 2 núcleos en almacenes privados.
- **Límite por trabajo:** 6 horas.

### 6. Coste de una GPU externa

Una tarjeta del tipo RTX 4090 cuesta entre **0,34 y 0,69 $ por hora**, según el proveedor y la fiabilidad (las máquinas «comunitarias» son más baratas; las de centro de datos, más caras).

- Exige crear una cuenta, dejar saldo de prepago y guardar una clave (credencial E, con límite de gasto).
- Es la **única pieza de toda la arquitectura con coste variable real.** No se activaría sin tu aprobación.

### 7 y 8. Coste y tiempo por render (orientativos, **a confirmar en la prueba piloto**)

| | 1080p | 4K | Coste por render |
|---|---|---|---|
| GitHub Actions (procesador) | 20–60 min | 1,5–4 h | Gratis dentro de los 2.000 min, que dan para unas 30–80 imágenes 1080p al mes. Después, ~0,10–0,40 $ |
| GPU de alquiler | 0,5–2 min | 2–8 min | ~0,02–0,10 $, más ~5 min de arranque por lote. Un lote de 20 renders en 4K: ~1–2 h → ~0,50–1,50 $ |

### 9. Calidad esperable

- **Mejora claramente:** la luz rebotada real, las sombras suaves, las lámparas que iluminan de verdad, los reflejos correctos y la eliminación de ruido profesional.
- **No mejora por sí solo:** el nivel de detalle de los objetos. Si el mobiliario es simple, se verá simple pero muy bien iluminado. Por eso las texturas (apartado 13) y el detalle del mobiliario importan tanto como el motor de render.

### 10. Mantenimiento

- Versión de Blender **fija**, y actualización controlada una vez al año.
- Al añadir un material nuevo al catálogo, se añade su traducción (lo hace la receta de biblioteca).
- Una **escena de referencia** se vuelve a renderizar en cada cambio y se compara automáticamente con la anterior, para detectar si algo se ha roto.

### La prueba piloto (antes de adoptar nada)

- **Misma estancia** (el salón de la tipología A) y **misma cámara**, en 1080p y 4K.
- **Se compara:**
  - el render actual;
  - Blender/Cycles automatizado;
  - y el path tracing en navegador (apartado 12), que aprovecha el mismo traductor con poco trabajo extra.
- **Se mide:**
  - tiempo, coste e intervención manual (debe ser cero);
  - y tu valoración visual, **viendo las imágenes sin saber cuál es cuál**.
- **Se adopta solo si:**
  - tú percibes una mejora clara;
  - la ejecución es 100 % desatendida;
  - el coste por promoción es razonable.

  Si no se cumple, no se adopta y no se habrá tocado nada más.

### La promotora pidiendo renders premium (más adelante)

1. La promotora pulsa «Solicitar render premium» de una vista del portal.
2. Queda en una cola.
3. El servidor de render la atiende.
4. La imagen aparece en la zona temporal en 30–60 minutos.

Sin Claude de por medio y sin guardarse por defecto.

---

## 12. Path tracing en navegador

| Aspecto | Valoración |
|---|---|
| Calidad | Alta en luz. Algo inferior a Cycles en eliminación de ruido, lámparas y materiales complejos |
| Compatibilidad | La librería de referencia funciona con el motor WebGL, no con WebGPU ni con nuestros materiales procedurales actuales. **Necesita el mismo traductor de materiales que Blender** |
| Velocidad | Depende del equipo: minutos con una buena tarjeta gráfica; en un portátil normal, mucho más, con riesgo de bloquear el navegador |
| Automatización | **Mala.** Necesita un navegador con tarjeta gráfica real; no se puede ejecutar desatendido en servidores normales |
| Coste | Cero |
| Dependencia del hardware del usuario | **Total**: la calidad y el tiempo dependen del ordenador de la promotora |
| Mantenimiento | Medio: otra librería y otro camino de render que mantener |

**Conclusión:** sobre el papel, Blender gana en calidad y automatización, y el render actual basta para el uso libre. Eso dejaría fuera el punto intermedio. Como pides, **no lo descarto solo por teoría.**

- Entra en la prueba piloto como tercera opción, porque con el traductor ya hecho cuesta poco probarlo.
- **Solo se mantendría** si da una calidad cercana a Cycles en menos de 2–3 minutos en un portátil medio. En ese caso sería un «render mejorado» en el navegador, sin servidores.
- Si no, se elimina.

---

## 13. Texturas, modelos y assets

### Lo que propongo usar (todo gratis, comercial, sin atribución obligatoria)

| Recurso | Licencia | Uso comercial | Redistribuir y servir desde nuestra web | Coste | Aporta |
|---|---|---|---|---|---|
| **Poly Haven**: texturas, HDRI (iluminación ambiental) y algunos modelos | CC0 (dominio público) | Sí | Sí | 0 | Gran mejora de realismo en suelos, paredes, madera y piedra. Los HDRI mejoran luz y reflejos tanto en el visor como en Blender |
| **ambientCG**: texturas | CC0 | Sí | Sí | 0 | Complementa a Poly Haven con más materiales de construcción |
| **Google Fonts** (para nuestros textos) | OFL | Sí | Sí | 0 | Tipografías con licencia clara |

### Distinción importante

- **Texturas:** encajan con tu regla de «procedural». Las texturas no son modelos; dan realismo a la superficie de una geometría que seguimos generando nosotros.
- **Modelos 3D de terceros** (muebles CC0): **romperían** la regla de «solo procedural». No los propongo salvo que tú decidas cambiar esa regla. Si algún día se plantea, sería por categorías concretas, como plantas u objetos decorativos complejos.

### Licencias que hay que vigilar

- **Fuentes de marca de la promotora.** Muchas fuentes comerciales tienen licencia para impresión pero **no para web**. La receta de marca lo comprueba. Si no hay licencia web, se usa una alternativa libre similar en la web y la original solo en los PDF, si su licencia lo permite.
- **Bibliotecas de pago** (Poliigon, Fab/Megascans y similares):
  - **no las integro**;
  - si en algún momento una aportara algo que no tengan las gratuitas, te presentaría antes precio, modalidad, condiciones, si permite servirla desde la web (muchas no permiten redistribuir el archivo original) y alternativa gratuita.
- **Registro de licencias:** cada recurso externo queda anotado en `biblioteca/licencias.md` con su origen, licencia y fecha de descarga.

---

## 14. Recetas

### Estructura común de cada receta

| Campo | Contenido |
|---|---|
| Entrada | Qué hay que decir o aportar |
| Requisitos | Qué debe existir antes |
| Comprobaciones previas | Qué se verifica. Si falla, se detiene y explica |
| Pasos automáticos | Lo que hacen los scripts (exacto, repetible, sin IA) |
| Pasos de Claude | Lo que requiere criterio |
| Puntos de control | Dónde se para a pedir tu OK |
| Salida | Qué produce |
| Registro | Qué anota en el diario de la promoción y en Supabase |
| Errores | Qué hace si algo falla |
| Marcha atrás | Cómo se deshace, si aplica |

### Reglas universales (escritas en todas)

1. Nunca se trabaja directamente sobre lo publicado: siempre en una rama de trabajo.
2. Nunca se publica sin tu OK explícito.
3. Nunca se borra una versión anterior.
4. Si falta información, se detiene y la pide.
5. No se inventan datos: lo supuesto se marca como supuesto y se te enseña.
6. Se registra qué documentos (y qué versión de cada uno) se utilizaron.
7. Se registra qué versión se generó.
8. Al empezar, Claude dice qué receta va a ejecutar («Receta 4 · Actualizar planos · Residencial X»), para que siempre sepas qué procedimiento está en marcha.
9. Al terminar, deja un informe breve en el diario.

### Catálogo

**Recetas que pediste (13):**

| # | Receta | Lo dices así | Pasos automáticos | Interviene Claude | Tu OK | Si falla / marcha atrás |
|---|---|---|---|---|---|---|
| 1 | **Nueva promoción** | «Da de alta Residencial X para Promotora Y» | Carpeta desde plantilla, fichas y checklist en Supabase, invitación | Comprobar datos y redactar la bienvenida | Antes de invitar | Si algo falla a medias, se deshace todo lo creado. La promoción se puede desactivar |
| 2 | **Procesar documentación** | «Revisa lo nuevo (de X)» | Descarga, huellas digitales, comprobación del checklist | Clasificar, leer, extraer datos, detectar incoherencias | Antes de marcar documentos como vigentes | Un documento ilegible o equivocado se rechaza con nota a la promotora |
| 3 | **Generar primera versión** | «Genera la primera versión de X» | Superficies, vistas automáticas, plano comercial, validación, preview | Traducir planos, asignar materiales, interiorismo, encuadres | Al presentar la preview | Todo en una rama: si no convence, se descarta sin efecto |
| 4 | **Actualizar planos** | «Actualiza los planos de X» | Guardar versión, comparar, revisión de impacto, regenerar | Traducir el plano conservando identificadores, resolver lo señalado | Lista de cambios y de compradores afectados | La versión anterior queda intacta y publicada hasta tu OK |
| 5 | **Actualizar memoria de calidades** | «Aplica la nueva memoria de X» | Comparación de partidas, regenerar | Emparejar materiales y equipos con el catálogo | Lista de cambios y de packs o precios afectados | Igual que la 4 |
| 6 | **Incorporar pack** | «Añade el pack de cocinas de X» | Comprobar fechas, precios y tipologías; PDF de muestra | Interpretar la propuesta de la promotora | Con el PDF de muestra | Un pack publicado y con selecciones no se modifica: se crea uno nuevo |
| 7 | **Generar entregables** | «Prepara los entregables de X» | Planos PDF/PNG por tipología, renders de las cámaras, PDF de muestra | Elegir y revisar encuadres | Antes de conservarlos y subirlos al portal | Se regeneran cuando haga falta |
| 8 | **Validar** | «Valida X» | Revisión técnica, vistas obligatorias, superficies frente al cuadro, textos legales, pruebas en navegador de escritorio, móvil y modo de respaldo, comprobación de secretos | Interpretar fallos y proponer arreglos | Solo si algo falla | No modifica nada |
| 9 | **Crear preview** | «Prepárame la preview de X» | Construir y publicar en una dirección privada | — | No (no afecta a lo publicado) | Se descarta sin efecto |
| 10 | **Publicar** | «Publica X» | Comprobaciones, numerar la versión, ficha, etiqueta, copiar al escaparate, actualizar el portal | Redactar el resumen de cambios | **Siempre**: confirmación final | Si algo falla, no se publica nada: la versión anterior sigue |
| 11 | **Volver a una versión anterior** | «Vuelve X a la v2» | Restaurar la web de la v2 en el escaparate y marcar la v3 como «retirada» | Registrar el motivo | Confirmación | Se puede volver a la v3 igual |
| 12 | **Registrar selección de comprador** | «Registra la selección del 2ºB en X» | Guardar opciones, versión y precios de ese momento | Comprobar que coincide con el PDF firmado que te pasa el comercial | Con el resumen | Una selección formalizada no se modifica: una corrección es un registro nuevo |
| 13 | **Revisar novedades** | Automática cada día, o «¿hay algo nuevo?» | Consultar subidas, validaciones y rechazos | Resumir | No | — |

**Recetas que faltan y propongo añadir:**

| # | Receta | Lo dices así | Por qué hace falta |
|---|---|---|---|
| 14 | **Gestionar accesos** | «Da acceso a Ana (ana@…) en Promotora Y como aprobadora» / «Quita el acceso a…» | Las personas de la promotora cambian. También existe en el panel de administración |
| 15 | **Desactivar o cerrar promoción** | «Cierra Residencial X» | Fin de contrato: exportar todo, entregarlo a la promotora, conservar o borrar según el contrato, y certificar el borrado |
| 16 | **Actualizar marca e información comercial** | «Aplica la nueva marca de X» | Pediste que la promotora pueda actualizar branding e información, y no encaja en las otras recetas |
| 17 | **Actualizar producto en una promoción** | «Lleva las mejoras del visor a X» | Las mejoras del producto maestro solo llegan a una promoción publicada con preview y tu OK |
| 18 | **Copias y simulacro de recuperación** | Automática, más un simulacro trimestral | Una copia que nunca se ha probado a restaurar no es fiable |
| 19 | **Informe del sistema** | Automático mensual, o «¿cómo va el sistema?» | Uso de cuotas, gastos, caducidad de credenciales, accesos sin uso |
| 20 | **Exportar promoción** | «Exporta todo lo de X» | Entrega a la promotora, cambio de proveedor o auditoría |

**Imprescindibles antes del primer cliente:** 1–14 y 18. **Pueden llegar después:** 15–17, 19 y 20.

### Cómo funciona «en lenguaje normal»

- Cada receta está escrita como una *skill* de Claude Code, con su descripción.
- Cuando dices «actualiza los planos de Residencial X», Claude reconoce la receta, la anuncia y la sigue paso a paso.
- Si la petición es ambigua («cambia lo de la cocina»), pregunta a qué receta corresponde antes de hacer nada.

---

## 15. Versionado

- **Una versión = una publicación.**
  - **Numeración:** v1, v2, v3… por promoción.
  - **Inmutable:** la etiqueta en GitHub está protegida contra cambios y borrados.
- **Cada versión conserva:**
  - fecha;
  - **documentos de origen**, con su versión y huella digital;
  - **cambios** respecto a la anterior;
  - **estado** (en preview, aprobada, publicada, sustituida, retirada);
  - **quién la aprobó y cuándo** (tu OK);
  - **qué planos aprobó la promotora** (validación con huella);
  - precios y packs de esa versión;
  - versión del producto maestro utilizada;
  - la web exacta que se publicó, en el historial del escaparate.
- **Selecciones de comprador:**
  - cada selección formalizada guarda **la versión y los precios vigentes al formalizarla**;
  - el PDF del comprador lleva impresa la versión («Residencial X · v2 · 21/07/2026»).
  - Aunque exista la v3, la selección sigue asociada a la v2.
- **Nada formalizado se modifica retroactivamente.** Una corrección siempre es un registro nuevo que remite al anterior.
- **Precios que cambian:** afectan solo a selecciones futuras. Los packs ya formalizados conservan su precio.

---

## 16. Validación de planos por la promotora

**Flujo:**

1. Tú das el OK a la preview.
2. Los planos comerciales de cada tipología pasan a **«Pendiente de validación»** en el portal.
3. Una persona con **rol de aprobador** de la promotora los revisa en el portal (visor del PDF) y pulsa:
   - **«Apruebo»**, con una casilla de confirmación del tipo «He revisado superficies, cotas y distribución»;
   - o **«Rechazo»**, con un **comentario obligatorio** que explique qué está mal.

**Qué se registra:**
- plano y tipología;
- **huella digital del archivo exacto aprobado**;
- versión;
- persona;
- fecha y hora;
- decisión y comentario.

El registro no se puede modificar después.

**Quién puede aprobar:** solo los usuarios marcados como aprobadores al dar de alta la promotora (por ejemplo, la dirección técnica). Se gestiona con la receta 14.

**Si se rechaza:**
- la promoción vuelve a «En producción»;
- recibes el aviso y Claude incorpora el comentario (recetas 4 o 2, según el caso);
- se genera un **nuevo** plano, con huella nueva, que vuelve a validación.

El rechazado queda en el historial.

**Qué versión queda aprobada:** exactamente el archivo con esa huella. Si cambia **cualquier cosa** del plano después, la aprobación deja de valer y hace falta una nueva. Esto lo comprueba automáticamente la receta de publicar.

**Sin aprobación no hay plano definitivo.** Te propongo una opción: si comercialmente necesitas publicar antes, podría salir con una marca visible «Provisional — pendiente de validación», solo si lo decides expresamente en cada caso. Si prefieres no tener esa opción, no se construye.

---

## 17. Copias de seguridad y recuperación

### Qué se copia y dónde

| Qué | Copia | Dónde | Cuánto se conserva |
|---|---|---|---|
| Base de datos (Supabase) | Copia diaria de Supabase (incluida en Pro) | Supabase | 7 días |
| Base de datos | **Copia diaria propia**, automática | Cloudflare R2 (UE) | 30 diarias + 12 mensuales |
| Archivos de las promotoras | **Copia diaria propia**, automática. Como nunca se borran ni se modifican, solo se copian los nuevos | Cloudflare R2 (UE) | Indefinido (mientras dure el contrato) |
| Taller y escaparate (GitHub) | Historial completo + **copia mensual** de los dos almacenes | GitHub + R2 | Indefinido |
| Ramas y etiquetas | Protegidas contra borrado y reescritura | GitHub | — |

**Importante:** las copias que hace Supabase **no incluyen los archivos**, solo la base de datos. Por eso existe la copia propia de archivos.

### Qué ocurre si…

| Situación | Qué pasa | Cómo se recupera | Tiempo |
|---|---|---|---|
| Alguien «borra» un archivo | Desde la aplicación no se puede borrar. Solo la propietaria podría hacerlo en el panel de Supabase | Desde la copia en R2 | < 1 h |
| Alguien modifica datos por error | Los documentos y validaciones solo admiten añadir. Los cambios de estado quedan en el registro | Se revierte desde el registro | Minutos |
| Error grave en la base de datos | — | Restaurar la copia en un proyecto aparte y recuperar solo lo afectado | 1–3 h |
| Supabase falla (caída temporal) | **Las webs públicas siguen funcionando.** El portal no está disponible | Esperar a que vuelva | — |
| Supabase falla (pérdida total, muy improbable) | — | Proyecto nuevo, estructura desde el taller, datos y archivos desde R2. Pérdida máxima de 24 h de datos | 2–4 h |
| Cloudflare falla | Las webs no se ven mientras dure | Esperar o, si se alarga, publicar el escaparate en otro alojamiento estático (son solo archivos) | 1–2 h |
| Se elimina una rama | No se puede: las ramas principales están protegidas | Si ocurriera, cualquier copia contiene el historial | Minutos |
| Publicación incorrecta | — | Receta 11 | 2–5 min |

**Peor caso, una promoción completa desde cero:** medio día. **Caso habitual** (publicación errónea): minutos.

**Simulacro trimestral:** se restaura la copia en un proyecto de pruebas y se comprueba que todo cuadra (receta 18).

---

## 18. Costes

### Supuestos

- Documentación por promoción: ~1–2 GB al inicio (los proyectos de ejecución escaneados pesan), más ~0,5 GB/año de actualizaciones, más ~0,2–0,4 GB de entregables conservados.
- Web de una promoción: ~5–15 MB por visita. Va por Cloudflare, sin facturación por tráfico estático.
- Portal: unas decenas de usuarios.
- Todas las promotoras comparten **un único proyecto** de Supabase (multiempresa), así que no hay coste por promoción ni por promotora.

### Costes fijos

| Concepto | Coste |
|---|---|
| Claude | Tu plan actual. No cambia con la arquitectura; el límite es de **capacidad de uso**, no de factura |
| Supabase Pro (proyecto de producción) | 25 $/mes |
| Supabase (proyecto de pruebas) | 0 (plan gratuito, en otra organización) |
| Cloudflare (webs, portal, DNS) | 0 |
| GitHub (organización, almacenes privados, 2.000 min de automatizaciones) | 0 |
| Dominio | ~10–15 €/año |
| Envío de emails | 0 (SMTP propio o plan gratuito) |
| Correo profesional (opcional) | 0–7 €/mes |

### Costes variables (solo si se superan las cuotas)

| Concepto | Incluido | Precio al superarlo |
|---|---|---|
| Almacenamiento de archivos (Supabase) | 100 GB | ~0,021 $/GB/mes |
| Base de datos (Supabase) | 8 GB (usaremos < 1 GB) | ~0,125 $/GB/mes |
| Transferencia desde Supabase (descargas del portal) | 250 GB/mes | ~0,09 $/GB |
| Transferencia de las webs (Cloudflare) | Sin facturación para archivos estáticos | — |
| Copias en R2 | 10 GB gratis | ~0,015 $/GB/mes, sin coste por descarga |
| Automatizaciones (GitHub) | 2.000 min/mes | ~0,006 $/min |
| Emails | Según proveedor: unos cientos al día gratis | Plan de pago solo con volúmenes muy superiores |
| Render premium con GPU (fase 3, opcional) | — | ~0,34–0,69 $/h de GPU |

### ¿Añadir una promoción aumenta algún coste?

- **Solo almacenamiento:** ~1,5–3 GB más.
- Hasta ~50 promociones cabe en los 100 GB incluidos. A partir de ahí, unos **0,03–0,06 $/mes por promoción**, más una cantidad similar por su copia.
- **No** hay coste por promoción en Cloudflare, GitHub ni en el número de usuarios.
- **Lo que sí crece es el tiempo de producción** (uso de Claude y tu revisión), que es justo lo que las recetas reducen.

### Tabla por escenarios (mensual, aproximada, sin Claude)

| Escenario | Supabase | Cloudflare (webs + R2) | GitHub | Dominio y emails | **Total aprox.** |
|---|---|---|---|---|---|
| Desarrollo | 0 | 0 | 0 | ~1 € | **~1 €** |
| Primer cliente (1 promoción) | 25 $ | 0 | 0 | ~1 € | **~26 $** |
| 5 promociones (~10 GB) | 25 $ | 0 | 0 | ~1 € | **~26 $** |
| 20 promociones (~40 GB) | 25 $ | ~0,5 $ | 0 | ~1 € | **~27 $** |
| 50 promociones (~100 GB) | 25–30 $ | ~1,5 $ | 0–2 $ | ~1–2 € | **~30–40 $** |

**Si se adopta el render premium con GPU:** súmale ~1–3 $ por promoción en cada tanda de renders. Con GitHub Actions es gratis dentro de la cuota.

**Sobre el «coste por visitante»:** en la web pública, el alojamiento de Cloudflare no tiene ningún concepto de facturación ligado a visitas de archivos estáticos. Hay dos matices:
- sus condiciones de uso razonable se aplican igual que a cualquier cliente;
- Cloudflare podría cambiar sus precios en el futuro.

Por eso la web son archivos estándar que podrían moverse a otro alojamiento en una o dos horas.

### Límites: qué pasa si se superan y cómo se controla

| Servicio | Límite relevante | Si se supera | Control |
|---|---|---|---|
| Supabase Pro | 100 GB de archivos, 250 GB de transferencia, 8 GB de base de datos | Con el **tope de gasto** activado (viene así por defecto), en lugar de cobrar se **restringe** el servicio. Sin tope, se cobra el exceso | Informe mensual (receta 19) con aviso al llegar al 70 %. Tú decides si quitar el tope |
| Supabase (archivo individual) | Configurable. En Pro admite archivos muy grandes (el plan gratuito, 50 MB) | Se rechaza la subida con un mensaje claro | Fijaremos un máximo razonable (p. ej. 500 MB) |
| Supabase gratis (pruebas) | Se **pausa** tras una semana sin uso | Solo afecta a las pruebas; se reactiva | Por eso producción va en Pro |
| Cloudflare | 25 MB por archivo, 20.000 archivos por sitio | La publicación falla (no se rompe lo publicado) | La receta 8 lo comprueba antes |
| GitHub | Almacenes recomendados por debajo de 1–5 GB; archivos < 100 MB; 2.000 min | Avisos, y después lentitud. Los minutos extra se cobran | El escaparate se archiva cada año si crece. Los documentos pesados nunca van a Git |
| Email | Según el plan gratuito (cientos al día) | Los emails se retrasan | Volumen real: decenas al mes |
| Claude | Límites de uso de tu plan | Hay que esperar a que se renueve el límite | Lo mecánico va en scripts, sin IA |

---

## 19. Cloudflare frente a Vercel, para este producto

| Aspecto | Cloudflare | Vercel |
|---|---|---|
| Coste | Gratis | Plan gratuito **no permitido** para uso comercial. Pro: 20 $/mes por persona |
| Uso comercial | Permitido en el plan gratuito | Solo en planes de pago |
| Tráfico | Sin facturación para archivos estáticos | Pro: 1 TB/mes incluido, y después se paga. Con 5–15 MB por visita, 1 TB son unas 70.000–200.000 visitas al mes |
| Previews | Sí, automáticas por rama | Sí. Su interfaz es algo más cómoda |
| Dominios | Sí. Además, Cloudflare puede ser tu DNS y tu registrador | Sí |
| Despliegue desde GitHub | Sí | Sí |
| Múltiples promociones | Sí, en un solo sitio (escaparate) | Igual |
| Archivos 3D y texturas | Hasta 25 MB por archivo, sin coste de tráfico | Sin problema técnico, pero consumen la cuota de transferencia |
| Mantenimiento | Bajo | Bajo |
| Integración futura | R2 (copias, archivos grandes), email, DNS y protección en la misma cuenta | Excelente para aplicaciones Next.js, que no usamos |
| Dependencia del proveedor | Baja: son archivos estáticos | Baja: igual |

**Conclusión: Cloudflare es claramente mejor para este producto.** Es gratis con uso comercial, no tiene coste por tráfico (lo que más pesa en una web 3D) y reúne copias, DNS y dominio en la misma cuenta.

**Matiz técnico:** Cloudflare recomienda hoy **Workers con archivos estáticos** para proyectos nuevos. Pages sigue funcionando, pero ya no recibe novedades. Para ti es indiferente (mismo precio, mismo resultado); en la fase 0 usaría Workers.

---

## 20. Legal y privacidad (obligaciones técnicas, no asesoramiento jurídico)

**Tu papel:** al custodiar contactos, CIF, IBAN y documentación de proyecto de las promotoras, pasas a ser **encargada del tratamiento** de los datos personales que contengan (contactos). El resto es información confidencial de empresa.

| Obligación | Cómo se cubre |
|---|---|
| Región UE | Supabase en región UE (p. ej. Fráncfort). Copias R2 con ubicación UE. Las webs públicas solo contienen información pública |
| Contrato con proveedores (DPA) | Supabase y Cloudflare ofrecen acuerdo de tratamiento de datos estándar: se acepta en sus paneles |
| Contrato con la promotora | Un **contrato de encargo de tratamiento** (art. 28 RGPD) junto al contrato comercial, más una **cláusula de confidencialidad** sobre la documentación de proyecto. Conviene que lo revise un asesor |
| Permisos | Menor privilegio (apartados 7 y 8) |
| Registro de accesos | Registro de acciones en Supabase: subidas, descargas de documentos confidenciales, aprobaciones, cambios de estado, altas y bajas de accesos. Recomendable y sencillo |
| Política de conservación | Durante el contrato, y después el plazo que se acuerde (p. ej. el de garantías o reclamaciones). Al terminar: exportación a la promotora y borrado certificado (receta 15) |
| Eliminación de datos | Receta 15. También para solicitudes de supresión de una persona concreta |
| Exportación | Receta 20: un paquete con todos los documentos y datos de la promoción |
| Seguridad | Verificación en dos pasos, cifrado en tránsito y en reposo (lo dan los proveedores), copias, pruebas de aislamiento |
| Git sin datos personales | Regla: en el taller no hay contactos ni emails, solo datos de empresa necesarios para el producto |
| Webs públicas | Sin cookies de seguimiento ni analítica invasiva, así que no hace falta banner de cookies. Aviso legal y de privacidad sencillos |

### Compradores: no almacenamos sus datos

- El comprador genera su PDF en su propio navegador, lo firma y lo envía **directamente al comercial de la promotora** con el justificante.
- **Nosotros no recibimos ni guardamos** nombre, DNI ni justificantes.
- La receta 12 registra solo: vivienda, opciones, versión, precios y fecha. Sin datos personales.
- Si algún día se quisiera recibir los PDF firmados en el portal, eso sí implicaría datos personales y se diseñaría aparte.

---

## 21. Fases (orden revisado)

He hecho cuatro cambios respecto a la propuesta anterior:

- copias de seguridad, panel de administración mínimo y email al **principio** (fase 1), antes de que haya datos reales;
- un **ensayo general** obligatorio antes del primer cliente;
- las texturas libres pasan a la fase 3 junto con el render premium, porque mejoran también el visor;
- la fase 3 puede adelantarse si comercialmente necesitas renders premium para vender.

### Fase 0 · Cimientos

- **Contenido:**
  - Tú creas las cuentas, guiada, en 1–2 horas.
  - El taller pasa a ser multipromoción (`promociones/<nombre>/`).
  - El Studio sale de la web pública.
  - Versiones con producto maestro fijado.
  - Almacén escaparate y Cloudflare.
  - Recetas 8 (solo validación técnica), 9, 10 y 11.
  - Protección de ramas y etiquetas, y protección contra secretos.
  - Primer borrador del manual.
- **Criterio para darla por terminada:** la promoción de demostración publicada en su dirección estable de Cloudflare, con preview, publicación y vuelta atrás probadas delante de ti.

### Fase 1 · Portal seguro

- **Contenido:**
  - Supabase de producción (UE, Pro) y de pruebas (gratis).
  - Estructura y reglas en el taller, envío de emails, pantallas del portal y panel de administración mínimo.
  - Registro de acciones.
  - Email inmediato de subida.
  - **Copias en R2 y primer simulacro.**
  - **Prueba de aislamiento automática.**
  - Recetas 1, 2, 13, 14 y 18.
- **Criterio para darla por terminada:**
  - prueba de aislamiento en verde;
  - simulacro de recuperación correcto;
  - una promotora ficticia completa el onboarding de principio a fin.

### Fase 2 · Producción por recetas y ensayo general

- **Contenido:**
  - Recetas 3–7, 12 y 16.
  - **Ensayo general** con documentación realista: alta → documentación → v1 → validación de planos → publicación → plano nuevo → v2 → vuelta atrás.
  - Medición de tiempos.
- **Criterio para darla por terminada:** el ensayo completo sin intervenciones técnicas tuyas. **Listo para el primer cliente.**

### Fase 3 · Realismo

- **Contenido:**
  - Biblioteca de texturas y HDRI libres (mejora el visor y el render libre).
  - Traductor de materiales.
  - **Prueba piloto de tres opciones** (actual, Blender/Cycles y path tracing).
  - Decisión con los resultados.
  - Si compensa: automatización (receta 7 premium) y, más tarde, petición desde el portal.
- **Criterio para darla por terminada:** tu decisión, tomada sobre imágenes reales y costes medidos.

### Fase 4 · Módulos opcionales

Según demanda de clientes:
- firma electrónica avanzada (de pago por uso, a valorar);
- pago con tarjeta (comisión por operación, a valorar);
- catálogo comercial en PDF;
- panel de administración ampliado;
- recetas 15, 17, 19 y 20 si no han llegado antes.

---

## 22. Estructuras exactas

### GitHub · Taller (`<tu-organizacion>/taller`, privado)

```
taller/
  README.md                    qué es el producto (2 páginas)
  docs/
    arquitectura.md            este documento, al día
    operaciones.md             todas las recetas en lenguaje normal
    recuperacion.md            qué hacer ante cada incidente
    decisiones.md              por qué se decidió cada cosa
  motor/                       producto maestro: visor 3D, plano comercial, packs, PDFs
  studio/                      herramienta interna (NUNCA se publica)
  portal/                      web del Portal Promotora y panel de administración
  biblioteca/
    materiales/                catálogo de materiales (+ traducción para Blender en fase 3)
    mobiliario/                mobiliario procedural
    texturas/                  texturas libres, versión web
    licencias.md               origen y licencia de cada recurso externo
  plantillas/
    promocion/                 carpeta modelo para una promoción nueva
    checklist.json             checklist de onboarding (6 bloques)
    textos-legales/
  promociones/
    residencial-x/             (ver estructura abajo)
  .claude/skills/              las recetas (una carpeta por receta)
  herramientas/                scripts: construir, publicar, revisar, exportar, copias
  supabase/
    estructura/                tablas y reglas de seguridad, como archivos
    pruebas/aislamiento        la prueba automática entre promotoras
  .github/workflows/           automatizaciones: copias diarias, prueba de aislamiento,
                               escena de referencia y (fase 3) render premium
```

### GitHub · Escaparate (`<tu-organizacion>/escaparate`, privado; lo lee Cloudflare)

```
escaparate/
  residencial-x/               la web construida de la versión publicada
  residencial-y/
  portal/                      la web del portal (sin datos)
  LEEME.md                     «lo que hay aquí es exactamente lo publicado»
```

### Carpeta de una promoción

```
promociones/residencial-x/
  promocion.json          identidad, marca, packs, precios, pagos, textos legales
  publicacion.json        versión publicada y versión del producto maestro que usa
  fuentes.json            qué documentos (id, versión, huella) se usaron para cada dato
  diario.md               registro de cada receta ejecutada
  marca/                  logo.svg, colores, favicon, fuente web (si su licencia lo permite)
  tipologias/<id>/
    vivienda.json         geometría
    variantes.json        distribuciones alternativas
    tipologia.json        cámaras, orientación, revisión
    ambientacion.json     mobiliario y decoración
  versiones/
    v1/version.json       ficha de la versión (fecha, documentos, cambios, estado,
                          aprobación, planos validados, precios, packs)
    v1/cambios.md
    v2/…
  compradores/
    selecciones.json      selecciones formalizadas (vivienda, opciones, versión,
                          precios, fecha). SIN datos personales
```

### Supabase, estructura mínima

**Fichas (tablas):**

| Tabla | Qué guarda |
|---|---|
| `promotoras` | Nombre, CIF, datos fiscales y de pago, contacto principal |
| `miembros` | Qué persona pertenece a qué promotora y con qué rol (gestor o aprobador) |
| `administracion` | Tú, el robot de producción y el robot lector |
| `promociones` | Nombre, promotora, estado visible, activa sí/no, dirección pública, versión publicada |
| `requisitos` | El checklist de cada promoción: bloque, elemento, archivo o dato, obligatorio |
| `documentos` | Cada versión de cada archivo subido: nombre, tipo, versión, reemplaza a, huella, estado, quién, cuándo. **Solo se añaden filas** |
| `datos` | Los datos estructurados del checklist (CIF, IBAN, colores…), también con historial |
| `versiones` | Resumen de cada versión publicada, para que la promotora la vea |
| `validaciones` | Aprobaciones y rechazos de planos, con huella. **Solo se añaden filas** |
| `entregables` | Planos, renders y PDF conservados, por versión |
| `solicitudes` | *(fase 3)* peticiones de render premium |
| `registro` | Registro de acciones: quién, qué, cuándo |

**Almacenes de archivos (buckets), todos privados:**

| Bucket | Qué contiene |
|---|---|
| `documentos` | Organizado por promotora / promoción / bloque / elemento / versión |
| `entregables` | Organizado por promoción / versión |
| `temporales` | Renders premium bajo demanda. Se vacía a los 7 días |
| `biblioteca` | *(fase 3)* texturas de alta resolución |

### Qué se publica en Cloudflare y qué queda solo en el Studio

| Publicado (Cloudflare) | Solo en el Studio o en producción |
|---|---|
| Web pública de cada promoción: visita 3D, plano estándar en PDF, configurador del comprador, PDF de pack | Edición de geometría, cámaras, materiales y decoración |
| Render libre y plano con selector (perfil promotora) | Revisión de impacto, comparación de versiones |
| Web del portal (sin datos; los datos vienen de Supabase con login) | Interiorismo con IA, biblioteca, exportación |
| — | Recetas, scripts, credenciales, documentos originales |

---

## 23. Riesgos y cómo se mitigan

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | Un error en las reglas de seguridad mezcla datos de promotoras | Prueba de aislamiento automática obligatoria en cada cambio |
| 2 | Traducción de planos inexacta (con consecuencias legales en superficies) | Comparación con el cuadro oficial, validación formal de la promotora y aviso legal en el plano |
| 3 | Fuga de la credencial del robot | Menor privilegio, sin borrado, registro de acciones, rotación anual, revocación inmediata |
| 4 | Límites de uso de Claude en picos de trabajo | Lo mecánico va en scripts. Las operaciones críticas (publicar, volver atrás, accesos) funcionan sin Claude |
| 5 | Dependencia de una sola persona (tú) para los accesos | Segundo administrador de emergencia y códigos de recuperación guardados |
| 6 | Supabase restringe el servicio al superar la cuota (tope de gasto) | Informe mensual con aviso al 70 % |
| 7 | Email de acceso que no llega (spam o límite) | SMTP propio del dominio, configurado correctamente para no caer en spam |
| 8 | Cambios de precios o condiciones de proveedores | Todo es estándar y trasladable: archivos estáticos, Postgres, archivos normales |
| 9 | El escaparate crece mucho con los años | Archivado anual de versiones antiguas (siguen en el taller) |
| 10 | Licencias de fuentes de marca sin permiso web | Comprobación en la receta de marca y alternativa libre |
| 11 | Rendimiento en móviles modestos | Pruebas en móvil en la receta 8 y niveles de calidad automáticos |
| 12 | El render premium no compensa | Prueba piloto con criterio de adopción previo; no se adopta sin evidencia |
| 13 | Mejoras del producto maestro que cambian promociones publicadas sin querer | Cada versión fija el producto maestro. Las mejoras solo llegan con la receta 17 |
| 14 | Cloudflare Pages deja de evolucionar | Usar Workers con archivos estáticos desde el inicio |

---

## 24. ¿Hay tareas técnicas para ti? (respuesta honesta)

**Una sola vez, guiada paso a paso:**

1. Crear las cuentas (apartado 6), activar la verificación en dos pasos y guardar los códigos de recuperación.
2. Conectar GitHub con Cloudflare (dos clics de autorización).
3. Introducir la credencial del robot en los ajustes del entorno de Claude Code. Te digo exactamente dónde; nunca se pega en el chat.
4. Aceptar los acuerdos de tratamiento de datos (DPA) en Supabase y Cloudflare.
5. Configurar el envío de emails del dominio. Son unos datos que se copian en Supabase; te los preparo.

**Ocasionales, guiadas:**

- Rotar la credencial del robot, una vez al año (5 minutos).
- Si una promotora quiere su **propio dominio** para la web, su informático añade un registro DNS, o lo haces tú con instrucciones exactas. Por defecto no hace falta: la web vive en tu dominio y la promotora la enlaza desde la suya.
- Dar de baja a un desarrollador, si algún día lo hay.

**Habituales (por diseño, y no son técnicas):**

- Revisar previews y decir «publica».
- Decidir en los puntos de control de las recetas.
- Leer el informe mensual.

**No tendrás que:** usar Git, la terminal, Blender, el panel de Supabase ni el de Cloudflare en el día a día.

**Un punto que te señalo:** las recetas se piden en una sesión de Claude Code conectada al taller, que es lo que usas ahora. No requiere nada técnico por tu parte, pero sí que sea Claude Code (o Cowork con el taller conectado) y no un chat normal sin acceso al repositorio.

---

## 25. Decisiones que necesito para aprobar

1. **Arquitectura:** ¿apruebas GitHub (taller + escaparate) + Cloudflare (Workers) + Supabase (UE, Pro) + Claude Code como producción?
2. **Credencial del robot:** ¿aceptas la cuenta robot con permisos mínimos, guardada como secreto del entorno, más el conector oficial de Supabase solo durante la construcción?
3. **Email:** ¿tienes ya correo profesional en un dominio (para usar su SMTP) o usamos un servicio gratuito?
4. **Aviso inmediato por email de cada subida:** ¿sí? (Recomendado: reduce la dependencia de Claude.)
5. **Planos provisionales:** ¿quieres la opción de publicar con marca «Provisional — pendiente de validación», o nunca sin aprobación?
6. **Regla «solo procedural»:** confirmas que las **texturas** CC0 sí se permiten y los **modelos 3D** de terceros no.
7. **Orden de fases:** ¿mantenemos el orden propuesto o adelantamos la prueba piloto de render premium por necesidad comercial?

Con tu aprobación empezaría la **fase 0**, y lo primero sería guiarte en la creación de las cuentas.

---

## Fuentes de precios y límites (consultadas el 5/10/2026)

- Supabase: [MakerKit – Supabase pricing 2026](https://makerkit.dev/blog/saas/supabase-pricing) · [JetAdmin – Supabase pricing guide 2026](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/) · [Supabase pricing](https://supabase.com/pricing) · [Las copias de Supabase no incluyen archivos (SimpleBackups)](https://simplebackups.com/blog/what-supabase-native-backup-doesnt-cover) · [DEV – Supabase backups don't include storage files](https://dev.to/superlede/supabase-backups-dont-include-your-storage-files-heres-what-does-14e9)
- Conector oficial de Supabase (solo lectura, limitado a un proyecto): [Supabase MCP guide](https://www.gamut.so/blog/supabase-mcp-guide)
- Cloudflare: [Límites de Pages](https://developers.cloudflare.com/pages/platform/limits) · [Migrar de Pages a Workers](https://developers.cloudflare.com/workers/static-assets/migrate-from-pages/) · [Pages vs Workers 2026](https://www.morphllm.com/comparisons/cloudflare-pages-vs-workers) · [Precios de R2 (Filebase)](https://filebase.com/blog/cloudflare-r2-pricing-costs-savings-and-alternatives-in-2026/)
- Vercel: [MakerKit – Vercel cost 2026](https://makerkit.dev/blog/saas/vercel-cost) · [Schematic – Vercel pricing](https://schematichq.com/blog/vercel-pricing)
- GitHub Actions: [Cambios de precios 2026](https://theplatformengineering.substack.com/p/github-actions-2026-pricing-changes) · [IT Brief – GitHub cuts runner prices](https://itbrief.news/story/github-cuts-actions-runner-prices-adds-new-usage-fee)
- GPU de alquiler: [Spheron – RunPod vs Vast.ai 2026](https://www.spheron.network/blog/runpod-vs-vastai-2026/) · [GetDeploying – RTX 4090](https://getdeploying.com/gpus/nvidia-rtx-4090-vs-nvidia-v100)

*Los precios son orientativos y pueden cambiar. Los tiempos de render son estimaciones que confirmará la prueba piloto.*

---

## Decisiones posteriores aprobadas (prevalecen sobre lo anterior)

1. **Panel de administración propio** como centro de control diario. Las recetas son la lógica por debajo. Claude solo interviene en las tareas que requieren criterio, que el Panel lanza a través de una cola de tareas atendida por una tarea programada de Claude.
2. **Brazo ejecutor:** las acciones del Panel que construyen o publican las ejecuta GitHub Actions, con una llave de GitHub limitada a lanzar procesos y guardada solo en el servidor de Supabase.
3. **Clasificación de recetas:** 12 de Panel (1, 8–15, 18–20), 3 de Claude (3–5) y 5 mixtas (2, 6, 7, 16, 17). Recetas añadidas: 21 (aplicar cambios sobre una preview), 22 (importar unidades), 23 (generar entorno) y 24 (regenerar código de unidad).
4. **Sin coste durante el desarrollo:** sin dominio de pago (se usan las URLs gratuitas de Cloudflare) y sin email de pago (un Gmail dedicado envía los avisos). Cualquier coste nuevo se detiene y se consulta antes.
5. **No hay planos «provisionales»:** ningún plano comercial definitivo se publica sin la aprobación de la promotora.
6. **Render premium (Blender):** primero se prueban opciones de coste 0. Nunca se contrata una GPU de pago automáticamente. Su coste queda como desconocido hasta la prueba piloto.
7. **Assets externos gratuitos permitidos** (incluidos modelos 3D) si tienen licencia inequívoca de uso comercial y de redistribución, registrada en `biblioteca/licencias.md`.
8. **Arquitectura 3D híbrida:** la arquitectura se genera desde datos; mobiliario, vegetación y objetos complejos son assets GLB reutilizables de una biblioteca compartida.
9. **Modelo:** Promoción → Tipología → Variante (modificación fija: espejo, bajo, ático…) → Unidad (vivienda concreta). *Alternativa* es la elección del comprador. En plurifamiliares se produce por tipología y variante, no por unidad. No se gestionan disponibilidad ni precio de venta.
10. **Códigos de comprador validados en Supabase** (fase 1): se guarda solo su hash, con límite de intentos, regeneración y revocación. La web pública no contiene códigos. Solo el acceso privado depende de Supabase.
11. **Entorno en tres capas** con su fiabilidad indicada: A precisa (planos), B próxima (Catastro, IGN/PNOA/LiDAR, OpenStreetMap) y C lejana. Google 3D Tiles queda fuera salvo aprobación expresa. Dron y fotografía real son un enriquecimiento opcional, nunca un requisito.
12. **GitHub:** la organización es MUNE-Projects y los almacenes son `taller` (privado) y `escaparate` (privado). La protección de ramas en almacenes privados es de pago (GitHub Team); de momento se sustituye por copias automáticas y por la regla de no reescribir el historial.

## Estado del Panel (Fase 0)

Lo que ya funciona, y dónde vive cada pieza:

| Pieza | Dónde | Notas |
|---|---|---|
| Código del Panel | `panel/` en el taller | TypeScript sin frameworks + `@supabase/supabase-js` |
| Web del Panel | Cloudflare Workers, proyecto `panel` | Solo archivos estáticos. Vista previa por cada propuesta del taller (pestaña «Base de vistas previas»: compilación `npm run build`, directorio `/panel`) |
| Entrada | Supabase Auth (UE, Irlanda) | Correo + contraseña + código del móvil (TOTP). Alta de usuarios cerrada: solo a mano |
| Reglas de datos | `supabase/*.sql` | Todo exige doble verificación (`aal2`) y estar en `administradores` |
| Registro de actividad | Tabla `registro` | Solo añadir; no se edita ni se borra |
| Promotoras y promociones | Tablas `promotoras` y `promociones` | Privadas. En Fase 1, cada promotora verá solo las suyas |
| Versiones | `/<promoción>/version.json` del escaparate | El Panel compara producción y vista previa. No existe lista pública de promociones |

Pendiente: «Pedir cambios» (cola de tareas en Supabase) y «Aprobar y publicar» desde el Panel (brazo ejecutor con permisos limitados, que se presentarán antes de crearlo).
13. **Avisos durante el desarrollo:** el aviso «versión lista para revisar» es una incidencia que abre GitHub Actions (`avisar.yml`). Así GitHub envía el email sin servicio de correo propio. Un email transaccional propio se decidirá en la Fase 1 y se consultará antes si tiene coste.
14. **Sin índice público de promociones:** la lista de promotoras y promociones vive solo en Supabase. El escaparate solo expone el `version.json` de cada promoción.
15. **Peticiones a Claude bajo demanda:** de momento no hay tarea programada. Claude atiende la cola cuando la administradora se lo pide. Las peticiones admiten fotos de referencia, también para el interiorismo («estilo a partir de una foto»).
16. **Direcciones:** subdominio de Cloudflare `mune-projects`. El escaparate conserva el nombre `escaparate`. Las propuestas salen de la rama `revision`, tanto en el taller como en el escaparate.

### Decisiones de la Fase 1 (6/10/2026)

17. **Copias de seguridad en GitHub:** un almacén privado `copias`, con copias cifradas de la base de datos y de los archivos nuevos. Gratis y sin tarjeta. R2 (que pide tarjeta para activarse, aunque no cobre) solo cuando el volumen lo exija; el Panel avisará al acercarse. Los originales también los conservan las promotoras; lo que solo existe aquí es lo que hay que proteger: validaciones con huella, registro, códigos de comprador y personalizaciones.
18. **Supabase gratuito hasta el primer cliente.** Entonces se sube a Pro (25 $/mes, con límite de gasto) el mismo proyecto: misma dirección, datos y claves, sin reconfigurar nada. Motivos: el gratuito se duerme a los 7 días sin uso, no hace copias propias, admite solo 1 GB de archivos y no tiene soporte por email.
19. **Prueba de aislamiento sin segundo proyecto:** se ejecuta en GitHub Actions (`aislamiento.yml`) sobre un Supabase local y vacío, con datos inventados y sin ninguna llave. Sustituye al «proyecto de pruebas» del apartado 8. Como la protección de ramas es de pago, una propuesta con la prueba en rojo simplemente no se aprueba.
20. **Emails del portal:** un Gmail dedicado del negocio (gratis), conectado a Supabase con una «contraseña de aplicación» (solo sirve para enviar correo y se revoca sin tocar la contraseña principal). No se usa el correo personal.
21. **Entrada de las promotoras:** usuario y contraseña, sin código del móvil (se puede añadir más adelante). El Panel sigue exigiendo contraseña + código del móvil.
22. **Acceso del comprador:** desde el botón que ya existe en la web pública («¿Ya eres comprador? Accede para personalizar tu vivienda.»). No hay botón nuevo, y el comprador nunca entra en el portal de la promotora.
23. **Robot de Claude, permisos ampliados (aprobado):** lee los requisitos, los documentos subidos (también los archivos) y los entregables, y marca documentos como vigentes o rechazados, con nota. Sigue sin poder borrar, subir, validar planos, publicar, crear administradores ni ver usuarios. En la receta 2 pregunta antes de marcar.
24. **Recetas corregidas:**
    - **5 · Memoria de calidades:** solo lo que la vivienda lleva de serie (suelos, sanitarios, carpinterías…). Sin packs ni precios.
    - **6 · Personalizaciones y mejoras:** apartado propio en el portal de la promotora. Puede trabajar por **packs** (crear «Pack 1» y, dentro, sus personalizaciones) o **una a una**, sin pack. Cada personalización es un elemento con **varias opciones**; cada opción es **gratuita o con precio** y lleva su **archivo de especificaciones**, y se indica a qué tipologías o viviendas se aplica.
    - **16 · Marca e información:** incluye tres textos legales que rellena la promotora: **planos**, **infografías** y **PDF de personalizaciones y mejoras**.
    - **7 · Entregables, quién descarga qué:** planos comerciales, cualquiera desde la web pública y la promotora desde su portal; PDF de personalizaciones, solo el comprador con código (el suyo); **infografías en alta resolución, solo la promotora** desde su portal, para sus materiales comerciales. La web pública sigue mostrando la visita 3D y sus vistas como ahora.
    - **15 · Cerrar promoción:** se añaden dos tareas previas al primer cliente: **contrato con la promotora** (encargo de tratamiento, confidencialidad y qué pasa al terminar; borrador para que lo revise un asesor) y **modelo de certificado de cierre** (qué se entregó, con huellas, qué se borró y cuándo), que la receta rellena sola.
25. **Fase 1 por etapas**, cada una con su propuesta y su OK: 1 cimientos de datos y prueba de aislamiento; 2 portal de promotoras y accesos (receta 14); 3 documentación (recetas 2 y 13, email de subida); 4 validación de planos; 5 códigos de comprador (receta 24); 6 Inicio y avisos del sistema; 7 copias y simulacro (receta 18); 8 alta de promoción (receta 1) y ensayo con una promotora ficticia.
26. **Función `invitar` (Etapa 2):** para crear las cuentas de las promotoras, la función `invitar` de Supabase usa la clave de servicio que Supabase le da automáticamente. Esa clave no sale de los servidores de Supabase (no está en el Panel, ni en GitHub, ni se copia), y la función solo la usa para crear la cuenta y enviar el email. Antes comprueba que quien llama es la administradora con el código del móvil, y el acceso a la promotora se da con la sesión de la administradora (pasa por las reglas y queda en el registro). Matiza el apartado 7 («nuestro sistema no la usa»).
27. **Portal de promotoras** en `https://portal.mune-projects.workers.dev` (vista previa: `https://revision-portal.mune-projects.workers.dev`): entrada con correo y contraseña (mínimo 10 caracteres), «¿Has olvidado tu contraseña?», documentación con versiones, planos y entregables, y versión publicada. La sesión se cierra tras 1 hora sin actividad.
28. **Equipos por promoción (Etapa 2, 6/10/2026):**
    - Una **promotora** es la marca o el grupo. Agrupa sus promociones, pero estar en ella no da acceso a nada por sí solo.
    - El acceso al portal es **por promoción**: cada promoción tiene su equipo. Opcionalmente, una persona puede tener acceso a **todas las promociones de su promotora**, también a las que se den de alta después.
    - **Sin roles:** todas las personas con acceso pueden hacer lo mismo (subir documentación, aprobar o rechazar planos, descargar planos e infografías y, cuando existan, gestionar los códigos de comprador). Solo se apunta su **cargo**, como texto libre. Sustituye a los roles «gestor» y «aprobador» de los apartados 8 y 16.
    - Cada persona pertenece a **una sola promotora**.
    - **Datos fiscales** (razón social, CIF y domicilio): los de la promotora y los de cada promoción, porque cada proyecto puede ser una sociedad distinta. Los rellena la propia promotora en su portal; en cada promoción hay un botón «Copiar los datos de la promotora». Cualquier persona con acceso puede editar los datos de su promotora y de sus promociones.
    - **Marca (Fase 2, receta 16):** los colores, las tipografías y el logo de la marca son de la promotora y valen para todas sus promociones. Cada promoción tiene su nombre (obligatorio) y su logo (opcional). Todo ello aparecerá en lo que vean los interesados y los compradores.
29. **Ficha de la promoción y lista estándar de documentos (Etapa 2):**
    - **Ficha** (la rellena la promotora en su portal): dirección, código postal, municipio y provincia, referencia catastral (para el entorno desde el Catastro), tipo (plurifamiliar o unifamiliar), número de viviendas, portales y plantas, y fecha prevista de entrega (opcional).
    - **Lista estándar de documentos**, que se aplica sola al crear una promoción y luego se ajusta (quitar o volver a poner, añadir):
      - Planos: situación o emplazamiento; urbanización o implantación; cada tipología, **acotados**; plantas generales (opcional, plurifamiliar); alzados y secciones; garajes y trasteros (opcional); cubiertas (opcional). En PDF y, si lo tienen, en DWG.
      - Viviendas y superficies: tabla de viviendas y tipologías en Excel, con **plantilla para descargar** (`portal/public/plantillas/tabla-viviendas.xlsx`, generada con `herramientas/plantilla_viviendas.py`); cuadro de superficies oficial.
      - Calidades: memoria de calidades vigente.
      - Proyecto: básico o de ejecución (opcional, como referencia).
    - **No se piden** fotografías ni infografías: las infografías las hace MUNE. La personalización y la marca tienen sus propias secciones (Fase 2).
30. **Nombres:** **MUNE** es el nombre del portal y de la plataforma que ven promotoras, interesados y compradores. **MUNE Projects** es la empresa. En los emails y en el portal se usa «MUNE»; «MUNE Projects» solo cuando se habla de la empresa.
31. **Aviso de cada subida (Etapa 3):** las funciones de Supabase no pueden enviar email por SMTP (Gmail bloqueado en sus servidores), así que el aviso lo envía GitHub, como el de «versión lista para revisar»: el portal llama a la función `aviso-subida`, que lanza `aviso-documento.yml` con la llave A; GitHub escribe en el aviso abierto de esa promoción (uno por promoción, las subidas siguientes como comentarios) y te manda el email. Sin cuentas ni llaves nuevas. Cada documento avisa una sola vez (`009_aviso_subida.sql`).
32. **Revisión de documentos:** en el Panel (pestaña *Documentación*) o con Claude (receta 2, `herramientas/documentos.mjs`), siempre con tu OK. Rechazar exige una nota, que la promotora ve en su portal. Recetas escritas en `docs/recetas/`.
33. **Exportar y borrar (recetas 15 y 20):** botón *Exportar todo (ZIP)* en cada promoción y en cada promotora: un ZIP con un LEEME.txt legible, los datos (`datos.json`: ficha, datos fiscales, lista de documentos, equipo, peticiones y actividad) y todos los archivos (documentos con sus versiones, entregables y fotos de las peticiones), comprobando la huella de cada uno. Se recomienda antes de desactivar (desactivar se puede deshacer: el equipo deja de ver al instante). Borrar para siempre: solo la administradora, solo si está desactivada, **después de descargar la exportación** en esa misma pantalla y escribiendo su nombre. Una promotora se borra con todas sus promociones y accesos. Las cuentas de las personas y el registro de actividad se conservan, y el borrado queda anotado (`010_borrar.sql`). Si hay web, no se retira desde el Panel: se pide a Claude.
34. **Validación de planos (Etapa 4):** los planos comerciales los genera el sistema al preparar cada versión (`herramientas/planos.mjs`): en las plurifamiliares, uno por tipología y variante (también el espejo) y por cada distribución alternativa; en las unifamiliares, uno por vivienda. Tras revisar la vista previa, la administradora pulsa *Enviar los planos a la promotora* en el Panel; el equipo los ve en su portal (pestaña *Planos*), los aprueba o pide cambios. **Solo se publica con todos aprobados**, y publica la administradora (o Claude cuando ella lo pide). Si un plano no cambia de una versión a otra (misma huella de datos), su aprobación se conserva. La promotora puede ver la visita 3D de la versión antes de publicarla. Aviso por email de cada validación (`aviso-plano.yml`). `011_planos.sql`, receta en `docs/recetas/09-10-planos-y-publicar.md`.
35. **Avisos por email a la promotora (gratis):** función `avisar-promotora` de Supabase → proceso `aviso-promotora.yml` de GitHub → Gmail de MUNE (contraseña de aplicación en el secreto `AVISOS_GMAIL_CLAVE` del taller). Tres avisos al equipo de la promoción (acceso a ella o a todas): planos para validar (al enviarlos), documento rechazado (con la nota; también si lo marca el robot) y versión publicada. Cada aviso se envía una sola vez (`012_avisos_promotora.sql`). Quien lo pide nunca ve los correos: los busca la función. Coste: ninguno (Gmail ~500 emails/día; minutos gratuitos de GitHub Actions).
36. **Códigos de comprador (Etapa 5, receta 24):** un código por vivienda. Los gestiona la promotora en la pestaña *Compradores* de su portal: todos a la vez con descarga en Excel (.xlsx, generado sin librerías) o uno a uno, con buscador. En el Panel la administradora consulta, y generar o cambiar queda plegado en «Ayudar con un código». El comprador ve en la web el nombre de su vivienda, no la tipología. Solo se guarda su huella y se ve una vez. *Cambiar código* distingue mismo comprador (conserva lo formalizado) y comprador nuevo (empieza de cero; lo anterior queda en el historial). No hay «anular»: si se cancela la venta, se cambia el código para el nuevo comprador. No caducan (hasta que se cambian o se borra la promoción). La web pública los comprueba en Supabase (`entrar_comprador`, con límite de intentos) y ya no contiene códigos ni selecciones; lo formalizado por cada comprador vive en `selecciones_comprador`. `014_codigos_comprador.sql`.
37. **Sin precio de venta ni datos del comprador (10/10/2026):** la plataforma no conoce el precio de las viviendas (cambia durante toda la comercialización y lo lleva la promotora en sus propias herramientas): el comprador solo ve el **total de su personalización**, no «vivienda + personalización». Se quita `precioBase` de los datos, del Studio y de la web. Los códigos **no se asocian a ningún dato personal** (ni nombre, ni DNI, ni email): el comercial sabe a quién da cada código. El nombre y el DNI que el comprador escribe antes de descargar el PDF solo van al PDF y **no se guardan en ningún sitio** (tampoco en su navegador).
38. **Inicio y avisos del sistema (Etapa 6, receta 19):** el Inicio del Panel enseña arriba los avisos del sistema y, debajo, las versiones pendientes según lo que toca (lista para publicar, cambios pedidos, enviar planos, esperando a la promotora), la documentación por revisar y las peticiones abiertas. Avisos: llaves que caducan (a 60 días, «Pronto»; a 30, urgente y por email), espacio del plan gratuito (80 % y 95 %), vigilancia parada, invitaciones sin aceptar (más de 7 días) y accesos sin usar (más de 3 meses). Las fechas de las llaves viven en Supabase (`llaves`) y se actualizan con *Ya la he renovado*. **Vigilancia automática** (`vigilancia.yml`): cada 3 días GitHub llama a `latido()` con la clave pública; mantiene despierto el Supabase gratuito y abre un aviso de GitHub (email) si no responde o si una llave caduca en 30 días o menos. `latido()` solo apunta la hora y devuelve los días que faltan; lo demás, solo la administradora. Coste: ninguno. `015_sistema.sql`.
39. **Marca y nombres de las capas (revisión de marca y producto, 10/10/2026):** MUNE Projects es la empresa; **MUNE** es la plataforma y la marca visible (tagline provisional «The agile visual platform»). Capas: **MUNE Portal** (espacio de trabajo de la promotora), **MUNE Studio** (entorno interno de producción y gestión: el Panel y el Studio, aunque técnicamente sigan separados) y la **experiencia pública de la promoción** (marca blanca para interesados y compradores). «Escaparate» queda como nombre técnico interno y no se muestra. En las pantallas ya se usan estos nombres; las direcciones y los Workers de Cloudflare no cambian todavía (lista en `docs/arquitectura-mune.md`). Identidad verbal: clara, directa, precisa, segura y poco técnica; primero qué obtiene la persona; tú en singular en el Portal, en Studio y con el comprador; «MUNE» para lo que hace la plataforma y «el equipo de MUNE» para las personas; versiones como «v7»; ningún error técnico a la vista (el detalle queda en la consola). **Formalización:** cada promoción tiene un contacto (nombre opcional, email, teléfono opcional) y los datos de la transferencia, que configura la promotora en MUNE Portal (*Ficha y datos*); viven en Supabase (`promociones.formalizacion`, `016_formalizacion.sql`) y solo llegan a la experiencia pública con un código de comprador válido. MUNE no envía el documento: el comprador lo envía a ese contacto. El histórico de packs no cambia. Pendientes de decisión: permisos por capacidad, quitar el acceso profesional y sacar catálogo y precios del contenido público (`docs/arquitectura-mune.md`).
40. **Arquitectura de MUNE cerrada (10/10/2026):** decisiones completas en `docs/arquitectura-mune.md`, que prevalece en lo que trata. MUNE Studio es todo el lado interno (la aplicación de MUNE Studio es su interfaz operativa); MUNE Portal, el espacio de cada empresa cliente; MUNE Experience, la experiencia 3D común, integrada también en el Portal con acceso profesional sin códigos ni límites. Repositorios `studio` y `experience`, Workers `studio`, `portal` y `experience`. Administrador de la promotora y administrador de promoción (alcance dentro de su empresa), capacidades de trabajo (`documentacion`, `planos`, `compradores`, `personalizacion`, `materiales`, `datos`, `marca`), validación obligatoria de planos comerciales y de Experiencia 3D por tipología o variante con aprobadores definidos por la promotora, exportación de personalizaciones formalizadas y datos privados fuera de lo público. Se implementa por pasos (0 a 5), cada uno con su propuesta y el OK de la administradora. Antes del primer cliente, el remitente de los emails debe ser una dirección con dominio propio de MUNE.
41. **Lista maestra, módulos y publicación al aprobar la promotora (12/10/2026):** la lista maestra de pendientes y los principios permanentes están en `docs/arquitectura-mune.md` (apartado 10), que sustituye al orden de pasos anterior. Cada promoción tiene módulos que activa MUNE Studio (Experience pública, Acceso comprador y Personalización, independientes) y un modo de publicación: por defecto se publica sola cuando la promotora valida todo lo que MUNE le envió (el visto bueno de la administradora es *Enviar a validar*); con «Publico yo», publica la administradora. Los avisos a MUNE salen del Gmail de MUNE. Detalle en el apartado 11 de `docs/arquitectura-mune.md` y en `022_modulos_y_documentos.sql`.
42. **Copias de seguridad y simulacro (lista maestra, paso 4; receta 18):** concreta la decisión 17. Cada noche (`copias.yml`) se guarda en el almacén privado `MUNE-Projects/copias`, cifrado con AES-256 y una contraseña que solo tiene la administradora (secreto `COPIAS_CIFRADO`, guardada también fuera de GitHub): los datos de MUNE y los usuarios (con su contraseña cifrada y su código del móvil), leídos con un usuario de la base de datos que **solo puede leer** (`copias`, credencial C), y los archivos nuevos, leídos con una cuenta de MUNE que **solo puede verlos**. Se conservan las copias de la base de datos de los últimos 31 días y la del día 1 de cada mes durante un año; los archivos se copian una vez y su copia se borra 30 días después de borrarse en Supabase. Cada tres meses, el simulacro (`simulacro.yml`) recupera la última copia en un Supabase vacío dentro de GitHub (estructura desde `supabase/0NN_*.sql`, datos y archivos desde la copia, con la huella de cada archivo) y comprueba que está todo. Copias y simulacros se apuntan en Supabase (`copias_hechas`): MUNE Studio los enseña en Sistema y avisa en Inicio; si fallan, llega un email. La llave B también tiene permiso sobre `copias`. La herramienta de recuperación se niega a escribir en el proyecto real. Coste: ninguno. `023_copias.sql`.
43. **Datos privados fuera de la web pública (lista maestra, paso 5a, 22/10/2026):** el catálogo con sus precios, los packs, lo que admite cada tipología y la lista de viviendas dejan de ir dentro de la web pública. Se guardan en Supabase con cada versión (`datos_privados`); los sube «publicacion.mjs preparar» con el robot, que para ello tiene un permiso nuevo y limitado (`guardar_datos_privados`: solo mientras la versión no se ha enviado a validar; queda en el registro). La web pública solo lleva la opción incluida de cada categoría, sin precios, y una vivienda de muestra por unidad (tipología y variante; en unifamiliares, cada vivienda). Sin código se ven la promoción y sus tipologías en 3D, sin opciones, packs ni precios. Con un código válido, `entrar_comprador` devuelve los datos de esa versión y solo de su vivienda. MUNE Studio y el Portal (con «compradores» o «personalización») leen la lista de viviendas con `viviendas_de_promocion`. Los planos comerciales se siguen generando con todos los datos (modo «planos» de la construcción). El acceso profesional con código de la web pública deja de ver precios y opciones; desaparece en el paso 6, cuando el equipo de la promotora lo ve desde el Portal. `024_datos_privados.sql`.
44. **La personalización se guarda: Seleccionada → Cerrada (lista maestra, paso 5b, 22/10/2026):** al descargar el documento de un pack, la elección del comprador queda «Seleccionada» en Supabase (`selecciones_comprador`, con su detalle e importe) y se puede cambiar mientras el periodo del pack esté abierto; cada cambio queda en `selecciones_historial`. Al terminar el periodo pasa sola a «Cerrada» (se comprueba al consultar) y ya no cambia. El importe lo calcula siempre Supabase con los precios de la versión. Nadie escribe directamente en la tabla: solo `guardar_seleccion` (el comprador, con su código y el mismo límite de intentos que la entrada) y `guardar_seleccion_equipo` (el equipo de la promotora con «personalización», en nombre de un comprador que no puede hacerlo solo). **MUNE nunca elige ni cambia una selección**: MUNE Studio solo consulta. Pestaña *Personalización* en el Portal y en MUNE Studio, con estado e importe por vivienda y pack, y el Excel de las cerradas (o de todas). Cada pack va por separado: vale para fases o grupos. Los renders de una vivienda personalizada los saca solo la promotora desde el Portal (paso 6). `025_selecciones.sql`.
45. **Puerta general del comprador (lista maestra, paso 5c, 22/10/2026):** una sola página para todos los compradores, «Accede a tu vivienda» (`experience…/acceso/`, y con el dominio propio, su dirección equivalente). El comprador escribe su código y `buscar_vivienda_comprador` dice de qué promoción es (nada más); la página lo lleva a `…/<promoción>/#<código>`, donde entra como siempre. Cada código es único en todo MUNE (índice único de las huellas activas). Límite propio de la puerta: 10 fallos en 15 minutos desde la misma dirección o 1000 en una hora en total. Con el acceso de compradores apagado, el código no lleva a ningún sitio. La web pública de cada promoción sigue invitando a personalizar con su propio enlace. El mensaje para el comprador del Portal incluye las dos formas de entrar. La página vive en el almacén `experience` (`publico/acceso/index.html`) y se publica aparte de las versiones de las promociones. `026_puerta_comprador.sql`.
46. **3D profesional desde MUNE Portal (lista maestra, paso 6a, 25/10/2026):** el equipo de la promotora abre la Experiencia 3D de su promoción desde el Portal (pestaña *Experiencia 3D*: versión publicada, versión en revisión o cada tipología) sin códigos. El Portal pide a Supabase un **pase** de esa persona y esa promoción (`abrir_experiencia_profesional`) y abre la web en una pestaña nueva con él (`…/<promoción>/#p-<pase>`); la web lo quita de la dirección al entrar y lo cambia por los datos de esa versión (`entrar_profesional`): todas las viviendas (se elige cuál ver arriba), su personalización con precios y lo que ha elegido cada comprador. Cualquiera del equipo con acceso a la promoción saca Render HD y descarga el plano comercial (decidido el 25/10/2026, opción B); **elegir en nombre del comprador** (su selección queda «Seleccionada», como si la hiciera él, y se descarga el mismo PDF) exige «Gestionar personalizaciones» (`guardar_seleccion_profesional`); sin ella, es una vista previa que no se guarda. MUNE nunca elige: desde una cuenta de MUNE también es solo vista previa. El pase vale una jornada (12 horas) y solo para esa pestaña; en Supabase solo queda su huella; deja de valer al momento si la persona pierde el acceso; tiene límite de intentos. Se usa pestaña nueva y no la Experience integrada en el Portal (apartado 3 de `docs/arquitectura-mune.md`) porque da pantalla completa y funciona igual en el móvil; integrarla queda como mejora. **Desaparece de la web pública** el «Acceso profesional» con código de promotora (botón, enlaces `#promotora-…` y su huella); el acceso con código del Studio solo existe en la construcción interna. «Ver como el público» sigue en el Portal. `027_profesional.sql`.
47. **Experience pública: compartir, «Solicitar información» y apagada (lista maestra, paso 6b, 25/10/2026):** en MUNE Portal → *Experiencia 3D*, con la Experience pública activa y una versión publicada, **un enlace y un código de inserción por tipología** (y variante; en una unifamiliar, por vivienda): «Copiar enlace» y «Copiar código de inserción» (un `iframe` que vale en cualquier web, sin lista de dominios; siempre enseña la última versión publicada). La promotora pone cada uno junto a su tipología en su web. En *Ficha y datos*, el equipo con «datos» pone el enlace de **«Solicitar información»** (su web, un formulario o un email; solo `https://` o email), que la web pública enseña como botón al momento, sin preparar versión. La web pública pregunta al abrirse a Supabase (`experiencia_publica`, sin dar ninguna lista) si su Experience pública está activa, si tiene acceso de compradores y ese enlace; **no hace esperar a la visita** y, si Supabase no responde, la visita sigue igual (la web pública no depende de Supabase para funcionar). **Apagada:** la dirección pública enseña «Esta experiencia no está disponible ahora» y, si el acceso de compradores está activo, «Entrar con mi código»; los compradores con código y el equipo de la promotora (modo profesional) siguen entrando; en la vista previa solo sale un aviso. Es un apagado comercial, no de seguridad: la web pública ya no lleva datos privados (decisión 43). Sin acceso de compradores, desaparece la invitación «¿Ya eres comprador?». **Visor con alcance:** quien entra por el enlace de una tipología solo ve esa tipología: la web pública no tiene ningún selector para pasar a otras (solo el equipo de la promotora, en modo profesional, elige vivienda). Como mucho podrá ver también la promoción completa (urbanización, zonas comunes), cuando exista con el entorno, y volver a su tipología; nunca otras tipologías. Como la web pública es estática, alguien que cambie a mano la dirección podría abrir otra tipología pública; no lleva datos privados. `028_experiencia_publica.sql`.
48. **Cada promoción se interpreta desde su documentación (ensayo del paso 7, 26/10/2026):** el ensayo con una promoción ficticia («Residencial Las Encinas»: dos tipologías, documentación sintética con una contradicción a propósito, dos versiones, validación, publicación, compradores y los tres contextos, en una copia local) funcionó de principio a fin, pero mostró que el 3D y los planos daban por hechas cosas de la demo. Regla permanente: **Claude interpreta los planos y la memoria de calidades de cada promoción y todo se hace a su medida; nada queda atado a lo que se hizo para la demo**. Si algo del proyecto aún no se puede representar, MUNE lo avisa en vez de aproximarlo en silencio. Se generaliza por partes (huecos de todo tipo; alturas, techos y dúplex; exteriores; acabados desde la memoria y equipamiento; receta 1 «Interpretar la documentación»), cada una con su propuesta y probada con promociones de ensayo distintas. **Huecos de todo tipo (26/10/2026):** puerta de entrada; puertas interiores abatibles de una o dos hojas, correderas vistas y correderas empotradas; pasos sin puerta; puertas-ventana (balconeras) y ventanas con antepecho, en cualquier fachada, con apertura abatible, oscilobatiente, corredera, fija o proyectante, de 1 a 4 hojas, con o sin persiana y con sus propias alturas. El plano comercial y las líneas de planta de la visita dibujan cada tipo con su símbolo (`src/modelo/simbolos.ts`), la leyenda del plano solo enseña lo que hay y la comprobación automática avisa de lo que la visita aún no sabe representar. **Alturas y techos (26/10/2026):** cada estancia puede tener su propio techo: falso techo más bajo (baños, pasillos) o techo inclinado (áticos, bajo cubierta: de una altura a otra, subiendo hacia un lado). Techos, focos, armarios hasta el techo y decoración siguen la altura de cada punto; el plano comercial marca con punto y raya la línea de 1,50 m de altura libre; la comprobación automática avisa si un dintel queda por encima de un falso techo o si un techo supera la altura general. **Viviendas en varias plantas (26/10/2026):** dúplex, unifamiliares, viviendas con sótano y viviendas con altillo se describen por plantas, de abajo arriba (cada una con su nombre y su cota respecto a la planta de calle, que tiene cota 0; un sótano tiene cota negativa); los muros de cada planta suben hasta el suelo de la de encima, sin hueco entre plantas; muros, estancias y equipamiento dicen a qué planta pertenecen y la escalera sube de una a otra (con su peldañeado, pasamanos y el hueco abierto en el techo de abajo, con su barandilla arriba). La visita enseña un selector de planta (solo si hay más de una): en el plano se ve la planta elegida; en 3D, esa y las de debajo, como una maqueta que se levanta, y desde dentro se ven también las de encima por el hueco de la escalera. El plano comercial tiene una hoja por planta, con la superficie útil de cada planta y la de toda la vivienda. En un sótano, el terreno de alrededor se aparta para verlo. **Garaje:** estancia de uso «garaje» (suelo de hormigón), que no cuenta en la superficie útil de la vivienda: el plano comercial y la ficha la dan aparte; puerta de garaje seccional y plaza de aparcamiento (líneas pintadas en 3D; en el plano, con un coche orientativo). La comprobación automática avisa si falta la escalera de una planta, si su hueco queda bajo una estancia de arriba, si las plantas no van de abajo arriba o si una puerta de garaje no tiene altura (se supone 2,20 m). **Exteriores (26/10/2026):** terrazas, balcones, porches, jardines, patios y rampas en cualquier fachada y en cualquier planta, con tantas barandillas como haga falta y de cuatro tipos (vidrio con perfilería, barrotes metálicos, peto de obra o peto bajo con vidrio). Un exterior puede estar cubierto (porche, terraza bajo forjado: techo, canto del forjado y su proyección discontinua en el plano); los balcones en alto llevan su losa; el jardín tiene suelo de césped y su propio color en el plano; la rampa de garaje baja desde la calle hasta el sótano con su pendiente, abre su hueco en el terreno y en el plano va con su flecha y en el apartado del garaje. El césped de las zonas comunes, el seto y los árboles se colocan hacia el lado de la vivienda donde están sus exteriores, y el sol y el entorno se centran en cada vivienda (nada queda en las coordenadas de la demo). La ficha nombra los exteriores que tiene cada vivienda. En la visita, con la cámara a pie (dentro, en el jardín, en la rampa) se ve la casa entera; desde encima del tejado, la maqueta se levanta hasta la planta elegida. La comprobación automática avisa si un exterior en alto no tiene barandilla o si una barandilla es de un tipo que la visita no sabe representar, e informa de la pendiente de cada rampa. **Acabados de serie desde la memoria (26/10/2026):** cada promoción lleva en `promocion.json` → `acabados` lo que dice su memoria de calidades: fachada (color y textura lisa o de ladrillo cara vista, con su junta), paredes, techos, carpintería exterior (perfiles de ventanas y barandillas), puertas interiores (color y número de ranuras; 0 = lisa), suelos y alicatados, rodapié y grifería. **Suelos y alicatados no son solo un color** (pedido por la administradora el 27/10/2026): porcelánico general, de cocina, cerámico, exterior, suelo de los baños, alicatado y tarima llevan su especificación completa (`src/modelo/revestimientos.ts`): formato (`baldosa`, `lama` o `continuo`), medidas en cm (`[60, 120]`), colocación (`recto`, `trabado` con su `desfase`, `aleatorio` o `espiga`), aspecto (`liso`, `piedra`, `marmol`, `cemento`, `madera`, `terrazo`), junta (mm y color) y brillo (`pulido`, `brillo`, `satinado`, `mate`, `antideslizante`); en los baños y la tarima el color sale de la opción del catálogo y el resto de la memoria. Si un dato está mal escrito, «preparar» se detiene y dice cuál. Lo que la memoria no dice toma el valor de siempre y **se avisa** (pedido por la administradora el 26 y el 27/10/2026): «preparar» lo enumera, va en `experiencia/experiencia.json` de la versión (`supuestos`) y lo ven MUNE Studio, en el bloque de validación, y la promotora **por email** («Experiencia 3D para validar», función `avisar-promotora`) y al validar la Experiencia 3D en MUNE Portal, con este mensaje: falta información en la memoria de calidades para que la Experiencia 3D y los renders salgan como serán; súbela en Documentación; si no dispones de ella, se usará lo de por defecto (y la lista). Solo se pide lo que la promoción usa. Las personalizaciones del comprador (suelo de madera, cocina, encimera, baños) siguen en el catálogo y no forman parte de este aviso. **Choques en la distribución (27/10/2026):** «preparar» se detiene si, en alguna tipología o alternativa, dos muebles o equipos ocupan el mismo sitio (salvo las sillas bajo la mesa), uno atraviesa un muro, una puerta abatible choca con un mueble al abrirse o la placa, el fregadero o el lavavajillas quedan fuera de su encimera (`src/modelo/choques.ts`; también en la revisión de MUNE Studio). La placa y el fregadero se colocan bien en encimeras contra cualquier pared (antes solo contra las paredes este y oeste, como en la demo). **Más equipamiento (26/10/2026):** isla y península de cocina (con placa o fregadero), bañera exenta, bidé y secadora, en 3D y en el plano comercial; la comprobación automática da error si un equipamiento es de un tipo que la visita aún no sabe representar (`src/modelo/equipamiento.ts`). Las paredes que quedan dentro de la casa aunque su planta no tenga estancia ahí (hueco de escalera, dobles alturas) se pintan como interior, no como fachada. **Superficies:** «preparar» no prepara una versión si la suma de las estancias de una tipología (la que enseñan la ficha de la web y el plano comercial) se aparta más de 0,5 m² de su superficie útil oficial; se aclara antes con la promotora qué dato es el bueno. **Receta 1 «Interpretar la documentación» (27/10/2026):** `docs/recetas/01-interpretar-documentacion.md` es la lista con la que se pasan a datos los planos y la memoria de cada promoción, siempre igual y sin depender de nadie: qué documentos hacen falta (también el plano de urbanización y las plantas generales, para hacer la promoción completa, pedido por la administradora el 27/10/2026), el `origen` de cada dato (`plano`, `memoria`, `tabla`, `usuario` o `supuesto`), los apartados A a H (promoción y viviendas; promoción completa desde el plano de urbanización y las plantas generales; tipología, escala y norte; muros y huecos; plantas, alturas y techos; estancias, exteriores y equipamiento; acabados de la memoria; catálogo) y qué hacer con lo que no cuadra. La orden `node herramientas/publicacion.mjs comprobar <id>` hace las mismas comprobaciones que «preparar» (superficies, choques, acabados y lo que la visita aún no sabe representar) sin crear versión, y deja los planos de prueba en `salida/comprobar/<id>/`. El alta de la promoción (lo que antes se llamaba receta 1 en el apartado 4.A) se hace con el alta guiada de MUNE Studio.
49. **Producto: alcance antes del primer cliente (26/10/2026, al preparar el documento del plan de negocio):**
    - **Renders con calidad de fotografía, obligatorios antes del primer cliente:** salen del propio 3D, que tiene que ser mucho más realista (texturas y cielos reales, mobiliario y objetos detallados); el equipo de la promotora los descarga bajo demanda y sin límite (por ejemplo, 26 de una vez). El motor y dónde se calculan, por decidir; nunca se contrata una tarjeta gráfica de pago sin su aprobación.
    - **También antes del primer cliente** (antes, «Fase 2» o «más adelante»): la promotora gestiona desde el Portal su catálogo, opciones, precios, restricciones, packs o fases y su marca; comparar versiones; comentarios visuales sobre el 3D y los planos; descarga por lotes; entorno real de la parcela; «Solicitar información» conectado con la promotora (llevar al formulario de su web o insertar el de su CRM: forma por definir; MUNE no guarda los datos del interesado) y renders de una vivienda personalizada.
    - **Después del primer cliente:** analítica de uso.
    - **Se mantiene:** la Experiencia 3D profesional se abre en una pestaña nueva desde el Portal (no dentro de la página).
    - **Investigar:** si Claude puede leer bien BIM, IFC y DWG.
    - **Descartado:** dron e imágenes reales del solar, realidad virtual con gafas, firma electrónica y pago con tarjeta dentro de MUNE.
50. **Tipografía y colores de MUNE (27/10/2026, aprobado por la administradora):**
    - **Inter** para toda la plataforma: MUNE Studio, MUNE Portal y la letra de respaldo de la visita. **Fraunces** (peso 400), solo en los titulares de la marca: presentaciones, la web de MUNE y documentos. El nombre «MUNE» se escribe en Fraunces 400 (no hay logotipo aparte).
    - Inter se sirve desde la propia web (`app/src/fuentes/`, `portal/src/fuentes/` y `src/fuentes/`, licencia SIL Open Font License 1.1 junto a cada archivo, uso comercial y redistribución permitidos), no desde Google Fonts: así funciona con las reglas de seguridad de Studio y Portal (solo cargan lo suyo) y la visita de quien entra no se comunica a terceros. Solo el juego latino (el español completo), 48 KB.
    - La visita es de marca blanca: si la promoción tiene su tipografía (`marca.tipografia`), se usa esa e Inter ni se descarga.
    - **Colores corporativos, siempre los mismos:** arena `#F5F3EF` (fondo), verde `#2F5D50` (acento), negro `#1C1C1A` (texto), blanco cálido `#FCFBF9` (tarjetas) y gris cálido `#5E5A53` (texto secundario). Coral `#B8643F` como color que rompe, por ahora solo en presentaciones; se valorará llevarlo a la plataforma. Sobre fondo oscuro (presentaciones): verde claro `#8FB3A2` y coral claro `#E0A27F`.
52. **La promotora gestiona su catálogo y sus precios (lista maestra, paso 8a, 28/10/2026, decidido por la administradora):** en MUNE Portal → *Personalización* → *Catálogo y precios* (capacidad «personalización»), y lo mismo en MUNE Studio como ayuda, la promotora ajusta sin versión nueva el nombre, la descripción y el precio de cada opción, si se ofrece y en qué tipologías. **Los cambios se aplican al momento** (antes de confirmar se le enseña un resumen) y cada uno queda en el registro con quién lo hizo (MUNE o la promotora). **Una mejora lanzada nunca cambia de precio:** mientras su pack no se ha abierto a los compradores, el precio se puede cambiar; desde el día en que se abre, queda fijo para siempre (las categorías que no están en ningún pack se abren con la promoción publicada). **Dejar de ofrecer una opción** (raro, por ejemplo si el proveedor deja de tenerla): quien ya la eligió la conserva con su precio; los demás ya no la ven. La opción incluida de serie no se puede quitar. **Fechas de elección (decidido por la administradora el 28/10/2026):** cada promotora lo organiza a su manera: todo por separado, por packs o todo junto. En *Fechas de elección*, cada categoría se elige **por separado**, con su propia apertura y cierre, o **dentro de un pack** (una ficha con título, descripción y fechas que agrupa las categorías que quiera; un solo pack con todas es «todo junto»). Todas las categorías tienen fechas. Lo que aún no se ha abierto se cambia por completo y no puede empezar en el pasado; lo abierto conserva su apertura y lo que agrupa (puede cambiar su título y su cierre, sin dejarlo en el pasado); lo terminado ya no cambia ni se quita; una categoría ya abierta no pasa a un pack sin abrir (si ya se podía elegir sin fechas, se le pone su cierre y sigue abierta). Por dentro, una categoría por separado es un pack de una sola categoría (`individual`); los de la promotora sustituyen a los de la versión (`packs_promocion`) y también deciden cuándo se cierran las selecciones. **Nombres de las categorías:** la promotora cambia el nombre de cualquier categoría («Suelo» → «Pavimentos»; `catalogo_categorias`) y, al añadir opciones, puede volver a elegir las categorías nuevas que aún están en preparación. **Añadir personalizaciones y mejoras:** la promotora añade ella misma opciones nuevas, en una categoría existente o en una nueva (por ejemplo, «Climatización»), con su precio, su descripción y, si quiere, hasta cinco documentos (PDF, Word o imágenes) con la descripción detallada y fotos. Esos documentos no llegan nunca al comprador: son para que MUNE (Claude) prepare el aspecto de la opción en el 3D. La opción queda «En preparación» (a MUNE le aparece en Inicio, *Opciones por preparar*) y los compradores la ven en la versión siguiente, cuando MUNE la marca como añadida (o descartada, con nota). **Mientras está en preparación (decidido por la administradora el 28/10/2026), la promotora no espera:** lo añadido aparece enseguida en *Fechas de elección* y en *Opciones y precios*, marcado «En preparación», y ya puede meterlo (también una categoría nueva) en un pack o darle sus fechas por separado, cambiar su nombre, su precio y su descripción, cambiar el nombre de la categoría nueva o retirarlo. Los compradores no lo ven hasta que MUNE lo prepara; entonces aparece ya con su pack y sus fechas (un pack cuyas categorías están todas en preparación no se ve aún). Cada categoría nueva recibe su identificador al pedirla («Climatización» → `climatizacion`), que MUNE usa al preparar la opción para que encaje con los packs (`opciones_pedidas_pendientes` lo da, con su pack). Los documentos van a la carpeta `opciones` de la promoción en el almacén de documentos (copias y exportación incluidas). **Permiso nuevo del robot de Claude:** leer las opciones añadidas y sus documentos (`catalogo_de_promocion`, `opciones_pedidas_pendientes` y la carpeta `opciones`); no puede cambiar, añadir ni subir nada. Técnicamente, el catálogo de cada versión (datos privados) no cambia: los ajustes se guardan aparte (`catalogo_ajustes`) y se aplican encima al entrar el comprador o el equipo, al guardar una selección y en la pestaña Personalización (`029_catalogo_promotora.sql`).
53. **Restricciones de la personalización: por tipología (lista maestra, paso 8b, 28/10/2026, decidido por la administradora):** las restricciones no son por vivienda concreta sino **por tipología**, y **no hay reglas entre opciones** (del tipo «si eliges X, no puedes elegir Y»). Lo que ya está en el catálogo se ajusta por tipología desde la decisión 52 (columna *Tipologías* de *Opciones y precios*, visible cuando la promoción tiene más de una). Además, la promotora marca las tipologías de una opción **mientras está en preparación**, y MUNE la prepara solo para esas (`opciones_pedidas_pendientes` las da; sin marcar, en todas). `030_tipologias_en_preparacion.sql`.
54. **La promotora gestiona su marca (lista maestra, paso 8c, 28/10/2026, decidido por la administradora):** la marca es **de la promotora**: la pone una vez en MUNE Portal (Inicio, quien administra la promotora) y vale para todas sus promociones. **Una promoción puede tener la suya propia** (pestaña *Marca*, con la capacidad «marca»), que sustituye entera a la de la promotora solo en esa promoción y se puede quitar para volver a la general. La promotora cambia **el nombre que se enseña, el logo (SVG, PNG o JPG), los colores principal y secundario** (en la paleta o escribiendo su código, por ejemplo #7A2E3B), **la tipografía y el contacto comercial** (teléfono, email, web y dirección). **Tipografía (decidido por la administradora el 28/10/2026):** cualquiera de Google Fonts, por su nombre, o la suya propia subiendo sus archivos (WOFF2, WOFF, TTF u OTF), confirmando que tiene licencia para usarla en una web (queda la fecha). **MUNE la guarda dentro de cada versión:** «preparar» la descarga (de Google Fonts o, la propia, de Supabase con el robot) a `fuentes/` con su `LICENCIA.txt`, y la Experiencia ya no pide nada a Google Fonts al visitarla (la dirección del visitante no llega a Google; tampoco con la marca de `promocion.json`). Una marca propia de una promoción puede reutilizar los archivos de la tipografía de la promotora; los **textos legales** siguen en *Ficha y datos* de cada promoción (decisión 52 y 020). **Se aplica en la siguiente versión:** la Experiencia 3D es una web fija, así que la marca guardada sale en la próxima versión que prepare MUNE (Experiencia 3D, planos comerciales y documento de selección), que la administradora revisa en la vista previa y la promotora valida como siempre; al guardar no se publica nada. «preparar» la lee con el robot de Claude (**permiso nuevo: solo leer la marca y descargar los archivos de su tipografía**) y, sin marca guardada, usa la de `promocion.json`. **Seguridad:** el logo se guarda como SVG (un PNG o JPG se envuelve en un SVG en el navegador) y solo se acepta sin código (sin scripts, eventos ni enlaces a fuera), en Supabase y otra vez al construir; además la Experiencia lo pinta como imagen. MUNE Studio ve y cambia ambas como ayuda. De paso, borrar una promoción desactivada borra también sus datos privados y su catálogo, que antes lo impedían. `031_marca.sql`.
55. **Código del móvil también para las promotoras (auditoría de seguridad del 28/10/2026, aprobado por la administradora):** para entrar en MUNE Portal hace falta, además de la contraseña, el código de 6 cifras de una app de verificación (Google o Microsoft Authenticator), como en MUNE Studio. La primera vez (o al aceptar la invitación, después de elegir la contraseña) la persona vincula el móvil con un código QR; con la contraseña olvidada, primero da el código y después elige la nueva. **Lo comprueba la base de datos, no la página:** con una sesión de solo contraseña, una persona de una promotora no ve ni cambia nada, ni siquiera su propio acceso (`032_movil_promotoras.sql`, función `sesion_con_movil`; caso 44 de la prueba de aislamiento). No cambia nada para el robot de Claude, la cuenta de copias ni los compradores. **Si alguien pierde o cambia el móvil:** quien administra su promotora o su promoción (MUNE Portal → *Equipo*) o la administradora (MUNE Studio) pulsan *Quitar código del móvil* (función `invitar`, acción `quitar-movil`; nadie se lo quita a sí mismo) y, al volver a entrar, la persona vincula el nuevo. Queda en el registro. Coste: ninguno (incluido en el plan gratuito de Supabase).
