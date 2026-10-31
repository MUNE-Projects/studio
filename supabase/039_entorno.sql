-- Entorno real de cada promoción, etapa 1 (31/10/2026, decidido por la administradora).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 038. Es repetible.
--
-- El proceso «Generar el entorno» de GitHub (entorno.yml, herramientas/entorno.mjs)
-- descarga de fuentes públicas y gratuitas lo que rodea a la parcela (Catastro,
-- IGN y OpenStreetMap) a partir de la referencia catastral de la ficha, y lo
-- guarda en el almacén privado «entornos»: <promoción>/entorno.json (parcela,
-- edificios con sus plantas, calles, árboles, relieve, fuentes y su fiabilidad)
-- y <promoción>/orto.jpg (la foto aérea). Lo lanza la administradora desde MUNE
-- Studio (función «ejecutar», acción «entorno») o desde GitHub.
--  · Escribe la cuenta «ejecutor» de MUNE (036), solo en esas dos rutas.
--  · Lo leen MUNE Studio (para revisarlo) y el robot de Claude (al preparar una
--    versión, para ponerlo en el 3D: etapa 2). La promotora no lo ve aquí.
--  · Se borra con la promoción (037).

insert into storage.buckets (id, name, public)
values ('entornos', 'entornos', false)
on conflict (id) do nothing;

create table if not exists public.entornos (
	promocion_id  text primary key references public.promociones (id) on delete cascade,
	generado_en   timestamptz not null default now(),
	resumen       jsonb not null default '{}'::jsonb check (pg_column_size(resumen) < 20000)
);
alter table public.entornos enable row level security;
revoke all on public.entornos from anon, authenticated;
grant select on public.entornos to authenticated;
drop policy if exists "MUNE ve los entornos" on public.entornos;
create policy "MUNE ve los entornos" on public.entornos for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_ejecutor());

-- ¿Es una ruta válida del almacén «entornos»? <promoción existente>/entorno.json u orto.jpg
create or replace function public.ruta_de_entorno(p_ruta text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select pr.id from public.promociones pr
	where array_length(storage.foldername(p_ruta), 1) = 1
		and pr.id = (storage.foldername(p_ruta))[1]
		and storage.filename(p_ruta) in ('entorno.json', 'orto.jpg');
$$;
revoke all on function public.ruta_de_entorno(text) from public, anon;
grant execute on function public.ruta_de_entorno(text) to authenticated;

drop policy if exists "MUNE guarda el entorno" on storage.objects;
create policy "MUNE guarda el entorno" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'entornos' and (public.es_ejecutor() or public.es_admin()) and public.ruta_de_entorno(name) is not null);
drop policy if exists "MUNE rehace el entorno" on storage.objects;
create policy "MUNE rehace el entorno" on storage.objects
	for update to authenticated
	using (bucket_id = 'entornos' and (public.es_ejecutor() or public.es_admin()))
	with check (bucket_id = 'entornos' and (public.es_ejecutor() or public.es_admin()) and public.ruta_de_entorno(name) is not null);
drop policy if exists "MUNE ve el entorno" on storage.objects;
create policy "MUNE ve el entorno" on storage.objects
	for select to authenticated
	using (bucket_id = 'entornos' and (public.es_admin() or public.es_robot() or public.es_ejecutor()));

-- Lo que necesita el proceso de la ficha: la referencia catastral y la dirección.
create or replace function public.ficha_para_entorno(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot() or public.es_ejecutor()) then
		raise exception 'Sin permiso';
	end if;
	return (select jsonb_build_object('referencia_catastral', pr.referencia_catastral, 'direccion', pr.direccion,
		'municipio', pr.municipio, 'provincia', pr.provincia) from public.promociones pr where pr.id = p_promocion);
end $$;
revoke all on function public.ficha_para_entorno(text) from public, anon;
grant execute on function public.ficha_para_entorno(text) to authenticated;

-- Al terminar, el proceso apunta cuándo y un resumen (para MUNE Studio).
create or replace function public.entorno_generado(p_promocion text, p_resumen jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_ejecutor()) then
		raise exception 'Sin permiso';
	end if;
	if not exists (select 1 from public.promociones pr where pr.id = p_promocion) then
		raise exception 'No existe esa promoción';
	end if;
	insert into public.entornos (promocion_id, generado_en, resumen)
	values (p_promocion, now(), coalesce(p_resumen, '{}'::jsonb))
	on conflict (promocion_id) do update set generado_en = now(), resumen = excluded.resumen;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'genera el entorno', jsonb_build_object('promocion', p_promocion));
end $$;
revoke all on function public.entorno_generado(text, jsonb) from public, anon;
grant execute on function public.entorno_generado(text, jsonb) to authenticated;

-- ═══ Borrado completo (037), también con el entorno ═════════════════════════

create or replace function public.promocion_del_archivo(p_bucket text, p_nombre text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select case p_bucket
		when 'documentos'  then (storage.foldername(p_nombre))[2]
		when 'entregables' then (storage.foldername(p_nombre))[1]
		when 'versiones'   then (storage.foldername(p_nombre))[1]
		when 'entornos'    then (storage.foldername(p_nombre))[1]
		when 'referencias' then (select pe.promocion_id from public.peticiones pe
			where pe.id::text = (storage.foldername(p_nombre))[1])
	end;
$$;
revoke all on function public.promocion_del_archivo(text, text) from public, anon;
grant execute on function public.promocion_del_archivo(text, text) to authenticated;

drop policy if exists "admin borra archivos de promociones desactivadas" on storage.objects;
create policy "admin borra archivos de promociones desactivadas" on storage.objects
	for delete to authenticated
	using (bucket_id in ('documentos', 'entregables', 'referencias', 'versiones', 'entornos') and public.es_admin()
		and (exists (select 1 from public.promociones pr join public.promotoras po on po.id = pr.promotora_id
				where pr.id = public.promocion_del_archivo(bucket_id, name) and not (pr.activa and po.activa))
			or (bucket_id = 'documentos' and exists (select 1 from public.promotoras po
				where po.id::text = (storage.foldername(name))[1] and not po.activa))));

create or replace function public.archivos_de_promocion(p_id text)
returns table (bucket text, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	return query
		select o.bucket_id::text, o.name::text from storage.objects o
		where o.bucket_id in ('documentos', 'entregables', 'referencias', 'versiones', 'entornos')
			and public.promocion_del_archivo(o.bucket_id, o.name) = p_id;
end $$;
revoke all on function public.archivos_de_promocion(text) from public, anon;
grant execute on function public.archivos_de_promocion(text) to authenticated;

create or replace function public.archivos_de_promotora(p_id uuid)
returns table (bucket text, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora';
	end if;
	return query
		select o.bucket_id::text, o.name::text from storage.objects o
		where (o.bucket_id in ('documentos', 'entregables', 'referencias', 'versiones', 'entornos')
				and public.promocion_del_archivo(o.bucket_id, o.name) in
					(select pr.id from public.promociones pr where pr.promotora_id = p_id))
			-- todo lo de la carpeta de la promotora (su marca incluida)
			or (o.bucket_id = 'documentos' and (storage.foldername(o.name))[1] = p_id::text);
end $$;
revoke all on function public.archivos_de_promotora(uuid) from public, anon;
grant execute on function public.archivos_de_promotora(uuid) to authenticated;

select 'Listo: entorno real (etapa 1)' as resultado;
