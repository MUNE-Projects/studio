-- Fase 1 · paso 17: textos de la lista estándar de documentos (revisión editorial del 10/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 016. Es repetible.
--
-- · La lista estándar se dirige a la persona en singular («si lo tienes»,
--   «descarga la plantilla») y explica qué necesitamos, qué debe contener y
--   en qué formato.
-- · «Memoria de calidades vigente» pasa a ser «Documentación técnica de
--   materiales, acabados y equipamiento»: no es la memoria comercial.
-- · Las promociones que ya tienen lista reciben los textos nuevos solo en los
--   documentos que conservan el texto estándar antiguo (si se cambió a mano,
--   se respeta). No cambia nada de lo ya subido ni de su revisión.

create or replace function public.lista_estandar()
returns table (bloque text, elemento text, descripcion text, obligatorio boolean, orden int, plantilla text)
language sql
immutable
set search_path = ''
as $$
	values
		('Planos', 'Plano de situación o emplazamiento',
			'Sitúa la parcela en su entorno. En PDF y, si lo tienes, también en DWG.', true, 1, null::text),
		('Planos', 'Plano de urbanización o implantación',
			'Parcela, zonas comunes, accesos y viales interiores. En PDF y, si lo tienes, también en DWG.', true, 2, null),
		('Planos', 'Planos de cada tipología, acotados',
			'Uno por tipología, con cotas y superficies por estancia. En PDF y, si lo tienes, también en DWG.', true, 3, null),
		('Planos', 'Planos de plantas generales del edificio',
			'Planta por planta, con la posición de cada vivienda. Solo en plurifamiliares. En PDF y, si lo tienes, también en DWG.', false, 4, null),
		('Planos', 'Alzados y secciones',
			'Fachadas y secciones con sus alturas. En PDF y, si lo tienes, también en DWG.', true, 5, null),
		('Planos', 'Planos de garajes y trasteros',
			'Si la promoción los tiene, con la numeración de plazas y trasteros. En PDF y, si lo tienes, también en DWG.', false, 6, null),
		('Planos', 'Plano de cubiertas',
			'Si aplica, con la geometría de cubiertas, huecos y elementos relevantes. En PDF y, si lo tienes, también en DWG.', false, 7, null),
		('Viviendas y superficies', 'Tabla de viviendas y tipologías (Excel)',
			'Descarga la plantilla, rellénala con todas las viviendas y súbela aquí.', true, 8, '/plantillas/tabla-viviendas.xlsx'),
		('Viviendas y superficies', 'Cuadro de superficies oficial del proyecto',
			'Documento vigente con las superficies oficiales de las viviendas, tipologías y espacios del proyecto.', true, 9, null),
		('Materiales y acabados', 'Documentación técnica de materiales, acabados y equipamiento',
			'No la memoria comercial de la promoción. Sube la documentación técnica vigente que defina con precisión los elementos que debemos reproducir: '
			|| 'dimensiones, espesores, formatos, sistemas, materiales, acabados, marcas, modelos y referencias cuando estén definidos. '
			|| 'Por ejemplo: ventanas (medidas, perfil, sistema, vidrio y acabado), puertas (medidas, modelo, acabado y herrajes), pavimentos (material, formato, espesor y acabado), '
			|| 'cocinas, sanitarios, griferías, barandillas y revestimientos. Puede estar en la memoria técnica, el proyecto de ejecución, los cuadros de carpinterías y de acabados, '
			|| 'los detalles constructivos o las fichas técnicas de los fabricantes: no hace falta reorganizarla para MUNE.', true, 10, null),
		('Proyecto', 'Proyecto básico o de ejecución',
			'Como documentación de referencia para contrastar el proyecto. Sube la versión más reciente que tengas disponible.', false, 11, null)
$$;
revoke all on function public.lista_estandar() from public, anon;

create or replace function public.aplicar_lista_estandar(p_promocion text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede preparar la lista de documentos';
	end if;
	if not exists (select 1 from public.promociones where id = p_promocion) then
		raise exception 'No existe esa promoción';
	end if;
	if exists (select 1 from public.requisitos where promocion_id = p_promocion and activo) then
		raise exception 'Esta promoción ya tiene lista de documentos';
	end if;
	insert into public.requisitos (promocion_id, bloque, elemento, descripcion, obligatorio, orden, plantilla)
	select p_promocion, l.bloque, l.elemento, l.descripcion, l.obligatorio, l.orden, l.plantilla
	from public.lista_estandar() l;
	get diagnostics n = row_count;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'lista_estandar', jsonb_build_object('promocion', p_promocion, 'documentos', n));
	return n;
end $$;
revoke all on function public.aplicar_lista_estandar(text) from public, anon;
grant execute on function public.aplicar_lista_estandar(text) to authenticated;

-- ─── Listas ya creadas: textos nuevos donde seguía el texto estándar antiguo ──

update public.requisitos r
set bloque = l.bloque, elemento = l.elemento, descripcion = l.descripcion
from (values
	('Plano de situación o emplazamiento', 'En PDF; si lo tenéis, también en DWG.'),
	('Plano de urbanización o implantación', 'Parcela, zonas comunes y accesos. En PDF y, si lo tenéis, en DWG.'),
	('Planos de cada tipología, acotados', 'Uno por tipología, con cotas y superficies por estancia. En PDF y, si lo tenéis, en DWG.'),
	('Planos de plantas generales del edificio', 'Planta por planta. Solo en plurifamiliares.'),
	('Alzados y secciones', 'En PDF; si lo tenéis, también en DWG.'),
	('Planos de garajes y trasteros', 'Si la promoción los tiene.'),
	('Plano de cubiertas', ''),
	('Tabla de viviendas y tipologías (Excel)', 'Descargad la plantilla, rellenadla con todas las viviendas y subidla aquí.'),
	('Cuadro de superficies oficial del proyecto', ''),
	('Memoria de calidades vigente', ''),
	('Proyecto básico o de ejecución', 'Como referencia, si lo tenéis disponible.')
) as antiguo (elemento, descripcion)
join public.lista_estandar() l on l.orden = (
	case antiguo.elemento
		when 'Plano de situación o emplazamiento' then 1
		when 'Plano de urbanización o implantación' then 2
		when 'Planos de cada tipología, acotados' then 3
		when 'Planos de plantas generales del edificio' then 4
		when 'Alzados y secciones' then 5
		when 'Planos de garajes y trasteros' then 6
		when 'Plano de cubiertas' then 7
		when 'Tabla de viviendas y tipologías (Excel)' then 8
		when 'Cuadro de superficies oficial del proyecto' then 9
		when 'Memoria de calidades vigente' then 10
		when 'Proyecto básico o de ejecución' then 11
	end)
where r.elemento = antiguo.elemento and r.descripcion = antiguo.descripcion;

select 'Listo: textos de la lista de documentos' as resultado;
