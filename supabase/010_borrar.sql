-- Fase 1 · paso 10: borrar promociones y promotoras definitivamente desde el Panel.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 009. Es repetible.
--
-- Antes de borrar, el Panel obliga a descargar la exportación (un ZIP con
-- todos los datos y archivos). Después:
--   · Promoción: solo la administradora (con el código del móvil), solo si
--     está desactivada y escribiendo su nombre. Se borra todo lo suyo:
--     documentos y archivos subidos, planos y validaciones, lista de
--     documentos, accesos de su equipo y peticiones de cambios con sus fotos.
--   · Promotora: igual, si está desactivada; se borran todas sus promociones
--     (aunque alguna siga activa) y todos sus accesos.
-- Las cuentas de las personas no se borran (se quedan sin acceso a nada). El
-- registro de actividad se conserva y apunta el borrado.
--
-- Los archivos se borran con la API de almacenamiento (Supabase no permite
-- borrarlos con SQL): el Panel pide la lista con archivos_de_promocion o
-- archivos_de_promotora, los borra, y después borrar_promocion o
-- borrar_promotora comprueban que no queda ninguno.

-- ¿De qué promoción es un archivo?
--   documentos/<promotora>/<promoción>/…   entregables/<promoción>/…   referencias/<petición>/…
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
		when 'referencias' then (select pe.promocion_id from public.peticiones pe
			where pe.id::text = (storage.foldername(p_nombre))[1])
	end;
$$;
revoke all on function public.promocion_del_archivo(text, text) from public, anon;
grant execute on function public.promocion_del_archivo(text, text) to authenticated;

-- La administradora puede borrar archivos de una promoción desactivada, o de
-- cualquier promoción de una promotora desactivada.
drop policy if exists "admin borra archivos de promociones desactivadas" on storage.objects;
create policy "admin borra archivos de promociones desactivadas" on storage.objects
	for delete to authenticated
	using (bucket_id in ('documentos', 'entregables', 'referencias') and public.es_admin()
		and exists (select 1 from public.promociones pr join public.promotoras po on po.id = pr.promotora_id
			where pr.id = public.promocion_del_archivo(bucket_id, name) and not (pr.activa and po.activa)));

-- Archivos guardados de una promoción, o de todas las de una promotora.
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
		where o.bucket_id in ('documentos', 'entregables', 'referencias')
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
		where o.bucket_id in ('documentos', 'entregables', 'referencias')
			and public.promocion_del_archivo(o.bucket_id, o.name) in
				(select pr.id from public.promociones pr where pr.promotora_id = p_id);
end $$;
revoke all on function public.archivos_de_promotora(uuid) from public, anon;
grant execute on function public.archivos_de_promotora(uuid) to authenticated;

-- (Interna) Borra las filas de una promoción. Devuelve cuántos documentos tenía.
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
	delete from public.validaciones where promocion_id = p_id;
	delete from public.entregables  where promocion_id = p_id;
	delete from public.documentos   where promocion_id = p_id;
	delete from public.requisitos   where promocion_id = p_id;
	delete from public.miembros     where promocion_id = p_id;
	delete from public.peticiones   where promocion_id = p_id;
	delete from public.promociones  where id = p_id;
	return n_docs;
end $$;
revoke all on function public.borrar_filas_de_promocion(text) from public, anon, authenticated;

-- Borra una promoción. p_nombre: su nombre escrito a mano como confirmación.
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
	if exists (select 1 from public.archivos_de_promocion(p_id)) then
		raise exception 'Todavía quedan archivos de esta promoción: vuelve a pulsar «Borrar para siempre»';
	end if;

	n_docs := public.borrar_filas_de_promocion(p_id);
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'borra una promoción', jsonb_build_object(
		'promocion', p_id, 'nombre', pr.nombre, 'promotora', pr.promotora_id, 'documentos', n_docs));
end $$;
revoke all on function public.borrar_promocion(text, text) from public, anon;
grant execute on function public.borrar_promocion(text, text) to authenticated;

-- Borra una promotora con todas sus promociones y accesos.
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
	if exists (select 1 from public.archivos_de_promotora(p_id)) then
		raise exception 'Todavía quedan archivos de esta promotora: vuelve a pulsar «Borrar para siempre»';
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

select 'Listo: ya se pueden exportar y borrar promociones y promotoras desde el Panel' as resultado;
