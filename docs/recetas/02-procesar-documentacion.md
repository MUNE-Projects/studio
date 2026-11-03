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
   - si cambia algo **ya preparado** (un plano comercial o una tipología de la Experiencia 3D de la versión publicada o de la que se valida): por ejemplo, una memoria nueva con otro baño en la tipología B.
5. **Punto de control:** Claude te presenta una tabla con cada documento, su propuesta (vigente o rechazado) y, si rechaza, la nota exacta que verá la promotora. Debajo, **lo que queda desfasado**: cada plano o tipología que propone marcar como «Requiere actualizar», con la nota que verá la promotora. No marca nada sin tu OK.
6. Con tu OK: `node herramientas/documentos.mjs estado <id> vigente` o `estado <id> rechazado --nota "…"`. Al rechazar, el equipo de la promotora recibe un email con la nota. Lo desfasado: `node herramientas/documentos.mjs actualizar <promoción> plano|experiencia <clave> --nota "…" --documento <id>` (decisión 69). La promotora lo ve en MUNE Portal como «Requiere actualizar», con la nota. Al preparar la versión que lo incorpora, «preparar» lo recuerda y se resuelve con `documentos.mjs actualizaciones <promoción> resolver <ids> --version vN`.
7. Informe breve en la conversación: qué se marcó, qué falta por entregar y las incoherencias encontradas.

## Registro
Cada cambio de estado queda en el registro de actividad automáticamente (con quién lo hizo: el robot), y cada descarga del robot también.

## Sin Claude
Lo mismo se hace desde el Panel: promoción → pestaña **Documentación** → *Descargar*, *Marcar como vigente* o *Rechazar…* (con nota). «Requiere actualizar» lo marca Claude; sin Claude, la administradora puede quitar una marca puesta por error (*Resumen y versiones*).

## Errores
- Documento ilegible o equivocado: se rechaza con una nota clara para la promotora.
- Huella que no coincide: no se marca nada y se avisa a la administradora.
