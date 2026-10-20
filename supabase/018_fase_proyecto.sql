-- Fase 1 · paso 18: fase del proyecto y memoria de calidades técnica (10/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 017. Es repetible.
--
-- · La promoción indica en su ficha en qué fase está su proyecto: anteproyecto,
--   proyecto básico o proyecto de ejecución. No es un documento que entregar:
--   cada documento que se sube queda marcado con la fase en la que estaba la
--   promoción en ese momento.
-- · Desaparece el documento «Proyecto básico o de ejecución» de la lista
--   (en las promociones donde nadie lo había subido).
-- · «Documentación técnica de materiales, acabados y equipamiento» pasa a
--   llamarse «Memoria de calidades técnica», con la misma explicación.

-- ─── Fase del proyecto ──────────────────────────────────────────────────────

alter table public.promociones add column if not exists fase_proyecto text
	check (fase_proyecto is null or fase_proyecto in ('anteproyecto', 'basico', 'ejecucion'));
alter table public.documentos add column if not exists fase text
	check (fase is null or fase in ('anteproyecto', 'basico', 'ejecucion'));

-- Cada documento nuevo queda marcado con la fase de la promoción en ese momento.
create or replace function public.documento_con_fase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	select p.fase_proyecto into new.fase from public.promociones p where p.id = new.promocion_id;
	return new;
end $$;
drop trigger if exists documento_con_fase on public.documentos;
create trigger documento_con_fase before insert on public.documentos
	for each row execute function public.documento_con_fase();

-- La ficha guarda también la fase (si no se indica, se conserva la que había).
drop function if exists public.guardar_ficha_promocion(text, text, text, text, text, text, text, int, int, int, date);
create or replace function public.guardar_ficha_promocion(
	p_promocion text, p_direccion text, p_codigo_postal text, p_municipio text, p_provincia text,
	p_referencia_catastral text, p_tipo text, p_num_viviendas int, p_num_portales int, p_num_plantas int,
	p_fecha_entrega date, p_fase_proyecto text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	if coalesce(p_fase_proyecto, '') not in ('', 'anteproyecto', 'basico', 'ejecucion') then
		raise exception 'Fase del proyecto no válida';
	end if;
	update public.promociones set
		direccion = nullif(btrim(p_direccion), ''),
		codigo_postal = nullif(btrim(p_codigo_postal), ''),
		municipio = nullif(btrim(p_municipio), ''),
		provincia = nullif(btrim(p_provincia), ''),
		referencia_catastral = nullif(upper(replace(btrim(p_referencia_catastral), ' ', '')), ''),
		tipo = nullif(p_tipo, ''),
		num_viviendas = p_num_viviendas,
		num_portales = p_num_portales,
		num_plantas = p_num_plantas,
		fecha_entrega = p_fecha_entrega,
		fase_proyecto = coalesce(nullif(p_fase_proyecto, ''), fase_proyecto)
	where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'ficha_promocion', jsonb_build_object('promocion', p_promocion));
end $$;
revoke all on function public.guardar_ficha_promocion(text, text, text, text, text, text, text, int, int, int, date, text) from public, anon;
grant execute on function public.guardar_ficha_promocion(text, text, text, text, text, text, text, int, int, int, date, text) to authenticated;

-- ─── Lista estándar de documentos ───────────────────────────────────────────

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
		('Calidades', 'Memoria de calidades técnica',
			'No la memoria comercial de la promoción. Sube la documentación técnica vigente que defina con precisión los elementos que debemos reproducir: '
			|| 'dimensiones, espesores, formatos, sistemas, materiales, acabados, marcas, modelos y referencias cuando estén definidos. '
			|| 'Por ejemplo: ventanas (medidas, perfil, sistema, vidrio y acabado), puertas (medidas, modelo, acabado y herrajes), pavimentos (material, formato, espesor y acabado), '
			|| 'cocinas, sanitarios, griferías, barandillas y revestimientos. Puede estar en la memoria técnica, el proyecto, los cuadros de carpinterías y de acabados, '
			|| 'los detalles constructivos o las fichas técnicas de los fabricantes: no hace falta reorganizarla para MUNE.', true, 10, null)
$$;
revoke all on function public.lista_estandar() from public, anon;

-- Listas ya creadas: el nombre nuevo de la memoria (con la explicación al día)…
update public.requisitos r
set bloque = l.bloque, elemento = l.elemento, descripcion = l.descripcion
from public.lista_estandar() l
where l.orden = 10
	and (r.elemento = 'Documentación técnica de materiales, acabados y equipamiento'
		or (r.elemento = 'Memoria de calidades vigente' and r.descripcion = ''));

-- …y fuera «Proyecto básico o de ejecución» donde nadie lo había subido.
update public.requisitos r
set activo = false
where r.elemento = 'Proyecto básico o de ejecución' and r.activo
	and not exists (select 1 from public.documentos d where d.requisito_id = r.id);

select 'Listo: fase del proyecto y memoria de calidades técnica' as resultado;
