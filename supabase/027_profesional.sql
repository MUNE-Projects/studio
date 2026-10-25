-- Lista maestra · paso 6a: el 3D profesional, desde MUNE Portal.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 026. Es repetible.
--
-- El equipo de la promotora abre el 3D de su promoción desde el Portal, sin
-- códigos: el Portal pide un pase (abrir_experiencia_profesional) y abre la web
-- de la promoción con él (…/<promoción>/#p-<pase>). La web lo cambia por los
-- datos de la versión (entrar_profesional): todas las viviendas, la
-- personalización con sus precios y lo que ha elegido cada comprador.
--  · El pase es de esa persona y esa promoción, vale una jornada (12 horas desde
--    que se abre; para seguir otro día se vuelve a abrir desde el Portal) y en
--    Supabase solo queda su huella.
--  · Con el pase, cualquiera del equipo con acceso a la promoción ve todo, saca
--    renders y descarga el plano comercial (decidido el 25/10/2026).
--  · Elegir en nombre del comprador: solo con la capacidad «personalizacion»
--    (guardar_seleccion_profesional). MUNE nunca elige ni cambia una selección.
--  · Si la persona pierde el acceso a la promoción, su pase deja de valer al momento.

-- ═══ 1. Pases ═══════════════════════════════════════════════════════════════

create table if not exists public.pases_profesionales (
	id           bigint generated always as identity primary key,
	huella       text not null unique check (huella ~ '^[0-9a-f]{64}$'),
	user_id      uuid not null references auth.users (id) on delete cascade,
	promocion_id text not null references public.promociones (id) on delete cascade,
	creado_en    timestamptz not null default now(),
	usado_en     timestamptz not null default now()
);
alter table public.pases_profesionales enable row level security;
revoke all on public.pases_profesionales from anon, authenticated;

create or replace function public.abrir_experiencia_profesional(p_promocion text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	v_pase text := encode(extensions.gen_random_bytes(24), 'hex');
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'No tienes acceso a esta promoción';
	end if;
	delete from public.pases_profesionales where usado_en < now() - interval '1 day';
	insert into public.pases_profesionales (huella, user_id, promocion_id)
	values (encode(sha256(convert_to(v_pase, 'UTF8')), 'hex'), auth.uid(), p_promocion);
	return v_pase;
end $$;
revoke all on function public.abrir_experiencia_profesional(text) from public, anon;
grant execute on function public.abrir_experiencia_profesional(text) to authenticated;

-- Comprueba el pase y deja la sesión como su dueño (para las comprobaciones de
-- siempre: es_miembro_de_promocion, equipo_puede, es_admin y el registro).
create or replace function public._pase_valido(p_promocion text, p_pase text)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	cabeceras json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
	v_cliente text := encode(sha256(convert_to(coalesce(
		cabeceras->>'cf-connecting-ip', split_part(cabeceras->>'x-forwarded-for', ',', 1), 'desconocido'), 'UTF8')), 'hex');
	p public.pases_profesionales%rowtype;
begin
	if (select count(*) from public.intentos_comprador i where i.promocion_id = '*pro' and i.cliente = v_cliente
			and not i.acierto and i.momento > now() - interval '15 minutes') >= 10 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;
	select * into p from public.pases_profesionales x
	where x.huella = encode(sha256(convert_to(coalesce(p_pase, ''), 'UTF8')), 'hex')
		and x.promocion_id = p_promocion
		and x.creado_en > now() - interval '12 hours';
	if p.id is null then
		insert into public.intentos_comprador (promocion_id, cliente, acierto) values ('*pro', v_cliente, false);
		return null;
	end if;
	perform set_config('request.jwt.claim.sub', p.user_id::text, true);
	perform set_config('request.jwt.claims', json_build_object('sub', p.user_id, 'role', 'authenticated')::text, true);
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		delete from public.pases_profesionales where id = p.id;
		return null;
	end if;
	update public.pases_profesionales set usado_en = now() where id = p.id;
	return p.user_id;
end $$;
revoke all on function public._pase_valido(text, text) from public, anon, authenticated;

-- ═══ 2. La web de la promoción con el pase ══════════════════════════════════
-- p_version: la de la web desde la que se entra (publicada o vista previa).

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
	d := coalesce((select dp.contenido from public.datos_privados dp where dp.promocion_id = p_promocion and dp.version = p_version),
		public._ultimos_datos(p_promocion));
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

-- Elegir en nombre del comprador desde el 3D (con la capacidad «personalizacion»).
create or replace function public.guardar_seleccion_profesional(p_promocion text, p_pase text, p_version text,
	p_vivienda text, p_pack text, p_opciones jsonb)
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
	if public._pase_valido(p_promocion, p_pase) is null then
		raise exception 'Tu acceso al 3D ha caducado. Vuelve a abrirlo desde MUNE Portal.';
	end if;
	if public.es_admin() or not public.equipo_puede(p_promocion, 'personalizacion') then
		raise exception 'Solo el comprador o el equipo de la promotora pueden guardar una selección';
	end if;
	perform public._cerrar_vencidas(p_promocion);
	select coalesce((select cc.comprador from public.codigos_comprador cc
		where cc.promocion_id = p_promocion and cc.vivienda_ref = p_vivienda and cc.activo limit 1), 1) into v_comprador;
	r := public._guardar_seleccion(p_promocion, p_vivienda, v_comprador, p_version, p_pack, p_opciones, 'equipo');
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'guarda una selección', jsonb_build_object('promocion', p_promocion, 'vivienda', p_vivienda, 'pack', p_pack, 'desde', '3D'));
	return r;
end $$;
revoke all on function public.guardar_seleccion_profesional(text, text, text, text, text, jsonb) from public;
grant execute on function public.guardar_seleccion_profesional(text, text, text, text, text, jsonb) to anon, authenticated;

select 'Listo: el 3D profesional desde MUNE Portal' as resultado;
