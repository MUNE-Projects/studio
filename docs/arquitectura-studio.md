# Studio de producción: arquitectura

El Studio es el modo de trabajo del equipo que prepara una promoción. Es
independiente de la experiencia pública y de la del comprador:

| | Público | Comprador | Promotora | Studio |
|---|---|---|---|---|
| Acceso | web abierta | su código de comprador | desde MUNE Portal, con un pase personal (decisión 46) | «Acceso profesional» + código de Studio (solo en la construcción interna) |
| Qué hace | ver la vivienda | personalizar y generar los PDF de sus packs | descargar entregables comerciales | preparar los datos de la promoción |
| Plano comercial | PDF directo | PDF directo | PDF o PNG (selector) | PDF o PNG (selector) |
| Render HD | no | no | sí | sí |
| Edición (muebles, cámaras, precios…) | no | no | no | sí |
| IA | nunca | nunca | nunca | opcional, solo aquí |
| Código cargado | bundle principal | bundle principal | bundle principal | + chunk `studio` (bajo demanda) |

**Cómo entrar:**
- El equipo de la promotora entra desde MUNE Portal → *Experiencia 3D* (modo profesional, decisión 46). En la web pública ya no hay «Acceso profesional».
- En la construcción interna (`--mode studio`), pulsa **Acceso profesional** (abajo a la derecha) e introduce el código del Studio. Código de la demo: `estudio-7q4m2x`.
- Ese navegador recuerda el acceso: la próxima vez, el botón abre el Studio directamente.
- También se entra de una vez con `#studio-estudio-7q4m2x` al final de la URL.

El código no se guarda en los datos: `promocion.json` solo contiene
`studio.acceso`, el SHA-256 de `"<id de promoción>:studio:<código>"`.
Es un control de acceso de comodidad, no de seguridad: los datos de la
promoción son públicos de todos modos, porque los necesita el visor. Lo que
el Studio edita no se publica hasta que se exporta y se reconstruye la web.

## Flujo

```
documentación de la promoción ──► datos (JSON) ──► Studio (edición en la escena) ──► paquete JSON ──► promociones/<id>/ ──► build ──► web publicada
```

1. **Documentación.** Plano de urbanización, planos acotados por tipología,
   superficies, número y distribución de viviendas, memorias técnica y de
   calidades, información comercial, branding, acabados, opciones y precios.
   La pestaña Documentación lleva la lista de lo recibido y lo ya integrado.
   Los ficheros no se suben a ningún sitio: solo se anota su referencia.
2. **Datos.** Cada tipología vive en `promociones/<id>/tipologias/<tipología>/`:
   - `vivienda.json`: la geometría;
   - `alternativas.json`: las distribuciones alternativas;
   - `tipologia.json`: las cámaras maestras;
   - `ambientacion.json`: el mobiliario y la decoración.

   A nivel de promoción están:
   - `promocion.json`: marca, viviendas y accesos;
   - `catalogo.json`: opciones y precios;
   - `biblioteca.json`: los activos.
3. **Studio.** Edita esos datos sobre la escena real (mismo motor, mismos
   materiales). No automatiza de más: propone, y el equipo decide.
4. **Publicación.** «Exportar paquete de datos» descarga un JSON con los
   ficheros editados. Se copian a `promociones/<id>/`, se ejecuta `npm run build` y se
   publica. La web publicada solo lee datos preparados.

## Pestañas

- **Escena.** Clic en un objeto para seleccionarlo (marco verde).
  - *Muebles del plano* (sofás, camas, mesas…): su posición y medidas vienen del plano. Se elige qué activo de la biblioteca lo representa (`ambientacion.sustituciones`).
  - *Decoración*: se mueve en pasos de 5 cm, se gira de 15° en 15°, se sube o se baja, se duplica, se elimina (tecla Supr) o se sustituye por otra pieza de la misma categoría.

  Cambiar una pieza reconstruye solo el mobiliario, no la estancia.
- **Cámaras.** Las vistas maestras de la tipología. La revisión de Publicación avisa si alguna estancia principal no tiene vista compuesta, o si una grande tiene solo una.
  - «Guardar encuadre actual» sobre una existente;
  - «Nueva vista» a partir del encuadre actual;
  - la casilla decide si la vista aparece en la barra de vistas guiadas.
