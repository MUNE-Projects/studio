-- Panel · paso 4: fotos de referencia en las peticiones de cambios.
--
-- Se ejecuta una vez en Supabase → SQL Editor. Es repetible.
--
-- Almacén privado «referencias»: la administradora adjunta fotos (JPG, PNG o
-- WebP, hasta 10 MB) a sus peticiones; el robot de Claude puede verlas para
-- atenderlas. Nadie las puede ver sin entrar, y desde el Panel no se borran.
-- Organización: referencias/<número de petición>/<archivo>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('referencias', 'referencias', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
	public = false,
	file_size_limit = excluded.file_size_limit,
	allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "admin sube referencias" on storage.objects;
create policy "admin sube referencias" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'referencias' and public.es_admin());

drop policy if exists "admin y robot ven referencias" on storage.objects;
create policy "admin y robot ven referencias" on storage.objects
	for select to authenticated
	using (bucket_id = 'referencias' and (public.es_admin() or public.es_robot()));

select 'Listo: almacén de fotos de referencia creado' as resultado;
