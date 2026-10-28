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
-- Los cambios se aplican al momento; cada uno queda en el registro con quién lo
-- hizo. Una opción con un aspecto nuevo (otro suelo, otro acabado) hay que
-- crearla en el 3D: la promotora la pide (pedir_opcion) y MUNE la añade en una
-- versión nueva.

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
alter table public.opciones_pedidas enable row level security;
revoke all on public.opciones_pedidas from anon, authenticated;

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
		return coalesce(p->>'estado', case when public._hoy_espana() < (p->>'desde')::date then 'proximamente' else 'abierto' end) <> 'proximamente';
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
	if d is null or not exists (select 1 from public.catalogo_ajustes ca where ca.promocion_id = p_promocion) then
		return d;
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
		cats := cats || jsonb_build_array(c || jsonb_build_object('opciones', ops));
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
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	d := public._ultimos_datos(p_promocion);
	if d is null then
		return jsonb_build_object('catalogo', null);
	end if;
	e := public._aplicar_catalogo(p_promocion, d);
	return jsonb_build_object(
		'hoy', public._hoy_espana(),
		'catalogo', e->'catalogo',
		'packs', coalesce(e->'packs', '[]'::jsonb),
		-- en qué tipologías se ofrece cada opción ahora, y cuál es la incluida de cada tipología
		'tipologias', coalesce(e->'tipologias', '[]'::jsonb),
		'tipologias_version', coalesce(d->'tipologias', '[]'::jsonb),
		'lanzadas', coalesce((select jsonb_agg(c->>'id') from jsonb_array_elements(coalesce(d->'catalogo'->'categorias', '[]'::jsonb)) c
			where public._categoria_lanzada(p_promocion, d, c->>'id')), '[]'::jsonb),
		'cambios', coalesce((select jsonb_agg(jsonb_build_object('categoria', ca.categoria, 'opcion', ca.opcion,
			'actualizado_en', ca.actualizado_en, 'por', case when public.es_admin_usuario(ca.actualizado_por) then 'MUNE' else 'la promotora' end)
			order by ca.actualizado_en desc)
			from public.catalogo_ajustes ca where ca.promocion_id = p_promocion), '[]'::jsonb),
		'pedidas', coalesce((select jsonb_agg(jsonb_build_object('id', op.id, 'categoria', op.categoria, 'nombre', op.nombre,
			'descripcion', op.descripcion, 'precio', op.precio, 'pedido_en', op.pedido_en, 'estado', op.estado, 'nota', op.nota)
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
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) > 500 then
		raise exception 'Cambios no válidos';
	end if;
	d := public._ultimos_datos(p_promocion);
	if d is null then
		raise exception 'Esta promoción todavía no tiene catálogo';
	end if;
	e := public._aplicar_catalogo(p_promocion, d);

	for x in select y from jsonb_array_elements(p_cambios) y loop
		v_tipologias := null;
		select c into k from jsonb_array_elements(e->'catalogo'->'categorias') c where c->>'id' = x->>'categoria' limit 1;
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
			if v_precio <> coalesce((o->>'precio')::numeric, 0) and public._categoria_lanzada(p_promocion, d, k->>'id') then
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
		'opciones', (select jsonb_agg(y->>'categoria' || ':' || (y->>'opcion')) from jsonb_array_elements(p_cambios) y)));
	return n;
end $$;
revoke all on function public.guardar_catalogo(text, jsonb) from public, anon;
grant execute on function public.guardar_catalogo(text, jsonb) to authenticated;

-- La promotora pide una opción con un aspecto nuevo (hay que crearla en el 3D).
create or replace function public.pedir_opcion(p_promocion text, p_categoria text, p_nombre text, p_descripcion text, p_precio numeric)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_id bigint;
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	if char_length(btrim(coalesce(p_nombre, ''))) = 0 then
		raise exception 'Escribe el nombre de la opción';
	end if;
	insert into public.opciones_pedidas (promocion_id, categoria, nombre, descripcion, precio)
	values (p_promocion, nullif(btrim(p_categoria), ''), btrim(p_nombre), nullif(btrim(p_descripcion), ''), p_precio)
	returning id into v_id;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'pide una opción nueva', jsonb_build_object('promocion', p_promocion, 'nombre', btrim(p_nombre)));
	return v_id;
end $$;
revoke all on function public.pedir_opcion(text, text, text, text, numeric) from public, anon;
grant execute on function public.pedir_opcion(text, text, text, text, numeric) to authenticated;

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
	if not public.es_admin() then
		raise exception 'Solo MUNE ve las opciones pedidas de todas las promociones';
	end if;
	return coalesce((select jsonb_agg(jsonb_build_object('id', op.id, 'promocion_id', op.promocion_id, 'promocion', pr.nombre,
		'nombre', op.nombre, 'pedido_en', op.pedido_en) order by op.pedido_en)
		from public.opciones_pedidas op join public.promociones pr on pr.id = op.promocion_id
		where op.estado = 'pendiente'), '[]'::jsonb);
end $$;
revoke all on function public.opciones_pedidas_pendientes() from public, anon;
grant execute on function public.opciones_pedidas_pendientes() to authenticated;

-- ═══ 4. Compradores, equipo y selecciones: con el catálogo ajustado ═════════
-- Las mismas funciones de 025 y 027, con los ajustes aplicados.

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
		v_estado := coalesce(p->>'estado', case when public._hoy_espana() < (p->>'desde')::date then 'proximamente'
			when public._hoy_espana() > (p->>'hasta')::date then 'finalizado' else 'disponible' end);
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
		continue when jsonb_array_length(permitidas) < 2;
		elegida := coalesce(p_opciones->>cat, permitidas->>0);
		if not permitidas ? elegida then raise exception 'La opción % no se puede elegir en esta vivienda', elegida; end if;
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
