-- Fase 1 · paso 11: validación de planos comerciales por la promotora (Etapa 4).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 010. Es repetible.
--
-- Flujo:
--  1. Al preparar una versión se generan sus planos (uno por tipología y
--     variante, o por vivienda en las unifamiliares) y van a la vista previa.
--  2. La administradora revisa la vista previa y pulsa en el Panel «Enviar los
--     planos a la promotora»: se copian al almacén «entregables» y se apuntan
--     aquí, con su huella (archivo) y su huella de datos (geometría, superficies…).
--  3. El equipo de la promotora aprueba o pide cambios en su portal.
--  4. Solo se puede publicar la versión cuando todos sus planos están aprobados
--     (lo comprueba la función «ejecutar» con planos_listos).
--
-- Si un plano no cambia de una versión a otra (misma huella de datos), su
-- aprobación anterior sigue valiendo: no hay que volver a aprobarlo.

-- ─── Datos de cada plano ────────────────────────────────────────────────────

alter table public.entregables
	add column if not exists clave        text check (clave is null or clave ~ '^[a-z0-9-]{1,80}$'),
	add column if not exists titulo       text check (titulo is null or char_length(titulo) <= 160),
	add column if not exists detalle      text check (detalle is null or char_length(detalle) <= 300),
	add column if not exists viviendas    text check (viviendas is null or char_length(viviendas) <= 2000),
	add column if not exists orden        int not null default 0,
	add column if not exists miniatura    text check (miniatura is null or char_length(miniatura) <= 500),
	add column if not exists huella_datos text check (huella_datos is null or huella_datos ~ '^[0-9a-f]{64}$');

create unique index if not exists entregables_plano_unico
	on public.entregables (promocion_id, version, clave) where tipo = 'plano';

grant insert (promocion_id, version, tipo, tipologia, nombre, ruta, huella,
	clave, titulo, detalle, viviendas, orden, miniatura, huella_datos) on public.entregables to authenticated;

alter table public.validaciones add column if not exists avisado boolean not null default false;

-- ─── Solo se valida la última versión enviada ───────────────────────────────

create or replace function public.validacion_nueva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	e public.entregables%rowtype;
	ultima int;
begin
	select * into e from public.entregables where id = new.entregable_id;
	if e.id is null or e.tipo <> 'plano' then
		raise exception 'Solo se validan planos';
	end if;
	select max(substr(x.version, 2)::int) into ultima
	from public.entregables x where x.promocion_id = e.promocion_id and x.tipo = 'plano';
	if substr(e.version, 2)::int <> ultima then
		raise exception 'Este plano es de una versión anterior: valida los de la versión más reciente';
	end if;
	new.promocion_id := e.promocion_id;
	new.version      := e.version;
	new.huella       := e.huella;
	new.user_id      := auth.uid();
	new.momento      := now();
	new.avisado      := false;
	return new;
end $$;

-- ─── Estado de los planos de una versión ────────────────────────────────────
-- Para cada plano: su decisión, o la heredada de una versión anterior con la
-- misma huella de datos (el mismo dibujo).

create or replace function public.planos_de_version(p_promocion text, p_version text)
returns table (
	id bigint, clave text, titulo text, detalle text, viviendas text, orden int,
	ruta text, miniatura text, huella text, decision text, comentario text,
	momento timestamptz, persona text, heredada_de text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso';
	end if;
	return query
	select e.id, e.clave, coalesce(e.titulo, e.nombre), e.detalle, e.viviendas, e.orden,
		e.ruta, e.miniatura, e.huella,
		coalesce(v.decision, h.decision), coalesce(v.comentario, h.comentario),
		coalesce(v.momento, h.momento),
		coalesce(
			(select m.nombre from public.miembros m where m.user_id = coalesce(v.user_id, h.user_id) order by m.id limit 1),
			case when coalesce(v.user_id, h.user_id) is null then null else 'MUNE' end),
		case when v.id is null and h.decision is not null then h.version end
	from public.entregables e
	left join public.validaciones v on v.entregable_id = e.id
	left join lateral (
		select vv.decision, vv.comentario, vv.momento, vv.user_id, vv.version
		from public.entregables ee
		join public.validaciones vv on vv.entregable_id = ee.id and vv.decision = 'aprobado'
		where ee.promocion_id = e.promocion_id and ee.tipo = 'plano' and ee.id <> e.id
			and e.huella_datos is not null and ee.huella_datos = e.huella_datos
			and substr(ee.version, 2)::int < substr(e.version, 2)::int
		order by substr(ee.version, 2)::int desc limit 1
	) h on true
	where e.promocion_id = p_promocion and e.version = p_version and e.tipo = 'plano'
	order by e.orden, e.id;
end $$;
revoke all on function public.planos_de_version(text, text) from public, anon;
grant execute on function public.planos_de_version(text, text) to authenticated;

-- ¿Se puede publicar esta versión?  'sin_enviar' | 'pendientes' | 'cambios' | 'listos'
create or replace function public.planos_listos(p_promocion text, p_version text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when count(*) = 0 then 'sin_enviar'
		when bool_or(p.decision = 'rechazado') then 'cambios'
		when bool_or(p.decision is null) then 'pendientes'
		else 'listos'
	end
	from public.planos_de_version(p_promocion, p_version) p;
$$;
revoke all on function public.planos_listos(text, text) from public, anon;
grant execute on function public.planos_listos(text, text) to authenticated;

-- ─── Aviso por email de cada validación (función «aviso-subida») ────────────

create or replace function public.marcar_aviso_validacion(p_validacion bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	update public.validaciones set avisado = true
	where id = p_validacion and not avisado
		and user_id = auth.uid()
		and momento > now() - interval '30 minutes'
		and public.es_miembro_de_promocion(promocion_id);
	get diagnostics n = row_count;
	return n = 1;
end $$;
revoke all on function public.marcar_aviso_validacion(bigint) from public, anon;
grant execute on function public.marcar_aviso_validacion(bigint) to authenticated;

select 'Listo: validación de planos por la promotora' as resultado;
