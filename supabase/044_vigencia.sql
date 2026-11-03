-- Vigencia de planos y tipologías: «Requiere actualizar» (3/11/2026, decidido
-- por la administradora; decisión 69).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 043. Es repetible.
--
-- Cada plano comercial y cada tipología de la Experiencia 3D se ve con su
-- vigencia: Vigente (aprobado, en la versión publicada o la última validada),
-- Pendiente de validar (en la versión que se está validando) o Requiere
-- actualizar. Esto último lo marca el equipo de MUNE (Claude, con el robot, o
-- la administradora) cuando la promotora aporta documentación que cambia algo
-- ya preparado: qué plano o qué tipología, con una nota y, si se quiere, el
-- documento que lo motiva. Se resuelve al preparar la versión que lo incorpora
-- (entonces pasa a «Pendiente de validar» en esa versión). La administradora
-- puede quitar una marca puesta por error.
--  · Lo ven MUNE Studio, el robot y el equipo de la promotora de esa promoción.
--  · Solo el robot y la administradora marcan y resuelven; nadie borra filas.

create table if not exists public.actualizaciones (
	id              bigint generated always as identity primary key,
	promocion_id    text not null references public.promociones (id) on delete cascade,
	tipo            text not null check (tipo in ('plano', 'experiencia')),
	-- la clave del plano o de la tipología, como en sus entregables
	clave           text not null check (char_length(clave) between 1 and 120),
	nota            text not null check (char_length(btrim(nota)) between 3 and 1000),
	documento_id    bigint references public.documentos (id) on delete set null,
	marcada_por     uuid references auth.users (id) on delete set null default auth.uid(),
	marcada_en      timestamptz not null default now(),
	-- la versión que la incorpora (al prepararla)
	resuelta_version text check (resuelta_version is null or resuelta_version ~ '^v[0-9]{1,5}$'),
	resuelta_en     timestamptz,
	-- quitada por la administradora (puesta por error)
	quitada_en      timestamptz
);
create index if not exists actualizaciones_abiertas on public.actualizaciones (promocion_id, tipo, clave)
	where resuelta_en is null and quitada_en is null;
alter table public.actualizaciones enable row level security;
revoke all on public.actualizaciones from anon, authenticated;
grant select on public.actualizaciones to authenticated;
drop policy if exists "leen las actualizaciones" on public.actualizaciones;
create policy "leen las actualizaciones" on public.actualizaciones for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));

-- Marca un plano o una tipología como «Requiere actualizar» (robot o administradora).
create or replace function public.marcar_actualizacion(
	p_promocion text, p_tipo text, p_clave text, p_nota text, p_documento bigint default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_id bigint;
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo el equipo de MUNE marca lo que requiere actualizar';
	end if;
	if p_tipo not in ('plano', 'experiencia') then
		raise exception 'Tipo no válido';
	end if;
	if not exists (select 1 from public.entregables e where e.promocion_id = p_promocion and e.tipo = p_tipo and e.clave = p_clave) then
		raise exception 'Esa promoción no tiene ese plano o esa tipología';
	end if;
	if p_documento is not null and not exists (select 1 from public.documentos d where d.id = p_documento and d.promocion_id = p_promocion) then
		raise exception 'Ese documento no es de esta promoción';
	end if;
	if exists (select 1 from public.actualizaciones a where a.promocion_id = p_promocion and a.tipo = p_tipo and a.clave = p_clave
			and a.resuelta_en is null and a.quitada_en is null) then
		raise exception 'Ya está marcado como «Requiere actualizar»';
	end if;
	insert into public.actualizaciones (promocion_id, tipo, clave, nota, documento_id)
	values (p_promocion, p_tipo, p_clave, btrim(p_nota), p_documento)
	returning id into v_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'marca que requiere actualizar', jsonb_build_object('promocion', p_promocion, 'tipo', p_tipo, 'clave', p_clave, 'id', v_id));
	return v_id;
end $$;
revoke all on function public.marcar_actualizacion(text, text, text, text, bigint) from public, anon;
grant execute on function public.marcar_actualizacion(text, text, text, text, bigint) to authenticated;

-- Al preparar una versión, las que incorpora (robot o administradora). La
-- versión tiene que estar preparada y en revisión.
create or replace function public.resolver_actualizaciones(p_promocion text, p_version text, p_ids bigint[])
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo el equipo de MUNE resuelve lo que requiere actualizar';
	end if;
	if not exists (select 1 from public.versiones_promocion v where v.promocion_id = p_promocion and v.version = p_version and v.estado = 'en_revision') then
		raise exception 'Esa versión no está preparada y en revisión';
	end if;
	update public.actualizaciones a set resuelta_version = p_version, resuelta_en = now()
	where a.promocion_id = p_promocion and a.id = any (p_ids) and a.resuelta_en is null and a.quitada_en is null;
	get diagnostics n = row_count;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'resuelve lo que requería actualizar', jsonb_build_object('promocion', p_promocion, 'version', p_version, 'ids', p_ids, 'resueltas', n));
	return n;
end $$;
revoke all on function public.resolver_actualizaciones(text, text, bigint[]) from public, anon;
grant execute on function public.resolver_actualizaciones(text, text, bigint[]) to authenticated;

-- Quitar una marca puesta por error (solo la administradora).
create or replace function public.quitar_actualizacion(p_id bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_promocion text;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	update public.actualizaciones set quitada_en = now()
	where id = p_id and resuelta_en is null and quitada_en is null
	returning promocion_id into v_promocion;
	if v_promocion is null then
		raise exception 'No hay ninguna marca abierta con ese número';
	end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'quita una marca de requiere actualizar', jsonb_build_object('promocion', v_promocion, 'id', p_id));
end $$;
revoke all on function public.quitar_actualizacion(bigint) from public, anon;
grant execute on function public.quitar_actualizacion(bigint) to authenticated;

select 'Listo: vigencia (requiere actualizar)' as resultado;
