-- Borrado completo (auditoría de seguridad del 28/10/2026, propuesta 3 de 3;
-- aprobado por la administradora el 29/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 036. Es repetible.
--
-- Al borrar una promoción o una promotora desde MUNE Studio (010_borrar.sql)
-- se borraban sus datos y los archivos de «documentos», «entregables» y
-- «referencias». Desde aquí, también:
--  · la web de cada una de sus versiones (almacén «versiones», 036);
--  · los archivos de la marca de la promotora (su tipografía propia, en
--    documentos/<promotora>/marca/), al borrar la promotora.
-- Su modelo (035) y su registro de versiones (036) ya se borraban con ella.
-- Al terminar, MUNE Studio pide retirarla de la web pública y de la vista
-- previa (función «ejecutar», acción «retirar»).

-- ¿De qué promoción es un archivo? (010, con el almacén «versiones»)
--   documentos/<promotora>/<promoción>/…   entregables/<promoción>/…
--   referencias/<petición>/…               versiones/<promoción>/<vN>/sitio.tar.gz
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
		when 'referencias' then (select pe.promocion_id from public.peticiones pe
			where pe.id::text = (storage.foldername(p_nombre))[1])
	end;
$$;
revoke all on function public.promocion_del_archivo(text, text) from public, anon;
grant execute on function public.promocion_del_archivo(text, text) to authenticated;

-- La administradora puede borrar los archivos de una promoción desactivada (o
-- de una promotora desactivada), también su web guardada y su marca.
drop policy if exists "admin borra archivos de promociones desactivadas" on storage.objects;
create policy "admin borra archivos de promociones desactivadas" on storage.objects
	for delete to authenticated
	using (bucket_id in ('documentos', 'entregables', 'referencias', 'versiones') and public.es_admin()
		and (exists (select 1 from public.promociones pr join public.promotoras po on po.id = pr.promotora_id
				where pr.id = public.promocion_del_archivo(bucket_id, name) and not (pr.activa and po.activa))
			or (bucket_id = 'documentos' and exists (select 1 from public.promotoras po
				where po.id::text = (storage.foldername(name))[1] and not po.activa))));

-- Archivos guardados de una promoción, o de una promotora (con su marca).
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
		where o.bucket_id in ('documentos', 'entregables', 'referencias', 'versiones')
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
		where (o.bucket_id in ('documentos', 'entregables', 'referencias', 'versiones')
				and public.promocion_del_archivo(o.bucket_id, o.name) in
					(select pr.id from public.promociones pr where pr.promotora_id = p_id))
			-- todo lo de la carpeta de la promotora (su marca incluida)
			or (o.bucket_id = 'documentos' and (storage.foldername(o.name))[1] = p_id::text);
end $$;
revoke all on function public.archivos_de_promotora(uuid) from public, anon;
grant execute on function public.archivos_de_promotora(uuid) to authenticated;

select 'Listo: borrado completo' as resultado;
