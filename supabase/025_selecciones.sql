-- Lista maestra · paso 5b: la personalización se guarda (Seleccionada → Cerrada).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 024. Es repetible.
--
-- · Cuando el comprador descarga el documento de un pack, su elección queda
--   guardada como «Seleccionada». Puede cambiarla mientras el periodo del pack
--   esté abierto: cada cambio queda en el histórico.
-- · Al terminar el periodo, pasa sola a «Cerrada» y ya no se puede cambiar.
-- · El equipo de la promotora con la capacidad «personalizacion» ve en la
--   pestaña Personalización cada vivienda con su estado y su importe, descarga
--   el Excel de las cerradas y, si hace falta (por ejemplo, un comprador que no
--   puede hacerlo solo), guarda una selección en su nombre.
-- · MUNE Studio solo la consulta: MUNE nunca elige ni cambia una selección.
-- · El importe lo calcula siempre Supabase con los precios de la versión: nunca
--   se fía de lo que envía el navegador.
-- Cada pack va por separado, así que vale igual para fases o grupos.

-- ═══ 1. Selecciones: estado, importe y detalle ══════════════════════════════

alter table public.selecciones_comprador add column if not exists estado text not null default 'cerrada';
alter table public.selecciones_comprador drop constraint if exists selecciones_comprador_estado_check;
alter table public.selecciones_comprador add constraint selecciones_comprador_estado_check check (estado in ('seleccionada', 'cerrada'));
alter table public.selecciones_comprador add column if not exists importe numeric(12, 2) not null default 0;
-- lo elegido con sus nombres y precios en ese momento (para el Excel aunque luego cambie el catálogo)
alter table public.selecciones_comprador add column if not exists detalle jsonb not null default '[]'::jsonb;
alter table public.selecciones_comprador add column if not exists version text;
alter table public.selecciones_comprador add column if not exists hecho_por text not null default 'comprador';
alter table public.selecciones_comprador drop constraint if exists selecciones_comprador_hecho_por_check;
alter table public.selecciones_comprador add constraint selecciones_comprador_hecho_por_check check (hecho_por in ('comprador', 'equipo'));
alter table public.selecciones_comprador add column if not exists user_id uuid references auth.users (id);
alter table public.selecciones_comprador add column if not exists actualizado_en timestamptz not null default now();
alter table public.selecciones_comprador add column if not exists cerrada_en timestamptz;

-- Nadie escribe directamente: solo con las funciones de abajo.
revoke insert, update, delete on public.selecciones_comprador from authenticated;
drop policy if exists "admin registra selecciones" on public.selecciones_comprador;
drop policy if exists "leen selecciones" on public.selecciones_comprador;
create policy "leen selecciones" on public.selecciones_comprador
	for select to authenticated
	using (public.es_admin() or public.equipo_puede(promocion_id, 'personalizacion'));

create table if not exists public.selecciones_historial (
	id           bigint generated always as identity primary key,
	seleccion_id bigint not null references public.selecciones_comprador (id) on delete cascade,
	momento      timestamptz not null default now(),
	opciones     jsonb not null,
	importe      numeric(12, 2) not null,
	hecho_por    text not null,
	user_id      uuid references auth.users (id)
);
alter table public.selecciones_historial enable row level security;
revoke all on public.selecciones_historial from anon, authenticated;
grant select on public.selecciones_historial to authenticated;
drop policy if exists "leen historial de selecciones" on public.selecciones_historial;
create policy "leen historial de selecciones" on public.selecciones_historial
	for select to authenticated
	using (exists (select 1 from public.selecciones_comprador s where s.id = seleccion_id
		and (public.es_admin() or public.equipo_puede(s.promocion_id, 'personalizacion'))));

-- ═══ 2. Utilidades internas (no se pueden llamar desde fuera) ═══════════════

-- Hoy en España
create or replace function public._hoy_espana()
returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Europe/Madrid')::date $$;
revoke all on function public._hoy_espana() from public, anon, authenticated;

