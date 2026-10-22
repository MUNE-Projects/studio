-- Lista maestra · paso 4: copias de seguridad y simulacro (receta 18).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 022. Es repetible.
--
-- Cada noche, el proceso «copias.yml» de GitHub guarda en el almacén privado
-- MUNE-Projects/copias, cifrado con una contraseña que solo tienes tú:
--  · la base de datos (todo lo de MUNE y los usuarios, con su contraseña cifrada
--    y su código del móvil), leída con el usuario «copias» de la base de datos,
--    que solo puede leer;
--  · los archivos nuevos (documentación, entregables y fotos de referencia),
--    leídos con la cuenta «copias» de MUNE, que solo puede ver archivos.
-- Cada tres meses, «simulacro.yml» restaura la última copia en un Supabase de
-- prueba dentro de GitHub y comprueba que está todo.
--
-- Después de ejecutar este archivo hay que darle una contraseña al usuario
-- «copias» de la base de datos (receta 18, paso 2):
--   alter role copias with password '…';

-- ═══ 1. Usuario «copias» de la base de datos: solo lectura ══════════════════

do $$
begin
	if not exists (select 1 from pg_roles where rolname = 'copias') then
		-- Sin contraseña no puede entrar: se la pones tú después.
		create role copias login bypassrls;
	end if;
end $$;
alter role copias nocreatedb nocreaterole noinherit bypassrls connection limit 2;

grant usage on schema public, storage to copias;
grant select on all tables in schema public to copias;
grant select on all sequences in schema public to copias;
-- Las tablas que se creen en el futuro también se copian.
alter default privileges for role postgres in schema public grant select on tables to copias;
alter default privileges for role postgres in schema public grant select on sequences to copias;
grant select on storage.objects to copias;

-- Los usuarios (auth) no se pueden leer directamente: se ven a través de este
-- esquema, que no está en la API y solo puede leer «copias».
create schema if not exists copias;
revoke all on schema copias from public, anon, authenticated;
create or replace view copias.usuarios as select * from auth.users;
create or replace view copias.identidades as select * from auth.identities;
create or replace view copias.factores as select * from auth.mfa_factors;
revoke all on all tables in schema copias from public, anon, authenticated;
grant usage on schema copias to copias;
grant select on all tables in schema copias to copias;

-- ═══ 2. Cuenta «copias» de MUNE: solo ve archivos ═══════════════════════════
-- La creas tú en Authentication → Users (receta 18, paso 3) y se marca aquí.

create table if not exists public.cuentas_copias (
	user_id   uuid primary key references auth.users (id) on delete cascade,
	creado_en timestamptz not null default now()
);
alter table public.cuentas_copias enable row level security;
revoke all on public.cuentas_copias from anon, authenticated;

insert into public.cuentas_copias (user_id)
select u.id from auth.users u where lower(u.email) = 'hello.muneprojects+copias@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.es_copias()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.cuentas_copias c where c.user_id = auth.uid());
$$;
revoke all on function public.es_copias() from public, anon;
grant execute on function public.es_copias() to authenticated;

drop policy if exists "copias ve los archivos" on storage.objects;
create policy "copias ve los archivos" on storage.objects
	for select to authenticated
	using (bucket_id in ('documentos', 'entregables', 'referencias') and public.es_copias());

-- ═══ 3. Registro de copias y simulacros ═════════════════════════════════════

create table if not exists public.copias_hechas (
	id        bigint generated always as identity primary key,
	tipo      text not null check (tipo in ('copia', 'simulacro')),
	momento   timestamptz not null default now(),
	correcta  boolean not null,
	detalle   jsonb not null default '{}'::jsonb check (pg_column_size(detalle) < 4000)
);
alter table public.copias_hechas enable row level security;
revoke all on public.copias_hechas from anon, authenticated;
grant select on public.copias_hechas to authenticated;
drop policy if exists "admin lee copias" on public.copias_hechas;
create policy "admin lee copias" on public.copias_hechas for select to authenticated using (public.es_admin());

