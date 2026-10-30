-- Comentarios visuales (29/10/2026, decidido por la administradora).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 037 (o de la última
-- que se haya pegado: no depende de 035, 036 ni 037). Es repetible.
--
-- El equipo de la promotora comenta una versión sin escribir dónde: pulsa en
-- el sitio del plano comercial o del 3D y escribe. El punto es opcional: sin
-- él, el comentario es general de ese plano, de esa tipología o de toda la
-- versión.
--  · Dos cosas separadas: la Experiencia 3D (y los planos), que se comenta al
--    validarla, y la personalización (packs, opciones y su aspecto en el 3D),
--    que se comenta en su pestaña o en el 3D en modo Personalizar.
--  · Pendiente de enviar → Enviado: mientras se comenta, los comentarios
--    quedan pendientes; al pulsar «Pedir cambios» (en la validación o en la
--    personalización) se envían todos juntos. Claude solo trabaja con lo
--    enviado, y el email a MUNE sale entonces (no con cada comentario).
--  · Notas de MUNE para Claude: la administradora comenta igual la vista previa
--    (plano, 3D o general) y pulsa «Devolver a Claude». La promotora no las ve.
--  · Al preparar la versión nueva, Claude (el robot) marca como resueltos los
--    comentarios que esa versión arregla; la administradora lo comprueba en la
--    vista previa antes de enviarla. Si la promotora responde a uno resuelto,
--    se reabre y vuelve a quedar pendiente de enviar.
--  · El robot lee los comentarios y marca los resueltos (solo con una versión
--    que aún no se ha enviado a validar); no escribe, no responde ni borra.

create table if not exists public.comentarios (
	id                bigint generated always as identity primary key,
	promocion_id      text not null references public.promociones (id) on delete cascade,
	version           text not null check (version ~ '^v[0-9]{1,5}$'),
	tipo              text not null,
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
	avisado           boolean not null default false
);
alter table public.comentarios add column if not exists interno boolean not null default false;
alter table public.comentarios add column if not exists enviado_en timestamptz;
alter table public.comentarios drop constraint if exists comentarios_tipo_check;
alter table public.comentarios drop constraint if exists comentarios_check;
alter table public.comentarios drop constraint if exists comentarios_sitio_check;
alter table public.comentarios add constraint comentarios_sitio_check check (
	tipo in ('version', 'plano', 'experiencia', 'personalizacion')
	and (tipo <> 'version' or clave is null)
	and (tipo not in ('plano', 'experiencia') or clave is not null));
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
		when p_tipo in ('experiencia', 'personalizacion') then
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

-- ¿Puede la sesión comentar aquí? MUNE, o el equipo con acceso a la promoción
-- (la personalización, solo con la capacidad «personalizacion»).
create or replace function public._puede_comentar(p_promocion text, p_tipo text default null)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.es_admin() or (public.es_miembro_de_promocion(p_promocion)
		and (p_tipo is distinct from 'personalizacion' or public.equipo_puede(p_promocion, 'personalizacion')));
$$;
revoke all on function public._puede_comentar(text, text) from public, anon, authenticated;
drop function if exists public._puede_comentar(text);

-- ¿Es de MUNE quien entra con este pase? (la administradora, desde MUNE Studio)
create or replace function public._es_de_mune(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.administradores a where a.user_id = p_user);
$$;
revoke all on function public._es_de_mune(uuid) from public, anon, authenticated;

-- Escribe un comentario (o una respuesta, con p_padre). p_mune: lo escribe el
-- equipo de MUNE (lo comprueba quien llama). Lo de MUNE que no responde a la
-- promotora es una nota interna para Claude.
drop function if exists public._comentar(text, text, text, text, jsonb, text, bigint);
create or replace function public._comentar(p_promocion text, p_version text, p_tipo text, p_clave text,
	p_punto jsonb, p_texto text, p_padre bigint, p_mune boolean)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	padre public.comentarios%rowtype;
	v_id bigint;
	v_texto text := btrim(coalesce(p_texto, ''));
	v_autor text;
