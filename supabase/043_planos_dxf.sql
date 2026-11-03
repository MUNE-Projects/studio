-- Los planos, en DXF y no en DWG (decisión 67: el DWG no podemos leerlo).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 042. Es repetible.
--
-- La lista estándar de documentos pedía los planos «en PDF y, si lo tienes,
-- también en DWG». Desde aquí pide «también en DXF», que AutoCAD exporta con
-- «Guardar como → DXF»:
--  · en la lista estándar (para las promociones nuevas);
--  · en las promociones que ya tienen la lista (solo esa frase; el resto de la
--    descripción, igual).

create or replace function public.lista_estandar()
returns table (bloque text, elemento text, descripcion text, obligatorio boolean, orden int, plantilla text, varios boolean, contenidos text[])
language sql
immutable
set search_path = ''
as $$
	values
		('Planos', 'Plano de situación o emplazamiento',
			'Sitúa la parcela en su entorno. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', true, 1, null::text, false, '{}'::text[]),
		('Planos', 'Plano de urbanización o implantación',
			'Parcela, zonas comunes, accesos y viales interiores. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', true, 2, null, false, '{}'),
		('Planos', 'Planos de cada tipología, acotados',
			'Uno por tipología, con cotas y superficies por estancia. Añade un archivo por tipología e indica cuál es. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', true, 3, null, true,
			'{"Plano de tipología","Otro"}'),
		('Planos', 'Planos de plantas generales del edificio',
			'Planta por planta, con la posición de cada vivienda. Solo en plurifamiliares. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', false, 4, null, true,
			'{"Planta general","Otro"}'),
		('Planos', 'Alzados y secciones',
			'Fachadas y secciones con sus alturas. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', true, 5, null, true,
			'{"Alzado","Sección","Otro"}'),
		('Planos', 'Planos de garajes y trasteros',
			'Si la promoción los tiene, con la numeración de plazas y trasteros. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', false, 6, null, true,
			'{"Planta de garaje","Trasteros","Otro"}'),
		('Planos', 'Plano de cubiertas',
			'Si aplica, con la geometría de cubiertas, huecos y elementos relevantes. En PDF y, si lo tienes, también en DXF (AutoCAD lo exporta con «Guardar como → DXF»).', false, 7, null, false, '{}'),
		('Viviendas y superficies', 'Relación de viviendas, tipologías y superficies',
			'Todas las viviendas con su tipología, su planta y sus superficies. En el formato que ya tengas (Excel, PDF, el listado comercial…): no hace falta adaptarlo a MUNE.', true, 8, null, false, '{}'),
		('Viviendas y superficies', 'Cuadro de superficies oficial del proyecto',
			'Documento vigente con las superficies oficiales de las viviendas, tipologías y espacios del proyecto.', true, 9, null, false, '{}'),
		('Calidades', 'Memoria de calidades técnica',
			'No la memoria comercial de la promoción. Sube la documentación técnica vigente que defina con precisión los elementos que debemos reproducir: '
			|| 'dimensiones, espesores, formatos, sistemas, materiales, acabados, marcas, modelos y referencias cuando estén definidos. '
			|| 'Por ejemplo: ventanas (medidas, perfil, sistema, vidrio y acabado), puertas (medidas, modelo, acabado y herrajes), pavimentos (material, formato, espesor y acabado), '
			|| 'cocinas, sanitarios, griferías, barandillas y revestimientos. Puede estar en la memoria técnica, el proyecto, los cuadros de carpinterías y de acabados, '
			|| 'los detalles constructivos o las fichas técnicas de los fabricantes: no hace falta reorganizarla para MUNE. Añade cada archivo por separado e indica qué contiene.',
			true, 10, null, true,
			'{"Memoria técnica","Cuadro de carpinterías","Cuadro de acabados","Detalles constructivos","Fichas técnicas de fabricantes","Otro"}')
$$;
revoke all on function public.lista_estandar() from public, anon;

update public.requisitos
set descripcion = regexp_replace(descripcion, '\mDWG\.', 'DXF (AutoCAD lo exporta con «Guardar como → DXF»).', 'g')
where descripcion ~ '\mDWG\.';

select 'Listo: los planos se piden en DXF' as resultado;
