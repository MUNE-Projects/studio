-- Lista maestra · paso 8a: la promotora gestiona su catálogo y sus precios
-- desde MUNE Portal (decisiones del 28/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 028. Es repetible.
--
-- El catálogo de personalización (opciones, nombres y precios) sigue llegando
-- con cada versión (datos privados, 024). Encima, la promotora (con la capacidad
-- «personalizacion») y MUNE Studio pueden ajustar, sin preparar versión nueva:
--  · el nombre y la descripción de cada opción;
--  · su precio, mientras su pack no se haya abierto a los compradores: desde ese
--    día queda fijo para siempre (una mejora lanzada nunca cambia de precio).
--    Las categorías que no están en ningún pack se abren con la promoción
--    publicada;
--  · si se ofrece o no (dejar de ofrecer: quien ya la eligió la conserva con su
--    precio; los demás ya no la ven);
--  · en qué tipologías se ofrece.
-- La opción incluida de serie (la primera de cada tipología) no se puede quitar.
-- Fechas de elección (decidido por la administradora el 28/10/2026): cada
-- categoría se elige por separado, con su apertura y su cierre, o dentro de un
-- pack (una ficha con título y fechas) que agrupa las que la promotora quiera;
-- un solo pack con todas es «todo junto». Una categoría por separado es, por
-- dentro, un pack de una sola categoría («individual»). Un pack abierto o
-- terminado no cambia de fecha de apertura ni de categorías (solo su título, su
-- descripción y alargar o acortar su cierre sin dejarlo en el pasado); los packs
-- aún sin abrir se pueden cambiar por completo y no pueden empezar en el pasado.
-- Los cambios se aplican al momento; cada uno queda en el registro con quién lo
-- hizo. La promotora también añade opciones nuevas (y categorías nuevas): con
-- su precio, su descripción y, si quiere, un documento (fotos, ficha) para que
-- MUNE (Claude, con el robot, que solo puede leerlos) prepare su aspecto en el
-- 3D (pedir_opcion, en documentos/<promotora>/<promoción>/opciones/). Queda «En
-- preparación» y los compradores la ven en la versión siguiente. El documento
-- nunca llega al comprador. Mientras está en preparación, la promotora ya puede
-- meterla (y su categoría nueva) en un pack, ponerle fechas, cambiar su nombre,
-- su precio y su descripción, o retirarla; los compradores no la ven hasta que
-- MUNE la prepara, y entonces aparece ya con su pack y sus fechas. Cada
-- categoría nueva recibe su identificador al pedirla (opciones_pedidas.categoria),
-- que MUNE usa al prepararla para que encaje con los packs.

-- ═══ 1. Ajustes del catálogo y opciones pedidas ═════════════════════════════

create table if not exists public.catalogo_ajustes (
	promocion_id    text not null references public.promociones (id),
	categoria       text not null check (categoria ~ '^[a-z0-9-]{1,60}$'),
	opcion          text not null check (opcion ~ '^[a-z0-9-]{1,60}$'),
	nombre          text check (char_length(nombre) between 1 and 80),
	detalle         text check (char_length(detalle) <= 300),
	precio          numeric(12, 2) check (precio >= 0 and precio <= 10000000),
	ofrecida        boolean,
	-- en qué tipologías se ofrece (null: como venga en la versión)
	tipologias      text[],
	actualizado_por uuid references auth.users (id),
	actualizado_en  timestamptz not null default now(),
	primary key (promocion_id, categoria, opcion)
);
alter table public.catalogo_ajustes enable row level security;
revoke all on public.catalogo_ajustes from anon, authenticated;

create table if not exists public.opciones_pedidas (
	id           bigint generated always as identity primary key,
	promocion_id text not null references public.promociones (id),
	categoria    text check (char_length(categoria) <= 60),
	nombre       text not null check (char_length(nombre) between 1 and 80),
	descripcion  text check (char_length(descripcion) <= 1000),
	precio       numeric(12, 2) check (precio >= 0 and precio <= 10000000),
	pedido_por   uuid references auth.users (id) default auth.uid(),
	pedido_en    timestamptz not null default now(),
	estado       text not null default 'pendiente' check (estado in ('pendiente', 'hecha', 'descartada')),
	nota         text check (char_length(nota) <= 500),
	atendido_en  timestamptz
);
-- categoría nueva (si no es de las del catálogo)
alter table public.opciones_pedidas add column if not exists categoria_nueva text check (char_length(categoria_nueva) between 1 and 60);
-- documentos adjuntos (fotos, ficha): [{ ruta, nombre }] en el almacén «documentos»
alter table public.opciones_pedidas add column if not exists archivos jsonb not null default '[]'::jsonb
	check (jsonb_typeof(archivos) = 'array' and jsonb_array_length(archivos) <= 5);
alter table public.opciones_pedidas enable row level security;
revoke all on public.opciones_pedidas from anon, authenticated;

-- Nombre de cada categoría puesto por la promotora («Suelo» → «Pavimentos»).
create table if not exists public.catalogo_categorias (
	promocion_id    text not null references public.promociones (id),
	categoria       text not null check (categoria ~ '^[a-z0-9-]{1,60}$'),
	nombre          text not null check (char_length(nombre) between 1 and 60),
	actualizado_por uuid references auth.users (id),
	actualizado_en  timestamptz not null default now(),
	primary key (promocion_id, categoria)
);
alter table public.catalogo_categorias enable row level security;
revoke all on public.catalogo_categorias from anon, authenticated;

-- Packs de la promotora: si existen, sustituyen a los de la versión.
create table if not exists public.packs_promocion (
	promocion_id    text primary key references public.promociones (id),
	packs           jsonb not null check (jsonb_typeof(packs) = 'array' and jsonb_array_length(packs) <= 30),
	actualizado_por uuid references auth.users (id),
	actualizado_en  timestamptz not null default now()
);
alter table public.packs_promocion enable row level security;
revoke all on public.packs_promocion from anon, authenticated;

-- documentos/<promotora>/<promoción>/opciones/<archivo>: lo adjunto a una opción pedida
create or replace function public.carpeta_de_opciones_valida(p_ruta text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select pr.id from public.promociones pr
	where pr.promotora_id::text = (storage.foldername(p_ruta))[1]
		and pr.id = (storage.foldername(p_ruta))[2]
		and (storage.foldername(p_ruta))[3] = 'opciones'
		and array_length(storage.foldername(p_ruta), 1) = 3;
$$;
revoke all on function public.carpeta_de_opciones_valida(text) from public, anon;
grant execute on function public.carpeta_de_opciones_valida(text) to authenticated;

drop policy if exists "personalizacion sube opciones" on storage.objects;
create policy "personalizacion sube opciones" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'documentos' and (public.es_admin()
		or public.equipo_puede(public.carpeta_de_opciones_valida(name), 'personalizacion')));
drop policy if exists "ven opciones" on storage.objects;
create policy "ven opciones" on storage.objects
	for select to authenticated
	using (bucket_id = 'documentos' and (public.es_admin() or (public.es_robot() and public.carpeta_de_opciones_valida(name) is not null)
		or public.equipo_puede(public.carpeta_de_opciones_valida(name), 'personalizacion')));

-- ═══ 2. Utilidades internas ═════════════════════════════════════════════════

-- Una lista JSON de identificadores sin uno de ellos
create or replace function public._sin(p_lista jsonb, p_id text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select coalesce(jsonb_agg(e), '[]'::jsonb) from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) e where e #>> '{}' <> p_id;
$$;
revoke all on function public._sin(jsonb, text) from public, anon, authenticated;

-- Identificador de una categoría nueva desde su nombre («Iluminación» → «iluminacion»)
create or replace function public._id_de(p_nombre text)
returns text
language sql
immutable
set search_path = ''
as $$
	select coalesce(nullif(left(btrim(regexp_replace(translate(lower(coalesce(p_nombre, '')),
		'áàäâãéèëêíìïîóòöôõúùüûñç', 'aaaaaeeeeiiiiooooouuuunc'), '[^a-z0-9]+', '-', 'g'), '-'), 50), ''), 'categoria');
$$;
revoke all on function public._id_de(text) from public, anon, authenticated;

-- las opciones pedidas antes de tener identificador de categoría
update public.opciones_pedidas set categoria = public._id_de(categoria_nueva)
where categoria is null and categoria_nueva is not null;

-- Datos de una promoción sin versión preparada todavía: catálogo vacío
create or replace function public._datos_o_vacio(p_promocion text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(public._ultimos_datos(p_promocion), jsonb_build_object('catalogo', jsonb_build_object('categorias', '[]'::jsonb),
		'packs', '[]'::jsonb, 'tipologias', '[]'::jsonb, 'viviendas', '[]'::jsonb));
$$;
revoke all on function public._datos_o_vacio(text) from public, anon, authenticated;

-- Los packs tal como los guardó la promotora, también con las categorías que
-- aún están en preparación (los compradores solo ven las del catálogo).
create or replace function public._packs_de(p_promocion text, d jsonb)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce((select pp.packs from public.packs_promocion pp where pp.promocion_id = p_promocion), d->'packs', '[]'::jsonb);
$$;
revoke all on function public._packs_de(text, jsonb) from public, anon, authenticated;

-- Categorías nuevas en preparación: { id: nombre }
create or replace function public._categorias_en_preparacion(p_promocion text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(jsonb_object_agg(x.categoria, coalesce(cc.nombre, x.nombre)), '{}'::jsonb)
	from (select op.categoria, min(op.categoria_nueva) as nombre from public.opciones_pedidas op
		where op.promocion_id = p_promocion and op.estado = 'pendiente' and op.categoria_nueva is not null and op.categoria is not null
		group by op.categoria) x
	left join public.catalogo_categorias cc on cc.promocion_id = p_promocion and cc.categoria = x.categoria;
$$;
revoke all on function public._categorias_en_preparacion(text) from public, anon, authenticated;

-- Estado de un pack hoy: proximamente | disponible | finalizado
create or replace function public._estado_pack(p jsonb)
returns text
language sql
stable
set search_path = ''
as $$
	select coalesce(p->>'estado', case when public._hoy_espana() < (p->>'desde')::date then 'proximamente'
		when public._hoy_espana() > (p->>'hasta')::date then 'finalizado' else 'disponible' end);
$$;
revoke all on function public._estado_pack(jsonb) from public, anon, authenticated;

-- ¿Está ya lanzada (abierta a los compradores) una categoría? Entonces sus precios
-- no cambian nunca más. Por su pack; si no está en ninguno, con la promoción publicada.
create or replace function public._categoria_lanzada(p_promocion text, d jsonb, p_categoria text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	p jsonb;
begin
	select x into p from jsonb_array_elements(coalesce(d->'packs', '[]'::jsonb)) x where x->'categorias' ? p_categoria limit 1;
	if p is not null then
		return public._estado_pack(p) <> 'proximamente';
	end if;
	return exists (select 1 from public.promociones pr where pr.id = p_promocion and pr.estado = 'publicada');
end $$;
revoke all on function public._categoria_lanzada(text, jsonb, text) from public, anon, authenticated;

-- Los datos privados de una versión con los ajustes de la promotora aplicados:
-- nombres, descripciones y precios en el catálogo; qué se ofrece en cada
-- tipología y en cada vivienda.
create or replace function public._aplicar_catalogo(p_promocion text, d jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	a public.catalogo_ajustes%rowtype;
	r jsonb := d;
	cats jsonb := '[]'::jsonb;
	c jsonb;
	o jsonb;
	ops jsonb;
	t jsonb;
	tips jsonb;
	v jsonb;
	vivs jsonb;
	lista jsonb;
	tenia boolean;
	quiere boolean;
begin
	if d is null then
		return d;
	end if;
	-- packs de la promotora, solo con las categorías del catálogo (las que están
	-- en preparación esperan a que MUNE las prepare; un pack sin ninguna no se ve)
	select pp.packs into lista from public.packs_promocion pp where pp.promocion_id = p_promocion;
	if lista is not null then
		r := jsonb_set(r, '{packs}', coalesce((select jsonb_agg(p || jsonb_build_object('categorias', (p->'categorias') - (
				select coalesce(array_agg(z), '{}') from jsonb_array_elements_text(p->'categorias') z
				where not exists (select 1 from jsonb_array_elements(coalesce(d->'catalogo'->'categorias', '[]'::jsonb)) k where k->>'id' = z))))
			from jsonb_array_elements(lista) p
			where exists (select 1 from jsonb_array_elements_text(p->'categorias') z
				join jsonb_array_elements(coalesce(d->'catalogo'->'categorias', '[]'::jsonb)) k on k->>'id' = z)), '[]'::jsonb));
	end if;
	if not exists (select 1 from public.catalogo_ajustes ca where ca.promocion_id = p_promocion)
		and not exists (select 1 from public.catalogo_categorias cc where cc.promocion_id = p_promocion) then
		return r;
	end if;
	-- nombres, descripciones y precios
	for c in select x from jsonb_array_elements(coalesce(d->'catalogo'->'categorias', '[]'::jsonb)) x loop
		ops := '[]'::jsonb;
		for o in select x from jsonb_array_elements(coalesce(c->'opciones', '[]'::jsonb)) x loop
			select * into a from public.catalogo_ajustes ca
			where ca.promocion_id = p_promocion and ca.categoria = c->>'id' and ca.opcion = o->>'id';
			if found then
				if a.nombre is not null then o := o || jsonb_build_object('nombre', a.nombre); end if;
				if a.detalle is not null then o := case when a.detalle = '' then o - 'detalle' else o || jsonb_build_object('detalle', a.detalle) end; end if;
				if a.precio is not null then o := o || jsonb_build_object('precio', a.precio); end if;
				if a.ofrecida = false then o := o || jsonb_build_object('ofrecida', false); end if;
			end if;
			ops := ops || jsonb_build_array(o);
		end loop;
		c := c || jsonb_build_object('opciones', ops);
		c := c || coalesce((select jsonb_build_object('nombre', cc.nombre) from public.catalogo_categorias cc
			where cc.promocion_id = p_promocion and cc.categoria = c->>'id'), '{}'::jsonb);
		cats := cats || jsonb_build_array(c);
	end loop;
	if d->'catalogo' is not null then
		r := jsonb_set(r, '{catalogo,categorias}', cats);
	end if;

	-- qué se ofrece en cada tipología y en cada vivienda
	for a in select * from public.catalogo_ajustes ca
		where ca.promocion_id = p_promocion and (ca.ofrecida = false or ca.tipologias is not null) loop
		tips := '[]'::jsonb;
		for t in select x from jsonb_array_elements(coalesce(r->'tipologias', '[]'::jsonb)) x loop
			lista := t->'opciones'->a.categoria;
			tenia := coalesce(lista ? a.opcion, false);
			quiere := a.ofrecida is distinct from false
				and case when a.tipologias is null then tenia else (t->>'id') = any (a.tipologias) end;
			if tenia and not quiere then
				lista := public._sin(lista, a.opcion);
			elsif quiere and not tenia then
				lista := coalesce(lista, '[]'::jsonb) || to_jsonb(a.opcion);
			end if;
			if lista is not null then
				t := t || jsonb_build_object('opciones', coalesce(t->'opciones', '{}'::jsonb) || jsonb_build_object(a.categoria, lista));
			end if;
			tips := tips || jsonb_build_array(t);
		end loop;
		r := jsonb_set(r, '{tipologias}', tips);
		vivs := '[]'::jsonb;
		for v in select x from jsonb_array_elements(coalesce(r->'viviendas', '[]'::jsonb)) x loop
			if v->'opciones'->a.categoria ? a.opcion and (a.ofrecida = false
				or (a.tipologias is not null and not (v->>'tipologia') = any (a.tipologias))) then
				v := jsonb_set(v, array['opciones', a.categoria], public._sin(v->'opciones'->a.categoria, a.opcion));
			end if;
			vivs := vivs || jsonb_build_array(v);
		end loop;
		r := jsonb_set(r, '{viviendas}', vivs);
	end loop;
	return r;
end $$;
revoke all on function public._aplicar_catalogo(text, jsonb) from public, anon, authenticated;

-- ═══ 3. Catálogo y precios en MUNE Portal y MUNE Studio ═════════════════════

-- Lo que enseña la sección «Catálogo y precios»: cada categoría con sus opciones
-- tal como las ven ahora los compradores, si su precio ya está fijo, cuál es la
-- incluida de serie, y las opciones nuevas pedidas.
create or replace function public.catalogo_de_promocion(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	d jsonb;
	e jsonb;
begin
	if not (public.es_admin() or public.es_robot() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	-- sin versión preparada todavía: catálogo vacío (la promotora ya puede añadir sus primeras opciones)
	d := public._datos_o_vacio(p_promocion);
	e := public._aplicar_catalogo(p_promocion, d);
	return jsonb_build_object(
		'hoy', public._hoy_espana(),
		'catalogo', e->'catalogo',
		-- los packs con todas sus categorías, también las que están en preparación
		'packs', public._packs_de(p_promocion, d),
		-- categorías nuevas en preparación: { id: nombre }
		'en_preparacion', public._categorias_en_preparacion(p_promocion),
		-- en qué tipologías se ofrece cada opción ahora, y cuál es la incluida de cada tipología
		'tipologias', coalesce(e->'tipologias', '[]'::jsonb),
		'tipologias_version', coalesce(d->'tipologias', '[]'::jsonb),
		'lanzadas', coalesce((select jsonb_agg(c->>'id') from jsonb_array_elements(coalesce(d->'catalogo'->'categorias', '[]'::jsonb)) c
			where public._categoria_lanzada(p_promocion, e, c->>'id')), '[]'::jsonb),
		'packs_actualizado', (select jsonb_build_object('en', pp.actualizado_en, 'por',
			case when public.es_admin_usuario(pp.actualizado_por) then 'MUNE' else 'la promotora' end)
			from public.packs_promocion pp where pp.promocion_id = p_promocion),
		'cambios', coalesce((select jsonb_agg(jsonb_build_object('categoria', ca.categoria, 'opcion', ca.opcion,
			'actualizado_en', ca.actualizado_en, 'por', case when public.es_admin_usuario(ca.actualizado_por) then 'MUNE' else 'la promotora' end)
			order by ca.actualizado_en desc)
			from public.catalogo_ajustes ca where ca.promocion_id = p_promocion), '[]'::jsonb),
		'pedidas', coalesce((select jsonb_agg(jsonb_build_object('id', op.id, 'categoria', op.categoria, 'nombre', op.nombre,
			'descripcion', op.descripcion, 'precio', op.precio, 'pedido_en', op.pedido_en, 'estado', op.estado, 'nota', op.nota,
			'archivos', op.archivos, 'categoria_nueva', op.categoria_nueva)
			order by op.pedido_en desc)
			from public.opciones_pedidas op where op.promocion_id = p_promocion), '[]'::jsonb));
end $$;
revoke all on function public.catalogo_de_promocion(text) from public, anon;
grant execute on function public.catalogo_de_promocion(text) to authenticated;

-- ¿Es de MUNE (administradora) una persona? Para el registro de quién cambió qué.
create or replace function public.es_admin_usuario(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select exists (select 1 from public.administradores ad where ad.user_id = p_user) $$;
revoke all on function public.es_admin_usuario(uuid) from public, anon, authenticated;

-- Guarda los cambios de la sección «Catálogo y precios», todos o ninguno.
-- p_cambios: [{ categoria, opcion, nombre?, detalle?, precio?, ofrecida?, tipologias? }]
-- o, para cambiar el nombre de una categoría: [{ categoria, nombre_categoria }]
-- o, para una opción en preparación: [{ pedida, nombre?, detalle?, precio? }] y,
-- para retirarla, [{ pedida, quitar: true }]
create or replace function public.guardar_catalogo(p_promocion text, p_cambios jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	d jsonb;
	e jsonb;
	x jsonb;
	k jsonb;
	o jsonb;
	t jsonb;
	n int := 0;
	v_tipologias text[];
	v_precio numeric;
	pe public.opciones_pedidas%rowtype;
	nuevas jsonb := public._categorias_en_preparacion(p_promocion);
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) > 500 then
		raise exception 'Cambios no válidos';
	end if;
	d := public._datos_o_vacio(p_promocion);
	e := public._aplicar_catalogo(p_promocion, d);

	for x in select y from jsonb_array_elements(p_cambios) y loop
		v_tipologias := null;
		-- una opción en preparación: los compradores aún no la ven, así que todo se puede cambiar
		if x ? 'pedida' then
			select * into pe from public.opciones_pedidas op
			where op.id = (x->>'pedida')::bigint and op.promocion_id = p_promocion and op.estado = 'pendiente';
			if pe.id is null then
				raise exception 'Esa opción ya no está en preparación';
			end if;
			if (x->>'quitar')::boolean then
				update public.opciones_pedidas set estado = 'descartada', atendido_en = now(),
					nota = case when public.es_admin() then 'Retirada por MUNE' else 'Retirada por la promotora' end
				where id = pe.id;
				-- su categoría nueva, si ya no le queda nada, sale de los packs
				if pe.categoria_nueva is not null and not exists (select 1 from public.opciones_pedidas op
					where op.promocion_id = p_promocion and op.categoria = pe.categoria and op.estado in ('pendiente', 'hecha'))
					and not exists (select 1 from jsonb_array_elements(e->'catalogo'->'categorias') c where c->>'id' = pe.categoria) then
					update public.packs_promocion pp set packs = coalesce((select jsonb_agg(p || jsonb_build_object('categorias', public._sin(p->'categorias', pe.categoria)))
						from jsonb_array_elements(pp.packs) p
						where not ((p->>'individual')::boolean and p->'categorias' ? pe.categoria)), '[]'::jsonb)
					where pp.promocion_id = p_promocion;
				end if;
			else
				if x ? 'nombre' and char_length(btrim(coalesce(x->>'nombre', ''))) not between 1 and 80 then
					raise exception 'Escribe el nombre de la opción (como mucho, 80 letras)';
				end if;
				if x ? 'detalle' and char_length(coalesce(x->>'detalle', '')) > 1000 then
					raise exception 'La descripción de «%» es demasiado larga', pe.nombre;
				end if;
				if x ? 'precio' then
					v_precio := round((x->>'precio')::numeric, 2);
					if v_precio is null or v_precio < 0 or v_precio > 10000000 then
						raise exception 'El precio de «%» no es válido', pe.nombre;
					end if;
				end if;
				update public.opciones_pedidas set
					nombre = case when x ? 'nombre' then btrim(x->>'nombre') else nombre end,
					descripcion = case when x ? 'detalle' then nullif(btrim(coalesce(x->>'detalle', '')), '') else descripcion end,
					precio = case when x ? 'precio' then v_precio else precio end
				where id = pe.id;
			end if;
			n := n + 1;
			continue;
		end if;
		select c into k from jsonb_array_elements(e->'catalogo'->'categorias') c where c->>'id' = x->>'categoria' limit 1;
		-- nombre de la categoría (también de una nueva en preparación)
		if x ? 'nombre_categoria' and x->>'opcion' is null then
			if k is null and not nuevas ? (x->>'categoria') then raise exception 'Esa categoría no está en el catálogo'; end if;
			if char_length(btrim(coalesce(x->>'nombre_categoria', ''))) not between 1 and 60 then
				raise exception 'Escribe el nombre de la categoría (como mucho, 60 letras)';
			end if;
			insert into public.catalogo_categorias as cc (promocion_id, categoria, nombre, actualizado_por, actualizado_en)
			values (p_promocion, x->>'categoria', btrim(x->>'nombre_categoria'), auth.uid(), now())
			on conflict (promocion_id, categoria) do update set nombre = excluded.nombre, actualizado_por = excluded.actualizado_por, actualizado_en = now();
			if k is null then
				update public.opciones_pedidas set categoria_nueva = btrim(x->>'nombre_categoria')
				where promocion_id = p_promocion and categoria = x->>'categoria' and estado = 'pendiente' and categoria_nueva is not null;
			end if;
			n := n + 1;
			continue;
		end if;
		select op into o from jsonb_array_elements(coalesce(k->'opciones', '[]'::jsonb)) op where op->>'id' = x->>'opcion' limit 1;
		if o is null then
			raise exception 'Esa opción no está en el catálogo';
		end if;
		-- una mejora lanzada nunca cambia de precio
		if x ? 'precio' then
			v_precio := round((x->>'precio')::numeric, 2);
			if v_precio < 0 or v_precio > 10000000 then
				raise exception 'El precio de «%» no es válido', o->>'nombre';
			end if;
			if v_precio <> coalesce((o->>'precio')::numeric, 0) and public._categoria_lanzada(p_promocion, e, k->>'id') then
				raise exception 'La categoría «%» ya está abierta a los compradores: sus precios ya no se pueden cambiar', k->>'nombre';
			end if;
		end if;
		if x ? 'tipologias' then
			select array_agg(y) into v_tipologias from jsonb_array_elements_text(x->'tipologias') y;
		end if;
		-- la opción incluida de serie (la primera de una tipología) no se puede quitar de esa tipología
		for t in select y from jsonb_array_elements(coalesce(d->'tipologias', '[]'::jsonb)) y loop
			if t->'opciones'->(k->>'id')->>0 = o->>'id'
				and ((x->>'ofrecida')::boolean is false or (x ? 'tipologias' and not (t->>'id') = any (coalesce(v_tipologias, '{}')))) then
				raise exception '«%» es la opción incluida de serie: no se puede dejar de ofrecer', o->>'nombre';
			end if;
		end loop;
		insert into public.catalogo_ajustes as ca (promocion_id, categoria, opcion, nombre, detalle, precio, ofrecida, tipologias, actualizado_por, actualizado_en)
		values (p_promocion, k->>'id', o->>'id',
			nullif(btrim(x->>'nombre'), ''), case when x ? 'detalle' then btrim(coalesce(x->>'detalle', '')) end,
			case when x ? 'precio' then v_precio end, (x->>'ofrecida')::boolean,
			case when x ? 'tipologias' then coalesce(v_tipologias, '{}') end, auth.uid(), now())
		on conflict (promocion_id, categoria, opcion) do update set
			nombre = coalesce(excluded.nombre, ca.nombre),
			detalle = case when x ? 'detalle' then excluded.detalle else ca.detalle end,
			precio = case when x ? 'precio' then excluded.precio else ca.precio end,
			ofrecida = case when x ? 'ofrecida' then excluded.ofrecida else ca.ofrecida end,
			tipologias = case when x ? 'tipologias' then excluded.tipologias else ca.tipologias end,
			actualizado_por = excluded.actualizado_por, actualizado_en = now();
		n := n + 1;
	end loop;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'cambia el catálogo', jsonb_build_object('promocion', p_promocion, 'cambios', n,
		'opciones', (select jsonb_agg(case when y ? 'pedida' then 'en preparación:' || (y->>'pedida') || case when (y->>'quitar')::boolean then ':retirada' else '' end
			else y->>'categoria' || ':' || coalesce(y->>'opcion', 'nombre') end) from jsonb_array_elements(p_cambios) y)));
	return n;
end $$;
revoke all on function public.guardar_catalogo(text, jsonb) from public, anon;
grant execute on function public.guardar_catalogo(text, jsonb) to authenticated;

-- La promotora pide una opción con un aspecto nuevo (hay que crearla en el 3D),
-- con fotos o fichas ya subidas a documentos/<promotora>/<promoción>/opciones/.
drop function if exists public.pedir_opcion(text, text, text, text, numeric);
drop function if exists public.pedir_opcion(text, text, text, text, numeric, jsonb);
create or replace function public.pedir_opcion(p_promocion text, p_categoria text, p_categoria_nueva text, p_nombre text, p_descripcion text,
	p_precio numeric, p_archivos jsonb default '[]'::jsonb)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_id bigint;
	a jsonb;
	v_archivos jsonb := '[]'::jsonb;
	v_categoria text := nullif(btrim(p_categoria), '');
	v_nueva text := nullif(btrim(p_categoria_nueva), '');
	cats text[];
	nuevas jsonb := public._categorias_en_preparacion(p_promocion);
	i int := 1;
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	if char_length(btrim(coalesce(p_nombre, ''))) = 0 then
		raise exception 'Escribe el nombre de la opción';
	end if;
	if v_categoria is null and v_nueva is null then
		raise exception 'Elige la categoría o escribe el nombre de la nueva';
	end if;
	if char_length(v_nueva) > 60 then
		raise exception 'El nombre de la categoría es demasiado largo (como mucho, 60 letras)';
	end if;
	select coalesce(array_agg(k->>'id'), '{}') into cats
	from jsonb_array_elements(public._datos_o_vacio(p_promocion)->'catalogo'->'categorias') k;
	if v_categoria is not null then
		-- una del catálogo, o una nueva que ya está en preparación
		if nuevas ? v_categoria then
			v_nueva := nuevas->>v_categoria;
		elsif v_categoria = any (cats) then
			v_nueva := null;
		else
			raise exception 'Esa categoría no está en el catálogo';
		end if;
	else
		-- una categoría nueva: con el mismo nombre que otra en preparación, es esa
		select key into v_categoria from jsonb_each_text(nuevas) where lower(value) = lower(v_nueva) limit 1;
		if v_categoria is null then
			v_categoria := public._id_de(v_nueva);
			while v_categoria = any (cats) or exists (select 1 from public.opciones_pedidas op
				where op.promocion_id = p_promocion and op.categoria = v_categoria) loop
				i := i + 1;
				v_categoria := public._id_de(v_nueva) || '-' || i;
			end loop;
		end if;
	end if;
	if p_precio is not null and (p_precio < 0 or p_precio > 10000000) then
		raise exception 'El precio no es válido';
	end if;
	if jsonb_typeof(coalesce(p_archivos, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_archivos, '[]'::jsonb)) > 5 then
		raise exception 'Como mucho, cinco archivos';
	end if;
	for a in select x from jsonb_array_elements(coalesce(p_archivos, '[]'::jsonb)) x loop
		-- solo archivos ya subidos a la carpeta de opciones de esta promoción
		if public.carpeta_de_opciones_valida(a->>'ruta') is distinct from p_promocion
			or not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = a->>'ruta') then
			raise exception 'Ese archivo no está en la carpeta de esta promoción';
		end if;
		v_archivos := v_archivos || jsonb_build_array(jsonb_build_object('ruta', a->>'ruta', 'nombre', left(coalesce(a->>'nombre', ''), 120)));
	end loop;
	insert into public.opciones_pedidas (promocion_id, categoria, categoria_nueva, nombre, descripcion, precio, archivos)
	values (p_promocion, v_categoria, v_nueva,
		btrim(p_nombre), nullif(btrim(p_descripcion), ''), p_precio, v_archivos)
	returning id into v_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'pide una opción nueva', jsonb_build_object('promocion', p_promocion, 'nombre', btrim(p_nombre),
		'archivos', jsonb_array_length(v_archivos)));
	return v_id;
end $$;
revoke all on function public.pedir_opcion(text, text, text, text, text, numeric, jsonb) from public, anon;
grant execute on function public.pedir_opcion(text, text, text, text, text, numeric, jsonb) to authenticated;

-- Guarda las fechas de elección de la promoción, todas de una vez: los packs y
-- las categorías por separado (packs «individual» de una sola categoría).
-- p_packs: [{ id, titulo, descripcion?, desde, hasta, categorias: [...], individual? }]
-- Todas las categorías del catálogo (y las nuevas en preparación) tienen que tener sus fechas.
create or replace function public.guardar_packs(p_promocion text, p_packs jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	d jsonb;
	e jsonb;
	x jsonb;
	viejo jsonb;
	cats text[];
	-- categorías nuevas en preparación: { id: nombre }
	nuevas jsonb := public._categorias_en_preparacion(p_promocion);
	-- las de opciones ya preparadas, por si aún no ha llegado su versión
	hechas text[];
	packs jsonb;
	usadas text[] := '{}';
	ids text[] := '{}';
	c text;
	v_desde date;
	v_hasta date;
	v_packs jsonb := '[]'::jsonb;
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso a los packs de esta promoción';
	end if;
	if jsonb_typeof(p_packs) is distinct from 'array' or jsonb_array_length(p_packs) > 30 then
		raise exception 'Packs no válidos';
	end if;
	d := public._datos_o_vacio(p_promocion);
	e := public._aplicar_catalogo(p_promocion, d);
	packs := public._packs_de(p_promocion, d);
	select coalesce(array_agg(k->>'id'), '{}') into cats from jsonb_array_elements(e->'catalogo'->'categorias') k;
	select coalesce(array_agg(distinct op.categoria), '{}') into hechas from public.opciones_pedidas op
	where op.promocion_id = p_promocion and op.estado = 'hecha' and op.categoria_nueva is not null;

	for x in select y from jsonb_array_elements(p_packs) y loop
		if coalesce(x->>'id', '') !~ '^[a-z0-9-]{1,40}$' or x->>'id' = 'personalizacion' or x->>'id' = any (ids) then
			raise exception 'Identificador de pack no válido';
		end if;
		ids := ids || (x->>'id');
		if char_length(btrim(coalesce(x->>'titulo', ''))) not between 1 and 80 then
			raise exception 'Cada pack necesita un título';
		end if;
		begin
			v_desde := (x->>'desde')::date;
			v_hasta := (x->>'hasta')::date;
		exception when others then
			raise exception 'Las fechas del pack «%» no son válidas', x->>'titulo';
		end;
		if v_desde is null or v_hasta is null or v_hasta < v_desde then
			raise exception 'El pack «%» tiene que cerrar después de abrir', x->>'titulo';
		end if;
		for c in select jsonb_array_elements_text(coalesce(x->'categorias', '[]'::jsonb)) loop
			if not (c = any (cats) or nuevas ? c or c = any (hechas)) then raise exception 'La categoría % no está en el catálogo', c; end if;
			if c = any (usadas) then raise exception 'Una categoría solo puede estar en un pack'; end if;
			usadas := usadas || c;
		end loop;
		select y into viejo from jsonb_array_elements(packs) y where y->>'id' = x->>'id' limit 1;
		if viejo is not null and public._estado_pack(viejo) <> 'proximamente' then
			-- abierto o terminado: misma apertura y mismas categorías
			if v_desde <> (viejo->>'desde')::date
				or (select coalesce(array_agg(z order by z), '{}') from jsonb_array_elements_text(x->'categorias') z)
					<> (select coalesce(array_agg(z order by z), '{}') from jsonb_array_elements_text(viejo->'categorias') z) then
				raise exception 'El pack «%» ya se ha abierto: no cambian su apertura ni sus categorías', viejo->>'titulo';
			end if;
			if v_hasta <> (viejo->>'hasta')::date and public._estado_pack(viejo) = 'finalizado' then
				raise exception 'El pack «%» ya ha terminado: sus fechas no cambian', viejo->>'titulo';
			end if;
			if v_hasta <> (viejo->>'hasta')::date and v_hasta < public._hoy_espana() then
				raise exception 'El cierre del pack «%» no puede quedar en el pasado', viejo->>'titulo';
			end if;
		elsif viejo is null and jsonb_array_length(coalesce(x->'categorias', '[]'::jsonb)) > 0 and not exists (
			select 1 from jsonb_array_elements_text(x->'categorias') z
			where not (z = any (cats) and public._categoria_lanzada(p_promocion, e, z))
				or exists (select 1 from jsonb_array_elements(packs) y where y->'categorias' ? z)) then
			-- categorías que ya se podían elegir siempre (sin pack, con la promoción publicada):
			-- se les pone fecha de cierre y siguen abiertas
			if v_desde > public._hoy_espana() then
				raise exception '«%» ya se puede elegir: su apertura no puede pasar al futuro', x->>'titulo';
			end if;
			if v_hasta < public._hoy_espana() then
				raise exception 'El cierre de «%» no puede quedar en el pasado', x->>'titulo';
			end if;
		else
			if v_desde < public._hoy_espana() then
				raise exception 'El pack «%» no puede empezar en el pasado', x->>'titulo';
			end if;
			-- una categoría ya lanzada no pasa a un pack sin abrir
			for c in select jsonb_array_elements_text(coalesce(x->'categorias', '[]'::jsonb)) loop
				if c = any (cats) and public._categoria_lanzada(p_promocion, e, c) then
					raise exception 'La categoría «%» ya está abierta a los compradores: no puede pasar a un pack sin abrir',
						(select k->>'nombre' from jsonb_array_elements(e->'catalogo'->'categorias') k where k->>'id' = c);
				end if;
			end loop;
		end if;
		if (x->>'individual')::boolean and jsonb_array_length(coalesce(x->'categorias', '[]'::jsonb)) <> 1 then
			raise exception 'Una categoría por separado lleva solo esa categoría';
		end if;
		v_packs := v_packs || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('id', x->>'id', 'titulo', btrim(x->>'titulo'),
			'descripcion', nullif(btrim(coalesce(x->>'descripcion', '')), ''), 'desde', v_desde, 'hasta', v_hasta,
			'categorias', coalesce(x->'categorias', '[]'::jsonb), 'estado', viejo->'estado',
			'individual', case when (x->>'individual')::boolean then true end)));
	end loop;
	-- todas las categorías con sus fechas (por separado o en un pack)
	for c in select unnest(cats) union select jsonb_object_keys(nuevas) loop
		if not c = any (usadas) then
			raise exception 'Falta la fecha de «%»: elígela por separado o métela en un pack',
				coalesce((select k->>'nombre' from jsonb_array_elements(e->'catalogo'->'categorias') k where k->>'id' = c), nuevas->>c);
		end if;
	end loop;
	-- ningún pack abierto o terminado desaparece
	for viejo in select y from jsonb_array_elements(packs) y loop
		if public._estado_pack(viejo) <> 'proximamente' and not (viejo->>'id') = any (ids) then
			raise exception 'El pack «%» ya se ha abierto: no se puede quitar', viejo->>'titulo';
		end if;
	end loop;
	insert into public.packs_promocion as pp (promocion_id, packs, actualizado_por, actualizado_en)
	values (p_promocion, v_packs, auth.uid(), now())
	on conflict (promocion_id) do update set packs = excluded.packs, actualizado_por = excluded.actualizado_por, actualizado_en = now();
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'cambia los packs', jsonb_build_object('promocion', p_promocion, 'packs', jsonb_array_length(v_packs)));
	return jsonb_array_length(v_packs);
end $$;
revoke all on function public.guardar_packs(text, jsonb) from public, anon;
grant execute on function public.guardar_packs(text, jsonb) to authenticated;

-- MUNE marca una opción pedida como hecha (añadida en una versión) o descartada, con nota.
create or replace function public.atender_opcion(p_id bigint, p_estado text, p_nota text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo MUNE puede atender las opciones pedidas';
	end if;
	if p_estado not in ('hecha', 'descartada', 'pendiente') then
		raise exception 'Estado no válido';
	end if;
	update public.opciones_pedidas set estado = p_estado, nota = nullif(btrim(p_nota), ''),
		atendido_en = case when p_estado = 'pendiente' then null else now() end
	where id = p_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'atiende una opción pedida', jsonb_build_object('id', p_id, 'estado', p_estado));
end $$;
revoke all on function public.atender_opcion(bigint, text, text) from public, anon;
grant execute on function public.atender_opcion(bigint, text, text) to authenticated;

-- Para el Inicio de MUNE Studio: las opciones pedidas que esperan.
create or replace function public.opciones_pedidas_pendientes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo MUNE ve las opciones pedidas de todas las promociones';
	end if;
	return coalesce((select jsonb_agg(jsonb_build_object('id', op.id, 'promocion_id', op.promocion_id, 'promocion', pr.nombre,
		-- categoria: el identificador que hay que usar al prepararla (también si es nueva)
		'nombre', op.nombre, 'categoria', op.categoria, 'categoria_nombre', coalesce(cc.nombre, op.categoria_nueva, op.categoria),
		'categoria_nueva', op.categoria_nueva is not null, 'precio', op.precio, 'descripcion', op.descripcion,
		'archivos', op.archivos, 'pedido_en', op.pedido_en,
		-- con qué fechas se elegirá: su pack (o «por separado»)
		'pack', (select jsonb_build_object('id', p->>'id', 'titulo', p->>'titulo', 'desde', p->>'desde', 'hasta', p->>'hasta')
			from jsonb_array_elements(coalesce(pp.packs, '[]'::jsonb)) p where p->'categorias' ? op.categoria limit 1)) order by op.pedido_en)
		from public.opciones_pedidas op join public.promociones pr on pr.id = op.promocion_id
		left join public.catalogo_categorias cc on cc.promocion_id = op.promocion_id and cc.categoria = op.categoria
		left join public.packs_promocion pp on pp.promocion_id = op.promocion_id
		where op.estado = 'pendiente'), '[]'::jsonb);
end $$;
revoke all on function public.opciones_pedidas_pendientes() from public, anon;
grant execute on function public.opciones_pedidas_pendientes() to authenticated;

-- ═══ 4. Compradores, equipo y selecciones: con el catálogo ajustado ═════════
-- Las mismas funciones de 025 y 027, con los ajustes aplicados.

-- Pasa a «Cerrada» lo seleccionado en packs cuyo periodo ya terminó (con las fechas de la promotora).
create or replace function public._cerrar_vencidas(p_promocion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	d jsonb := public._aplicar_catalogo(p_promocion, public._ultimos_datos(p_promocion));
begin
	if d is null then return; end if;
	update public.selecciones_comprador s set estado = 'cerrada', cerrada_en = now()
	from jsonb_array_elements(coalesce(d->'packs', '[]'::jsonb)) p
	where s.promocion_id = p_promocion and s.estado = 'seleccionada' and s.pack = p->>'id'
		and public._estado_pack(p) = 'finalizado';
end $$;
revoke all on function public._cerrar_vencidas(text) from public, anon, authenticated;

create or replace function public._guardar_seleccion(p_promocion text, p_vivienda text, p_comprador int, p_version text,
	p_pack text, p_opciones jsonb, p_hecho_por text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	d jsonb;
	p jsonb;
	v jsonb;
	t jsonb;
	cat text;
	permitidas jsonb;
	elegida text;
	o jsonb;
	k jsonb;
	cats text[];
	v_estado text;
	v_importe numeric := 0;
	v_detalle jsonb := '[]'::jsonb;
	v_opciones jsonb := '{}'::jsonb;
	s public.selecciones_comprador%rowtype;
begin
	if not coalesce((select (pr.modulos->>'personalizacion')::boolean from public.promociones pr where pr.id = p_promocion), true) then
		raise exception 'La personalización no está activa en esta promoción';
	end if;
	d := case when p_version is null then public._ultimos_datos(p_promocion)
		else (select dp.contenido from public.datos_privados dp where dp.promocion_id = p_promocion and dp.version = p_version) end;
	if d is null then
		raise exception 'Esta versión no permite guardar la selección';
	end if;
	d := public._aplicar_catalogo(p_promocion, d);
	select x into v from jsonb_array_elements(d->'viviendas') x where x->>'ref' = p_vivienda limit 1;
	if v is null then raise exception 'Esa vivienda no existe'; end if;
	select x into t from jsonb_array_elements(coalesce(d->'tipologias', '[]'::jsonb)) x where x->>'id' = v->>'tipologia' limit 1;

	select x into p from jsonb_array_elements(coalesce(d->'packs', '[]'::jsonb)) x where x->>'id' = p_pack limit 1;
	if p is not null then
		select array_agg(c) into cats from jsonb_array_elements_text(p->'categorias') c;
		v_estado := public._estado_pack(p);
	elsif p_pack = 'personalizacion' then
		-- categorías que no están en ningún pack: siempre abiertas
		select array_agg(c->>'id') into cats from jsonb_array_elements(d->'catalogo'->'categorias') c
		where not exists (select 1 from jsonb_array_elements(coalesce(d->'packs', '[]'::jsonb)) x
			where x->'categorias' ? (c->>'id'));
		v_estado := 'disponible';
	end if;
	if cats is null then raise exception 'Ese pack no existe'; end if;
	if v_estado <> 'disponible' then
		raise exception 'El periodo de selección de este pack no está abierto';
	end if;
	for cat in select jsonb_object_keys(coalesce(p_opciones, '{}'::jsonb)) loop
		if not cat = any (cats) then raise exception 'La categoría % no es de este pack', cat; end if;
	end loop;

	select * into s from public.selecciones_comprador sc where sc.promocion_id = p_promocion and sc.vivienda_ref = p_vivienda
		and sc.comprador = p_comprador and sc.pack = p_pack;
	if s.id is not null and s.estado = 'cerrada' then
		raise exception 'Esta selección ya está cerrada';
	end if;

	foreach cat in array cats loop
		select x into k from jsonb_array_elements(d->'catalogo'->'categorias') x where x->>'id' = cat limit 1;
		continue when k is null;
		permitidas := coalesce(v->'opciones'->cat, t->'opciones'->cat, '[]'::jsonb);
		-- quien ya eligió una opción que se ha dejado de ofrecer la conserva
		if s.id is not null and s.opciones->>cat is not null and not permitidas ? (s.opciones->>cat) then
			permitidas := permitidas || to_jsonb(s.opciones->>cat);
		end if;
		-- una opción que no se ofrece da error aunque solo quede una (no se ignora en silencio)
		if p_opciones ? cat and not permitidas ? (p_opciones->>cat) then
			raise exception 'La opción % no se puede elegir en esta vivienda', p_opciones->>cat;
		end if;
		continue when jsonb_array_length(permitidas) < 2;
		elegida := coalesce(p_opciones->>cat, permitidas->>0);
		select x into o from jsonb_array_elements(k->'opciones') x where x->>'id' = elegida limit 1;
		if o is null then raise exception 'La opción % no existe', elegida; end if;
		v_opciones := v_opciones || jsonb_build_object(cat, elegida);
		v_importe := v_importe + coalesce((o->>'precio')::numeric, 0);
		v_detalle := v_detalle || jsonb_build_array(jsonb_build_object('categoria', cat, 'nombre_categoria', k->>'nombre',
			'opcion', elegida, 'nombre', o->>'nombre', 'precio', coalesce((o->>'precio')::numeric, 0)));
	end loop;

	insert into public.selecciones_comprador as sc (promocion_id, vivienda_ref, comprador, pack, opciones, fecha, estado, importe,
		detalle, version, hecho_por, user_id, actualizado_en)
	values (p_promocion, p_vivienda, p_comprador, p_pack, v_opciones, public._hoy_espana(), 'seleccionada', v_importe,
		v_detalle, coalesce(p_version, s.version), p_hecho_por, auth.uid(), now())
	on conflict (promocion_id, vivienda_ref, comprador, pack) do update set opciones = excluded.opciones, fecha = excluded.fecha,
		importe = excluded.importe, detalle = excluded.detalle, version = coalesce(excluded.version, sc.version),
		hecho_por = excluded.hecho_por, user_id = excluded.user_id, actualizado_en = now()
	returning * into s;
	insert into public.selecciones_historial (seleccion_id, opciones, importe, hecho_por, user_id)
	values (s.id, v_opciones, v_importe, p_hecho_por, auth.uid());
	return jsonb_build_object('estado', s.estado, 'importe', s.importe, 'fecha', s.fecha, 'opciones', s.opciones, 'hasta', p->>'hasta');
end $$;
revoke all on function public._guardar_seleccion(text, text, int, text, text, jsonb, text) from public, anon, authenticated;

create or replace function public.personalizacion_de_promocion(p_promocion text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	d jsonb;
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso a la personalización de esta promoción';
	end if;
	perform public._cerrar_vencidas(p_promocion);
	d := public._aplicar_catalogo(p_promocion, public._ultimos_datos(p_promocion));
	return jsonb_build_object(
		'hoy', public._hoy_espana(),
		'catalogo', d->'catalogo',
		'packs', coalesce(d->'packs', '[]'::jsonb),
		'tipologias', coalesce(d->'tipologias', '[]'::jsonb),
		'viviendas', coalesce(d->'viviendas', '[]'::jsonb),
		'selecciones', coalesce((
			select jsonb_agg(jsonb_build_object('vivienda', s.vivienda_ref, 'pack', s.pack, 'estado', s.estado,
				'importe', s.importe, 'fecha', s.fecha, 'detalle', s.detalle, 'opciones', s.opciones, 'hecho_por', s.hecho_por,
				'actualizado_en', s.actualizado_en, 'cerrada_en', s.cerrada_en) order by s.vivienda_ref, s.pack)
			from public.selecciones_comprador s
			where s.promocion_id = p_promocion
				and s.comprador = coalesce((select cc.comprador from public.codigos_comprador cc
					where cc.promocion_id = s.promocion_id and cc.vivienda_ref = s.vivienda_ref and cc.activo limit 1), s.comprador)
		), '[]'::jsonb));
end $$;
revoke all on function public.personalizacion_de_promocion(text) from public, anon;
grant execute on function public.personalizacion_de_promocion(text) to authenticated;

create or replace function public.entrar_comprador(p_promocion text, p_codigo text, p_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	cabeceras json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
	v_cliente text := encode(sha256(convert_to(coalesce(
		cabeceras->>'cf-connecting-ip', split_part(cabeceras->>'x-forwarded-for', ',', 1), 'desconocido'), 'UTF8')), 'hex');
	c public.codigos_comprador%rowtype := public._codigo_valido(p_promocion, p_codigo);
	d jsonb;
	v_vivienda jsonb;
begin
	if c.id is null then
		delete from public.intentos_comprador where momento < now() - interval '1 day';
		return null;
	end if;
	insert into public.intentos_comprador (promocion_id, cliente, acierto) values (p_promocion, v_cliente, true);
	update public.codigos_comprador set ultimo_acceso = now(), accesos = accesos + 1 where id = c.id;
	perform public._cerrar_vencidas(p_promocion);

	select public._aplicar_catalogo(c.promocion_id, dp.contenido) into d from public.datos_privados dp
	where dp.promocion_id = c.promocion_id and dp.version = p_version;
	if d is not null then
		select v into v_vivienda from jsonb_array_elements(d->'viviendas') v where v->>'ref' = c.vivienda_ref limit 1;
	end if;

	return jsonb_build_object(
		'vivienda', c.vivienda_ref,
		'selecciones', coalesce((
			select jsonb_object_agg(s.pack, jsonb_build_object('fecha', s.fecha, 'opciones', s.opciones, 'estado', s.estado, 'importe', s.importe))
			from public.selecciones_comprador s
			where s.promocion_id = c.promocion_id and s.vivienda_ref = c.vivienda_ref and s.comprador = c.comprador
		), '{}'::jsonb),
		'formalizacion', (select pr.formalizacion from public.promociones pr where pr.id = c.promocion_id),
		'datos', case when v_vivienda is null then null else jsonb_build_object(
			'catalogo', d->'catalogo',
			'packs', coalesce(d->'packs', '[]'::jsonb),
			'tipologia', (select t from jsonb_array_elements(coalesce(d->'tipologias', '[]'::jsonb)) t
				where t->>'id' = v_vivienda->>'tipologia' limit 1),
			'vivienda', v_vivienda) end);
end $$;
revoke all on function public.entrar_comprador(text, text, text) from public;
grant execute on function public.entrar_comprador(text, text, text) to anon, authenticated;

create or replace function public.entrar_profesional(p_promocion text, p_pase text, p_version text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	d jsonb;
begin
	if public._pase_valido(p_promocion, p_pase) is null then
		return null;
	end if;
	perform public._cerrar_vencidas(p_promocion);
	d := public._aplicar_catalogo(p_promocion, coalesce(
		(select dp.contenido from public.datos_privados dp where dp.promocion_id = p_promocion and dp.version = p_version),
		public._ultimos_datos(p_promocion)));
	return jsonb_build_object(
		'puede_personalizar', public.equipo_puede(p_promocion, 'personalizacion') and not public.es_admin(),
		'catalogo', d->'catalogo',
		'packs', coalesce(d->'packs', '[]'::jsonb),
		'tipologias', coalesce(d->'tipologias', '[]'::jsonb),
		'viviendas', coalesce(d->'viviendas', '[]'::jsonb),
		'formalizacion', (select pr.formalizacion from public.promociones pr where pr.id = p_promocion),
		-- lo de cada vivienda, de su comprador actual
		'selecciones', coalesce((
			select jsonb_object_agg(x.vivienda_ref, x.packs) from (
				select s.vivienda_ref, jsonb_object_agg(s.pack, jsonb_build_object('fecha', s.fecha, 'opciones', s.opciones,
					'estado', s.estado, 'importe', s.importe)) as packs
				from public.selecciones_comprador s
				where s.promocion_id = p_promocion
					and s.comprador = coalesce((select cc.comprador from public.codigos_comprador cc
						where cc.promocion_id = s.promocion_id and cc.vivienda_ref = s.vivienda_ref and cc.activo limit 1), s.comprador)
				group by s.vivienda_ref) x), '{}'::jsonb));
end $$;
revoke all on function public.entrar_profesional(text, text, text) from public;
grant execute on function public.entrar_profesional(text, text, text) to anon, authenticated;

select 'Listo: la promotora gestiona su catálogo y sus precios' as resultado;
