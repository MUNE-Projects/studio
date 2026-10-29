-- Comentarios visuales (29/10/2026, decidido por la administradora).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 037 (o de la última
-- que se haya pegado: no depende de 035, 036 ni 037). Es repetible.
--
-- El equipo de la promotora comenta una versión sin escribir dónde: pulsa en
-- el sitio del plano comercial o del 3D y escribe. El punto es opcional: sin
-- él, el comentario es general de ese plano o de esa tipología; y también hay
-- comentarios generales de toda la versión.
--  · Puede comentar todo el equipo con acceso a la promoción (MUNE Portal, o el
--    3D profesional con su pase). Validar sigue siendo solo de quien valida, y
--    «Pedir cambios» recoge solos los comentarios abiertos (lo hace el Portal).
--  · Cada comentario es un hilo: el equipo de MUNE y la promotora responden, y
--    el equipo de MUNE lo marca «Resuelto» (con la versión que lo resuelve). Si
--    la promotora responde a uno resuelto, se vuelve a abrir.
--  · Los comentarios de un plano o una tipología siguen a la vista en las
--    versiones siguientes mientras estén abiertos (van por su clave).
--  · Aviso a MUNE: un email con todo lo nuevo, agrupado (función «aviso-subida»
--    con { comentarios: <promoción> }, que llama a marcar_aviso_comentarios).
--  · El robot de Claude los lee (para preparar la versión siguiente); no puede
--    escribir, responder ni resolver.

