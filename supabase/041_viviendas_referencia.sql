-- Vivienda de referencia de cada tipología (31/10/2026, decidido por la
-- administradora; decisión 66).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 039 (y de 040, si ya
-- está). Es repetible.
--
-- Desde dentro de cada tipología, por las ventanas se ve lo que hay de verdad
-- alrededor (el entorno real o la urbanización), según dónde esté la vivienda.
-- Como una tipología se repite en varias plantas y portales, la promotora elige
-- en MUNE Portal (Documentación) una vivienda concreta de cada tipología y
-- variante: la «vivienda de referencia». Si falta alguna, «preparar» se detiene
-- y se le pide por email que la elija.
--  · Elige el equipo de la promotora con la capacidad «Documentación» o quien
--    administra la promoción; también la administradora, como soporte.
--  · La lista sale de la tabla de viviendas que el equipo de MUNE ha pasado a
--    datos (modelo de la promoción, 035): solo referencia, portal, planta y
--    tipología; nada privado.
--  · El robot de Claude la lee al preparar una versión. No puede cambiarla.

create table if not exists public.viviendas_referencia (
	promocion_id text not null references public.promociones (id) on delete cascade,
	-- la unidad: tipología y variante («a», «a-espejo»…), o «vivienda-<ref>» en una unifamiliar
	unidad       text not null check (unidad ~ '^[a-z0-9-]{1,80}$'),
	ref          text not null check (char_length(ref) between 1 and 80),
	elegida_por  uuid references auth.users (id) on delete set null,
	elegida_en   timestamptz not null default now(),
	primary key (promocion_id, unidad)
);
alter table public.viviendas_referencia enable row level security;
revoke all on public.viviendas_referencia from anon, authenticated;

-- La clave de una unidad, igual que en la Experiencia 3D (claveUnidad).
create or replace function public._clave_unidad(p_tipo text, p_vivienda jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
	select trim(both '-' from regexp_replace(normalize(lower(
		case when p_tipo = 'unifamiliar' then 'vivienda-' || coalesce(p_vivienda->>'ref', '')
		else coalesce(p_vivienda->>'tipologia', '') || case when coalesce((p_vivienda->>'espejo')::boolean, false) then '-espejo' else '' end end
	), NFD), '[^a-z0-9]+', '-', 'g'));
$$;
revoke all on function public._clave_unidad(text, jsonb) from public, anon;

-- ¿Puede elegir? El equipo con «Documentación», quien administra la promoción o la administradora.
create or replace function public._elige_referencia(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.es_admin() or public.administra_promocion(p_promocion) or public.equipo_puede(p_promocion, 'documentacion');
$$;
revoke all on function public._elige_referencia(text) from public, anon;
grant execute on function public._elige_referencia(text) to authenticated;

-- Las unidades de la promoción con sus viviendas y la elegida:
-- [{ unidad, tipologia, espejo, viviendas: [{ ref, portal, planta }], elegida, elegida_en }]
create or replace function public.viviendas_para_referencia(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_promocion jsonb;
begin
	if not (public._elige_referencia(p_promocion) or public.es_robot()) then
		raise exception 'No tienes acceso a las viviendas de esta promoción';
	end if;
	select (m.archivos->>'promocion.json')::jsonb into v_promocion from public.modelo_promocion m
	where m.promocion_id = p_promocion and m.version is null order by m.id desc limit 1;
	if v_promocion is null then
		return '[]'::jsonb;
	end if;
	return coalesce((
		select jsonb_agg(jsonb_build_object(
			'unidad', u.unidad, 'tipologia', u.tipologia, 'espejo', u.espejo, 'viviendas', u.viviendas,
			'elegida', r.ref, 'elegida_en', r.elegida_en) order by u.orden)
		from (
			select public._clave_unidad(v_promocion->'promocion'->>'tipo', v) as unidad,
				min(v->>'tipologia') as tipologia, bool_or(coalesce((v->>'espejo')::boolean, false)) as espejo, min(o) as orden,
				jsonb_agg(jsonb_build_object('ref', v->>'ref', 'portal', v->'portal', 'planta', v->>'planta') order by o) as viviendas
			from jsonb_array_elements(coalesce(v_promocion->'viviendas', '[]'::jsonb)) with ordinality as x(v, o)
			where coalesce(v->>'ref', '') <> ''
			group by 1
		) u
		left join public.viviendas_referencia r on r.promocion_id = p_promocion and r.unidad = u.unidad
	), '[]'::jsonb);
end $$;
revoke all on function public.viviendas_para_referencia(text) from public, anon;
grant execute on function public.viviendas_para_referencia(text) to authenticated;

-- Elige (o cambia) la vivienda de referencia de una unidad. Tiene que ser una
-- vivienda de esa unidad en la tabla de viviendas.
create or replace function public.elegir_vivienda_referencia(p_promocion text, p_unidad text, p_ref text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_unidades jsonb;
begin
	if not public._elige_referencia(p_promocion) then
		raise exception 'No puedes elegir las viviendas de referencia de esta promoción';
	end if;
	v_unidades := public.viviendas_para_referencia(p_promocion);
	if not exists (
		select 1 from jsonb_array_elements(v_unidades) u, jsonb_array_elements(u->'viviendas') v
		where u->>'unidad' = p_unidad and v->>'ref' = p_ref
	) then
		raise exception 'Esa vivienda no es de esa tipología';
	end if;
	insert into public.viviendas_referencia (promocion_id, unidad, ref, elegida_por, elegida_en)
	values (p_promocion, p_unidad, p_ref, auth.uid(), now())
	on conflict (promocion_id, unidad) do update set ref = excluded.ref, elegida_por = excluded.elegida_por, elegida_en = now();
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'elige la vivienda de referencia', jsonb_build_object('promocion', p_promocion, 'unidad', p_unidad, 'vivienda', p_ref));
end $$;
revoke all on function public.elegir_vivienda_referencia(text, text, text) from public, anon;
grant execute on function public.elegir_vivienda_referencia(text, text, text) to authenticated;

-- Email a la promotora pidiendo las que faltan (función «avisar-promotora», tipo «referencias»).
alter table public.avisos_enviados drop constraint if exists avisos_enviados_tipo_check;
alter table public.avisos_enviados add constraint avisos_enviados_tipo_check
	check (tipo in ('planos', 'experiencia', 'rechazado', 'publicada', 'referencias'));

select 'Listo: viviendas de referencia' as resultado;
