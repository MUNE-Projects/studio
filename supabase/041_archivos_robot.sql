-- Archivos para Claude, sin metadatos (decisión 66).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 040. Es repetible.
-- Antes, crear la función «archivo-robot» (supabase/funciones/archivo-robot):
-- sin ella, Claude no puede leer la documentación.
--
-- El robot de Claude deja de descargar directamente los originales:
--  · la documentación que sube la promotora (almacén «documentos»);
--  · los adjuntos de las opciones que pide la promotora (documentos/…/opciones/);
--  · las fotos de referencia de las peticiones (almacén «referencias»).
-- Los pide a la función «archivo-robot», que se los entrega sin metadatos (GPS,
-- autor, dispositivo, programa, XMP…) antes de que salgan hacia Claude. La
-- administradora y los equipos de las promotoras los siguen viendo tal cual.
-- El robot sigue leyendo la lista de documentos y opciones (nombres, estado,
-- huella), y bajando su web de cada versión, el entorno y la tipografía de la
-- marca (que no lleva datos de personas).

drop policy if exists "ven documentos" on storage.objects;
create policy "ven documentos" on storage.objects
	for select to authenticated
	using (bucket_id = 'documentos' and (public.es_admin()
		or public.equipo_puede(public.carpeta_de_documentos_valida(name), 'documentacion')));

drop policy if exists "ven opciones" on storage.objects;
create policy "ven opciones" on storage.objects
	for select to authenticated
	using (bucket_id = 'documentos' and (public.es_admin()
		or public.equipo_puede(public.carpeta_de_opciones_valida(name), 'personalizacion')));

drop policy if exists "admin y robot ven referencias" on storage.objects;
drop policy if exists "admin ve referencias" on storage.objects;
create policy "admin ve referencias" on storage.objects
	for select to authenticated
	using (bucket_id = 'referencias' and public.es_admin());

select 'Listo: Claude recibe los archivos sin metadatos' as resultado;