- **Acabados y precios.** Nombres, precios y colores de cada opción del catálogo (el precio de la vivienda no está en la plataforma: decisión 37). Se refleja al instante en el configurador del comprador.
- **Marca.** Promotora, promoción, colores, tipografía, logo SVG, contacto y textos legales.
- **Interiorismo IA.** Ver abajo.
- **Biblioteca.** Activos por categoría, con metadatos y «Colocar». Incluye un formulario para crear un activo nuevo desde una referencia.
- **Documentación.** Lista de entradas de la promoción con su estado: pendiente, recibido o integrado.
- **Publicación.** Revisión automática y exportación del paquete:
  - la revisión detecta decoración que invade muros, activos inexistentes, pocas vistas guiadas o una opción incluida con precio;
  - hay además un borrador local de seguridad.

## Biblioteca de activos

`biblioteca/biblioteca.json` (metadatos) y `src/biblioteca/generadores.ts` (geometría).

- **Activo:** un generador procedural con sus parámetros. Cada activo lleva:
  - `id`, `categoria`, `nombre`, `estilo`, `materiales`, `color`, `gama`;
  - `dims` (ancho × fondo × alto), `generador`, `params`;
  - `inspiracion`, `referencia`, `miniatura`;
  - `sustituye`, que indica a qué tipos del plano puede representar.
- **Categorías:** sofás, sillones, mesas, sillas, camas, mesillas, cabeceros, almacenaje, lámparas, alfombras, plantas, cuadros, textiles, accesorios y decoración.
- **Materiales:** se escriben como claves, por ejemplo `tela:#d8cfc1`, `boucle:#ece6db`, `madera:#b89574`, `marmol:#eeebe6`, `lienzo:#a,#b,#c` o `emisivo:#fff1dc:1.6`. Se crean bajo demanda y se reutilizan, así que dos piezas del mismo tejido comparten shader.
- **Tamaño:** un activo no pesa: son unos pocos parámetros. La geometría se genera en el navegador.
- **`inspiracion`:** es el universo de estilo de referencia (Maison du Monde, Kenay Home, Kave Home, Sklum, Le Masie, Minotti, Roche Bobois). Es información interna: no se muestra al comprador, no se integra ningún catálogo y no se reproduce ningún producto concreto.

## Interiorismo asistido

Entrada: imágenes de referencia (moodboard, ambientes, un estilo).
Salida: una **propuesta editable** sobre la escena 3D, nunca una imagen plana.

1. Se extrae la paleta dominante de las referencias en el navegador (k-medias sobre píxeles reducidos).
2. Se genera la propuesta, por una de dos vías:
   - **Sin IA:** reglas por temperatura y luminosidad de la paleta. Deciden el estilo, eligen activos de la biblioteca y crean alternativas de color de los textiles (sofá, cojines, manta, plaid).
   - **Con IA:** capability `sample`, que usa la cuenta de Claude de quien trabaja en el Studio. Se envían las imágenes, la paleta, la lista de activos y los muebles de la vivienda. Claude responde con la misma estructura JSON y solo puede referirse a activos existentes. Lo que no valida se descarta.
3. «Aplicar a la escena» la convierte en sustituciones, cambios de decoración y activos derivados (`propio: true`). Todo sigue editable pieza a pieza, y «Deshacer» recupera la ambientación anterior.

## Generación de mobiliario desde una referencia

Formulario de la Biblioteca. Datos: nombre, categoría, forma base (generador), medidas, material, color, gama, estilo, universo de referencia e imagen opcional.

- **«Crear con estos datos»:** genera el activo con parámetros directos.
- **«Interpretar con IA»:** Claude traduce la referencia a un generador y sus parámetros (forma, patas, cabecero, cojines…).

El resultado es una aproximación ligera y plausible, no una réplica. Si es decoración se coloca en la vista actual. Si es mobiliario del plano, queda disponible para sustituir.

## Qué no hace (a propósito)

- No hay base de datos, usuarios ni CRM: el Studio trabaja sobre ficheros.
- No guarda nada en servidor. El borrador local es solo una red de seguridad.
- No automatiza la lectura de planos o memorias: eso sigue siendo `herramientas/extraer_plano.py` más revisión humana. La arquitectura está preparada para añadir extractores por documento sin tocar el visor.
