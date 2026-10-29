# Receta 1 · Interpretar la documentación

**Lo dices así:** «Interpreta la documentación de Residencial X» (o «pasa a datos la tipología B de Residencial X»).
**Tipo:** mixta (criterio de Claude + comprobaciones automáticas). **Tu OK:** antes de preparar ninguna versión con estos datos.

Convierte los planos y la memoria de calidades de una promoción en los datos de MUNE (el **modelo de la promoción**, guardado en Supabase, nunca en GitHub: decisión 59), de los que salen la Experiencia 3D, los planos comerciales, los renders y la personalización. Se hace **siempre igual y con esta lista**, para que no dependa de quién lo haga (decisión 48): **cada promoción se interpreta desde su documentación; nada se copia de la demo ni de otra promoción.**

## Requisitos
- La promoción dada de alta (MUNE Studio → *Promotoras* → la promotora → *Nueva promoción*).
- Sus datos en la carpeta de trabajo, `trabajo/<id>/`, que nunca va a GitHub: `node herramientas/promociones.mjs bajar <id>` si ya tiene (o se crea la carpeta, si es la primera vez), y al terminar `node herramientas/promociones.mjs subir <id> --nota "…"`.
- La documentación marcada como **vigente** en la pestaña *Documentación* (receta 2). Como mínimo:
  - plano de **urbanización o implantación** (parcela, viales, accesos, zonas comunes, jardines, piscina, aparcamiento exterior);
  - planos de **plantas generales del edificio**, en las plurifamiliares (cómo se reparten las viviendas en cada planta, portales, núcleos de escalera y ascensor, zonas comunes interiores, garaje y trasteros);
  - plano **acotado** de cada tipología (y de cada planta de la vivienda, si tiene varias);
  - **cuadro de superficies** oficial (útil, exterior y construida por tipología);
  - **memoria de calidades**;
  - **tabla de viviendas y tipologías** (la plantilla Excel del Portal);
  - plano de situación (para el norte y la fachada a la calle).
- Si falta algo de esto, Claude se detiene y te dice qué pedir a la promotora. **No inventa.**

## La regla del origen
Cada dato lleva su `origen`, para saber siempre de dónde salió:

| `origen` | Significa |
|---|---|
| `plano` | medido o leído del plano acotado |
| `memoria` | tomado de la memoria de calidades |
| `tabla` | tomado de la tabla de viviendas o del cuadro de superficies |
| `usuario` | confirmado por ti o por la promotora (se apunta cuándo) |
| `supuesto` | valor por defecto razonable, **pendiente de confirmar** |

Los `supuesto` no son un error, pero se enumeran en el informe final y, en los acabados, la promotora los ve al validar (por email y en MUNE Portal).

## Pasos
1. Claude anuncia: «Receta 1 · Interpretar la documentación · Residencial X».
2. **Baja los documentos vigentes** con `node herramientas/documentos.mjs bajar <id>` (comprueba la huella de cada uno).
3. **Lee todo antes de escribir nada** y anota las contradicciones entre documentos (por ejemplo, una superficie del plano que no cuadra con el cuadro oficial, o un número de viviendas distinto en la tabla y en la ficha).
4. Rellena los datos siguiendo la **lista de comprobación** de abajo, apartado por apartado.
5. **Comprobaciones automáticas** (las mismas que hace «preparar», sin crear versión ni tocar la vista previa):
   - `npx tsc --noEmit`: que los datos tienen la forma correcta;
   - `node herramientas/publicacion.mjs comprobar <id>`: se detiene si las superficies se apartan más de 0,5 m² de las oficiales, si hay choques en la distribución, acabados mal escritos o elementos que la visita aún no sabe representar; enumera los acabados que la memoria no indica y deja los planos comerciales de prueba en `salida/comprobar/<id>/planos/`.
6. **Mira el resultado**: los planos de prueba y la Experiencia 3D de cada tipología en local (`npm run dev`), contra el plano original. Claude compara a la vista muros, huecos, estancias y mobiliario.
7. **Punto de control:** Claude te presenta:
   - capturas del plano comercial y del 3D de cada tipología, junto al plano original;
   - las **contradicciones** encontradas y qué dato propone usar (o qué hay que preguntar a la promotora);
   - la lista de **supuestos** (lo que la documentación no dice).
8. Con tu OK, los datos se guardan en el taller como una propuesta, y ya se puede preparar la versión (recetas 9 y 10).

## Lista de comprobación

### A. Promoción (`promocion.json`)
- [ ] Nombre, ubicación y tipo (`plurifamiliar` o `unifamiliar`).
- [ ] Tipologías: una por cada tipología del proyecto, con sus opciones de personalización (del catálogo).
- [ ] Viviendas: **todas** las de la tabla, cada una con su referencia, portal, planta, tipología, si es espejo, orientación y superficies oficiales. Que el número total cuadre con la ficha.
- [ ] Variantes (espejo, bajo, ático…): cada una es la misma tipología con su modificación fija, no una tipología nueva.
- [ ] Acabados de serie (`acabados`) desde la memoria, apartado G.

### B. Promoción completa: urbanización y plantas generales (`entorno/`)
- [ ] Parcela y su forma, con el norte y las calles de alrededor (plano de urbanización y de situación).
- [ ] Edificios o viviendas en la parcela: dónde está cada uno y su número de plantas. En las unifamiliares, cada parcela con su vivienda y su número.
- [ ] Plantas generales: en cada planta, qué vivienda va en cada sitio (referencia de la tabla, tipología y si es espejo); portales, escaleras y ascensores.
- [ ] Que lo que dicen las plantas generales cuadre con la tabla de viviendas: mismas referencias, misma tipología, mismo número de viviendas por planta.
- [ ] Zonas comunes: jardines, piscina, juegos, viales y aceras interiores, aparcamiento exterior, accesos y cerramiento de la parcela.
- [ ] Garaje y trasteros comunes, si los hay (planta de sótano).
- [ ] Lo que la Experiencia 3D aún no sepa representar de la promoción completa se apunta y se avisa (no se aproxima en silencio).

