-- Carpeta de marca solo para tipografías, y el robot de Claude sin acceso directo
-- a ella (decisión 72; preparado el 9/11/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 046. Es repetible.
-- Antes, actualizar la función «archivo-robot» (supabase/funciones/archivo-robot),
-- que ahora entrega las tipografías: sin ella, «preparar» no puede descargar la
-- tipografía propia de una promotora.
--
-- Hasta ahora:
--  · en la carpeta de marca (documentos/<promotora>/marca/ o
--    documentos/<promotora>/<promoción>/marca/) se podía subir cualquier archivo:
--    solo MUNE Portal comprobaba que fuera una tipografía;
--  · el robot de Claude descargaba directamente cualquier archivo de esa carpeta,
--    sin pasar por «archivo-robot». Un PDF dejado ahí le llegaba tal cual.
-- Ahora:
--  · en la carpeta de marca solo se suben archivos WOFF2, WOFF, TTF u OTF;
--  · el robot ya no la lee directamente: pide cada tipografía a «archivo-robot»
--    (orden «tipografia»), que comprueba que el archivo es de verdad una
--    tipografía y si no, no lo entrega.
-- La administradora y los equipos de la promotora la siguen viendo igual.

create or replace function public.puede_marca_en(p_ruta text, p_cambiar boolean)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	c jsonb := public.carpeta_de_marca(p_ruta);
begin
	if c is null then return false; end if;
	if public.es_admin() then return true; end if;
	if not p_cambiar and public.es_miembro_de_promotora((c->>'promotora')::uuid) then return true; end if;
	return case when c->>'promocion' is null then public.es_admin_promotora((c->>'promotora')::uuid)
		else public.puede(c->>'promocion', 'marca') end;
end $$;
revoke all on function public.puede_marca_en(text, boolean) from public, anon;
grant execute on function public.puede_marca_en(text, boolean) to authenticated;

drop policy if exists "marca sube tipografias" on storage.objects;
create policy "marca sube tipografias" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'documentos' and public.puede_marca_en(name, true)
		and lower(coalesce(storage.extension(name), '')) in ('woff2', 'woff', 'ttf', 'otf'));

select 'Listo: la carpeta de marca solo admite tipografías y Claude las recibe por archivo-robot' as resultado;