-- La llama copias.yml (o simulacro.yml) al terminar, con la cuenta «copias».
create or replace function public.registrar_copia(p_tipo text, p_correcta boolean, p_detalle jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_copias() then
		raise exception 'Solo la cuenta de copias puede registrar copias';
	end if;
	insert into public.copias_hechas (tipo, correcta, detalle)
	values (p_tipo, p_correcta, coalesce(p_detalle, '{}'::jsonb));
	delete from public.copias_hechas where momento < now() - interval '400 days';
end $$;
revoke all on function public.registrar_copia(text, boolean, jsonb) from public, anon;
grant execute on function public.registrar_copia(text, boolean, jsonb) to authenticated;

-- ═══ 4. Llaves: la B también guarda las copias ══════════════════════════════

update public.llaves set
	para_que = 'Copiar la web a experience al publicar y guardar las copias de seguridad',
	donde = 'GitHub, almacén studio → Settings → Secrets and variables → Actions (permiso sobre experience y copias)'
where id = 'llave-b';
update public.llaves set donde = 'Supabase → Edge Functions → Secrets (permiso sobre el almacén studio)'
where id = 'llave-a';

-- ═══ 5. Avisos y estado del sistema, con las copias ═════════════════════════

create or replace function public.avisos_sistema()
returns table (clave text, nivel text, titulo text, detalle text, enlace text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	l record;
	dias int;
	ultimo timestamptz;
	usado bigint;
	c record;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede ver los avisos del sistema';
	end if;

	-- Llaves: alerta a 30 días o menos, aviso a 60
	for l in select * from public.llaves order by caduca loop
		dias := l.caduca - current_date;
		if dias <= 60 then
			clave := 'llave:' || l.id;
			nivel := case when dias <= 30 then 'alerta' else 'aviso' end;
			titulo := case when dias < 0 then l.nombre || ' ha caducado'
				when dias = 0 then l.nombre || ' caduca hoy'
				else l.nombre || ' caduca en ' || dias || ' días' end;
			detalle := 'Sirve para: ' || l.para_que || '. Hay que crear una nueva en GitHub y guardarla en ' || l.donde
				|| '. Sigue la receta 19 (o pídele a Claude que te guíe) y luego apunta la fecha nueva en Sistema.';
			enlace := '#/sistema';
			return next;
		end if;
	end loop;

	-- Vigilancia automática: debería dar señales cada 3 días
	select la.ultimo into ultimo from public.latido la where la.id = 1;
	if ultimo is null or ultimo < now() - interval '4 days' then
		clave := 'latido';
		nivel := 'aviso';
		titulo := 'La vigilancia automática no da señales';
		detalle := case when ultimo is null then 'Todavía no ha llamado nunca.'
			else 'La última vez fue el ' || to_char(ultimo at time zone 'Europe/Madrid', 'DD/MM/YYYY') || '.' end
			|| ' Es el proceso de GitHub que mantiene despierto Supabase y avisa de las llaves. Díselo a Claude.';
		enlace := '#/sistema';
		return next;
	end if;

	-- Copias de seguridad: una cada noche
	select max(ch.momento) into ultimo from public.copias_hechas ch where ch.tipo = 'copia' and ch.correcta;
	if ultimo is null or ultimo < now() - interval '2 days' then
		clave := 'copias';
		nivel := case when ultimo is null then 'info' else 'alerta' end;
		titulo := case when ultimo is null then 'Todavía no hay ninguna copia de seguridad'
			else 'La copia de seguridad no se hace desde el ' || to_char(ultimo at time zone 'Europe/Madrid', 'DD/MM/YYYY') end;
		detalle := case when ultimo is null then 'Sigue la receta 18 para ponerlas en marcha (o pídele a Claude que te guíe).'
			else 'Cada noche se guarda una copia en GitHub. Díselo a Claude para que mire qué falla.' end;
		enlace := '#/sistema';
		return next;
	end if;
	select ch.momento, ch.correcta into c from public.copias_hechas ch
		where ch.tipo = 'simulacro' order by ch.momento desc limit 1;
	if ultimo is not null and (c.momento is null or not c.correcta or c.momento < now() - interval '100 days') then
		clave := 'simulacro';
		nivel := case when c.momento is not null and not c.correcta then 'alerta' else 'aviso' end;
		titulo := case when c.momento is null then 'Falta el primer simulacro de recuperación'
			when not c.correcta then 'El último simulacro de recuperación ha fallado'
			else 'Toca un simulacro de recuperación' end;
		detalle := 'Comprueba que las copias se pueden recuperar. Es automático cada tres meses; si no ha ido bien, díselo a Claude.';
		enlace := '#/sistema';
		return next;
	end if;

	-- Espacio del plan gratuito: base de datos 500 MB, archivos 1 GB
	usado := pg_database_size(current_database());
	if usado > 0.8 * 500 * 1024 * 1024 then
		clave := 'espacio:datos';
		nivel := case when usado > 0.95 * 500 * 1024 * 1024 then 'alerta' else 'aviso' end;
		titulo := 'La base de datos está al ' || round(100.0 * usado / (500 * 1024 * 1024)) || ' %';
		detalle := 'El plan gratuito de Supabase permite 500 MB. Habla con Claude antes de que se llene.';
		enlace := '#/sistema';
		return next;
	end if;
	select coalesce(sum((o.metadata->>'size')::bigint), 0) into usado from storage.objects o;
	if usado > 0.8 * 1024 * 1024 * 1024 then
		clave := 'espacio:archivos';
		nivel := case when usado > 0.95 * 1024 * 1024 * 1024 then 'alerta' else 'aviso' end;
		titulo := 'Los archivos ocupan el ' || round(100.0 * usado / (1024 * 1024 * 1024)) || ' % del espacio';
		detalle := 'El plan gratuito de Supabase permite 1 GB de archivos (documentación, planos y fotos). Habla con Claude antes de que se llene.';
		enlace := '#/sistema';
		return next;
	end if;

	-- Invitaciones sin aceptar desde hace más de 7 días, por promotora
	for l in
		select p.id, p.nombre, count(*) as n
		from public.miembros m
		join public.promotoras p on p.id = m.promotora_id
		join auth.users u on u.id = m.user_id
		where m.activo and u.email_confirmed_at is null and m.creado_en < now() - interval '7 days'
		group by p.id, p.nombre order by p.nombre
	loop
		clave := 'invitaciones:' || l.id;
		nivel := 'info';
		titulo := l.nombre || ': ' || l.n || case when l.n = 1 then ' invitación sin aceptar' else ' invitaciones sin aceptar' end;
		detalle := 'Hace más de una semana que se enviaron. Puedes reenviarlas desde la promotora.';
		enlace := '#/promotora/' || l.id;
		return next;
	end loop;

	-- Accesos que nadie usa desde hace más de 90 días, por promotora
	for l in
		select p.id, p.nombre, count(*) as n
		from public.miembros m
		join public.promotoras p on p.id = m.promotora_id
		join auth.users u on u.id = m.user_id
		where m.activo and u.email_confirmed_at is not null
			and coalesce(u.last_sign_in_at, m.creado_en) < now() - interval '90 days'
		group by p.id, p.nombre order by p.nombre
	loop
		clave := 'sin-uso:' || l.id;
		nivel := 'info';
		titulo := l.nombre || ': ' || l.n || case when l.n = 1 then ' acceso sin usar' else ' accesos sin usar' end || ' desde hace más de 3 meses';
		detalle := 'Si esa persona ya no trabaja en la promoción, quítale el acceso.';
		enlace := '#/promotora/' || l.id;
		return next;
	end loop;
end $$;
revoke all on function public.avisos_sistema() from public, anon;
grant execute on function public.avisos_sistema() to authenticated;

create or replace function public.estado_sistema()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede ver el estado del sistema';
	end if;
	return jsonb_build_object(
		'datos', pg_database_size(current_database()),
		'datos_limite', 500::bigint * 1024 * 1024,
		'archivos', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
		'archivos_limite', 1024::bigint * 1024 * 1024,
		'latido', (select la.ultimo from public.latido la where la.id = 1),
		'llaves', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.nombre, 'para_que', l.para_que,
			'donde', l.donde, 'caduca', l.caduca, 'renovada_en', l.renovada_en) order by l.caduca, l.id) from public.llaves l), '[]'::jsonb),
		'copias', coalesce((select jsonb_agg(jsonb_build_object('tipo', x.tipo, 'momento', x.momento, 'correcta', x.correcta,
			'detalle', x.detalle) order by x.momento desc) from (
				select * from public.copias_hechas ch order by ch.momento desc limit 10) x), '[]'::jsonb),
		'ultima_copia', (select max(ch.momento) from public.copias_hechas ch where ch.tipo = 'copia' and ch.correcta),
		'ultimo_simulacro', (select jsonb_build_object('momento', ch.momento, 'correcta', ch.correcta)
			from public.copias_hechas ch where ch.tipo = 'simulacro' order by ch.momento desc limit 1));
end $$;
revoke all on function public.estado_sistema() from public, anon;
grant execute on function public.estado_sistema() to authenticated;

select 'Listo: copias de seguridad preparadas. Falta la contraseña del usuario copias (receta 18)' as resultado;
