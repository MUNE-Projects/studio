-- Cerrar, desactivar y eliminar (decisión 70; preparado el 3/11/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 044. Es repetible.
-- Antes, crear la función «exportacion» (supabase/funciones/exportacion).
--
-- Tres cosas distintas, que no se mezclan:
--  · desactivar: nadie de la promotora entra; no se borra nada (como siempre);
--  · cerrar el servicio: desactivar y, si se quiere, retirar la web; tampoco borra;
--  · eliminar: borra la información de la promoción o de la promotora, y solo
--    se puede si antes:
--      a) se ha preparado su exportación y se ha enviado a quien administra la
--         promoción (o la promotora, si se elimina entera) un enlace privado
--         para descargarla, o
--      b) la promotora ha pedido eliminarla sin exportación (queda anotado).
--
-- 1. Exportaciones: almacén privado «exportaciones» (<id>/parte-N.zip). Solo la
--    administradora las prepara; la promotora las descarga con un enlace
--    privado y revocable que caduca (30 días por defecto), a través de la
--    función «exportacion». Caducada o revocada, se borran sus archivos.
-- 2. Portfolio: solo con autorización anotada de la promotora y solo resultados
--    promocionales de MUNE (entregables), nunca originales ni datos privados.
--    Viven en el almacén privado «portfolio» y no se borran al eliminar la
--    promoción; se retiran si la promotora retira la autorización.
-- 3. Eliminaciones: un apunte por cada promoción, promotora, acceso o código de
--    comprador eliminado o retirado, con solo una huella (sin nombres). Se
--    guarda también fuera de Supabase (proceso «eliminaciones» de GitHub, que
--    se lanza solo) para que, al recuperar una copia, no vuelva nada de lo
--    eliminado; una promoción o promotora no se elimina hasta que está guardada.
-- 4. Recuperación: mientras una recuperación no se ha comprobado, nadie de las
--    promotoras ni ningún comprador puede entrar, y no se publica.

-- ═══ 4. Recuperación pendiente de comprobar ═════════════════════════════════

create table if not exists public.restauracion (
	id           int primary key default 1 check (id = 1),
	pendiente    boolean not null,
	desde        timestamptz not null default now(),
	comprobada_en timestamptz,
	detalle      jsonb not null default '{}'::jsonb
);
alter table public.restauracion enable row level security;
revoke all on public.restauracion from anon, authenticated;
grant select on public.restauracion to authenticated;
drop policy if exists "MUNE ve la recuperación" on public.restauracion;
create policy "MUNE ve la recuperación" on public.restauracion for select to authenticated
	using (public.es_admin() or public.es_ejecutor());

create or replace function public.restauracion_pendiente()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce((select r.pendiente from public.restauracion r where r.id = 1), false);
$$;
revoke all on function public.restauracion_pendiente() from public;
grant execute on function public.restauracion_pendiente() to anon, authenticated;

-- Las promotoras solo entran con el código del móvil (032) y, ahora, si no hay
-- una recuperación sin comprobar.
create or replace function public.sesion_con_movil()
returns boolean
language sql
stable
set search_path = ''
as $$
	select coalesce(auth.jwt() ->> 'aal', '') = 'aal2' and not public.restauracion_pendiente();
$$;
revoke all on function public.sesion_con_movil() from public, anon;
grant execute on function public.sesion_con_movil() to authenticated;

