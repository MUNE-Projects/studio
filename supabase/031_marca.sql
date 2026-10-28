-- Lista maestra · paso 8c: la promotora gestiona su marca desde MUNE Portal
-- (decisiones de la administradora del 28/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 030. Es repetible.
--
-- La marca es de la promotora: la pone una vez y vale para todas sus
-- promociones. Una promoción puede tener una marca propia (por ejemplo, con el
-- logo del residencial), que sustituye entera a la de la promotora solo en esa
-- promoción. La marca lleva el nombre que se enseña, el logo, los colores, la
-- tipografía (de una lista de tipografías gratuitas) y el contacto comercial.
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

-- Tipografías que se pueden elegir (gratuitas, de Google Fonts)
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
	tipografia       text not null check (tipografia = any (public.tipografias_marca())),
	telefono         text check (char_length(telefono) <= 40),
	email            text check (char_length(email) <= 120),
	web              text check (char_length(web) <= 120),
	direccion        text check (char_length(direccion) <= 200),
	actualizado_por  uuid references auth.users (id),
	actualizado_en   timestamptz not null default now()
);
create unique index if not exists marcas_una_por_sitio on public.marcas (promotora_id, coalesce(promocion_id, ''));
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
		'tipografia', jsonb_build_object('familia', m.tipografia,
			'googleFonts', replace(m.tipografia, ' ', '+') || ':wght@400;500;600;700'),
		'contacto', nullif(jsonb_strip_nulls(jsonb_build_object('telefono', m.telefono, 'email', m.email, 'web', m.web,
			'direccion', m.direccion)), '{}'::jsonb),
		'actualizado_en', m.actualizado_en,
		'por', case when public.es_admin_usuario(m.actualizado_por) then 'MUNE' else 'la promotora' end)) end;
$$;
revoke all on function public._marca_json(public.marcas) from public, anon, authenticated;

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
	v_tipografia text := btrim(coalesce(p_marca->>'tipografia', ''));
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
	if not v_tipografia = any (public.tipografias_marca()) then
		raise exception 'Elige una tipografía de la lista';
	end if;
	if char_length(coalesce(p_marca->>'telefono', '')) > 40 or char_length(coalesce(p_marca->>'email', '')) > 120
		or char_length(coalesce(p_marca->>'web', '')) > 120 or char_length(coalesce(p_marca->>'direccion', '')) > 200 then
		raise exception 'Algún dato de contacto es demasiado largo';
	end if;

	insert into public.marcas as m (promotora_id, promocion_id, nombre, logo_svg, color_principal, color_secundario, tipografia,
		telefono, email, web, direccion, actualizado_por, actualizado_en)
	values (p_promotora, v_promocion, btrim(p_marca->>'nombre'), v_logo, p_marca->>'color_principal', p_marca->>'color_secundario',
		v_tipografia, nullif(btrim(coalesce(p_marca->>'telefono', '')), ''), nullif(btrim(coalesce(p_marca->>'email', '')), ''),
		nullif(btrim(coalesce(p_marca->>'web', '')), ''), nullif(btrim(coalesce(p_marca->>'direccion', '')), ''), auth.uid(), now())
	on conflict (promotora_id, coalesce(promocion_id, '')) do update set
		nombre = excluded.nombre, logo_svg = excluded.logo_svg, color_principal = excluded.color_principal,
		color_secundario = excluded.color_secundario, tipografia = excluded.tipografia, telefono = excluded.telefono,
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