begin
	if char_length(v_texto) = 0 then
		raise exception 'Escribe el comentario';
	end if;
	if char_length(v_texto) > 2000 then
		raise exception 'El comentario es demasiado largo (máximo 2000 caracteres)';
	end if;
	if (select count(*) from public.comentarios c where c.user_id = auth.uid() and c.creado_en > now() - interval '1 hour') >= 200 then
		raise exception 'Demasiados comentarios seguidos. Espera un poco y vuelve a probar.';
	end if;
	v_autor := case when p_mune then 'Equipo de MUNE' else coalesce((select m.nombre from public.miembros m
		join public.promociones pr on pr.promotora_id = m.promotora_id
		where m.user_id = auth.uid() and pr.id = p_promocion order by m.id limit 1), '—') end;

	if p_padre is not null then
		select * into padre from public.comentarios c where c.id = p_padre and c.promocion_id = p_promocion and c.padre_id is null;
		if padre.id is null or (padre.interno and not p_mune) then
			raise exception 'No encontramos ese comentario';
		end if;
		if not (p_mune or public._puede_comentar(p_promocion, padre.tipo)) then
			raise exception 'No tienes acceso a esta promoción';
		end if;
		insert into public.comentarios (promocion_id, version, tipo, clave, punto, texto, padre_id, user_id, autor, de_mune, interno)
		values (p_promocion, padre.version, padre.tipo, padre.clave, null, v_texto, padre.id, auth.uid(), v_autor, p_mune, padre.interno)
		returning id into v_id;
		-- si la promotora responde a uno resuelto, se reabre y queda pendiente de enviar
		if not p_mune and padre.resuelto_en is not null then
			update public.comentarios set resuelto_en = null, resuelto_version = null, enviado_en = null, avisado = false where id = padre.id;
		end if;
		return v_id;
	end if;

	if not (p_mune or public._puede_comentar(p_promocion, p_tipo)) then
		raise exception 'No tienes acceso a esta promoción';
	end if;
	if p_tipo not in ('version', 'plano', 'experiencia', 'personalizacion')
		or (p_tipo = 'version' and p_clave is not null)
		or (p_tipo in ('plano', 'experiencia') and p_clave is null)
		or (p_clave is not null and p_clave !~ '^[a-z0-9][a-z0-9-]{0,79}$') then
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
	insert into public.comentarios (promocion_id, version, tipo, clave, punto, texto, user_id, autor, de_mune, interno)
	values (p_promocion, p_version, p_tipo, p_clave, p_punto, v_texto, auth.uid(), v_autor, p_mune, p_mune)
	returning id into v_id;
	return v_id;
end $$;
revoke all on function public._comentar(text, text, text, text, jsonb, text, bigint, boolean) from public, anon, authenticated;

-- Desde MUNE Portal y MUNE Studio.
create or replace function public.comentar(p_promocion text, p_version text, p_tipo text, p_clave text,
	p_punto jsonb, p_texto text, p_padre bigint default null)
returns bigint
language sql
volatile
security definer
set search_path = ''
as $$
	select public._comentar(p_promocion, p_version, p_tipo, p_clave, p_punto, p_texto, p_padre, public.es_admin());
$$;
revoke all on function public.comentar(text, text, text, text, jsonb, text, bigint) from public, anon;
grant execute on function public.comentar(text, text, text, text, jsonb, text, bigint) to authenticated;

-- Desde el 3D profesional, con el pase de la persona (027): en modo Vivienda,
-- de la Experiencia 3D; en modo Personalizar, de la personalización.
drop function if exists public.comentar_profesional(text, text, text, text, jsonb, text, bigint);
create or replace function public.comentar_profesional(p_promocion text, p_pase text, p_version text, p_tipo text, p_clave text,
	p_punto jsonb, p_texto text, p_padre bigint default null)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_user uuid := public._pase_valido(p_promocion, p_pase);
begin
	if v_user is null then
		raise exception 'Tu acceso al 3D ha caducado. Vuelve a abrirlo desde MUNE Portal.';
	end if;
	if p_padre is null and p_tipo not in ('experiencia', 'personalizacion') then
		raise exception 'No se puede comentar aquí';
	end if;
	return public._comentar(p_promocion, p_version, p_tipo, p_clave, p_punto, p_texto, p_padre, public._es_de_mune(v_user));
end $$;
revoke all on function public.comentar_profesional(text, text, text, text, text, jsonb, text, bigint) from public;
grant execute on function public.comentar_profesional(text, text, text, text, text, jsonb, text, bigint) to anon, authenticated;

