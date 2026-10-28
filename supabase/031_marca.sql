-- Lista maestra · paso 8c: la promotora gestiona su marca desde MUNE Portal
-- (decisiones de la administradora del 28/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 030. Es repetible.
--
-- La marca es de la promotora: la pone una vez y vale para todas sus
-- promociones. Una promoción puede tener una marca propia (por ejemplo, con el
-- logo del residencial), que sustituye entera a la de la promotora solo en esa
-- promoción. La marca lleva el nombre que se enseña, el logo, los colores
-- (con su código, #7a2e3b), la tipografía y el contacto comercial.
-- Tipografía: cualquiera de Google Fonts, por su nombre, o la suya propia
-- (archivos WOFF2, WOFF, TTF u OTF subidos a documentos/<promotora>/marca/ o
-- documentos/<promotora>/<promoción>/marca/), confirmando que tiene licencia
-- para usarla en web. «preparar» la descarga y la guarda dentro de cada
-- versión: la Experiencia no pide nada a Google ni a nadie al visitarla.
-- Los textos legales siguen en *Ficha y datos* de cada promoción (020).
--
-- La Experiencia 3D pública es una web fija: la marca nueva sale en la
-- siguiente versión que prepare MUNE («preparar» la lee con el robot de
-- Claude), y pasa por la revisión de la administradora y la validación de la
-- promotora como siempre. Nada se publica al guardar.
--
-- Quién la cambia: la general, quien administra la promotora (y MUNE Studio);
-- la de una promoción, quien tenga ahí la capacidad «marca» (y MUNE Studio).
-- La ve todo el equipo de la promotora. El robot de Claude solo la lee.
--
-- El logo es un SVG (un PNG o JPG se envuelve en un SVG en el navegador). Como
-- la Experiencia lo pinta en la página, solo se acepta un SVG sin código: sin
-- scripts, sin eventos, sin enlaces a fuera y sin contenido incrustado que no
-- sea una imagen.
--
-- De paso: borrar una promoción desactivada (010) también borra sus datos
-- privados (024) y lo de su catálogo (029), que antes lo impedían.

-- ═══ 1. Marcas ══════════════════════════════════════════════════════════════

-- ¿Es un logo SVG sin código? (lo pinta la Experiencia pública)
create or replace function public.svg_seguro(p_svg text)
returns boolean
language sql
immutable
set search_path = ''
as $$
	select p_svg is not null
		and char_length(p_svg) <= 200000
		and p_svg ~* '^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]'
		and p_svg ~* '</svg>\s*$'
		and p_svg !~* '<\s*(script|foreignobject|iframe|embed|object|audio|video|a|animate|set|handler|listener)[\s>/]'
		and p_svg !~* '<!(doctype|entity)'
		and p_svg !~* '\son[a-z]+\s*='
		and p_svg !~* '(javascript|vbscript)\s*:'
		and p_svg !~* '@import'
		-- enlaces: solo a partes del mismo SVG (#…) o a una imagen incrustada
		and p_svg !~* 'href\s*=\s*["''](?!#|data:image/(png|jpeg|webp|gif);base64,)'
		and p_svg !~* 'url\(\s*["'']?(?!#)';
$$;
revoke all on function public.svg_seguro(text) from public, anon;
grant execute on function public.svg_seguro(text) to authenticated;

-- Tipografías sugeridas (gratuitas, de Google Fonts); se puede escribir cualquier otra de Google Fonts
create or replace function public.tipografias_marca()
returns text[]
language sql
immutable
set search_path = ''
as $$
	select array['Manrope', 'Inter', 'DM Sans', 'Work Sans', 'Montserrat', 'Poppins', 'Lato', 'Open Sans', 'Nunito Sans',
		'Raleway', 'Source Sans 3', 'Playfair Display', 'Lora', 'Cormorant Garamond', 'Libre Baskerville', 'Fraunces'];
$$;
revoke all on function public.tipografias_marca() from public, anon;
grant execute on function public.tipografias_marca() to authenticated;

create table if not exists public.marcas (
	id               bigint generated always as identity primary key,
	promotora_id     uuid not null references public.promotoras (id) on delete cascade,
	-- vacía: la general de la promotora; con promoción: la propia de esa promoción
	promocion_id     text references public.promociones (id) on delete cascade,
	nombre           text not null check (char_length(nombre) between 1 and 80),
	logo_svg         text,
	color_principal  text not null check (color_principal ~ '^#[0-9a-fA-F]{6}$'),
	color_secundario text not null check (color_secundario ~ '^#[0-9a-fA-F]{6}$'),
	tipografia       text not null,
	telefono         text check (char_length(telefono) <= 40),
	email            text check (char_length(email) <= 120),
	web              text check (char_length(web) <= 120),
	direccion        text check (char_length(direccion) <= 200),
	actualizado_por  uuid references auth.users (id),
	actualizado_en   timestamptz not null default now()
);
create unique index if not exists marcas_una_por_sitio on public.marcas (promotora_id, coalesce(promocion_id, ''));
-- tipografía: el nombre de una de Google Fonts o el de la propia
alter table public.marcas drop constraint if exists marcas_tipografia_check;
alter table public.marcas add constraint marcas_tipografia_check check (tipografia ~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$');
-- la propia: [{ ruta, nombre, peso, estilo }] en el almacén «documentos»; con la licencia confirmada
alter table public.marcas add column if not exists tipografia_archivos jsonb not null default '[]'::jsonb
	check (jsonb_typeof(tipografia_archivos) = 'array' and jsonb_array_length(tipografia_archivos) <= 6);
alter table public.marcas add column if not exists licencia_tipografia timestamptz;
-- sin logo vale (se escribe el nombre); con logo, solo un SVG sin código
alter table public.marcas drop constraint if exists marcas_logo_svg_check;
alter table public.marcas add constraint marcas_logo_svg_check check (logo_svg is null or public.svg_seguro(logo_svg));
alter table public.marcas enable row level security;
revoke all on public.marcas from anon, authenticated;

-- Una marca como la usa la Experiencia (promocion.json → marca)
create or replace function public._marca_json(m public.marcas)
returns jsonb
language sql
stable
set search_path = ''
as $$
	select case when m.id is null then null else jsonb_strip_nulls(jsonb_build_object(
		'promotora', m.nombre, 'logoSvg', m.logo_svg,
		'colorPrincipal', lower(m.color_principal), 'colorSecundario', lower(m.color_secundario),
		'tipografia', jsonb_strip_nulls(jsonb_build_object('familia', m.tipografia,
			'archivos', nullif(m.tipografia_archivos, '[]'::jsonb), 'licencia', m.licencia_tipografia)),
		'contacto', nullif(jsonb_strip_nulls(jsonb_build_object('telefono', m.telefono, 'email', m.email, 'web', m.web,
			'direccion', m.direccion)), '{}'::jsonb),
		'actualizado_en', m.actualizado_en,
		'por', case when public.es_admin_usuario(m.actualizado_por) then 'MUNE' else 'la promotora' end)) end;
$$;
revoke all on function public._marca_json(public.marcas) from public, anon, authenticated;

-- documentos/<promotora>/marca/<archivo> (general) o documentos/<promotora>/<promoción>/marca/<archivo>
-- (propia): { promotora, promocion } si la carpeta es de una marca que existe
create or replace function public.carpeta_de_marca(p_ruta text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when array_length(storage.foldername(p_ruta), 1) = 2 and (storage.foldername(p_ruta))[2] = 'marca'
			and exists (select 1 from public.promotoras po where po.id::text = (storage.foldername(p_ruta))[1])
			then jsonb_build_object('promotora', (storage.foldername(p_ruta))[1], 'promocion', null)
		when array_length(storage.foldername(p_ruta), 1) = 3 and (storage.foldername(p_ruta))[3] = 'marca'
			and exists (select 1 from public.promociones pr where pr.promotora_id::text = (storage.foldername(p_ruta))[1]
				and pr.id = (storage.foldername(p_ruta))[2])
			then jsonb_build_object('promotora', (storage.foldername(p_ruta))[1], 'promocion', (storage.foldername(p_ruta))[2])
	end;
$$;
revoke all on function public.carpeta_de_marca(text) from public, anon;
grant execute on function public.carpeta_de_marca(text) to authenticated;

-- ¿Puede la sesión subir (cambiar) o ver los archivos de esa carpeta de marca?
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
	if not p_cambiar and (public.es_robot() or public.es_miembro_de_promotora((c->>'promotora')::uuid)) then return true; end if;
	return case when c->>'promocion' is null then public.es_admin_promotora((c->>'promotora')::uuid)
		else public.puede(c->>'promocion', 'marca') end;
end $$;
revoke all on function public.puede_marca_en(text, boolean) from public, anon;
grant execute on function public.puede_marca_en(text, boolean) to authenticated;

drop policy if exists "marca sube tipografias" on storage.objects;
create policy "marca sube tipografias" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'documentos' and public.puede_marca_en(name, true));
drop policy if exists "ven tipografias de marca" on storage.objects;
create policy "ven tipografias de marca" on storage.objects
	for select to authenticated
	using (bucket_id = 'documentos' and public.puede_marca_en(name, false));

-- ═══ 2. Leer ════════════════════════════════════════════════════════════════

-- La marca general de una promotora (Inicio de MUNE Portal y MUNE Studio)
create or replace function public.marca_de_promotora(p_promotora uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	m public.marcas%rowtype;
begin
	if not (public.es_admin() or public.es_robot() or public.es_miembro_de_promotora(p_promotora)) then
		raise exception 'No tienes acceso a la marca de esta promotora';
	end if;
	select * into m from public.marcas where promotora_id = p_promotora and promocion_id is null;
	return jsonb_build_object(
		'general', public._marca_json(m),
		'puede_cambiar', public.es_admin() or public.es_admin_promotora(p_promotora),
		'tipografias', to_jsonb(public.tipografias_marca()),
		'propias', coalesce((select jsonb_agg(jsonb_build_object('id', pr.id, 'nombre', pr.nombre) order by pr.nombre)
			from public.marcas x join public.promociones pr on pr.id = x.promocion_id
			where x.promotora_id = p_promotora and (public.es_admin() or public.es_robot() or public.persona_puede(auth.uid(), pr.id, null))),
			'[]'::jsonb));
end $$;
revoke all on function public.marca_de_promotora(uuid) from public, anon;
grant execute on function public.marca_de_promotora(uuid) to authenticated;

-- La marca de una promoción: la general, la propia (si tiene) y la que se usa
create or replace function public.marca_de_promocion(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	v_promotora uuid;
	g public.marcas%rowtype;
	m public.marcas%rowtype;
begin
	if not (public.es_admin() or public.es_robot() or public.persona_puede(auth.uid(), p_promocion, null)) then
		raise exception 'No tienes acceso a la marca de esta promoción';
	end if;
	select pr.promotora_id into v_promotora from public.promociones pr where pr.id = p_promocion;
	select * into g from public.marcas where promotora_id = v_promotora and promocion_id is null;
	select * into m from public.marcas where promotora_id = v_promotora and promocion_id = p_promocion;
	return jsonb_build_object(
		'promotora_id', v_promotora,
		'general', public._marca_json(g),
		'propia', public._marca_json(m),
		'efectiva', coalesce(public._marca_json(m), public._marca_json(g)),
		'puede_cambiar', public.puede(p_promocion, 'marca'),
		'puede_cambiar_general', public.es_admin() or public.es_admin_promotora(v_promotora),
		'tipografias', to_jsonb(public.tipografias_marca()));
end $$;
revoke all on function public.marca_de_promocion(text) from public, anon;
grant execute on function public.marca_de_promocion(text) to authenticated;

-- ═══ 3. Guardar ═════════════════════════════════════════════════════════════

-- Guarda la marca general (p_promocion vacía) o la propia de una promoción.
-- p_marca: { nombre, logo_svg?, color_principal, color_secundario, tipografia,
--            tipografia_archivos?: [{ ruta, nombre, peso, estilo }], licencia?: true,
--            telefono?, email?, web?, direccion? }
create or replace function public.guardar_marca(p_promotora uuid, p_promocion text, p_marca jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_promocion text := nullif(btrim(p_promocion), '');
	v_logo text := nullif(btrim(coalesce(p_marca->>'logo_svg', '')), '');
	v_tipografia text := regexp_replace(btrim(coalesce(p_marca->>'tipografia', '')), '\s+', ' ', 'g');
	v_archivos jsonb := '[]'::jsonb;
	a jsonb;
	t text;
begin
	if v_promocion is null then
		if not (public.es_admin() or public.es_admin_promotora(p_promotora)) then
			raise exception 'Solo quien administra la promotora cambia su marca';
		end if;
	else
		if not exists (select 1 from public.promociones pr where pr.id = v_promocion and pr.promotora_id = p_promotora) then
			raise exception 'Esa promoción no es de esta promotora';
		end if;
		if not public.puede(v_promocion, 'marca') then
			raise exception 'No tienes permiso para cambiar la marca de esta promoción';
		end if;
	end if;
	if jsonb_typeof(p_marca) is distinct from 'object' then
		raise exception 'Marca no válida';
	end if;
	if char_length(btrim(coalesce(p_marca->>'nombre', ''))) not between 1 and 80 then
		raise exception 'Escribe el nombre que verán los compradores (como mucho, 80 letras)';
	end if;
	if v_logo is not null and not public.svg_seguro(v_logo) then
		raise exception 'Ese logo no se puede usar: sube un SVG sin código, o un PNG o JPG (como mucho, 150 KB)';
	end if;
	foreach t in array array['color_principal', 'color_secundario'] loop
		if coalesce(p_marca->>t, '') !~ '^#[0-9a-fA-F]{6}$' then
			raise exception 'Elige los dos colores';
		end if;
	end loop;
	if v_tipografia !~ '^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$' then
		raise exception 'Escribe el nombre de la tipografía (solo letras, números y espacios)';
	end if;
	-- tipografía propia: archivos ya subidos a la carpeta de marca de este sitio, con la licencia confirmada
	if jsonb_typeof(coalesce(p_marca->'tipografia_archivos', '[]'::jsonb)) <> 'array'
		or jsonb_array_length(coalesce(p_marca->'tipografia_archivos', '[]'::jsonb)) > 6 then
		raise exception 'Como mucho, seis archivos de tipografía';
	end if;
	for a in select x from jsonb_array_elements(coalesce(p_marca->'tipografia_archivos', '[]'::jsonb)) x loop
		-- la de este sitio o, en una promoción, también la general de su promotora (reutiliza sus archivos)
		if public.carpeta_de_marca(a->>'ruta')->>'promotora' is distinct from p_promotora::text
			or coalesce(public.carpeta_de_marca(a->>'ruta')->>'promocion', v_promocion, '') is distinct from coalesce(v_promocion, '')
			or not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = a->>'ruta') then
			raise exception 'Ese archivo de tipografía no está en la carpeta de esta marca';
		end if;
		if a->>'ruta' !~* '\.(woff2|woff|ttf|otf)$' then
			raise exception 'La tipografía tiene que ser un archivo WOFF2, WOFF, TTF u OTF';
		end if;
		if coalesce(a->>'peso', '400') not in ('300', '400', '500', '600', '700', '800') or coalesce(a->>'estilo', 'normal') not in ('normal', 'italic') then
			raise exception 'Peso o estilo de la tipografía no válido';
		end if;
		v_archivos := v_archivos || jsonb_build_array(jsonb_build_object('ruta', a->>'ruta', 'nombre', left(coalesce(a->>'nombre', ''), 120),
			'peso', coalesce(a->>'peso', '400')::int, 'estilo', coalesce(a->>'estilo', 'normal')));
	end loop;
	if jsonb_array_length(v_archivos) > 0 and (p_marca->>'licencia')::boolean is not true then
		raise exception 'Confirma que tienes licencia para usar esta tipografía en una web';
	end if;
	if char_length(coalesce(p_marca->>'telefono', '')) > 40 or char_length(coalesce(p_marca->>'email', '')) > 120
		or char_length(coalesce(p_marca->>'web', '')) > 120 or char_length(coalesce(p_marca->>'direccion', '')) > 200 then
		raise exception 'Algún dato de contacto es demasiado largo';
	end if;

	insert into public.marcas as m (promotora_id, promocion_id, nombre, logo_svg, color_principal, color_secundario, tipografia,
		tipografia_archivos, licencia_tipografia, telefono, email, web, direccion, actualizado_por, actualizado_en)
	values (p_promotora, v_promocion, btrim(p_marca->>'nombre'), v_logo, lower(p_marca->>'color_principal'), lower(p_marca->>'color_secundario'),
		v_tipografia, v_archivos, case when jsonb_array_length(v_archivos) > 0 then now() end, nullif(btrim(coalesce(p_marca->>'telefono', '')), ''), nullif(btrim(coalesce(p_marca->>'email', '')), ''),
		nullif(btrim(coalesce(p_marca->>'web', '')), ''), nullif(btrim(coalesce(p_marca->>'direccion', '')), ''), auth.uid(), now())
	on conflict (promotora_id, coalesce(promocion_id, '')) do update set
		nombre = excluded.nombre, logo_svg = excluded.logo_svg, color_principal = excluded.color_principal,
		color_secundario = excluded.color_secundario, tipografia = excluded.tipografia,
		tipografia_archivos = excluded.tipografia_archivos,
		licencia_tipografia = case when excluded.tipografia_archivos = '[]'::jsonb then null
			when excluded.tipografia_archivos = m.tipografia_archivos then coalesce(m.licencia_tipografia, excluded.licencia_tipografia)
			else excluded.licencia_tipografia end,
		telefono = excluded.telefono,
		email = excluded.email, web = excluded.web, direccion = excluded.direccion,
		actualizado_por = excluded.actualizado_por, actualizado_en = now();
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'cambia la marca', jsonb_build_object('promotora', p_promotora, 'promocion', v_promocion));
end $$;
revoke all on function public.guardar_marca(uuid, text, jsonb) from public, anon;
grant execute on function public.guardar_marca(uuid, text, jsonb) to authenticated;

-- La promoción vuelve a usar la marca de la promotora
create or replace function public.quitar_marca_propia(p_promocion text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not public.puede(p_promocion, 'marca') then
		raise exception 'No tienes permiso para cambiar la marca de esta promoción';
	end if;
	delete from public.marcas where promocion_id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'quita la marca propia', jsonb_build_object('promocion', p_promocion));
end $$;
revoke all on function public.quitar_marca_propia(text) from public, anon;
grant execute on function public.quitar_marca_propia(text) to authenticated;

-- ═══ 4. Borrar una promoción también borra sus datos privados y su catálogo ═

do $$
declare
	t text;
begin
	foreach t in array array['datos_privados', 'catalogo_ajustes', 'opciones_pedidas', 'catalogo_categorias', 'packs_promocion'] loop
		execute format('alter table public.%I drop constraint if exists %I', t, t || '_promocion_id_fkey');
		execute format('alter table public.%I add constraint %I foreign key (promocion_id) references public.promociones (id) on delete cascade',
			t, t || '_promocion_id_fkey');
	end loop;
end $$;

select 'Listo: la promotora gestiona su marca' as resultado;