create table if not exists public.comentarios (
	id                bigint generated always as identity primary key,
	promocion_id      text not null references public.promociones (id) on delete cascade,
	version           text not null check (version ~ '^v[0-9]{1,5}$'),
	tipo              text not null check (tipo in ('version', 'plano', 'experiencia')),
	clave             text check (clave is null or clave ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
	punto             jsonb check (punto is null or pg_column_size(punto) < 2000),
	texto             text not null check (char_length(btrim(texto)) between 1 and 2000),
	padre_id          bigint references public.comentarios (id) on delete cascade,
	user_id           uuid references auth.users (id) on delete set null,
	autor             text not null default '—',
	de_mune           boolean not null default false,
	creado_en         timestamptz not null default now(),
	resuelto_en       timestamptz,
	resuelto_version  text check (resuelto_version is null or resuelto_version ~ '^v[0-9]{1,5}$'),
	avisado           boolean not null default false,
	check ((tipo = 'version') = (clave is null))
);
create index if not exists comentarios_por_promocion on public.comentarios (promocion_id, creado_en);
create index if not exists comentarios_por_padre on public.comentarios (padre_id);
alter table public.comentarios enable row level security;
-- Sin acceso directo: todo pasa por las funciones de abajo.
revoke all on public.comentarios from anon, authenticated;

-- ¿El punto tiene la forma que toca? Plano: {x, y} entre 0 y 1 (sobre la
-- imagen). 3D: {p, cam, obj} (el sitio, y desde dónde se miraba), la planta y
-- la vista.
create or replace function public._punto_valido(p_tipo text, p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select case
		when p is null then true
		when jsonb_typeof(p) <> 'object' then false
		when p_tipo = 'plano' then
			(select count(*) = 2 from jsonb_object_keys(p))
			and jsonb_typeof(p->'x') = 'number' and jsonb_typeof(p->'y') = 'number'
			and (p->>'x')::numeric between 0 and 1 and (p->>'y')::numeric between 0 and 1
		when p_tipo = 'experiencia' then
			(select bool_and(k in ('p', 'cam', 'obj', 'planta', 'vista')) from jsonb_object_keys(p) k)
			and (select bool_and(jsonb_typeof(p->k) = 'array' and jsonb_array_length(p->k) = 3
				and (select bool_and(jsonb_typeof(n) = 'number' and abs((n #>> '{}')::numeric) < 100000) from jsonb_array_elements(p->k) n))
				from unnest(array['p', 'cam', 'obj']) k)
			and (p->'planta' is null or (jsonb_typeof(p->'planta') = 'number' and (p->>'planta')::numeric in (0, 1, 2, 3, 4, 5, 6, 7, 8, 9)))
			and (p->'vista' is null or (jsonb_typeof(p->'vista') = 'string' and char_length(p->>'vista') <= 120))
		else false
	end;
$$;
revoke all on function public._punto_valido(text, jsonb) from public, anon, authenticated;

-- ¿Puede la sesión comentar en esta promoción? MUNE o el equipo con acceso.
create or replace function public._puede_comentar(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.es_admin() or public.es_miembro_de_promocion(p_promocion);
$$;
revoke all on function public._puede_comentar(text) from public, anon, authenticated;

-- Escribe un comentario (o una respuesta, con p_padre) en nombre de la sesión.
create or replace function public._comentar(p_promocion text, p_version text, p_tipo text, p_clave text,
	p_punto jsonb, p_texto text, p_padre bigint)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	padre public.comentarios%rowtype;
	v_id bigint;
	v_admin boolean := public.es_admin();
	v_texto text := btrim(coalesce(p_texto, ''));
begin
	if not public._puede_comentar(p_promocion) then
		raise exception 'No tienes acceso a esta promoción';
	end if;
	if char_length(v_texto) = 0 then
		raise exception 'Escribe el comentario';
	end if;
	if char_length(v_texto) > 2000 then
		raise exception 'El comentario es demasiado largo (máximo 2000 caracteres)';
	end if;
	if (select count(*) from public.comentarios c where c.user_id = auth.uid() and c.creado_en > now() - interval '1 hour') >= 200 then
		raise exception 'Demasiados comentarios seguidos. Espera un poco y vuelve a probar.';
	end if;

	if p_padre is not null then
		select * into padre from public.comentarios c where c.id = p_padre and c.promocion_id = p_promocion and c.padre_id is null;
		if padre.id is null then
			raise exception 'No encontramos ese comentario';
		end if;
		insert into public.comentarios (promocion_id, version, tipo, clave, punto, texto, padre_id, user_id, autor, de_mune)
		values (p_promocion, padre.version, padre.tipo, padre.clave, null, v_texto, padre.id, auth.uid(),
			coalesce((select m.nombre from public.miembros m join public.promociones pr on pr.promotora_id = m.promotora_id
				where m.user_id = auth.uid() and pr.id = p_promocion order by m.id limit 1), case when v_admin then 'Equipo de MUNE' else '—' end),
			v_admin)
		returning id into v_id;
		-- si la promotora responde a uno resuelto, se vuelve a abrir
		if not v_admin and padre.resuelto_en is not null then
			update public.comentarios set resuelto_en = null, resuelto_version = null where id = padre.id;
		end if;
		return v_id;
	end if;

	if p_tipo not in ('version', 'plano', 'experiencia') then
		raise exception 'No se puede comentar aquí';
	end if;
	if (p_tipo = 'version') <> (p_clave is null) or (p_clave is not null and p_clave !~ '^[a-z0-9][a-z0-9-]{0,79}$') then
		raise exception 'No se puede comentar aquí';
	end if;
	if p_tipo = 'version' and p_punto is not null then
		raise exception 'Un comentario de toda la versión no lleva punto';
	end if;
	if not public._punto_valido(p_tipo, p_punto) then
		raise exception 'El punto marcado no es válido';
	end if;
	if p_version !~ '^v[0-9]{1,5}$' or not (
		exists (select 1 from public.entregables e where e.promocion_id = p_promocion and e.version = p_version)
		or exists (select 1 from public.datos_privados dp where dp.promocion_id = p_promocion and dp.version = p_version)) then
		raise exception 'Esa versión no existe';
	end if;
	insert into public.comentarios (promocion_id, version, tipo, clave, punto, texto, user_id, autor, de_mune)
	values (p_promocion, p_version, p_tipo, p_clave, p_punto, v_texto, auth.uid(),
		coalesce((select m.nombre from public.miembros m join public.promociones pr on pr.promotora_id = m.promotora_id
			where m.user_id = auth.uid() and pr.id = p_promocion order by m.id limit 1), case when v_admin then 'Equipo de MUNE' else '—' end),
		v_admin)
	returning id into v_id;
	return v_id;
end $$;
revoke all on function public._comentar(text, text, text, text, jsonb, text, bigint) from public, anon, authenticated;

-- Desde MUNE Portal y MUNE Studio.
create or replace function public.comentar(p_promocion text, p_version text, p_tipo text, p_clave text,
	p_punto jsonb, p_texto text, p_padre bigint default null)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
	select public._comentar(p_promocion, p_version, p_tipo, p_clave, p_punto, p_texto, p_padre);
$$;
revoke all on function public.comentar(text, text, text, text, jsonb, text, bigint) from public, anon;
grant execute on function public.comentar(text, text, text, text, jsonb, text, bigint) to authenticated;

-- Desde el 3D profesional, con el pase de la persona (027).
create or replace function public.comentar_profesional(p_promocion text, p_pase text, p_version text, p_clave text,
	p_punto jsonb, p_texto text, p_padre bigint default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if public._pase_valido(p_promocion, p_pase) is null then
		raise exception 'Tu acceso al 3D ha caducado. Vuelve a abrirlo desde MUNE Portal.';
	end if;
	return public._comentar(p_promocion, p_version, 'experiencia', p_clave, p_punto, p_texto, p_padre);
end $$;
revoke all on function public.comentar_profesional(text, text, text, text, jsonb, text, bigint) from public;
grant execute on function public.comentar_profesional(text, text, text, text, jsonb, text, bigint) to anon, authenticated;

-- Los hilos de una promoción, con sus respuestas (los más recientes primero).
create or replace function public._hilos(p_promocion text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(jsonb_agg(jsonb_build_object(
		'id', c.id, 'version', c.version, 'tipo', c.tipo, 'clave', c.clave, 'punto', c.punto, 'texto', c.texto,
		'autor', c.autor, 'de_mune', c.de_mune, 'mio', c.user_id = auth.uid(), 'creado_en', c.creado_en,
		'resuelto_en', c.resuelto_en, 'resuelto_version', c.resuelto_version,
		'respuestas', coalesce((select jsonb_agg(jsonb_build_object(
			'id', r.id, 'texto', r.texto, 'autor', r.autor, 'de_mune', r.de_mune, 'mio', r.user_id = auth.uid(), 'creado_en', r.creado_en)
			order by r.creado_en) from public.comentarios r where r.padre_id = c.id), '[]'::jsonb))
		order by c.creado_en desc), '[]'::jsonb)
	from public.comentarios c
	where c.promocion_id = p_promocion and c.padre_id is null;
$$;
revoke all on function public._hilos(text) from public, anon, authenticated;

create or replace function public.comentarios_de(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public._puede_comentar(p_promocion) or public.es_robot()) then
		raise exception 'No tienes acceso a esta promoción';
	end if;
	return public._hilos(p_promocion);
end $$;
revoke all on function public.comentarios_de(text) from public, anon;
grant execute on function public.comentarios_de(text) to authenticated;

-- En el 3D profesional: los hilos de la Experiencia 3D (para poner sus marcas).
create or replace function public.comentarios_profesional(p_promocion text, p_pase text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if public._pase_valido(p_promocion, p_pase) is null then
		return null;
	end if;
	return (select coalesce(jsonb_agg(h), '[]'::jsonb) from jsonb_array_elements(public._hilos(p_promocion)) h where h->>'tipo' = 'experiencia');
end $$;
revoke all on function public.comentarios_profesional(text, text) from public;
grant execute on function public.comentarios_profesional(text, text) to anon, authenticated;

-- El equipo de MUNE marca un hilo como resuelto (en una versión) o lo reabre.
create or replace function public.resolver_comentario(p_comentario bigint, p_resuelto boolean, p_version text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	c public.comentarios%rowtype;
begin
	if not public.es_admin() then
		raise exception 'Solo el equipo de MUNE marca los comentarios como resueltos';
	end if;
	select * into c from public.comentarios where id = p_comentario and padre_id is null;
	if c.id is null then
		raise exception 'No encontramos ese comentario';
	end if;
	if p_resuelto and p_version is not null and p_version !~ '^v[0-9]{1,5}$' then
		raise exception 'Versión no válida';
	end if;
	update public.comentarios
	set resuelto_en = case when p_resuelto then now() end,
		resuelto_version = case when p_resuelto then coalesce(p_version, c.version) end
	where id = c.id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), case when p_resuelto then 'comentario resuelto' else 'comentario reabierto' end,
		jsonb_build_object('promocion', c.promocion_id, 'comentario', c.id, 'version', p_version));
end $$;
revoke all on function public.resolver_comentario(bigint, boolean, text) from public, anon;
grant execute on function public.resolver_comentario(bigint, boolean, text) to authenticated;

-- Quien lo escribió puede borrar su comentario mientras nadie haya respondido.
create or replace function public.borrar_comentario(p_comentario bigint)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	c public.comentarios%rowtype;
begin
	select * into c from public.comentarios where id = p_comentario;
	if c.id is null or c.user_id is distinct from auth.uid() or not public._puede_comentar(c.promocion_id) then
		raise exception 'Solo puedes borrar tus propios comentarios';
	end if;
	if exists (select 1 from public.comentarios r where r.padre_id = c.id and r.user_id is distinct from auth.uid()) then
		raise exception 'Ya tiene respuestas: no se puede borrar';
	end if;
	delete from public.comentarios where id = c.id;
end $$;
revoke all on function public.borrar_comentario(bigint) from public, anon;
grant execute on function public.borrar_comentario(bigint) to authenticated;

-- Aviso a MUNE (función «aviso-subida»): lo nuevo de la promotora en esta
-- promoción que aún no se ha avisado, ya marcado como avisado. Cada comentario
-- avisa una sola vez; si no hay nada nuevo, nada.
create or replace function public.marcar_aviso_comentarios(p_promocion text, p_pase text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v jsonb;
begin
	if p_pase is not null then
		if public._pase_valido(p_promocion, p_pase) is null then
			raise exception 'Sin permiso';
		end if;
	elsif not public._puede_comentar(p_promocion) then
		raise exception 'Sin permiso';
	end if;
	with nuevos as (
		update public.comentarios c set avisado = true
		where c.promocion_id = p_promocion and not c.avisado and not c.de_mune
		returning c.*)
	select coalesce(jsonb_agg(jsonb_build_object(
		'version', n.version, 'tipo', n.tipo, 'clave', n.clave, 'con_punto', n.punto is not null,
		'texto', n.texto, 'autor', n.autor, 'respuesta', n.padre_id is not null,
		'titulo', (select coalesce(e.titulo, e.nombre) from public.entregables e
			where e.promocion_id = n.promocion_id and e.clave = n.clave
				and e.tipo = case n.tipo when 'plano' then 'plano' else 'experiencia' end
			order by substr(e.version, 2)::int desc limit 1))
		order by n.creado_en), '[]'::jsonb) into v
	from nuevos n;
	return v;
end $$;
revoke all on function public.marcar_aviso_comentarios(text, text) from public;
grant execute on function public.marcar_aviso_comentarios(text, text) to anon, authenticated;

-- Para la bandeja de Inicio de MUNE Studio: hilos abiertos por promoción, y
-- los que esperan respuesta de MUNE (el último mensaje es de la promotora).
create or replace function public.comentarios_abiertos()
returns table (promocion_id text, abiertos int, sin_respuesta int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Sin permiso';
	end if;
	return query
	select c.promocion_id, count(*)::int,
		count(*) filter (where not coalesce((select r.de_mune from public.comentarios r where r.padre_id = c.id order by r.creado_en desc limit 1), c.de_mune))::int
	from public.comentarios c
	where c.padre_id is null and c.resuelto_en is null
	group by c.promocion_id;
end $$;
revoke all on function public.comentarios_abiertos() from public, anon;
grant execute on function public.comentarios_abiertos() to authenticated;

-- La cuenta de las funciones (service_role) no la usa: no necesita grant (013).

select 'Listo: comentarios visuales' as resultado;
