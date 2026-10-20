-- Fase 1 · paso 14: códigos de comprador (Etapa 5, receta 24).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 013. Es repetible.
--
-- · Un código por vivienda. Solo se guarda su huella (SHA-256), nunca el
--   código: se ve una sola vez, al generarlo.
-- · Lo generan y cambian la promotora (portal) y la administradora (Panel).
--   Cambiarlo invalida el anterior al momento. Al cambiarlo se indica si es
--   el mismo comprador (conserva lo que eligió) o uno nuevo (empieza de cero:
--   lo del anterior queda en el historial, que solo ven MUNE y la promotora).
-- · No caducan: valen hasta que se cambian o se borra la promoción.
-- · El comprador entra desde el botón de la web pública: entrar_comprador
--   comprueba el código, con límite de intentos, y devuelve su vivienda y lo
--   que ya tiene formalizado. Es lo único de la web pública que usa Supabase.

-- ─── Códigos ────────────────────────────────────────────────────────────────

create table if not exists public.codigos_comprador (
	id            bigint generated always as identity primary key,
	promocion_id  text not null references public.promociones (id),
	vivienda_ref  text not null check (char_length(vivienda_ref) between 1 and 60),
	huella        text not null unique check (huella ~ '^[0-9a-f]{64}$'),
	comprador     int not null default 1,           -- 1, 2… cambia con cada comprador nuevo
	activo        boolean not null default true,
	creado_en     timestamptz not null default now(),
	creado_por    uuid default auth.uid() references auth.users (id) on delete set null,
	ultimo_acceso timestamptz,
	accesos       int not null default 0
);
create unique index if not exists codigos_comprador_activo
	on public.codigos_comprador (promocion_id, vivienda_ref) where activo;
alter table public.codigos_comprador enable row level security;
revoke all on public.codigos_comprador from anon, authenticated;
-- (nadie los lee directamente: se ven con codigos_de_promocion)

-- ─── Lo que cada comprador ha formalizado (antes iba en la web pública) ─────

create table if not exists public.selecciones_comprador (
	id            bigint generated always as identity primary key,
	promocion_id  text not null references public.promociones (id),
	vivienda_ref  text not null check (char_length(vivienda_ref) between 1 and 60),
	comprador     int not null default 1,
	pack          text not null check (char_length(pack) between 1 and 80),
	opciones      jsonb not null default '{}'::jsonb check (pg_column_size(opciones) < 8000),
	fecha         date not null,
	creado_en     timestamptz not null default now(),
	unique (promocion_id, vivienda_ref, comprador, pack)
);
alter table public.selecciones_comprador enable row level security;
revoke all on public.selecciones_comprador from anon, authenticated;
grant select on public.selecciones_comprador to authenticated;
grant insert (promocion_id, vivienda_ref, comprador, pack, opciones, fecha) on public.selecciones_comprador to authenticated;

drop policy if exists "leen selecciones" on public.selecciones_comprador;
create policy "leen selecciones" on public.selecciones_comprador
	for select to authenticated
	using (public.es_admin() or public.es_miembro_de_promocion(promocion_id));
drop policy if exists "admin registra selecciones" on public.selecciones_comprador;
create policy "admin registra selecciones" on public.selecciones_comprador
	for insert to authenticated with check (public.es_admin());

-- Lo formalizado en la promoción de demostración (antes en su promocion.json).
insert into public.selecciones_comprador (promocion_id, vivienda_ref, comprador, pack, opciones, fecha)
select 'residencial-demo', 'Bajo A', 1, 'distribuciones', '{"distribucion": "alternativa"}'::jsonb, date '2026-07-21'
where exists (select 1 from public.promociones where id = 'residencial-demo')
on conflict do nothing;

-- ─── Intentos de entrada (para el límite) ───────────────────────────────────

create table if not exists public.intentos_comprador (
	id            bigint generated always as identity primary key,
	promocion_id  text not null,
	cliente       text not null,          -- huella de la dirección de quien lo intenta
	acierto       boolean not null,
	momento       timestamptz not null default now()
);
create index if not exists intentos_comprador_reciente on public.intentos_comprador (promocion_id, cliente, momento);
alter table public.intentos_comprador enable row level security;
revoke all on public.intentos_comprador from anon, authenticated;