### C. Cada tipología (`tipologias/<t>/tipologia.json` y `vivienda.json`)
- [ ] Nombre, número de dormitorios y de baños, y resumen («2 dormitorios · 2 baños · …»).
- [ ] **Escala** calibrada con la escala gráfica o con una cota larga, y comprobada con otra cota distinta.
- [ ] **Sistema de coordenadas:** metros, x hacia el este, y hacia el norte, origen en una esquina exterior.
- [ ] **Norte** desde el plano de situación (si no está, `supuesto` y se pregunta).
- [ ] **Superficies oficiales** (`meta.superficies_oficiales`: interior, exterior y construida) del cuadro de superficies.

### D. Muros y huecos
- [ ] Muros de fachada (envolvente), medianeras y tabiques, con su grueso del plano.
- [ ] Cada hueco en su muro, con su posición desde las cotas:
  - puerta de entrada;
  - puertas interiores: abatible de una o dos hojas (con bisagra y sentido de apertura), corredera vista, corredera empotrada o paso sin puerta;
  - ventanas y balconeras: apertura (abatible, oscilobatiente, corredera, fija o proyectante), número de hojas (1 a 4), antepecho y altura, y si llevan persiana.
- [ ] Las alturas de cada hueco: de la memoria o del plano de alzados; si no aparecen, `supuesto`.

### E. Plantas, alturas y techos
- [ ] Altura libre general y canto del forjado.
- [ ] Falsos techos (baños, pasillos) y techos inclinados (áticos, bajo cubierta), estancia por estancia.
- [ ] Si la vivienda tiene varias plantas (dúplex, unifamiliar, sótano, altillo): cada planta con su nombre y su cota (la de calle es 0; el sótano, negativa), de abajo arriba, y la **escalera** con su hueco.
- [ ] Garaje: estancia de uso `garaje`, su puerta (con altura) y sus plazas; rampa, si la hay, con su pendiente.

### F. Estancias, exteriores y equipamiento
- [ ] Cada estancia con su nombre del plano, su uso y su polígono. **La suma de superficies útiles debe cuadrar con la oficial** (±0,5 m²).
- [ ] Exteriores: terrazas, balcones, porches, jardines y patios, con sus barandillas (vidrio, barrotes, peto de obra o peto bajo con vidrio) y si están cubiertos.
- [ ] Equipamiento fijo **del plano**: cocina (encimeras, placa, fregadero, lavavajillas, nevera, isla o península), baños (lavabo, inodoro, bidé, ducha, bañera o bañera exenta), lavadero (lavadora, secadora), armarios empotrados.
- [ ] Mobiliario de ambientación: el de la biblioteca, colocado sin chocar con muros, puertas ni otros muebles (las comprobaciones lo vigilan).
- [ ] Distribuciones alternativas (cocina abierta, dormitorio extra…), si el proyecto las ofrece.

### G. Acabados de la memoria (`promocion.json` → `acabados`)
- [ ] Fachada: color y textura (lisa o ladrillo cara vista, con su junta).
- [ ] Paredes y techos interiores.
- [ ] Carpintería exterior (ventanas y barandillas).
- [ ] Puertas interiores: color y diseño (lisa o con ranuras).
- [ ] Suelos y alicatados, cada uno con su especificación completa: formato (baldosa, lama o continuo), medidas en cm, colocación (recto, trabado, aleatorio o espiga), aspecto, junta y brillo. Apartados: porcelánico general, cocina, cerámico, exterior, baños, alicatado y tarima.
- [ ] Rodapié y grifería.
- [ ] Lo que la memoria no diga se deja sin poner: MUNE usa el valor de siempre y **lo avisa** a la promotora al validar.

### H. Catálogo de personalización (`catalogo.json`)
- [ ] Las opciones que la promotora ofrece al comprador (suelo, cocina, encimera, baños, exteriores…), con su opción incluida.
- [ ] Precios y packs: son **datos privados**; nunca van en la web pública (se guardan en Supabase al preparar).

## Qué hacer con lo que no cuadra
- **Superficies que no cuadran:** se pregunta a la promotora qué dato es el bueno (plano acotado o cuadro de superficies). Hasta entonces no se prepara la versión.
- **Algo que la Experiencia 3D aún no sabe representar** (un tipo de hueco, de barandilla o de equipamiento nuevo): MUNE lo avisa, no lo aproxima en silencio. Claude te lo cuenta y se valora añadirlo como mejora.
- **Contradicción entre documentos:** se anota con su `origen` y se pregunta; nunca se elige en silencio.

## Registro
Los datos quedan en Supabase (`modelo_promocion`): cada `subir` añade una versión de trabajo nueva sin borrar las anteriores, y cada versión preparada guarda su copia exacta, que no se puede cambiar. Cada dato dice su `origen`.

## Sin Claude
Lo mismo lo puede hacer cualquier persona del equipo de MUNE con esta lista: bajar los datos (`herramientas/promociones.mjs bajar <id>`), editar los archivos de `trabajo/<id>/` siguiendo los apartados A a H, ejecutar las comprobaciones del paso 5 y revisar el resultado del paso 6.

## Errores
- «preparar» se detiene por superficies, choques o acabados: el mensaje dice qué dato y en qué tipología; se corrige y se vuelve a probar.
- Plano sin cotas o ilegible: se rechaza en *Documentación* (receta 2) y se pide de nuevo a la promotora.
