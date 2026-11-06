# Registro de recursos externos

Todo lo que MUNE usa y no ha hecho el equipo de MUNE, con su licencia. Solo se
admiten recursos gratuitos cuya licencia permita **uso comercial y
redistribución** (CLAUDE.md, «3D híbrido»). Al añadir uno, se apunta aquí.

## Poly Haven (https://polyhaven.com) · CC0 1.0 (dominio público)

Uso comercial y redistribución permitidos, sin obligación de atribución
(https://polyhaven.com/license). Se cita igualmente a sus autores.

### Texturas (`src/texturas/`, preparadas como «detalle, rugosidad y altura»)

| Archivo | Original | Autor |
|---|---|---|
| `roble.webp` | Oak Veneer 01 | Jenelle van Heerden |
| `microcemento.webp` | Plaster Grey 04 | Rob Tuytel |
| `terrazo.webp` | Concrete Floor 01 | Rob Tuytel |
| `lino.webp` | Rough Linen | colormass, Rico Cilliers |

### Modelos 3D (`biblioteca/modelos/`, preparados con `herramientas/modelos.py`)

| Archivo | Original | Autor | Activo de la biblioteca |
|---|---|---|---|
| `potted_plant_04.glb` | Potted Plant 04 | James Ray Cock | `planta-pequena` |
| `potted_plant_02.glb` | Potted Plant 02 | Rico Cilliers | `planta-terracota` |
| `ceramic_vase_01.glb` | Ceramic Vase 01 | James Ray Cock | `jarron-ceramica-alto` |
| `ceramic_vase_02.glb` | Ceramic Vase 02 | James Ray Cock | `jarron-ceramica` |
| `ceramic_vase_04.glb` | Ceramic Vase 04 | James Ray Cock | `jarra-ceramica` |
| `modern_ceiling_lamp_01.glb` | Modern Ceiling Lamp 01 | James Ray Cock | (aún sin activo) |
| `modern_coffee_table_01.glb` | Modern Coffee Table 01 | Amin | `mesa-centro-hormigon` |
| `potted_plant_01.glb` | Potted Plant 01 (aligerado con `herramientas/modelos_blender.py`) | Rico Cilliers | `planta-grande-ficus` |
| `follaje_01.glb` | Potted Plant 01, solo hojas y tallos | Rico Cilliers | follaje de las jardineras |
| `follaje_ligero.glb` | Potted Plant 01, solo hojas y tallos, más ligero | Rico Cilliers | setos y macizos de la urbanización |

## Programas gratuitos que se usan para producir (no van en la web)

- Blender (GPL), como módulo de Python «bpy»: render foto (`herramientas/render_foto.py`) y preparación de modelos (`herramientas/modelos_blender.py`). Las imágenes que produce son nuestras, sin condiciones.

## Otras fuentes ya en uso

- Tipografía Inter (SIL Open Font License 1.1): `src/fuentes/`, `app/src/fuentes/`, `portal/src/fuentes/`.
- Entorno real: Catastro, IGN (CC BY 4.0) y OpenStreetMap (ODbL), con su atribución en la propia visita (decisión 64).