-- ─── Generar o cambiar el código de una vivienda ────────────────────────────

create or replace function public.generar_codigo_comprador(p_promocion text, p_vivienda text, p_nuevo_comprador boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	anterior public.codigos_comprador%rowtype;
	codigo text;
	numero int;
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso para los códigos de esta promoción';
	end if;
	if char_length(btrim(coalesce(p_vivienda, ''))) not between 1 and 60 then
		raise exception 'Vivienda no válida';
	end if;
	select * into anterior from public.codigos_comprador
	where promocion_id = p_promocion and vivienda_ref = p_vivienda and activo;
	select coalesce(max(comprador), 0) into numero from public.codigos_comprador
	where promocion_id = p_promocion and vivienda_ref = p_vivienda;
	if numero = 0 then numero := 1;
	elsif p_nuevo_comprador then numero := numero + 1;
	end if;

	update public.codigos_comprador set activo = false where id = anterior.id;
	-- 12 cifras hexadecimales al azar (48 bits); con el límite de intentos no se pueden adivinar
	codigo := 'c-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
	insert into public.codigos_comprador (promocion_id, vivienda_ref, huella, comprador)
	values (p_promocion, p_vivienda, encode(sha256(convert_to(codigo, 'UTF8')), 'hex'), numero);

	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), case when anterior.id is null then 'genera un código de comprador'
		when p_nuevo_comprador then 'cambia el código (comprador nuevo)' else 'cambia el código (mismo comprador)' end,
		jsonb_build_object('promocion', p_promocion, 'vivienda', p_vivienda, 'comprador', numero));
	return codigo;
end $$;
revoke all on function public.generar_codigo_comprador(text, text, boolean) from public, anon;
grant execute on function public.generar_codigo_comprador(text, text, boolean) to authenticated;