-- Los hilos de una promoción, con sus respuestas (los más recientes primero).
-- Las notas internas de MUNE, solo para MUNE y el robot.
drop function if exists public._hilos(text);
create or replace function public._hilos(p_promocion text, p_internos boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(jsonb_agg(jsonb_build_object(
		'id', c.id, 'version', c.version, 'tipo', c.tipo, 'clave', c.clave, 'punto', c.punto, 'texto', c.texto,
		'autor', c.autor, 'de_mune', c.de_mune, 'interno', c.interno, 'mio', c.user_id = auth.uid(), 'creado_en', c.creado_en,
		'enviado_en', c.enviado_en, 'resuelto_en', c.resuelto_en, 'resuelto_version', c.resuelto_version,
		'respuestas', coalesce((select jsonb_agg(jsonb_build_object(
			'id', r.id, 'texto', r.texto, 'autor', r.autor, 'de_mune', r.de_mune, 'mio', r.user_id = auth.uid(), 'creado_en', r.creado_en)
			order by r.creado_en) from public.comentarios r where r.padre_id = c.id), '[]'::jsonb))
		order by c.creado_en desc), '[]'::jsonb)
	from public.comentarios c
	where c.promocion_id = p_promocion and c.padre_id is null and (p_internos or not c.interno);
$$;
revoke all on function public._hilos(text, boolean) from public, anon, authenticated;

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
	return public._hilos(p_promocion, public.es_admin() or public.es_robot());
end $$;
revoke all on function public.comentarios_de(text) from public, anon;
grant execute on function public.comentarios_de(text) to authenticated;

-- En el 3D profesional: los hilos del 3D (Experiencia 3D y personalización).
create or replace function public.comentarios_profesional(p_promocion text, p_pase text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_user uuid := public._pase_valido(p_promocion, p_pase);
begin
	if v_user is null then
		return null;
	end if;
	return (select coalesce(jsonb_agg(h), '[]'::jsonb) from jsonb_array_elements(public._hilos(p_promocion, public._es_de_mune(v_user))) h
		where h->>'tipo' in ('experiencia', 'personalizacion')
			and (h->>'tipo' = 'experiencia' or public._es_de_mune(v_user) or public.equipo_puede(p_promocion, 'personalizacion')));
end $$;
revoke all on function public.comentarios_profesional(text, text) from public;
grant execute on function public.comentarios_profesional(text, text) to anon, authenticated;

-- Pendiente de enviar → Enviado. Al pedir cambios de un plano o una tipología
-- (validación «rechazado»), se envían sus comentarios pendientes y los de toda
-- la versión.
create or replace function public.comentarios_al_pedir_cambios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	e public.entregables%rowtype;
begin
	if new.decision <> 'rechazado' then
		return null;
	end if;
	select * into e from public.entregables where id = new.entregable_id;
	update public.comentarios c set enviado_en = now()
	where c.promocion_id = e.promocion_id and c.enviado_en is null and not c.interno and c.resuelto_en is null
		and ((c.tipo = case e.tipo when 'plano' then 'plano' else 'experiencia' end and c.clave = e.clave) or c.tipo = 'version');
	return null;
end $$;
drop trigger if exists comentarios_al_pedir_cambios on public.validaciones;
create trigger comentarios_al_pedir_cambios after insert on public.validaciones
	for each row execute function public.comentarios_al_pedir_cambios();

-- «Pedir cambios» de la personalización (MUNE Portal, con «personalizacion»):
-- envía sus comentarios pendientes. Devuelve cuántos.
create or replace function public.pedir_cambios_personalizacion(p_promocion text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if public.es_admin() or not public._puede_comentar(p_promocion, 'personalizacion') then
		raise exception 'Para pedir cambios de la personalización necesitas la capacidad «Personalización»';
	end if;
	update public.comentarios c set enviado_en = now()
	where c.promocion_id = p_promocion and c.tipo = 'personalizacion' and c.enviado_en is null and not c.interno and c.resuelto_en is null;
	get diagnostics n = row_count;
	if n = 0 then
		raise exception 'Escribe primero qué hay que cambiar: un comentario aquí o en el 3D, en modo Personalizar.';
	end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'pide cambios de la personalización', jsonb_build_object('promocion', p_promocion, 'comentarios', n));
	return n;
end $$;
revoke all on function public.pedir_cambios_personalizacion(text) from public, anon;
grant execute on function public.pedir_cambios_personalizacion(text) to authenticated;

-- «Devolver a Claude» (MUNE Studio): envía las notas internas pendientes.
create or replace function public.devolver_a_claude(p_promocion text)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not public.es_admin() then
		raise exception 'Sin permiso';
	end if;
	update public.comentarios c set enviado_en = now()
	where c.promocion_id = p_promocion and c.interno and c.padre_id is null and c.enviado_en is null and c.resuelto_en is null;
	get diagnostics n = row_count;
	if n = 0 then
		raise exception 'Escribe primero qué hay que corregir (una nota aquí, en un plano o en el 3D).';
	end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'devuelve a Claude', jsonb_build_object('promocion', p_promocion, 'notas', n));
	return n;
end $$;
revoke all on function public.devolver_a_claude(text) from public, anon;
grant execute on function public.devolver_a_claude(text) to authenticated;

-- Al preparar una versión, Claude (el robot) marca como resueltos los
-- comentarios enviados que esa versión arregla. Solo mientras la versión no se
-- haya enviado a validar. La administradora también puede, como soporte.
create or replace function public.resolver_comentarios(p_promocion text, p_version text, p_comentarios bigint[])
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not (public.es_robot() or public.es_admin()) then
		raise exception 'Sin permiso';
	end if;
	if p_version !~ '^v[0-9]{1,5}$' then
		raise exception 'Versión no válida';
	end if;
	if exists (select 1 from public.entregables e where e.promocion_id = p_promocion and e.version = p_version) then
		raise exception 'La % ya se ha enviado a validar: ya no se pueden marcar comentarios como resueltos en ella', p_version;
	end if;
	update public.comentarios c set resuelto_en = now(), resuelto_version = p_version
	where c.promocion_id = p_promocion and c.id = any (coalesce(p_comentarios, '{}')) and c.padre_id is null
		and c.enviado_en is not null and c.resuelto_en is null
		and substr(c.version, 2)::int < substr(p_version, 2)::int;
	get diagnostics n = row_count;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'comentarios resueltos', jsonb_build_object('promocion', p_promocion, 'version', p_version, 'comentarios', to_jsonb(p_comentarios), 'marcados', n));
	return n;
