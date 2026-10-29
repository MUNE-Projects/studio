-- Publicar sin GitHub (auditoría de seguridad del 28/10/2026, propuesta 2 de 3;
-- aprobado por la administradora el 29/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 035. Es repetible.
--
-- Hasta ahora la web construida de cada versión se guardaba en el almacén
-- «experience» de GitHub (rama revision = vista previa, main = publicada) y el
-- registro de versiones en «studio» (promociones/<id>/publicaciones.json).
-- Desde aquí:
--  · la web construida de cada versión preparada va al almacén privado
--    «versiones» (<promoción>/<vN>/sitio.tar.gz). No se puede cambiar ni borrar
--    desde la aplicación;
--  · el registro de versiones es la tabla versiones_promocion: en revisión,
--    publicada, sustituida, retirada o descartada (una en revisión que se
--    sustituye por otra antes de publicarse);
--  · el proceso de publicar de GitHub (cuenta «ejecutor» de MUNE) lee de aquí
--    qué versión de cada promoción va a la web pública y cuál a la vista
--    previa, y las envía directamente a Cloudflare.
--
-- Quién:
--  · el robot de Claude sube la web de cada versión que prepara y la apunta
--    «en revisión» (no puede publicarla);
--  · la administradora (con el código del móvil) y la cuenta «ejecutor»
--    publican y vuelven atrás. El ejecutor solo lo hace cuando lo pide MUNE
--    Studio o la última aprobación de la promotora (función «ejecutar» o
--    «aviso-subida», que ya lo comprueban);
--  · nadie de las promotoras ve el almacén ni el registro (ven la versión en
--    la web, como hasta ahora).

-- ═══ 1. Cuenta «ejecutor» de MUNE ═══════════════════════════════════════════
-- La creas tú en Authentication → Users (hello.muneprojects+ejecutor@gmail.com)
-- y se marca aquí. Solo sirve para publicar: no ve documentación, compradores
-- ni nada más.

create table if not exists public.cuentas_ejecutor (
	user_id   uuid primary key references auth.users (id) on delete cascade,
	creado_en timestamptz not null default now()
);
alter table public.cuentas_ejecutor enable row level security;
revoke all on public.cuentas_ejecutor from anon, authenticated;

insert into public.cuentas_ejecutor (user_id)
select u.id from auth.users u where lower(u.email) = 'hello.muneprojects+ejecutor@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.es_ejecutor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.cuentas_ejecutor c where c.user_id = auth.uid());
$$;
revoke all on function public.es_ejecutor() from public, anon;
grant execute on function public.es_ejecutor() to authenticated;

-- ═══ 2. Registro de versiones ═══════════════════════════════════════════════

create table if not exists public.versiones_promocion (
	promocion_id  text not null references public.promociones (id) on delete cascade,
	version       text not null check (version ~ '^v[0-9]{1,5}$'),
	numero        int generated always as (substr(version, 2)::int) stored,
	estado        text not null check (estado in ('en_revision', 'publicada', 'sustituida', 'retirada', 'descartada')),
	preparada_en  timestamptz not null default now(),
	preparada_por text not null default '' check (char_length(preparada_por) <= 120),
	cambios       text not null default '' check (char_length(cambios) <= 2000),
	-- commit del código de MUNE con el que se construyó
	taller        text check (taller is null or taller ~ '^[0-9a-f]{40}$'),
	-- huella (sha256) del archivo de la web en el almacén «versiones»
	huella        text check (huella is null or huella ~ '^[0-9a-f]{64}$'),
	aprobado_por  text check (aprobado_por is null or char_length(aprobado_por) <= 120),
	publicada_en  timestamptz,
	primary key (promocion_id, version)
);
create unique index if not exists versiones_promocion_una_publicada on public.versiones_promocion (promocion_id) where estado = 'publicada';
create unique index if not exists versiones_promocion_una_en_revision on public.versiones_promocion (promocion_id) where estado = 'en_revision';
alter table public.versiones_promocion enable row level security;
revoke all on public.versiones_promocion from anon, authenticated;
grant select on public.versiones_promocion to authenticated;
drop policy if exists "MUNE lee el registro de versiones" on public.versiones_promocion;
create policy "MUNE lee el registro de versiones" on public.versiones_promocion
	for select to authenticated using (public.es_admin() or public.es_robot() or public.es_ejecutor());

-- ═══ 3. Almacén «versiones»: la web construida de cada versión ══════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('versiones', 'versiones', false, 52428800, array['application/gzip'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- ¿Es una ruta válida del almacén? <promoción existente>/<vN>/sitio.tar.gz
create or replace function public.ruta_de_version(p_ruta text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select pr.id from public.promociones pr
	where array_length(storage.foldername(p_ruta), 1) = 2
		and pr.id = (storage.foldername(p_ruta))[1]
		and (storage.foldername(p_ruta))[2] ~ '^v[0-9]{1,5}$'
		and storage.filename(p_ruta) = 'sitio.tar.gz';
$$;
revoke all on function public.ruta_de_version(text) from public, anon;
grant execute on function public.ruta_de_version(text) to authenticated;

-- Subir: el robot o la administradora, solo a una ruta válida y nunca encima
-- de otra (no hay permiso de cambiar ni de borrar).
drop policy if exists "MUNE sube la web de una versión" on storage.objects;
create policy "MUNE sube la web de una versión" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'versiones' and (public.es_admin() or public.es_robot()) and public.ruta_de_version(name) is not null);
drop policy if exists "MUNE ve la web de cada versión" on storage.objects;
create policy "MUNE ve la web de cada versión" on storage.objects
	for select to authenticated
	using (bucket_id = 'versiones' and (public.es_admin() or public.es_robot() or public.es_ejecutor() or public.es_copias()));

-- ═══ 4. Preparar, publicar y volver atrás ═══════════════════════════════════

-- «publicacion.mjs preparar», después de subir la web de la versión: la apunta
-- en revisión (la que había en revisión sin publicar queda descartada).
create or replace function public.preparar_version(
	p_promocion text, p_version text, p_cambios text, p_preparada_por text, p_taller text, p_huella text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_ultima int;
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo MUNE prepara versiones';
	end if;
	if p_version !~ '^v[0-9]{1,5}$' or coalesce(p_taller, '') !~ '^[0-9a-f]{40}$' or coalesce(p_huella, '') !~ '^[0-9a-f]{64}$' then
		raise exception 'Faltan datos de la versión (número, commit del código o huella)';
	end if;
	if char_length(btrim(coalesce(p_cambios, ''))) not between 1 and 2000 then
		raise exception 'Cada versión tiene que explicar qué cambia';
	end if;
	if not exists (select 1 from storage.objects o where o.bucket_id = 'versiones' and o.name = p_promocion || '/' || p_version || '/sitio.tar.gz') then
		raise exception 'La web de la % no está en el almacén', p_version;
	end if;
	select max(numero) into v_ultima from public.versiones_promocion where promocion_id = p_promocion;
	if substr(p_version, 2)::int <= coalesce(v_ultima, 0) then
		raise exception 'La % no es posterior a la última versión (v%)', p_version, v_ultima;
	end if;

	update public.versiones_promocion set estado = 'descartada' where promocion_id = p_promocion and estado = 'en_revision';
	insert into public.versiones_promocion (promocion_id, version, estado, cambios, preparada_por, taller, huella)
	values (p_promocion, p_version, 'en_revision', btrim(p_cambios), left(coalesce(p_preparada_por, ''), 120), p_taller, p_huella);
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'prepara una versión', jsonb_build_object('promocion', p_promocion, 'version', p_version, 'huella', left(p_huella, 12)));
end $$;
revoke all on function public.preparar_version(text, text, text, text, text, text) from public, anon;
grant execute on function public.preparar_version(text, text, text, text, text, text) to authenticated;

-- Publica la versión en revisión. Solo exactamente la revisada (p_version).
create or replace function public.aprobar_version(p_promocion text, p_version text, p_por text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v public.versiones_promocion%rowtype;
	v_antes text;
begin
	if not (public.es_admin() or public.es_ejecutor()) then
		raise exception 'Solo MUNE Studio o el proceso de publicar publican';
	end if;
	if char_length(btrim(coalesce(p_por, ''))) not between 1 and 120 then
		raise exception 'Falta quién aprueba la publicación';
	end if;
	select * into v from public.versiones_promocion where promocion_id = p_promocion and estado = 'en_revision';
	if v.version is null then
		raise exception 'No hay ninguna versión de % en la vista previa', p_promocion;
	end if;
	if v.version <> p_version then
		raise exception 'La vista previa ha cambiado: ahora tiene la %, no la %. Revísala antes de publicar.', v.version, p_version;
	end if;

	select version into v_antes from public.versiones_promocion where promocion_id = p_promocion and estado = 'publicada';
	update public.versiones_promocion set estado = 'sustituida' where promocion_id = p_promocion and estado = 'publicada';
	update public.versiones_promocion set estado = 'publicada', aprobado_por = btrim(p_por), publicada_en = now()
	where promocion_id = p_promocion and version = p_version;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'publica una versión', jsonb_build_object('promocion', p_promocion, 'version', p_version, 'antes', v_antes, 'por', btrim(p_por)));
end $$;
revoke all on function public.aprobar_version(text, text, text) from public, anon;
grant execute on function public.aprobar_version(text, text, text) to authenticated;

-- Vuelve a una versión que ya estuvo publicada. La vigente queda «retirada».
create or replace function public.volver_version(p_promocion text, p_version text, p_motivo text, p_por text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v public.versiones_promocion%rowtype;
	v_antes text;
begin
	if not (public.es_admin() or public.es_ejecutor()) then
		raise exception 'Solo MUNE Studio o el proceso de publicar vuelven atrás';
	end if;
	if char_length(btrim(coalesce(p_motivo, ''))) not between 1 and 500 then
		raise exception 'Volver atrás exige un motivo';
	end if;
	select * into v from public.versiones_promocion where promocion_id = p_promocion and version = p_version;
	if v.version is null then
		raise exception 'No existe la % de %', p_version, p_promocion;
	end if;
	if v.estado = 'publicada' then
		raise exception 'La % ya es la versión publicada', p_version;
	end if;
	if v.estado not in ('sustituida', 'retirada') then
		raise exception 'La % nunca se ha publicado: no se puede volver a ella', p_version;
	end if;

	select version into v_antes from public.versiones_promocion where promocion_id = p_promocion and estado = 'publicada';
	update public.versiones_promocion set estado = 'retirada' where promocion_id = p_promocion and estado = 'publicada';
	update public.versiones_promocion set estado = 'publicada', publicada_en = now() where promocion_id = p_promocion and version = p_version;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'vuelve a una versión', jsonb_build_object('promocion', p_promocion, 'desde', v_antes, 'a', p_version,
		'motivo', btrim(p_motivo), 'por', left(btrim(coalesce(p_por, '')), 120)));
end $$;
revoke all on function public.volver_version(text, text, text, text) from public, anon;
grant execute on function public.volver_version(text, text, text, text) to authenticated;

-- Lo que va a cada web: de cada promoción, la versión publicada y la de la
-- vista previa (la que está en revisión o, si no hay, la publicada).
create or replace function public.versiones_para_desplegar()
returns table (promocion_id text, publicada text, vista_previa text)
language sql
stable
security definer
set search_path = ''
as $$
	select p.promocion_id,
		max(p.version) filter (where p.estado = 'publicada'),
		coalesce(max(p.version) filter (where p.estado = 'en_revision'), max(p.version) filter (where p.estado = 'publicada'))
	from public.versiones_promocion p
	where public.es_admin() or public.es_robot() or public.es_ejecutor()
	group by p.promocion_id
	having bool_or(p.estado in ('publicada', 'en_revision'))
	order by p.promocion_id;
$$;
revoke all on function public.versiones_para_desplegar() from public, anon;
grant execute on function public.versiones_para_desplegar() to authenticated;

select 'Listo: publicar sin GitHub' as resultado;