-- Códigos de todas las viviendas que aún no tienen (la lista la manda el
-- portal, de viviendas.json). Devuelve los códigos una sola vez, para el Excel.
create or replace function public.generar_codigos_pendientes(p_promocion text, p_viviendas text[])
returns table (vivienda_ref text, codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
	ref text;
	nuevo text;
	n int := 0;
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso para los códigos de esta promoción';
	end if;
	if coalesce(array_length(p_viviendas, 1), 0) > 2000 then
		raise exception 'Demasiadas viviendas';
	end if;
	for ref in select distinct btrim(x) from unnest(p_viviendas) x
		where char_length(btrim(x)) between 1 and 60
			and not exists (select 1 from public.codigos_comprador c
				where c.promocion_id = p_promocion and c.vivienda_ref = btrim(x) and c.activo)
		order by 1
	loop
		nuevo := 'c-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
		insert into public.codigos_comprador (promocion_id, vivienda_ref, huella, comprador)
		values (p_promocion, ref, encode(sha256(convert_to(nuevo, 'UTF8')), 'hex'),
			greatest(1, coalesce((select max(c.comprador) from public.codigos_comprador c
				where c.promocion_id = p_promocion and c.vivienda_ref = ref), 1)));
		vivienda_ref := ref;
		codigo := nuevo;
		n := n + 1;
		return next;
	end loop;
	if n > 0 then
		insert into public.registro (user_id, accion, detalle)
		values (auth.uid(), 'genera los códigos de comprador', jsonb_build_object('promocion', p_promocion, 'viviendas', n));
	end if;
end $$;
revoke all on function public.generar_codigos_pendientes(text, text[]) from public, anon;
grant execute on function public.generar_codigos_pendientes(text, text[]) to authenticated;

-- Estado de los códigos de una promoción (sin huellas).
create or replace function public.codigos_de_promocion(p_promocion text)
returns table (vivienda_ref text, comprador int, creado_en timestamptz, ultimo_acceso timestamptz, accesos int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso para los códigos de esta promoción';
	end if;
	return query
		select c.vivienda_ref, c.comprador, c.creado_en, c.ultimo_acceso, c.accesos
		from public.codigos_comprador c
		where c.promocion_id = p_promocion and c.activo
		order by c.vivienda_ref;
end $$;
revoke all on function public.codigos_de_promocion(text) from public, anon;
grant execute on function public.codigos_de_promocion(text) to authenticated;

-- ─── Entrar como comprador (web pública, sin sesión) ────────────────────────
-- Devuelve { vivienda, selecciones } o null. Límite: 10 fallos en 15 minutos
-- desde la misma dirección, o 300 en una hora en toda la promoción.

create or replace function public.entrar_comprador(p_promocion text, p_codigo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	cabeceras json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
	v_cliente text := encode(sha256(convert_to(coalesce(
		cabeceras->>'cf-connecting-ip', split_part(cabeceras->>'x-forwarded-for', ',', 1), 'desconocido'), 'UTF8')), 'hex');
	v_codigo text := lower(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
	c public.codigos_comprador%rowtype;
	fallos int;
	fallos_promocion int;
begin
	if p_promocion !~ '^[a-z0-9-]{1,60}$' then
		raise exception 'Promoción no válida';
	end if;
	select count(*) into fallos from public.intentos_comprador i
	where promocion_id = p_promocion and i.cliente = v_cliente and not acierto and momento > now() - interval '15 minutes';
	select count(*) into fallos_promocion from public.intentos_comprador
	where promocion_id = p_promocion and not acierto and momento > now() - interval '1 hour';
	if fallos >= 10 or fallos_promocion >= 300 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;

	-- el código es «c-» y 12 cifras; se acepta escrito con espacios, guiones o sin la «c-»
	if char_length(v_codigo) = 13 and left(v_codigo, 1) = 'c' then v_codigo := substr(v_codigo, 2); end if;
	v_codigo := 'c-' || v_codigo;
	select cc.* into c from public.codigos_comprador cc
	join public.promociones pr on pr.id = cc.promocion_id
	where cc.huella = encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex')
		and cc.promocion_id = p_promocion and cc.activo and pr.activa;

	insert into public.intentos_comprador (promocion_id, cliente, acierto) values (p_promocion, v_cliente, c.id is not null);
	delete from public.intentos_comprador where momento < now() - interval '1 day';
	if c.id is null then
		return null;
	end if;

	update public.codigos_comprador set ultimo_acceso = now(), accesos = accesos + 1 where id = c.id;
	return jsonb_build_object(
		'vivienda', c.vivienda_ref,
		'selecciones', coalesce((
			select jsonb_object_agg(s.pack, jsonb_build_object('fecha', s.fecha, 'opciones', s.opciones))
			from public.selecciones_comprador s
			where s.promocion_id = c.promocion_id and s.vivienda_ref = c.vivienda_ref and s.comprador = c.comprador
		), '{}'::jsonb));
end $$;
revoke all on function public.entrar_comprador(text, text) from public;
grant execute on function public.entrar_comprador(text, text) to anon, authenticated;

-- ─── Borrar una promoción también borra sus códigos y selecciones ───────────

create or replace function public.borrar_filas_de_promocion(p_id text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	n_docs int;
begin
	select count(*) into n_docs from public.documentos where promocion_id = p_id;
	delete from public.validaciones          where promocion_id = p_id;
	delete from public.entregables           where promocion_id = p_id;
	delete from public.documentos            where promocion_id = p_id;
	delete from public.requisitos            where promocion_id = p_id;
	delete from public.miembros              where promocion_id = p_id;
	delete from public.peticiones            where promocion_id = p_id;
	delete from public.codigos_comprador     where promocion_id = p_id;
	delete from public.selecciones_comprador where promocion_id = p_id;
	delete from public.intentos_comprador    where promocion_id = p_id;
	delete from public.avisos_enviados       where promocion_id = p_id;
	delete from public.promociones           where id = p_id;
	return n_docs;
end $$;
revoke all on function public.borrar_filas_de_promocion(text) from public, anon, authenticated;

select 'Listo: códigos de comprador' as resultado;
