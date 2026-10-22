-- Lista maestra · paso 5a: los datos privados de cada versión fuera de la web pública.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 023. Es repetible.
--
-- Hasta ahora el catálogo con sus precios, los packs y la lista de viviendas
-- iban dentro de la web pública de la promoción. Desde esta versión:
--  · se guardan aquí, una vez por versión («publicacion.mjs preparar» los sube
--    con el robot de Claude, antes de enviar la versión a validar);
--  · la web pública ya no los lleva: solo enseña la promoción y sus tipologías;
--  · el comprador los recibe al entrar con su código (entrar_comprador), y solo
--    los de su vivienda;
--  · MUNE Studio y el equipo de la promotora (con «compradores» o
--    «personalizacion») ven la lista de viviendas para los códigos.
--
-- Permiso nuevo del robot (aprobado el 22/10/2026): guardar los datos privados
-- de una versión que aún no se ha enviado a validar. Nada más.

-- ═══ 1. Datos privados de cada versión ══════════════════════════════════════

create table if not exists public.datos_privados (
	promocion_id text not null references public.promociones (id),
	version      text not null check (version ~ '^v[0-9]{1,5}$'),
	contenido    jsonb not null check (jsonb_typeof(contenido) = 'object' and pg_column_size(contenido) < 2000000),
	huella       text not null check (huella ~ '^[0-9a-f]{64}$'),
	guardado_por uuid not null default auth.uid() references auth.users (id),
	guardado_en  timestamptz not null default now(),
	primary key (promocion_id, version)
);
alter table public.datos_privados enable row level security;
revoke all on public.datos_privados from anon, authenticated;
grant select on public.datos_privados to authenticated;
drop policy if exists "admin lee datos privados" on public.datos_privados;
create policy "admin lee datos privados" on public.datos_privados
	for select to authenticated using (public.es_admin());

-- La llama «publicacion.mjs preparar» con el robot (o la administradora).
-- Solo mientras la versión no se haya enviado a validar: después, lo que ve la
-- promotora y lo que se publica ya no puede cambiar.
create or replace function public.guardar_datos_privados(p_promocion text, p_version text, p_contenido jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_huella text := encode(sha256(convert_to(p_contenido::text, 'UTF8')), 'hex');
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo MUNE puede guardar los datos privados de una versión';
	end if;
	if p_version !~ '^v[0-9]{1,5}$' then
		raise exception 'Versión no válida';
	end if;
	if not exists (select 1 from public.promociones where id = p_promocion) then
		raise exception 'Esa promoción no existe';
	end if;
	if exists (select 1 from public.entregables e where e.promocion_id = p_promocion and e.version = p_version) then
		raise exception 'La % ya se ha enviado a validar: sus datos ya no se pueden cambiar', p_version;
	end if;
	if jsonb_typeof(p_contenido->'catalogo') is distinct from 'object'
		or jsonb_typeof(p_contenido->'viviendas') is distinct from 'array'
		or jsonb_typeof(coalesce(p_contenido->'packs', '[]'::jsonb)) <> 'array'
		or jsonb_typeof(coalesce(p_contenido->'tipologias', '[]'::jsonb)) <> 'array' then
		raise exception 'Los datos privados tienen que llevar catálogo, viviendas, packs y tipologías';
	end if;

	insert into public.datos_privados (promocion_id, version, contenido, huella, guardado_por)
	values (p_promocion, p_version, p_contenido, v_huella, auth.uid())
	on conflict (promocion_id, version) do update
		set contenido = excluded.contenido, huella = excluded.huella, guardado_por = excluded.guardado_por, guardado_en = now();
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'guarda los datos privados', jsonb_build_object('promocion', p_promocion, 'version', p_version,
		'viviendas', jsonb_array_length(p_contenido->'viviendas'), 'huella', left(v_huella, 12)));
	return v_huella;
end $$;
revoke all on function public.guardar_datos_privados(text, text, jsonb) from public, anon;
grant execute on function public.guardar_datos_privados(text, text, jsonb) to authenticated;

-- ═══ 2. Lista de viviendas para los códigos (MUNE Studio y MUNE Portal) ═════
-- La de la última versión preparada. Sin opciones ni superficies: solo lo que
-- hace falta para dar un código a cada vivienda.

create or replace function public.viviendas_de_promocion(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot()
		or public.equipo_puede(p_promocion, 'compradores') or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso a las viviendas de esta promoción';
	end if;
	return (
		select coalesce(jsonb_agg(jsonb_build_object('ref', v->>'ref', 'portal', v->'portal', 'planta', v->>'planta',
			'tipologia', v->>'tipologia', 'espejo', coalesce((v->>'espejo')::boolean, false)) order by o), '[]'::jsonb)
		from (select d.contenido from public.datos_privados d where d.promocion_id = p_promocion
			order by (substr(d.version, 2))::int desc limit 1) ultima,
			jsonb_array_elements(ultima.contenido->'viviendas') with ordinality as x(v, o));
end $$;
revoke all on function public.viviendas_de_promocion(text) from public, anon;
grant execute on function public.viviendas_de_promocion(text) to authenticated;

-- ═══ 3. Entrada del comprador: ahora también recibe los datos de su vivienda ══
-- p_version: la versión de la web desde la que entra (la publicada o la vista
-- previa). Devuelve el catálogo con precios, los packs, lo que admite su
-- tipología y los datos de su vivienda; nada de las demás viviendas.

drop function if exists public.entrar_comprador(text, text);
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
	v_codigo text := lower(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
	c public.codigos_comprador%rowtype;
	fallos int;
	fallos_promocion int;
	d jsonb;
	v_vivienda jsonb;
begin
	if p_promocion !~ '^[a-z0-9-]{1,60}$' then
		raise exception 'Promoción no válida';
	end if;
	select count(*) into fallos from public.intentos_comprador i
	where promocion_id = p_promocion and i.cliente = v_cliente and not acierto and momento > now() - interval '15 minutes';
	select count(*) into fallos_promocion from public.intentos_comprador
	where promocion_id = p_promocion and not acierto and momento > now() - interval '1 hour';
	if fallos >= 10 or fallos_promocion >= 300 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;

	if char_length(v_codigo) = 13 and left(v_codigo, 1) = 'c' then v_codigo := substr(v_codigo, 2); end if;
	v_codigo := 'c-' || v_codigo;
	select cc.* into c from public.codigos_comprador cc
	join public.promociones pr on pr.id = cc.promocion_id
	where cc.huella = encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex')
		and cc.promocion_id = p_promocion and cc.activo and pr.activa
		and coalesce((pr.modulos->>'acceso_comprador')::boolean, true);

	insert into public.intentos_comprador (promocion_id, cliente, acierto) values (p_promocion, v_cliente, c.id is not null);
	delete from public.intentos_comprador where momento < now() - interval '1 day';
	if c.id is null then
		return null;
	end if;

	update public.codigos_comprador set ultimo_acceso = now(), accesos = accesos + 1 where id = c.id;

	select dp.contenido into d from public.datos_privados dp
	where dp.promocion_id = c.promocion_id and dp.version = p_version;
	if d is not null then
		select v into v_vivienda from jsonb_array_elements(d->'viviendas') v where v->>'ref' = c.vivienda_ref limit 1;
	end if;

	return jsonb_build_object(
		'vivienda', c.vivienda_ref,
		'selecciones', coalesce((
			select jsonb_object_agg(s.pack, jsonb_build_object('fecha', s.fecha, 'opciones', s.opciones))
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

select 'Listo: datos privados de cada versión fuera de la web pública' as resultado;
