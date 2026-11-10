# Receta 2 · Procesar documentación

**Lo dices así:** «Revisa lo nuevo (de Residencial X)».
**Tipo:** mixta (pasos automáticos + criterio de Claude). **Tu OK:** antes de marcar nada.

## Requisitos
- El robot de Claude con sus credenciales en el entorno (`ROBOT_EMAIL`, `ROBOT_CLAVE`).
- Permisos del robot (aprobados el 6/10/2026; ajustados el 31/10/2026, decisión 65): leer requisitos, documentos, entregables y validaciones, y cambiar solo el estado y la nota de un documento. De la ficha de la promoción, solo los campos técnicos (`ficha_para_robot`); en los comentarios, el papel de quien escribe en lugar de su nombre; no ve quién aprueba.

## Pasos
1. Claude anuncia: «Receta 2 · Procesar documentación · Residencial X».
2. `node herramientas/documentos.mjs pendientes <promoción>`: lista lo que espera revisión.
3. `node herramientas/documentos.mjs bajar <id>` para cada documento: lo descarga a `salida/documentos/` **sin metadatos** (la función `archivo-robot` le quita autor, GPS, programa…: decisión 67) y **comprueba la huella** del original (que es el archivo que subió la promotora). Si no coincide, se detiene y avisa. Limpia PDF, fotos, Word, Excel, PowerPoint, LibreOffice, DXF, IFC, ZIP y texto. Si es un DWG, una foto HEIC, un TIFF, un formato propio de un programa (RVT, SKP…) o un PDF con contraseña, no se entrega: se pide a la promotora en DXF, PDF o JPG (sin marcar nada como rechazado sin el OK de la administradora).
4. Claude lee cada documento y comprueba:
   - que es lo que se pidió en ese punto de la lista (por ejemplo, que el plano de tipología está **acotado**);
   - que es legible y está completo;
   - que cuadra con lo demás (superficies frente al cuadro oficial, número de viviendas frente a la ficha, tipologías frente a la tabla de viviendas);
   - si es un **plano nuevo de una tipología ya preparada** (por el nombre y el contenido se sabe cuál): esa tipología pasa a «En actualización». La memoria de calidades cambia materiales y acabados, no distribuciones.
   - **Datos personales (decisión 73):** si un documento lleva nombres, correos, teléfonos o firmas de personas, Claude no los copia a ningún sitio (modelo, notas, resumen), borra su copia de ese archivo en `salida/documentos/` y lo propone como rechazado con la nota «Sube una versión sin datos personales (nombres, correos, teléfonos o firmas)». Los demás documentos siguen. Si `comentarios` o `novedades` dicen «retenido», Claude no intenta leerlo: pide a la administradora que lo corrija en MUNE Studio (*Quitar un dato personal*) y sigue con lo demás.
5. **Punto de control:** Claude te presenta una tabla con cada documento, su propuesta (vigente o rechazado) y, si rechaza, la nota exacta que verá la promotora. Debajo, **qué tipologías pasan a «En actualización»**, con la nota corta que verá la promotora (por ejemplo, «el dormitorio 2 gana 40 cm de ancho»). No marca nada sin tu OK.
6. Con tu OK: `node herramientas/documentos.mjs estado <id> vigente` o `estado <id> rechazado --nota "…"`. Al rechazar, el equipo de la promotora recibe un email con la nota. Lo que pasa a «En actualización»: `node herramientas/documentos.mjs actualizar <promoción> plano|experiencia <clave> --nota "…" --documento <id>` (decisión 69), para el plano y, si cambia, también para el 3D de esa tipología. La promotora lo ve así en MUNE Portal y puede seguir descargando el anterior. Al preparar la versión que lo incluye, «preparar» lo recuerda y se resuelve con `documentos.mjs actualizaciones <promoción> resolver <ids> --version vN`.
7. Informe breve en la conversación: qué se marcó, qué falta por entregar y las incoherencias encontradas.

## Registro
Cada cambio de estado queda en el registro de actividad automáticamente (con quién lo hizo: el robot), y cada descarga del robot también.

## Sin Claude
Lo mismo se hace desde el Panel: promoción → pestaña **Documentación** → *Descargar*, *Marcar como vigente* o *Rechazar…* (con nota). «En actualización» lo pone Claude; sin Claude, la administradora puede quitar uno puesto por error (*Resumen y versiones*).

## Errores
- Documento ilegible o equivocado: se rechaza con una nota clara para la promotora.
- Huella que no coincide: no se marca nada y se avisa a la administradora.