end $$;
revoke all on function public.resolver_comentarios(text, text, bigint[]) from public, anon;
grant execute on function public.resolver_comentarios(text, text, bigint[]) to authenticated;

-- Si Claude marcó uno por error, la administradora lo reabre.
drop function if exists public.resolver_comentario(bigint, boolean, text);
create or replace function public.reabrir_comentario(p_comentario bigint)
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
		raise exception 'Sin permiso';
	end if;
	update public.comentarios set resuelto_en = null, resuelto_version = null
	where id = p_comentario and padre_id is null and resuelto_en is not null
	returning * into c;
	if c.id is null then
		raise exception 'No encontramos ese comentario';
	end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'comentario reabierto', jsonb_build_object('promocion', c.promocion_id, 'comentario', c.id));
end $$;
revoke all on function public.reabrir_comentario(bigint) from public, anon;
grant execute on function public.reabrir_comentario(bigint) to authenticated;

-- Quien lo escribió puede borrarlo mientras no se haya enviado ni tenga respuestas ajenas.
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
	if c.enviado_en is not null then
		raise exception 'Ya se ha enviado: no se puede borrar';
	end if;
	if exists (select 1 from public.comentarios r where r.padre_id = c.id and r.user_id is distinct from auth.uid()) then
		raise exception 'Ya tiene respuestas: no se puede borrar';
	end if;
	delete from public.comentarios where id = c.id;
end $$;
revoke all on function public.borrar_comentario(bigint) from public, anon;
grant execute on function public.borrar_comentario(bigint) to authenticated;

-- Aviso a MUNE (función «aviso-subida»): lo enviado por la promotora que aún no
-- se ha avisado, ya marcado como avisado. Cada comentario avisa una sola vez.
drop function if exists public.marcar_aviso_comentarios(text, text);
create or replace function public.marcar_aviso_comentarios(p_promocion text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v jsonb;
begin
	if not public._puede_comentar(p_promocion) then
		raise exception 'Sin permiso';
	end if;
	with nuevos as (
		update public.comentarios c set avisado = true
		where c.promocion_id = p_promocion and not c.avisado and not c.interno and c.enviado_en is not null and c.padre_id is null
		returning c.*)
	select coalesce(jsonb_agg(jsonb_build_object(
		'version', n.version, 'tipo', n.tipo, 'clave', n.clave, 'con_punto', n.punto is not null,
		'texto', n.texto, 'autor', n.autor,
		'titulo', (select coalesce(e.titulo, e.nombre) from public.entregables e
			where e.promocion_id = n.promocion_id and e.clave = n.clave
				and e.tipo = case n.tipo when 'plano' then 'plano' else 'experiencia' end
			order by substr(e.version, 2)::int desc limit 1))
		order by n.creado_en), '[]'::jsonb) into v
	from nuevos n;
	return v;
end $$;
revoke all on function public.marcar_aviso_comentarios(text) from public, anon;
grant execute on function public.marcar_aviso_comentarios(text) to authenticated;

-- Para la bandeja de Inicio de MUNE Studio: por promoción, los comentarios que
-- la promotora ha enviado y aún no resuelve ninguna versión, y los pendientes
-- de enviar (todavía los está escribiendo).
drop function if exists public.comentarios_abiertos();
create or replace function public.comentarios_abiertos()
returns table (promocion_id text, enviados int, pendientes int)
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
	select c.promocion_id,
		(count(*) filter (where c.enviado_en is not null))::int,
		(count(*) filter (where c.enviado_en is null))::int
	from public.comentarios c
	where c.padre_id is null and c.resuelto_en is null and not c.interno
	group by c.promocion_id;
end $$;
revoke all on function public.comentarios_abiertos() from public, anon;
grant execute on function public.comentarios_abiertos() to authenticated;

select 'Listo: comentarios visuales' as resultado;