-- Datos privados de la última versión preparada de una promoción
create or replace function public._ultimos_datos(p_promocion text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select d.contenido from public.datos_privados d where d.promocion_id = p_promocion
	order by (substr(d.version, 2))::int desc limit 1;
$$;
revoke all on function public._ultimos_datos(text) from public, anon, authenticated;

-- Pasa a «Cerrada» lo seleccionado en packs cuyo periodo ya terminó.
create or replace function public._cerrar_vencidas(p_promocion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	d jsonb := public._ultimos_datos(p_promocion);
begin
	if d is null then return; end if;
	update public.selecciones_comprador s set estado = 'cerrada', cerrada_en = now()
	from jsonb_array_elements(coalesce(d->'packs', '[]'::jsonb)) p
	where s.promocion_id = p_promocion and s.estado = 'seleccionada' and s.pack = p->>'id'
		and (p->>'estado' = 'finalizado' or (p->>'estado' is null and (p->>'hasta')::date < public._hoy_espana()));
end $$;
revoke all on function public._cerrar_vencidas(text) from public, anon, authenticated;

-- Código del comprador, con el mismo límite de intentos que la entrada
create or replace function public._codigo_valido(p_promocion text, p_codigo text)
returns public.codigos_comprador
language plpgsql
security definer
set search_path = ''
as $$
declare
	cabeceras json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
	v_cliente text := encode(sha256(convert_to(coalesce(
		cabeceras->>'cf-connecting-ip', split_part(cabeceras->>'x-forwarded-for', ',', 1), 'desconocido'), 'UTF8')), 'hex');
	v_codigo text := lower(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
	c public.codigos_comprador%rowtype;
begin
	if p_promocion !~ '^[a-z0-9-]{1,60}$' then
		raise exception 'Promoción no válida';
	end if;
	if (select count(*) from public.intentos_comprador i where i.promocion_id = p_promocion and i.cliente = v_cliente
			and not i.acierto and i.momento > now() - interval '15 minutes') >= 10
		or (select count(*) from public.intentos_comprador i where i.promocion_id = p_promocion
			and not i.acierto and i.momento > now() - interval '1 hour') >= 300 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;
	if char_length(v_codigo) = 13 and left(v_codigo, 1) = 'c' then v_codigo := substr(v_codigo, 2); end if;
	v_codigo := 'c-' || v_codigo;
	select cc.* into c from public.codigos_comprador cc
	join public.promociones pr on pr.id = cc.promocion_id
	where cc.huella = encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex')
		and cc.promocion_id = p_promocion and cc.activo and pr.activa
		and coalesce((pr.modulos->>'acceso_comprador')::boolean, true);
	if c.id is null then
		insert into public.intentos_comprador (promocion_id, cliente, acierto) values (p_promocion, v_cliente, false);
	end if;
	return c;
end $$;
revoke all on function public._codigo_valido(text, text) from public, anon, authenticated;

-- Comprueba y guarda una selección. El importe sale del catálogo de la versión.
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

	foreach cat in array cats loop
		select x into k from jsonb_array_elements(d->'catalogo'->'categorias') x where x->>'id' = cat limit 1;
		continue when k is null;
		permitidas := coalesce(v->'opciones'->cat, t->'opciones'->cat, '[]'::jsonb);
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

	select * into s from public.selecciones_comprador sc where sc.promocion_id = p_promocion and sc.vivienda_ref = p_vivienda
		and sc.comprador = p_comprador and sc.pack = p_pack;
	if s.id is not null and s.estado = 'cerrada' then
		raise exception 'Esta selección ya está cerrada';
	end if;
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

-- ═══ 3. Lo que se puede llamar ══════════════════════════════════════════════

-- El comprador, con su código, desde la web de la promoción (al descargar el documento).
create or replace function public.guardar_seleccion(p_promocion text, p_codigo text, p_version text, p_pack text, p_opciones jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	c public.codigos_comprador%rowtype := public._codigo_valido(p_promocion, p_codigo);
begin
	-- código que no vale: null (sin error, para que el intento fallido cuente en el límite)
	if c.id is null then
		return null;
	end if;
	perform public._cerrar_vencidas(p_promocion);
	return public._guardar_seleccion(p_promocion, c.vivienda_ref, c.comprador, p_version, p_pack, p_opciones, 'comprador');
end $$;
revoke all on function public.guardar_seleccion(text, text, text, text, jsonb) from public;
grant execute on function public.guardar_seleccion(text, text, text, text, jsonb) to anon, authenticated;

-- El equipo de la promotora, en nombre del comprador de una vivienda. MUNE no.
create or replace function public.guardar_seleccion_equipo(p_promocion text, p_vivienda text, p_pack text, p_opciones jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_comprador int;
	r jsonb;
begin
	if not public.equipo_puede(p_promocion, 'personalizacion') then
		raise exception 'Solo el comprador o el equipo de la promotora pueden guardar una selección';
	end if;
	perform public._cerrar_vencidas(p_promocion);
	-- el comprador actual de la vivienda: el de su código activo (o el primero, si aún no tiene)
	select coalesce((select cc.comprador from public.codigos_comprador cc
		where cc.promocion_id = p_promocion and cc.vivienda_ref = p_vivienda and cc.activo limit 1), 1) into v_comprador;
	r := public._guardar_seleccion(p_promocion, p_vivienda, v_comprador, null, p_pack, p_opciones, 'equipo');
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'guarda una selección', jsonb_build_object('promocion', p_promocion, 'vivienda', p_vivienda, 'pack', p_pack));
	return r;
end $$;
revoke all on function public.guardar_seleccion_equipo(text, text, text, jsonb) from public, anon;
grant execute on function public.guardar_seleccion_equipo(text, text, text, jsonb) to authenticated;

-- Pestaña Personalización: catálogo, packs y viviendas de la última versión, y
-- lo seleccionado por vivienda (del comprador actual de cada una).
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
	d := public._ultimos_datos(p_promocion);
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

-- ═══ 4. Entrada del comprador: con el estado de cada selección ══════════════

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

	select dp.contenido into d from public.datos_privados dp
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

select 'Listo: la personalización se guarda (Seleccionada → Cerrada)' as resultado;
