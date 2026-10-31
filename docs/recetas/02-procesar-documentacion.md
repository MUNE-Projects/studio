# Receta 2 · Procesar documentación

**Lo dices así:** «Revisa lo nuevo (de Residencial X)».
**Tipo:** mixta (pasos automáticos + criterio de Claude). **Tu OK:** antes de marcar nada.

## Requisitos
- El robot de Claude con sus credenciales en el entorno (`ROBOT_EMAIL`, `ROBOT_CLAVE`).
- Permisos del robot (aprobados el 6/10/2026; ajustados el 31/10/2026, decisión 65): leer requisitos, documentos, entregables y validaciones, y cambiar solo el estado y la nota de un documento. De la ficha de la promoción, solo los campos técnicos (`ficha_para_robot`); en los comentarios, el papel de quien escribe en lugar de su nombre; no ve quién aprueba.

## Pasos
1. Claude anuncia: «Receta 2 · Procesar documentación · Residencial X».
2. `node herramientas/documentos.mjs pendientes <promoción>`: lista lo que espera revisión.
3. `node herramientas/documentos.mjs bajar <id>` para cada documento: lo descarga a `salida/documentos/` y **comprueba la huella** (que es exactamente el archivo que subió la promotora). Si no coincide, se detiene y avisa.
4. Claude lee cada documento y comprueba:
   - que es lo que se pidió en ese punto de la lista (por ejemplo, que el plano de tipología está **acotado**);
   - que es legible y está completo;
   - que cuadra con lo demás (superficies frente al cuadro oficial, número de viviendas frente a la ficha, tipologías frente a la tabla de viviendas).
5. **Punto de control:** Claude te presenta una tabla con cada documento, su propuesta (vigente o rechazado) y, si rechaza, la nota exacta que verá la promotora. No marca nada sin tu OK.
6. Con tu OK: `node herramientas/documentos.mjs estado <id> vigente` o `estado <id> rechazado --nota "…"`. Al rechazar, el equipo de la promotora recibe un email con la nota.
7. Informe breve en la conversación: qué se marcó, qué falta por entregar y las incoherencias encontradas.

## Registro
Cada cambio de estado queda en el registro de actividad automáticamente (con quién lo hizo: el robot), y cada descarga del robot también.

## Sin Claude
Lo mismo se hace desde el Panel: promoción → pestaña **Documentación** → *Descargar*, *Marcar como vigente* o *Rechazar…* (con nota).

## Errores
- Documento ilegible o equivocado: se rechaza con una nota clara para la promotora.
- Huella que no coincide: no se marca nada y se avisa a la administradora.