-- Los compradores, igual (025 con una condición más).
create or replace function public._codigo_valido(p_promocion text, p_codigo text)
returns public.codigos_comprador
language plpgsql
security definer
set search_path = ''
as $$
declare
	cabeceras json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
	v_cliente text := encode(sha256(convert_to(coalesce(
		cabeceras->>'cf-connecting-ip', split_part(cabeceras->>'x-forwarded-for', ',', 1), 'desconocido'), 'UTF8')), 'hex');
	v_codigo text := lower(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
	c public.codigos_comprador%rowtype;
begin
	if public.restauracion_pendiente() then
		raise exception 'El acceso está en mantenimiento. Vuelve a probar más tarde.';
	end if;
	if p_promocion !~ '^[a-z0-9-]{1,60}$' then
		raise exception 'Promoción no válida';
	end if;
	if (select count(*) from public.intentos_comprador i where i.promocion_id = p_promocion and i.cliente = v_cliente
			and not i.acierto and i.momento > now() - interval '15 minutes') >= 10
		or (select count(*) from public.intentos_comprador i where i.promocion_id = p_promocion
			and not i.acierto and i.momento > now() - interval '1 hour') >= 300 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;
	if char_length(v_codigo) = 13 and left(v_codigo, 1) = 'c' then v_codigo := substr(v_codigo, 2); end if;
	v_codigo := 'c-' || v_codigo;
	select cc.* into c from public.codigos_comprador cc
	join public.promociones pr on pr.id = cc.promocion_id
	where cc.huella = encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex')
		and cc.promocion_id = p_promocion and cc.activo and pr.activa
		and coalesce((pr.modulos->>'acceso_comprador')::boolean, true);
	if c.id is null then
		insert into public.intentos_comprador (promocion_id, cliente, acierto) values (p_promocion, v_cliente, false);
	end if;
	return c;
end $$;

-- ═══ 3. Eliminaciones ═══════════════════════════════════════════════════════

-- Solo una huella (sha256 de «promocion:<id>», «promotora:<id>», «acceso:<id>»
-- o «codigo:<id>») y qué pasó: nada legible de personas ni de promociones.
create table if not exists public.eliminaciones (
	id      bigint generated always as identity primary key,
	momento timestamptz not null default now(),
	tipo    text not null check (tipo in ('promocion', 'promotora', 'acceso_borrado', 'acceso_retirado', 'acceso_devuelto', 'codigo_revocado', 'codigo_reactivado', 'portfolio_retirado')),
	huella  text not null check (huella ~ '^[0-9a-f]{64}$'),
	guardada_en timestamptz              -- ya está en la lista de fuera de Supabase (eliminaciones.yml)
);
alter table public.eliminaciones add column if not exists guardada_en timestamptz;
alter table public.eliminaciones drop constraint if exists eliminaciones_tipo_check;
alter table public.eliminaciones add constraint eliminaciones_tipo_check check (tipo in ('promocion', 'promotora', 'acceso_borrado', 'acceso_retirado', 'acceso_devuelto', 'codigo_revocado', 'codigo_reactivado', 'portfolio_retirado'));
alter table public.eliminaciones enable row level security;
revoke all on public.eliminaciones from anon, authenticated;
grant select on public.eliminaciones to authenticated;
drop policy if exists "MUNE ve las eliminaciones" on public.eliminaciones;
create policy "MUNE ve las eliminaciones" on public.eliminaciones for select to authenticated
	using (public.es_admin() or public.es_ejecutor() or public.es_copias());

create or replace function public.huella_de(p_clave text)
returns text
language sql
immutable
set search_path = ''
as $$
	select encode(sha256(convert_to(p_clave, 'UTF8')), 'hex');
$$;
revoke all on function public.huella_de(text) from public, anon;
grant execute on function public.huella_de(text) to authenticated;

create or replace function public._apunta_eliminacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if tg_table_name = 'promociones' and tg_op = 'DELETE' then
		insert into public.eliminaciones (tipo, huella) select 'promocion', public.huella_de('promocion:' || old.id)
		where not exists (select 1 from public.eliminaciones e where e.tipo = 'promocion' and e.huella = public.huella_de('promocion:' || old.id));
	elsif tg_table_name = 'promotoras' and tg_op = 'DELETE' then
		insert into public.eliminaciones (tipo, huella) select 'promotora', public.huella_de('promotora:' || old.id)
		where not exists (select 1 from public.eliminaciones e where e.tipo = 'promotora' and e.huella = public.huella_de('promotora:' || old.id));
	elsif tg_table_name = 'miembros' and tg_op = 'DELETE' then
		insert into public.eliminaciones (tipo, huella) values ('acceso_borrado', public.huella_de('acceso:' || old.id));
	elsif tg_table_name = 'miembros' and old.activo is distinct from new.activo then
		insert into public.eliminaciones (tipo, huella)
		values (case when new.activo then 'acceso_devuelto' else 'acceso_retirado' end, public.huella_de('acceso:' || new.id));
	elsif tg_table_name = 'codigos_comprador' and old.activo is distinct from new.activo then
		insert into public.eliminaciones (tipo, huella)
		values (case when new.activo then 'codigo_reactivado' else 'codigo_revocado' end, public.huella_de('codigo:' || new.id));
	end if;
	return null;
end $$;
revoke all on function public._apunta_eliminacion() from public, anon, authenticated;

drop trigger if exists apunta_eliminacion on public.promociones;
create trigger apunta_eliminacion after delete on public.promociones
	for each row execute function public._apunta_eliminacion();
drop trigger if exists apunta_eliminacion on public.promotoras;
create trigger apunta_eliminacion after delete on public.promotoras
	for each row execute function public._apunta_eliminacion();
drop trigger if exists apunta_eliminacion on public.miembros;
create trigger apunta_eliminacion after delete or update of activo on public.miembros
	for each row execute function public._apunta_eliminacion();
drop trigger if exists apunta_eliminacion on public.codigos_comprador;
create trigger apunta_eliminacion after update of activo on public.codigos_comprador
	for each row execute function public._apunta_eliminacion();

-- ═══ 1. Exportaciones ═══════════════════════════════════════════════════════

-- Sin claves foráneas: la exportación sobrevive a la eliminación de la promoción
-- hasta que caduca.
create table if not exists public.exportaciones (
	id             uuid primary key default gen_random_uuid(),
	promotora_id   uuid not null,
	promocion_id   text,                 -- null: la promotora entera
	titulo         text not null check (char_length(titulo) between 1 and 200),
	estado         text not null default 'preparando'
	               check (estado in ('preparando', 'lista', 'enviando', 'enviada', 'fallida', 'revocada', 'caducada')),
	partes         jsonb not null default '[]'::jsonb check (jsonb_typeof(partes) = 'array'),
	archivos       int,
	tamano         bigint,
	dias           int not null default 30 check (dias between 1 and 90),
	caduca_en      timestamptz,
	token_huella   text check (token_huella is null or token_huella ~ '^[0-9a-f]{64}$'),
	error          text check (error is null or char_length(error) <= 500),
	destinatarios  int,
	descargas      int not null default 0,
	ultima_descarga timestamptz,
	creada_en      timestamptz not null default now(),
	creada_por     uuid default auth.uid(),
	enviando_desde timestamptz,           -- se está enviando el email (proceso de GitHub)
	enviada_en     timestamptz,
	terminada_en   timestamptz
);
alter table public.exportaciones enable row level security;
revoke all on public.exportaciones from anon, authenticated;
grant select on public.exportaciones to authenticated;
grant select, update on public.exportaciones to service_role;
drop policy if exists "admin ve las exportaciones" on public.exportaciones;
create policy "admin ve las exportaciones" on public.exportaciones for select to authenticated
	using (public.es_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values ('exportaciones', 'exportaciones', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- exportaciones/<id>/parte-N.zip, solo mientras se prepara
create or replace function public.ruta_de_exportacion(p_ruta text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
	select e.id from public.exportaciones e
	where e.id::text = (storage.foldername(p_ruta))[1]
		and array_length(storage.foldername(p_ruta), 1) = 1
		and storage.filename(p_ruta) ~ '^parte-[0-9]{1,3}\.zip$'
		and e.estado = 'preparando';
$$;
revoke all on function public.ruta_de_exportacion(text) from public, anon;
grant execute on function public.ruta_de_exportacion(text) to authenticated;

drop policy if exists "admin sube exportaciones" on storage.objects;
create policy "admin sube exportaciones" on storage.objects for insert to authenticated
	with check (bucket_id = 'exportaciones' and public.es_admin() and public.ruta_de_exportacion(name) is not null);
drop policy if exists "admin ve exportaciones" on storage.objects;
create policy "admin ve exportaciones" on storage.objects for select to authenticated
	using (bucket_id = 'exportaciones' and public.es_admin());
drop policy if exists "admin borra exportaciones" on storage.objects;
create policy "admin borra exportaciones" on storage.objects for delete to authenticated
	using (bucket_id = 'exportaciones' and public.es_admin());

-- Empieza una exportación: de una promoción o de una promotora, desactivada.
create or replace function public.exportacion_nueva(p_promotora uuid, p_promocion text, p_dias int default 30)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_titulo text;
	v_id uuid;
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	if p_dias is null or p_dias not between 1 and 90 then raise exception 'La caducidad tiene que estar entre 1 y 90 días'; end if;
	if p_promocion is null then
		select po.nombre into v_titulo from public.promotoras po where po.id = p_promotora and not po.activa;
		if v_titulo is null then raise exception 'Primero desactiva la promotora'; end if;
	else
		select pr.nombre into v_titulo from public.promociones pr join public.promotoras po on po.id = pr.promotora_id
		where pr.id = p_promocion and pr.promotora_id = p_promotora and not (pr.activa and po.activa);
		if v_titulo is null then raise exception 'Primero desactiva la promoción'; end if;
	end if;
	-- una sola a la vez: la que está lista o enviada se revoca antes
	if exists (select 1 from public.exportaciones e where e.promotora_id = p_promotora and e.promocion_id is not distinct from p_promocion
			and (e.estado in ('lista', 'enviando') or (e.estado = 'enviada' and e.caduca_en > now()))) then
		raise exception 'Ya hay una exportación preparada o enviada: revócala antes de preparar otra';
	end if;
	-- la que se quedó a medias (por ejemplo, al cerrar la página) se da por fallida
	update public.exportaciones set estado = 'fallida', error = 'Sustituida por otra exportación', terminada_en = now()
	where promotora_id = p_promotora and promocion_id is not distinct from p_promocion and estado = 'preparando';
	insert into public.exportaciones (promotora_id, promocion_id, titulo, dias)
	values (p_promotora, p_promocion, v_titulo, p_dias) returning id into v_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'prepara una exportación', jsonb_build_object('exportacion', v_id, 'promotora', p_promotora, 'promocion', p_promocion));
	return v_id;
end $$;
revoke all on function public.exportacion_nueva(uuid, text, int) from public, anon;
grant execute on function public.exportacion_nueva(uuid, text, int) to authenticated;

-- Da por buena una exportación: cada parte tiene que estar en el almacén con su tamaño.
create or replace function public.exportacion_lista(p_id uuid, p_partes jsonb, p_archivos int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	p jsonb;
	n int := 0;
	total bigint := 0;
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	if not exists (select 1 from public.exportaciones e where e.id = p_id and e.estado = 'preparando') then
		raise exception 'Esa exportación no se está preparando';
	end if;
	if jsonb_typeof(p_partes) <> 'array' or jsonb_array_length(p_partes) = 0 then raise exception 'La exportación no tiene partes'; end if;
	for p in select x from jsonb_array_elements(p_partes) x loop
		n := n + 1;
		if p->>'ruta' <> p_id::text || '/parte-' || n || '.zip' or p->>'huella' !~ '^[0-9a-f]{64}$' then
			raise exception 'Parte % no válida', n;
		end if;
		if not exists (select 1 from storage.objects o where o.bucket_id = 'exportaciones' and o.name = p->>'ruta'
				and (o.metadata->>'size')::bigint = (p->>'tamano')::bigint) then
			raise exception 'La parte % no está completa en el almacén', n;
		end if;
		total := total + (p->>'tamano')::bigint;
	end loop;
	update public.exportaciones set estado = 'lista', partes = p_partes, archivos = p_archivos, tamano = total, error = null
	where id = p_id;
end $$;
revoke all on function public.exportacion_lista(uuid, jsonb, int) from public, anon;
grant execute on function public.exportacion_lista(uuid, jsonb, int) to authenticated;

create or replace function public.exportacion_fallida(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	update public.exportaciones set estado = 'fallida', error = left(coalesce(p_error, 'Sin detalle'), 500), terminada_en = now()
	where id = p_id and estado in ('preparando', 'lista');
end $$;
revoke all on function public.exportacion_fallida(uuid, text) from public, anon;
grant execute on function public.exportacion_fallida(uuid, text) to authenticated;

-- ═══ Eliminar sin exportación (lo pide la promotora) ═══════════════════════

create table if not exists public.eliminaciones_sin_exportacion (
	id            bigint generated always as identity primary key,
	promotora_id  uuid not null,
	promocion_id  text,
	solicitado_por text not null check (char_length(solicitado_por) between 3 and 200),
	motivo        text not null check (char_length(motivo) between 3 and 500),
	anotado_en    timestamptz not null default now(),
	anotado_por   uuid default auth.uid()
);
alter table public.eliminaciones_sin_exportacion enable row level security;
revoke all on public.eliminaciones_sin_exportacion from anon, authenticated;
grant select on public.eliminaciones_sin_exportacion to authenticated;
drop policy if exists "admin ve las eliminaciones sin exportación" on public.eliminaciones_sin_exportacion;
create policy "admin ve las eliminaciones sin exportación" on public.eliminaciones_sin_exportacion for select to authenticated
	using (public.es_admin());

create or replace function public.anotar_eliminacion_sin_exportacion(p_promotora uuid, p_promocion text, p_solicitado_por text, p_motivo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	if char_length(btrim(coalesce(p_solicitado_por, ''))) < 3 then raise exception 'Indica quién de la promotora lo ha pedido'; end if;
	if char_length(btrim(coalesce(p_motivo, ''))) < 3 then raise exception 'Indica cómo lo ha pedido (por ejemplo, «email del 3/11»)'; end if;
	insert into public.eliminaciones_sin_exportacion (promotora_id, promocion_id, solicitado_por, motivo)
	values (p_promotora, p_promocion, btrim(p_solicitado_por), btrim(p_motivo));
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'anota una eliminación sin exportación', jsonb_build_object('promotora', p_promotora, 'promocion', p_promocion));
end $$;
revoke all on function public.anotar_eliminacion_sin_exportacion(uuid, text, text, text) from public, anon;
grant execute on function public.anotar_eliminacion_sin_exportacion(uuid, text, text, text) to authenticated;

-- ¿Se puede eliminar? Exportación enviada y vigente, o petición sin exportación (de los últimos 30 días).
create or replace function public._eliminacion_permitida(p_promotora uuid, p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.exportaciones e
			where e.promotora_id = p_promotora and e.promocion_id is not distinct from p_promocion
				and e.estado = 'enviada' and e.caduca_en > now())
		or exists (select 1 from public.eliminaciones_sin_exportacion s
			where s.promotora_id = p_promotora and s.promocion_id is not distinct from p_promocion
				and s.anotado_en > now() - interval '30 days');
$$;
revoke all on function public._eliminacion_permitida(uuid, text) from public, anon, authenticated;

-- ¿Está ya guardada fuera de Supabase la eliminación de esta promoción o promotora?
create or replace function public._eliminacion_guardada(p_tipo text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.eliminaciones e
		where e.tipo = p_tipo and e.huella = public.huella_de(p_tipo || ':' || p_id) and e.guardada_en is not null);
$$;
revoke all on function public._eliminacion_guardada(text, text) from public, anon, authenticated;

-- 010, con la comprobación de la exportación y de la eliminación guardada fuera
create or replace function public.borrar_promocion(p_id text, p_nombre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	pr public.promociones%rowtype;
	n_docs int;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	select * into pr from public.promociones where id = p_id;
	if not found then
		raise exception 'Esa promoción no existe';
	end if;
	if pr.activa then
		raise exception 'Primero desactiva la promoción';
	end if;
	if btrim(coalesce(p_nombre, '')) <> btrim(pr.nombre) then
		raise exception 'El nombre escrito no coincide con el de la promoción';
	end if;
	if not public._eliminacion_permitida(pr.promotora_id, p_id) then
		raise exception 'Antes de eliminarla, envía su exportación a la promotora o anota que la ha pedido sin exportación';
	end if;
	if not public._eliminacion_guardada('promocion', p_id) then
		raise exception 'Antes de eliminarla se tiene que guardar la eliminación fuera de Supabase: vuelve a pulsar «Eliminar para siempre» en un momento';
	end if;
	if exists (select 1 from public.archivos_de_promocion(p_id)) then
		raise exception 'Todavía quedan archivos de esta promoción: vuelve a pulsar «Eliminar»';
	end if;

	n_docs := public.borrar_filas_de_promocion(p_id);
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'borra una promoción', jsonb_build_object(
		'promocion', p_id, 'nombre', pr.nombre, 'promotora', pr.promotora_id, 'documentos', n_docs));
end $$;
revoke all on function public.borrar_promocion(text, text) from public, anon;
grant execute on function public.borrar_promocion(text, text) to authenticated;

create or replace function public.borrar_promotora(p_id uuid, p_nombre text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	po public.promotoras%rowtype;
	pr record;
	n_promos int := 0;
	n_docs int := 0;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	select * into po from public.promotoras where id = p_id;
	if not found then
		raise exception 'Esa promotora no existe';
	end if;
	if po.activa then
		raise exception 'Primero desactiva la promotora';
	end if;
	if btrim(coalesce(p_nombre, '')) <> btrim(po.nombre) then
		raise exception 'El nombre escrito no coincide con el de la promotora';
	end if;
	if not public._eliminacion_permitida(p_id, null) then
		raise exception 'Antes de eliminarla, envía su exportación a la promotora o anota que la ha pedido sin exportación';
	end if;
	if not public._eliminacion_guardada('promotora', p_id::text) then
		raise exception 'Antes de eliminarla se tiene que guardar la eliminación fuera de Supabase: vuelve a pulsar «Eliminar para siempre» en un momento';
	end if;
	if exists (select 1 from public.archivos_de_promotora(p_id)) then
		raise exception 'Todavía quedan archivos de esta promotora: vuelve a pulsar «Eliminar»';
	end if;

	for pr in select id from public.promociones where promotora_id = p_id loop
		n_docs := n_docs + public.borrar_filas_de_promocion(pr.id);
		n_promos := n_promos + 1;
	end loop;
	delete from public.miembros where promotora_id = p_id;
	delete from public.promotoras where id = p_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'borra una promotora', jsonb_build_object(
		'promotora', p_id, 'nombre', po.nombre, 'promociones', n_promos, 'documentos', n_docs));
end $$;
revoke all on function public.borrar_promotora(uuid, text) from public, anon;
grant execute on function public.borrar_promotora(uuid, text) to authenticated;

-- ═══ 2. Portfolio ═══════════════════════════════════════════════════════════

create table if not exists public.portfolio_autorizaciones (
	id              bigint generated always as identity primary key,
	promocion_id    text not null,        -- sin clave foránea: sobrevive a la eliminación
	promocion_nombre text not null,
	promotora_nombre text not null,
	autorizada_por  text not null check (char_length(autorizada_por) between 3 and 200),
	fecha           date not null,
	alcance         text not null check (char_length(alcance) between 3 and 500),
	documento       text check (documento is null or char_length(documento) <= 300),
	creada_en       timestamptz not null default now(),
	creada_por      uuid default auth.uid(),
	retirada_en     timestamptz
);
create table if not exists public.portfolio_piezas (
	id              bigint generated always as identity primary key,
	autorizacion_id bigint not null references public.portfolio_autorizaciones (id) on delete cascade,
	ruta            text not null unique,
	titulo          text not null check (char_length(titulo) between 1 and 200),
	origen          text not null,        -- «entregable v3 · Plano tipología A»
	huella          text not null check (huella ~ '^[0-9a-f]{64}$'),
	tamano          bigint not null,
	creada_en       timestamptz not null default now()
);
alter table public.portfolio_autorizaciones enable row level security;
alter table public.portfolio_piezas enable row level security;
revoke all on public.portfolio_autorizaciones, public.portfolio_piezas from anon, authenticated;
grant select on public.portfolio_autorizaciones, public.portfolio_piezas to authenticated;
drop policy if exists "admin ve el portfolio" on public.portfolio_autorizaciones;
create policy "admin ve el portfolio" on public.portfolio_autorizaciones for select to authenticated using (public.es_admin());
drop policy if exists "admin ve las piezas del portfolio" on public.portfolio_piezas;
create policy "admin ve las piezas del portfolio" on public.portfolio_piezas for select to authenticated using (public.es_admin());

insert into storage.buckets (id, name, public, file_size_limit)
values ('portfolio', 'portfolio', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- portfolio/<autorización vigente>/<archivo>
create or replace function public.ruta_de_portfolio(p_ruta text)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
	select a.id from public.portfolio_autorizaciones a
	where a.id::text = (storage.foldername(p_ruta))[1] and array_length(storage.foldername(p_ruta), 1) = 1
		and a.retirada_en is null;
$$;
revoke all on function public.ruta_de_portfolio(text) from public, anon;
grant execute on function public.ruta_de_portfolio(text) to authenticated;

drop policy if exists "admin sube al portfolio" on storage.objects;
create policy "admin sube al portfolio" on storage.objects for insert to authenticated
	with check (bucket_id = 'portfolio' and public.es_admin() and public.ruta_de_portfolio(name) is not null);
drop policy if exists "admin ve el portfolio" on storage.objects;
create policy "admin ve el portfolio" on storage.objects for select to authenticated
	using (bucket_id = 'portfolio' and public.es_admin());
drop policy if exists "admin borra del portfolio" on storage.objects;
create policy "admin borra del portfolio" on storage.objects for delete to authenticated
	using (bucket_id = 'portfolio' and public.es_admin());

create or replace function public.autorizar_portfolio(p_promocion text, p_autorizada_por text, p_fecha date, p_alcance text, p_documento text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_id bigint;
	pr record;
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	select p.nombre, po.nombre as promotora into pr from public.promociones p join public.promotoras po on po.id = p.promotora_id where p.id = p_promocion;
	if pr is null then raise exception 'Esa promoción no existe'; end if;
	if char_length(btrim(coalesce(p_autorizada_por, ''))) < 3 then raise exception 'Indica quién de la promotora lo autoriza'; end if;
	if p_fecha is null or p_fecha > current_date then raise exception 'Indica la fecha de la autorización'; end if;
	if char_length(btrim(coalesce(p_alcance, ''))) < 3 then raise exception 'Indica qué se autoriza (por ejemplo, «imágenes y planos comerciales en la web de MUNE»)'; end if;
	insert into public.portfolio_autorizaciones (promocion_id, promocion_nombre, promotora_nombre, autorizada_por, fecha, alcance, documento)
	values (p_promocion, pr.nombre, pr.promotora, btrim(p_autorizada_por), p_fecha, btrim(p_alcance), nullif(btrim(coalesce(p_documento, '')), ''))
	returning id into v_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'anota una autorización de portfolio', jsonb_build_object('promocion', p_promocion, 'autorizacion', v_id));
	return v_id;
end $$;
revoke all on function public.autorizar_portfolio(text, text, date, text, text) from public, anon;
grant execute on function public.autorizar_portfolio(text, text, date, text, text) to authenticated;

-- Solo resultados de MUNE: la pieza tiene que ser idéntica a un entregable de esa promoción.
create or replace function public.pieza_de_portfolio(p_autorizacion bigint, p_entregable bigint, p_ruta text, p_titulo text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	a public.portfolio_autorizaciones%rowtype;
	e public.entregables%rowtype;
	o record;
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	select * into a from public.portfolio_autorizaciones where id = p_autorizacion and retirada_en is null;
	if not found then raise exception 'Esa autorización no existe o está retirada'; end if;
	select * into e from public.entregables where id = p_entregable and promocion_id = a.promocion_id;
	if not found then raise exception 'Solo se pueden guardar entregables de esa promoción'; end if;
	if public.ruta_de_portfolio(p_ruta) is distinct from p_autorizacion then raise exception 'Ruta no válida'; end if;
	select (ob.metadata->>'size')::bigint as tamano into o from storage.objects ob where ob.bucket_id = 'portfolio' and ob.name = p_ruta;
	if o is null then raise exception 'El archivo no está en el portfolio'; end if;
	insert into public.portfolio_piezas (autorizacion_id, ruta, titulo, origen, huella, tamano)
	values (p_autorizacion, p_ruta, left(coalesce(nullif(btrim(p_titulo), ''), e.nombre), 200),
		format('entregable %s · %s', e.version, coalesce(e.titulo, e.nombre)), e.huella, o.tamano)
	on conflict (ruta) do nothing;
end $$;
revoke all on function public.pieza_de_portfolio(bigint, bigint, text, text) from public, anon;
grant execute on function public.pieza_de_portfolio(bigint, bigint, text, text) to authenticated;

-- La promotora retira la autorización: se marca y se quitan las piezas (los archivos, desde MUNE Studio).
create or replace function public.retirar_portfolio(p_autorizacion bigint)
returns setof text
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	update public.portfolio_autorizaciones set retirada_en = now() where id = p_autorizacion and retirada_en is null;
	-- también fuera de Supabase: una copia anterior no la vuelve a traer (eliminaciones.mjs aplicar)
	if found then
		insert into public.eliminaciones (tipo, huella) values ('portfolio_retirado', public.huella_de('portfolio:' || p_autorizacion));
	end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'retira una autorización de portfolio', jsonb_build_object('autorizacion', p_autorizacion));
	return query delete from public.portfolio_piezas where autorizacion_id = p_autorizacion returning ruta;
end $$;
revoke all on function public.retirar_portfolio(bigint) from public, anon;
grant execute on function public.retirar_portfolio(bigint) to authenticated;

-- ═══ 5. Las eliminaciones, guardadas fuera de Supabase sin depender de nadie ═
--
-- Cada fila nueva de «eliminaciones» avisa sola (pg_net, desde la propia base
-- de datos) a la función «exportacion», acción «sincronizar», que lanza
-- eliminaciones.yml: este copia la lista a la release «eliminaciones» del
-- almacén de copias, comprueba que ha quedado y marca las filas como
-- guardadas (con la cuenta «ejecutor»). Si algo falla, las filas siguen «sin
-- guardar»: lo vuelven a pedir MUNE Studio, la vigilancia y la copia de la
-- noche. Una promoción o una promotora no se elimina hasta que su eliminación
-- está guardada fuera (pedir_eliminacion → guardada → borrar_*).

create extension if not exists pg_net;

create table if not exists public.sincronizacion (
	id              int primary key default 1 check (id = 1),
	url             text,                 -- la función «exportacion» de este proyecto (null: apagado)
	apikey          text,                 -- la clave pública (publishable) de este proyecto
	ultima_peticion timestamptz
);
alter table public.sincronizacion enable row level security;
revoke all on public.sincronizacion from anon, authenticated;
grant select, update on public.sincronizacion to service_role;
insert into public.sincronizacion (id, url, apikey)
values (1, 'https://iowtdenlkxjqzlpwizgb.supabase.co/functions/v1/exportacion', 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR')
on conflict (id) do nothing;
grant select on public.eliminaciones to service_role;

create or replace function public._pide_sincronizar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	s public.sincronizacion%rowtype;
begin
	select * into s from public.sincronizacion where id = 1;
	if s.url is not null then
		begin
			perform net.http_post(url := s.url, body := '{"accion": "sincronizar"}'::jsonb,
				headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', coalesce(s.apikey, '')),
				timeout_milliseconds := 10000);
		exception when others then
			null; -- la fila sigue «sin guardar» y se vuelve a pedir (MUNE Studio, vigilancia, copia de la noche)
		end;
	end if;
	return null;
end $$;
revoke all on function public._pide_sincronizar() from public, anon, authenticated;
drop trigger if exists pide_sincronizar on public.eliminaciones;
create trigger pide_sincronizar after insert on public.eliminaciones
	for each statement execute function public._pide_sincronizar();

-- MUNE Studio, antes de eliminar: apunta la eliminación (se guarda fuera sola)
create or replace function public.pedir_eliminacion(p_tipo text, p_id text, p_nombre text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_nombre text;
	v_activa boolean;
	v_promotora uuid;
	v_huella text;
begin
	if not public.es_admin() then raise exception 'Solo la administradora'; end if;
	if p_tipo = 'promocion' then
		select pr.nombre, pr.activa, pr.promotora_id into v_nombre, v_activa, v_promotora from public.promociones pr where pr.id = p_id;
	elsif p_tipo = 'promotora' then
		select po.nombre, po.activa, po.id into v_nombre, v_activa, v_promotora from public.promotoras po where po.id::text = p_id;
	else
		raise exception 'Tipo no válido';
	end if;
	if v_nombre is null then raise exception 'No existe'; end if;
	if v_activa then raise exception 'Primero desactívala'; end if;
	if btrim(coalesce(p_nombre, '')) <> btrim(v_nombre) then raise exception 'El nombre escrito no coincide'; end if;
	if not public._eliminacion_permitida(v_promotora, case when p_tipo = 'promocion' then p_id end) then
		raise exception 'Antes de eliminarla, envía su exportación a la promotora o anota que la ha pedido sin exportación';
	end if;
	v_huella := public.huella_de(p_tipo || ':' || p_id);
	if exists (select 1 from public.eliminaciones e where e.tipo = p_tipo and e.huella = v_huella and e.guardada_en is not null) then
		return 'guardada';
	end if;
	if not exists (select 1 from public.eliminaciones e where e.tipo = p_tipo and e.huella = v_huella) then
		insert into public.eliminaciones (tipo, huella) values (p_tipo, v_huella);
		insert into public.registro (user_id, accion, detalle)
		values (auth.uid(), 'pide eliminar', jsonb_build_object('tipo', p_tipo, 'id', p_id));
	end if;
	return 'pendiente';
end $$;
revoke all on function public.pedir_eliminacion(text, text, text) from public, anon;
grant execute on function public.pedir_eliminacion(text, text, text) to authenticated;

-- eliminaciones.yml: marca como guardadas las que ya están fuera (hasta un número de fila)
create or replace function public.marcar_eliminaciones_guardadas(p_hasta bigint)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not public.es_ejecutor() then raise exception 'Solo la cuenta ejecutor'; end if;
	update public.eliminaciones set guardada_en = now() where id <= p_hasta and guardada_en is null;
	get diagnostics n = row_count;
	return n;
end $$;
revoke all on function public.marcar_eliminaciones_guardadas(bigint) from public, anon;
grant execute on function public.marcar_eliminaciones_guardadas(bigint) to authenticated;

-- ═══ 6. El email de la exportación, sin que su enlace pase por GitHub ═══════
--
-- La función «exportacion» (acción «enviar») deja la exportación «enviando» y
-- lanza aviso-exportacion.yml solo con su identificador. El proceso entra
-- con la cuenta «ejecutor», pide aquí el enlace (se crea una sola vez por
-- envío; en Supabase solo queda su huella), envía el email y lo confirma.
-- Si falla, vuelve a «lista», sin enlace válido, para reintentar.

create or replace function public.exportacion_para_enviar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	e public.exportaciones%rowtype;
	v_token text;
	v_para text[];
begin
	if not public.es_ejecutor() then raise exception 'Solo la cuenta ejecutor'; end if;
	select * into e from public.exportaciones where id = p_id for update;
	if not found or e.estado <> 'enviando' or e.enviando_desde < now() - interval '30 minutes' then
		raise exception 'Esta exportación no se está enviando';
	end if;
	if e.token_huella is not null then raise exception 'El enlace de este envío ya se ha creado'; end if;
	-- de una promoción: quien administra esa promoción en MUNE Portal; de la promotora entera: quien administra la promotora
	select array_agg(distinct lower(btrim(m.email))) into v_para from public.miembros m
	where m.promotora_id = e.promotora_id and m.activo and m.administra
		and m.promocion_id is not distinct from e.promocion_id
		and m.email ~ '^[^\s@,]+@[^\s@,]+\.[^\s@,]+$';
	if v_para is null then
		raise exception '%', case when e.promocion_id is null then 'Nadie administra esta promotora en MUNE Portal' else 'Nadie administra esta promoción en MUNE Portal' end;
	end if;
	v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
	update public.exportaciones set token_huella = public.huella_de(v_token), destinatarios = cardinality(v_para),
		caduca_en = coalesce(caduca_en, now() + make_interval(days => dias))
	where id = p_id;
	return jsonb_build_object('para', to_jsonb(v_para), 'titulo', e.titulo, 'promocion', e.promocion_id is not null,
		'token', v_token, 'caduca_en', coalesce(e.caduca_en, now() + make_interval(days => e.dias)));
end $$;
revoke all on function public.exportacion_para_enviar(uuid) from public, anon;
grant execute on function public.exportacion_para_enviar(uuid) to authenticated;

create or replace function public.exportacion_confirmada(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	e public.exportaciones%rowtype;
begin
	if not public.es_ejecutor() then raise exception 'Solo la cuenta ejecutor'; end if;
	update public.exportaciones set estado = 'enviada', enviada_en = now(), enviando_desde = null, error = null
	where id = p_id and estado = 'enviando' and token_huella is not null
	returning * into e;
	if not found then raise exception 'Esta exportación no se estaba enviando'; end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'envía una exportación a la promotora', jsonb_build_object('exportacion', p_id, 'promotora', e.promotora_id,
		'promocion', e.promocion_id, 'destinatarios', e.destinatarios, 'caduca_en', e.caduca_en));
end $$;
revoke all on function public.exportacion_confirmada(uuid) from public, anon;
grant execute on function public.exportacion_confirmada(uuid) to authenticated;

create or replace function public.exportacion_no_enviada(p_id uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_ejecutor() then raise exception 'Solo la cuenta ejecutor'; end if;
	update public.exportaciones set estado = 'lista', token_huella = null, enviando_desde = null,
		error = left(coalesce(nullif(btrim(p_error), ''), 'El email no ha salido'), 500)
	where id = p_id and estado = 'enviando';
end $$;
revoke all on function public.exportacion_no_enviada(uuid, text) from public, anon;
grant execute on function public.exportacion_no_enviada(uuid, text) to authenticated;

select 'Listo: cierre, exportación, portfolio y eliminaciones' as resultado;
