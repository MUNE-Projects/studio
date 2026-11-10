-- Plazos de conservación (decisión 73; preparado el 10/11/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 047. Es repetible.
-- Lo aplica cada noche el proceso «Aplicar los plazos de conservación» de GitHub
-- (conservacion.yml), con la cuenta «ejecutor». A mano, con «simular», solo
-- cuenta lo que haría, sin borrar nada.
--
-- Plazos:
--  · un acceso retirado deja de entrar al momento (como hasta ahora);
--  · la CUENTA de una persona se elimina a los 30 días de quedarse sin ningún
--    acceso activo (ni a una promoción activa ni a una promotora activa). Las
--    cuentas internas (administradora, robot de Claude, «ejecutor», copias)
--    nunca. Antes de eliminarla se guarda aparte quién era (nombre, cargo, email
--    y a qué tenía acceso), para que sus aprobaciones, entregas y selecciones
--    sigan teniendo nombre;
--  · registro de actividad técnico (entradas, descargas, peticiones del Panel,
--    marcas de trabajo…) y pruebas rutinarias (copias y simulacros): 90 días;
--  · registros de avisos automáticos de MUNE (avisos_enviados y «avisa a la
--    promotora por email» del registro): 12 meses;
--  · NO se borra nunca solo: lo que es prueba (publicar, volver atrás, enviar a
--    validar, validaciones y aprobaciones, selecciones, exportaciones,
--    eliminaciones y peticiones de eliminar sin exportación, autorizaciones de
--    portfolio, altas, accesos dados…) ni nada del registro que no esté en la
--    lista técnica de abajo.
-- Con una recuperación de copia sin comprobar (045) no se borra nada.
--
-- Para ver en el SQL Editor qué cuentas están esperando y cuándo se eliminarían:
--   select u.email, c.desde, c.desde + interval '30 days' as se_elimina
--   from public.cuentas_sin_acceso c join auth.users u on u.id = c.user_id order by c.desde;

-- ═══ 1. Que eliminar una cuenta no rompa ni borre las pruebas ═══════════════
-- Las tablas que apuntan a la cuenta de quien subió, validó o eligió algo
-- conservan su identificador (sin la restricción que impedía eliminar la cuenta);
-- quién era queda en «personas_retiradas».
do $$
declare r record;
begin
	for r in select n.nspname, t.relname, c.conname
		from pg_constraint c
		join pg_class t on t.oid = c.conrelid
		join pg_namespace n on n.oid = t.relnamespace
		where c.contype = 'f' and c.confrelid = 'auth.users'::regclass and n.nspname = 'public'
			and c.confdeltype in ('a', 'r')   -- sin «on delete»: impiden eliminar la cuenta
	loop
		execute format('alter table %I.%I drop constraint %I', r.nspname, r.relname, r.conname);
	end loop;
end $$;

create table if not exists public.personas_retiradas (
	id           bigint generated always as identity primary key,
	user_id      uuid not null,
	nombre       text,
	cargo        text,
	email        text,
	promotora_id uuid,
	promocion_id text,
	eliminada_en timestamptz not null default now()
);
alter table public.personas_retiradas enable row level security;
revoke all on public.personas_retiradas from anon, authenticated;
grant select on public.personas_retiradas to authenticated;
drop policy if exists "MUNE ve las personas retiradas" on public.personas_retiradas;
create policy "MUNE ve las personas retiradas" on public.personas_retiradas for select to authenticated
	using (public.es_admin());

-- Desde cuándo una cuenta no tiene ningún acceso activo (la apunta el proceso de cada noche)
create table if not exists public.cuentas_sin_acceso (
	user_id uuid primary key,
	desde   timestamptz not null default now()
);
alter table public.cuentas_sin_acceso enable row level security;
revoke all on public.cuentas_sin_acceso from anon, authenticated;

-- Lo que ha hecho cada noche (solo números)
create table if not exists public.conservacion_hecha (
	id       bigint generated always as identity primary key,
	momento  timestamptz not null default now(),
	simulada boolean not null,
	resumen  jsonb not null default '{}'::jsonb
);
alter table public.conservacion_hecha enable row level security;
revoke all on public.conservacion_hecha from anon, authenticated;
grant select on public.conservacion_hecha to authenticated;
drop policy if exists "MUNE ve la conservación" on public.conservacion_hecha;
create policy "MUNE ve la conservación" on public.conservacion_hecha for select to authenticated
	using (public.es_admin() or public.es_ejecutor());

-- ═══ 2. Qué es técnico en el registro de actividad ══════════════════════════
-- Solo estas acciones se borran a los 90 días; cualquier otra se conserva.
create or replace function public.acciones_tecnicas()
returns text[]
language sql
immutable
set search_path = ''
as $$
	select array[
		'entra en el panel', 'activa doble verificación', 'quita el código del móvil',
		'descarga un documento', 'robot descarga un documento', 'robot descarga fotos de referencia',
		'robot actualiza una petición', 'pide cambios', 'descarta una petición',
		'pide generar el entorno', 'genera el entorno',
		'guarda los datos de una promoción', 'guarda los datos privados',
		'comentarios resueltos', 'comentario reabierto', 'devuelve a Claude',
		'pone en actualización', 'quita «En actualización»', 'resuelve lo que estaba en actualización',
		'añade un documento a la lista', 'exporta una promoción', 'exporta una promotora',
		'reenvía acceso al portal', 'apunta una llave renovada'
	]::text[];
$$;

-- Avisos automáticos de MUNE en el registro (12 meses)
create or replace function public.acciones_de_aviso()
returns text[]
language sql
immutable
set search_path = ''
as $$
	select array['avisa a la promotora por email']::text[];
$$;

-- ═══ 3. Aplicar los plazos ══════════════════════════════════════════════════
create or replace function public.aplicar_conservacion(p_simular boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_cuentas      uuid[];
	v_a_eliminar   uuid[];
	v_esperando    int;
	v_proxima      timestamptz;
	v_registro     int;
	v_avisos_reg   int;
	v_avisos       int;
	v_copias       int;
	v_noches       int;
	v_resumen      jsonb;
begin
	if not (public.es_ejecutor() or public.es_admin()) then
		raise exception 'Solo la cuenta «ejecutor» o la administradora aplican los plazos';
	end if;
	if public.restauracion_pendiente() then
		return jsonb_build_object('cerrado', 'Hay una copia recuperada sin comprobar: no se borra nada');
	end if;

	-- cuentas sin ningún acceso activo (nunca las internas)
	select coalesce(array_agg(u.id), '{}') into v_cuentas
	from auth.users u
	where not exists (select 1 from public.administradores a where a.user_id = u.id)
		and not exists (select 1 from public.robots r where r.user_id = u.id)
		and not exists (select 1 from public.cuentas_ejecutor e where e.user_id = u.id)
		and not exists (select 1 from public.cuentas_copias c where c.user_id = u.id)
		and not exists (
			select 1 from public.miembros m
			join public.promotoras po on po.id = m.promotora_id
			left join public.promociones pr on pr.id = m.promocion_id
			where m.user_id = u.id and m.activo and po.activa
				and (m.promocion_id is null or coalesce(pr.activa, false)));

	if not p_simular then
		delete from public.cuentas_sin_acceso s where not (s.user_id = any (v_cuentas));
		insert into public.cuentas_sin_acceso (user_id) select unnest(v_cuentas) on conflict do nothing;
	end if;
	select coalesce(array_agg(s.user_id), '{}') into v_a_eliminar
	from public.cuentas_sin_acceso s
	where s.user_id = any (v_cuentas) and s.desde <= now() - interval '30 days';
	select count(*), min(s.desde) + interval '30 days' into v_esperando, v_proxima
	from public.cuentas_sin_acceso s
	where s.user_id = any (v_cuentas) and not (s.user_id = any (v_a_eliminar));

	if not p_simular and cardinality(v_a_eliminar) > 0 then
		-- quién era, aparte, antes de eliminar la cuenta (sus accesos se borran con ella)
		insert into public.personas_retiradas (user_id, nombre, cargo, email, promotora_id, promocion_id)
		select m.user_id, m.nombre, m.cargo, m.email, m.promotora_id, m.promocion_id
		from public.miembros m where m.user_id = any (v_a_eliminar);
		insert into public.personas_retiradas (user_id, email)
		select u.id, u.email from auth.users u
		where u.id = any (v_a_eliminar) and not exists (select 1 from public.miembros m where m.user_id = u.id);
		delete from auth.users u where u.id = any (v_a_eliminar);
		delete from public.cuentas_sin_acceso s where s.user_id = any (v_a_eliminar);
	end if;

	-- registro técnico: 90 días; avisos automáticos: 12 meses
	select count(*) into v_registro from public.registro r
		where r.momento < now() - interval '90 days' and r.accion = any (public.acciones_tecnicas());
	select count(*) into v_avisos_reg from public.registro r
		where r.momento < now() - interval '12 months' and r.accion = any (public.acciones_de_aviso());
	select count(*) into v_avisos from public.avisos_enviados a where a.enviado_en < now() - interval '12 months';
	-- copias y simulacros (pruebas rutinarias): 90 días, siempre queda el último de cada tipo
	select count(*) into v_copias from public.copias_hechas c
		where c.momento < now() - interval '90 days'
			and c.id <> (select max(c2.id) from public.copias_hechas c2 where c2.tipo = c.tipo);
	select count(*) into v_noches from public.conservacion_hecha h where h.momento < now() - interval '90 days';

	if not p_simular then
		delete from public.registro r where r.momento < now() - interval '90 days' and r.accion = any (public.acciones_tecnicas());
		delete from public.registro r where r.momento < now() - interval '12 months' and r.accion = any (public.acciones_de_aviso());
		delete from public.avisos_enviados a where a.enviado_en < now() - interval '12 months';
		delete from public.copias_hechas c
			where c.momento < now() - interval '90 days'
				and c.id <> (select max(c2.id) from public.copias_hechas c2 where c2.tipo = c.tipo);
		delete from public.conservacion_hecha h where h.momento < now() - interval '90 days';
	end if;

	v_resumen := jsonb_build_object(
		'cuentas_eliminadas', cardinality(v_a_eliminar),
		'cuentas_esperando', coalesce(v_esperando, 0) + case when p_simular then
			(select count(*) from unnest(v_cuentas) x where not exists (select 1 from public.cuentas_sin_acceso s where s.user_id = x))::int else 0 end,
		'proxima_eliminacion', v_proxima,
		'registro_tecnico', v_registro,
		'registro_avisos', v_avisos_reg,
		'avisos_enviados', v_avisos,
		'copias_y_simulacros', v_copias,
		'noches_anteriores', v_noches);
	insert into public.conservacion_hecha (simulada, resumen) values (p_simular, v_resumen);
	return v_resumen;
end $$;
revoke all on function public.aplicar_conservacion(boolean) from public, anon;
grant execute on function public.aplicar_conservacion(boolean) to authenticated;

-- ═══ 4. Corregir solo un comentario que lleva un dato personal ══════════════
-- (MUNE Studio → «Quitar un dato personal», solo la administradora). Sustituye
-- el texto; en el registro queda que se corrigió, sin copiar el original.
create or replace function public.corregir_comentario(p_comentario bigint, p_texto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare c public.comentarios;
begin
	if not public.es_admin() then
		raise exception 'Solo el equipo de MUNE corrige un comentario';
	end if;
	select * into c from public.comentarios where id = p_comentario;
	if not found or c.de_mune then
		raise exception 'Ese comentario no existe o es del equipo de MUNE';
	end if;
	if char_length(btrim(coalesce(p_texto, ''))) not between 1 and 2000 then
		raise exception 'Escribe el comentario corregido (hasta 2000 caracteres)';
	end if;
	update public.comentarios set texto = btrim(p_texto) where id = p_comentario;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'corrige un dato personal de un comentario', jsonb_build_object('promocion', c.promocion_id, 'comentario', c.id));
end $$;
revoke all on function public.corregir_comentario(bigint, text) from public, anon;
grant execute on function public.corregir_comentario(bigint, text) to authenticated;

select 'Listo: plazos de conservación preparados (los aplica cada noche conservacion.yml)' as resultado;
