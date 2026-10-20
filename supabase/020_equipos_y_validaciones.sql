-- Fase 1 · paso 20: equipos, administración y validaciones (decisión 40, docs/arquitectura-mune.md).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 019. Es repetible.
--
-- Qué añade:
--  · Administración dentro de cada promotora: «administrador de la promotora»
--    (acceso a todas sus promociones, también las futuras) y «administrador de
--    promoción» (solo las suyas). Nunca ven otra promotora.
--  · Capacidades de trabajo por acceso: documentacion, planos, compradores,
--    personalizacion, materiales, datos y marca. Quien administra las tiene todas
--    dentro de su alcance.
--  · Equipo gestionado por la propia promotora (dar_acceso, cambiar_acceso).
--  · Aprobadores definidos por la promotora, por promoción y tipo: planos
--    comerciales y Experiencia 3D. Sin aprobadores no se valida. Un elemento
--    queda validado cuando aprueban todos; si no cambia entre versiones (misma
--    huella), conserva sus aprobaciones.
--  · Validación de Experiencia 3D por tipología o variante (entregables de
--    tipo «experiencia», sin archivo).
--  · Documentos con varios archivos, cada uno con lo que contiene.
--  · Textos legales de la promoción.
--
-- Migración: quien tenía acceso a todas las promociones de su promotora pasa a
-- administrarla; los demás conservan todo lo que podían hacer (todas las
-- capacidades salvo «marca», reservada). Lo ya aprobado sigue aprobado.

-- ═══ 1. Accesos: administración y capacidades ═══════════════════════════════

do $$
begin
	if not exists (select 1 from information_schema.columns
		where table_schema = 'public' and table_name = 'miembros' and column_name = 'administra') then
		alter table public.miembros add column administra boolean not null default false;
		-- quien veía todas las promociones de su promotora pasa a administrarla
		update public.miembros set administra = true where promocion_id is null;
	end if;
end $$;
alter table public.miembros add column if not exists capacidades text[] not null
	default '{documentacion,planos,compradores,personalizacion,materiales,datos}';
alter table public.miembros drop constraint if exists miembros_capacidades_validas;
alter table public.miembros add constraint miembros_capacidades_validas
	check (capacidades <@ array['documentacion', 'planos', 'compradores', 'personalizacion', 'materiales', 'datos', 'marca']);

revoke insert, update on public.miembros from authenticated;
grant insert (user_id, promotora_id, promocion_id, nombre, email, cargo, administra, capacidades) on public.miembros to authenticated;
grant update (nombre, cargo, activo, administra, capacidades) on public.miembros to authenticated;

create or replace function public.capacidades_validas(p text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
	select coalesce(p, '{}') <@ array['documentacion', 'planos', 'compradores', 'personalizacion', 'materiales', 'datos', 'marca']::text[];
$$;

-- ¿La sesión administra esta promotora (acceso a todas, como administradora)?
create or replace function public.es_admin_promotora(p_promotora uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1 from public.miembros m
		join public.promotoras po on po.id = m.promotora_id
		where m.promotora_id = p_promotora and po.activa
			and m.activo and m.user_id = auth.uid() and m.promocion_id is null and m.administra);
$$;

-- ¿La sesión administra esta promoción (como administradora de la promotora o de la promoción)?
create or replace function public.administra_promocion(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.promociones pr
		join public.promotoras po on po.id = pr.promotora_id
		join public.miembros m on m.promotora_id = po.id
		where pr.id = p_promocion and pr.activa and po.activa
			and m.activo and m.user_id = auth.uid() and m.administra
			and (m.promocion_id is null or m.promocion_id = pr.id));
$$;

-- ¿Esta persona puede trabajar en esta promoción con esta capacidad? (sin
-- capacidad: le basta con tener acceso). Solo para uso interno.
create or replace function public.persona_puede(p_user uuid, p_promocion text, p_capacidad text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.promociones pr
		join public.promotoras po on po.id = pr.promotora_id
		join public.miembros m on m.promotora_id = po.id
		where pr.id = p_promocion and pr.activa and po.activa
			and m.activo and m.user_id = p_user
			and (m.promocion_id is null or m.promocion_id = pr.id)
			and (p_capacidad is null or m.administra or p_capacidad = any (m.capacidades)));
$$;
revoke all on function public.persona_puede(uuid, text, text) from public, anon, authenticated;

-- La sesión, como parte del equipo de la promotora (sin contar a MUNE).
create or replace function public.equipo_puede(p_promocion text, p_capacidad text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.persona_puede(auth.uid(), p_promocion, p_capacidad);
$$;

-- La sesión: la administradora de MUNE Studio o el equipo con esa capacidad.
create or replace function public.puede(p_promocion text, p_capacidad text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.es_admin() or public.persona_puede(auth.uid(), p_promocion, p_capacidad);
$$;

revoke all on function public.es_admin_promotora(uuid) from public, anon;
revoke all on function public.administra_promocion(text) from public, anon;
revoke all on function public.equipo_puede(text, text) from public, anon;
revoke all on function public.puede(text, text) from public, anon;
grant execute on function public.es_admin_promotora(uuid) to authenticated;
grant execute on function public.administra_promocion(text) to authenticated;
grant execute on function public.equipo_puede(text, text) to authenticated;
grant execute on function public.puede(text, text) to authenticated;

-- ═══ 2. Reglas de lectura y escritura por capacidad ══════════════════════════

drop policy if exists "leen requisitos" on public.requisitos;
create policy "leen requisitos" on public.requisitos
	for select to authenticated
	using (public.es_admin() or public.es_robot() or (activo and public.equipo_puede(promocion_id, 'documentacion')));

drop policy if exists "leen documentos" on public.documentos;
create policy "leen documentos" on public.documentos
	for select to authenticated
	using (public.es_admin() or public.es_robot() or public.equipo_puede(promocion_id, 'documentacion'));
drop policy if exists "miembro sube documentos" on public.documentos;
create policy "miembro sube documentos" on public.documentos
	for insert to authenticated with check (public.equipo_puede(promocion_id, 'documentacion'));

drop policy if exists "miembro sube a sus documentos" on storage.objects;
create policy "miembro sube a sus documentos" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'documentos'
		and public.equipo_puede(public.carpeta_de_documentos_valida(name), 'documentacion'));
drop policy if exists "ven documentos" on storage.objects;
create policy "ven documentos" on storage.objects
	for select to authenticated
	using (bucket_id = 'documentos' and (public.es_admin() or public.es_robot()
		or public.equipo_puede(public.carpeta_de_documentos_valida(name), 'documentacion')));

-- Entregables: los planos (y demás archivos) con «planos» o «materiales»; las
-- unidades de Experiencia 3D (sin archivo) las ve todo el equipo.
drop policy if exists "leen entregables" on public.entregables;
create policy "leen entregables" on public.entregables
	for select to authenticated
	using (public.es_admin() or public.es_robot()
		or (tipo = 'experiencia' and public.es_miembro_de_promocion(promocion_id))
		or public.equipo_puede(promocion_id, 'planos') or public.equipo_puede(promocion_id, 'materiales'));
drop policy if exists "ven entregables" on storage.objects;
create policy "ven entregables" on storage.objects
	for select to authenticated
	using (bucket_id = 'entregables' and (public.es_admin() or public.es_robot()
		or public.equipo_puede((storage.foldername(name))[1], 'planos')
		or public.equipo_puede((storage.foldername(name))[1], 'materiales')));

-- Las selecciones de los compradores son de «personalizacion», no de «compradores».
drop policy if exists "leen selecciones" on public.selecciones_comprador;
create policy "leen selecciones" on public.selecciones_comprador
	for select to authenticated
	using (public.es_admin() or public.equipo_puede(promocion_id, 'personalizacion'));

-- ═══ 3. El equipo, gestionado por quien administra ═══════════════════════════

-- Lista para MUNE Studio (sustituye a la de 007: con administración y capacidades).
drop function if exists public.accesos(uuid);
create function public.accesos(p_promotora uuid)
returns table (
	id bigint, user_id uuid, promocion_id text, nombre text, email text, cargo text, activo boolean,
	creado_en timestamptz, aceptada boolean, ultima_entrada timestamptz, administra boolean, capacidades text[]
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede ver los accesos';
	end if;
	return query
		select m.id, m.user_id, m.promocion_id, m.nombre, m.email, m.cargo, m.activo, m.creado_en,
			u.email_confirmed_at is not null, u.last_sign_in_at, m.administra, m.capacidades
		from public.miembros m
		join auth.users u on u.id = m.user_id
		where m.promotora_id = p_promotora
		order by m.activo desc, m.nombre;
end $$;
revoke all on function public.accesos(uuid) from public, anon;
grant execute on function public.accesos(uuid) to authenticated;

-- Lista para la sección «Equipo» de MUNE Portal. Quien administra la promotora
-- ve todo su equipo; quien administra promociones, el de sus promociones (y,
-- solo para consultar, quién tiene acceso a todas).
create or replace function public.equipo_de_promotora(p_promotora uuid)
returns table (
	id bigint, user_id uuid, promocion_id text, nombre text, email text, cargo text, activo boolean,
	administra boolean, capacidades text[], aceptada boolean, ultima_entrada timestamptz, editable boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
	global boolean := public.es_admin() or public.es_admin_promotora(p_promotora);
	administra_alguna boolean;
begin
	-- Todo el equipo ve a sus compañeros (solo consulta). Quien administra ve
	-- además los accesos retirados, si han entrado ya y puede hacer cambios.
	if not global and not exists (
		select 1 from public.miembros m
		where m.promotora_id = p_promotora and m.user_id = auth.uid() and m.activo) then
		raise exception 'Sin acceso a esta promotora';
	end if;
	administra_alguna := global or exists (
		select 1 from public.miembros m
		where m.promotora_id = p_promotora and m.user_id = auth.uid() and m.activo and m.administra);
	return query
		select m.id, m.user_id, m.promocion_id, m.nombre, m.email, m.cargo, m.activo, m.administra, m.capacidades,
			case when administra_alguna then u.email_confirmed_at is not null end,
			case when administra_alguna then u.last_sign_in_at end,
			(global or (m.promocion_id is not null and not m.administra and public.administra_promocion(m.promocion_id)))
				and (public.es_admin() or m.user_id <> auth.uid())
		from public.miembros m
		join auth.users u on u.id = m.user_id
		where m.promotora_id = p_promotora
			and (global
				or (m.promocion_id is not null and public.administra_promocion(m.promocion_id))
				or (m.activo and (m.promocion_id is null or public.es_miembro_de_promocion(m.promocion_id))))
		order by m.activo desc, m.nombre, m.promocion_id nulls first;
end $$;
revoke all on function public.equipo_de_promotora(uuid) from public, anon;
grant execute on function public.equipo_de_promotora(uuid) to authenticated;

-- ¿Puede la sesión dar este acceso? Quien administra la promotora: cualquiera de
-- su promotora. Quien administra una promoción: personas sin administración en
-- esa promoción. MUNE Studio: todo.
create or replace function public.puede_dar_acceso(p_promotora uuid, p_promocion text, p_administra boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.es_admin() or public.es_admin_promotora(p_promotora)
		or (p_promocion is not null and not coalesce(p_administra, false)
			and public.administra_promocion(p_promocion)
			and exists (select 1 from public.promociones pr where pr.id = p_promocion and pr.promotora_id = p_promotora));
$$;
revoke all on function public.puede_dar_acceso(uuid, text, boolean) from public, anon;
grant execute on function public.puede_dar_acceso(uuid, text, boolean) to authenticated;

-- Da (o devuelve) un acceso a una cuenta que ya existe. La cuenta la crea antes
-- la función «invitar»; el correo se toma de la cuenta, no de quien llama.
create or replace function public.dar_acceso(
	p_user uuid, p_promotora uuid, p_promocion text, p_nombre text, p_cargo text,
	p_administra boolean, p_capacidades text[])
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_email text;
	v_id bigint;
begin
	if not public.puede_dar_acceso(p_promotora, p_promocion, p_administra) then
		raise exception 'No tienes permiso para dar este acceso';
	end if;
	if not public.capacidades_validas(p_capacidades) then
		raise exception 'Alguna capacidad no es válida';
	end if;
	if char_length(btrim(coalesce(p_nombre, ''))) not between 1 and 120 or char_length(coalesce(p_cargo, '')) > 120 then
		raise exception 'Revisa el nombre y el cargo';
	end if;
	select u.email into v_email from auth.users u where u.id = p_user;
	if v_email is null then
		raise exception 'No existe esa cuenta';
	end if;
	if exists (select 1 from public.administradores a where a.user_id = p_user)
		or exists (select 1 from public.robots r where r.user_id = p_user) then
		raise exception 'Esa cuenta es interna de MUNE: no puede tener acceso a MUNE Portal';
	end if;

	insert into public.miembros (user_id, promotora_id, promocion_id, nombre, email, cargo, administra, capacidades)
	values (p_user, p_promotora, p_promocion, btrim(p_nombre), lower(v_email), coalesce(btrim(p_cargo), ''),
		coalesce(p_administra, false), coalesce(p_capacidades, '{}'))
	on conflict (user_id, promotora_id, (coalesce(promocion_id, ''))) do update set
		activo = true, nombre = excluded.nombre, cargo = excluded.cargo,
		administra = excluded.administra, capacidades = excluded.capacidades
	returning id into v_id;
	return v_id;
end $$;
revoke all on function public.dar_acceso(uuid, uuid, text, text, text, boolean, text[]) from public, anon;
grant execute on function public.dar_acceso(uuid, uuid, text, text, text, boolean, text[]) to authenticated;

-- Cambia o retira un acceso. Nadie se cambia a sí mismo (salvo MUNE Studio) y
-- siempre queda al menos una persona que administre la promotora.
create or replace function public.cambiar_acceso(
	p_id bigint, p_activo boolean, p_administra boolean, p_capacidades text[], p_cargo text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	r public.miembros%rowtype;
	administra_luego boolean;
	activo_luego boolean;
begin
	select * into r from public.miembros where id = p_id;
	if r.id is null then
		raise exception 'No existe ese acceso';
	end if;
	if not public.es_admin() then
		if r.user_id = auth.uid() then
			raise exception 'No puedes cambiar tu propio acceso: pídeselo a otra persona que administre';
		end if;
		if not (public.es_admin_promotora(r.promotora_id)
			or (r.promocion_id is not null and not r.administra and not coalesce(p_administra, false)
				and public.administra_promocion(r.promocion_id))) then
			raise exception 'No tienes permiso para cambiar este acceso';
		end if;
	end if;
	if not public.capacidades_validas(p_capacidades) then
		raise exception 'Alguna capacidad no es válida';
	end if;
	if char_length(coalesce(p_cargo, '')) > 120 then
		raise exception 'El cargo es demasiado largo';
	end if;
	administra_luego := coalesce(p_administra, r.administra);
	activo_luego := coalesce(p_activo, r.activo);
	if r.promocion_id is null and r.administra and r.activo and not (administra_luego and activo_luego)
		and not exists (select 1 from public.miembros m
			where m.promotora_id = r.promotora_id and m.promocion_id is null and m.administra and m.activo and m.id <> r.id) then
		raise exception 'Tiene que quedar al menos una persona que administre la promotora';
	end if;
	update public.miembros set
		activo = activo_luego,
		administra = administra_luego,
		capacidades = coalesce(p_capacidades, capacidades),
		cargo = coalesce(btrim(p_cargo), cargo)
	where id = r.id;
end $$;
revoke all on function public.cambiar_acceso(bigint, boolean, boolean, text[], text) from public, anon;
grant execute on function public.cambiar_acceso(bigint, boolean, boolean, text[], text) to authenticated;

-- ═══ 4. Aprobadores (personas concretas, por promoción y tipo) ══════════════

create table if not exists public.aprobadores (
	id            bigint generated always as identity primary key,
	promocion_id  text not null references public.promociones (id) on delete cascade,
	tipo          text not null check (tipo in ('planos', 'experiencia')),
	user_id       uuid not null references auth.users (id) on delete cascade,
	creado_en     timestamptz not null default now(),
	unique (promocion_id, tipo, user_id)
);
alter table public.aprobadores enable row level security;
revoke all on public.aprobadores from anon, authenticated;
grant select on public.aprobadores to authenticated;
drop policy if exists "leen aprobadores" on public.aprobadores;
create policy "leen aprobadores" on public.aprobadores for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));

-- Los aprobadores que cuentan: los que siguen teniendo acceso (y, para los
-- planos comerciales, la capacidad «planos»).
create or replace function public.aprobadores_requeridos(p_promocion text, p_tipo text)
returns table (user_id uuid, nombre text)
language sql
stable
security definer
set search_path = ''
as $$
	select a.user_id,
		coalesce((select m.nombre from public.miembros m
			join public.promociones pr on pr.promotora_id = m.promotora_id
			where m.user_id = a.user_id and pr.id = a.promocion_id order by m.id limit 1), '—')
	from public.aprobadores a
	where a.promocion_id = p_promocion and a.tipo = p_tipo
		and public.persona_puede(a.user_id, p_promocion, case p_tipo when 'planos' then 'planos' end)
	order by 2;
$$;
revoke all on function public.aprobadores_requeridos(text, text) from public, anon, authenticated;

-- Para MUNE Portal y MUNE Studio: los aprobadores de una promoción.
create or replace function public.aprobadores_de(p_promocion text, p_tipo text)
returns table (user_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso';
	end if;
	return query select * from public.aprobadores_requeridos(p_promocion, p_tipo);
end $$;
revoke all on function public.aprobadores_de(text, text) from public, anon;
grant execute on function public.aprobadores_de(text, text) to authenticated;

create or replace function public.guardar_aprobadores(p_promocion text, p_tipo text, p_personas uuid[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	u uuid;
begin
	if not (public.es_admin() or public.administra_promocion(p_promocion)) then
		raise exception 'Solo quien administra la promoción puede elegir quién valida';
	end if;
	if p_tipo not in ('planos', 'experiencia') then
		raise exception 'Tipo de validación no válido';
	end if;
	foreach u in array coalesce(p_personas, '{}') loop
		if not public.persona_puede(u, p_promocion, case p_tipo when 'planos' then 'planos' end) then
			raise exception '%', case p_tipo
				when 'planos' then 'Para validar planos comerciales, la persona tiene que tener acceso a esta promoción con la capacidad «Planos comerciales»'
				else 'Para validar la Experiencia 3D, la persona tiene que tener acceso a esta promoción' end;
		end if;
	end loop;
	delete from public.aprobadores
	where promocion_id = p_promocion and tipo = p_tipo and not (user_id = any (coalesce(p_personas, '{}')));
	insert into public.aprobadores (promocion_id, tipo, user_id)
	select p_promocion, p_tipo, x from unnest(coalesce(p_personas, '{}')) x
	on conflict do nothing;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'aprobadores', jsonb_build_object('promocion', p_promocion, 'tipo', p_tipo, 'personas', to_jsonb(coalesce(p_personas, '{}'))));
end $$;
revoke all on function public.guardar_aprobadores(text, text, uuid[]) from public, anon;
grant execute on function public.guardar_aprobadores(text, text, uuid[]) to authenticated;

-- ═══ 5. Validaciones: varias personas por elemento ═══════════════════════════

alter table public.entregables drop constraint if exists entregables_tipo_check;
alter table public.entregables add constraint entregables_tipo_check
	check (tipo in ('plano', 'infografia', 'pdf', 'experiencia'));
-- Experiencia 3D: vistas o zonas de la tipología (para señalar dónde está un cambio).
alter table public.entregables add column if not exists vistas jsonb
	check (vistas is null or (jsonb_typeof(vistas) = 'array' and pg_column_size(vistas) < 8000));
grant insert (promocion_id, version, tipo, tipologia, nombre, ruta, huella,
	clave, titulo, detalle, viviendas, orden, miniatura, huella_datos, vistas) on public.entregables to authenticated;

-- Una decisión por persona (con su historial), no una por elemento.
alter table public.validaciones drop constraint if exists validaciones_entregable_id_key;
alter table public.validaciones add column if not exists zona text check (zona is null or char_length(zona) <= 120);
create index if not exists validaciones_por_entregable on public.validaciones (entregable_id, momento desc);
grant insert (entregable_id, decision, confirmado, comentario, zona) on public.validaciones to authenticated;

-- Foto de cada validación completa: quién aprobó, cuándo y con qué lista.
create table if not exists public.aprobaciones (
	id             bigint generated always as identity primary key,
	entregable_id  bigint not null unique references public.entregables (id) on delete cascade,
	promocion_id   text not null references public.promociones (id) on delete cascade,
	version        text not null,
	huella         text not null,
	completada_en  timestamptz not null default now(),
	aprobadores    jsonb not null default '[]'::jsonb
);
alter table public.aprobaciones enable row level security;
revoke all on public.aprobaciones from anon, authenticated;
grant select on public.aprobaciones to authenticated;
drop policy if exists "leen aprobaciones" on public.aprobaciones;
create policy "leen aprobaciones" on public.aprobaciones for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));

create or replace function public.tipo_validacion(p_tipo_entregable text)
returns text
language sql
immutable
set search_path = ''
as $$
	select case p_tipo_entregable when 'plano' then 'planos' when 'experiencia' then 'experiencia' end;
$$;

-- Los elementos con el mismo contenido (misma huella de datos) en versiones
-- anteriores o en esta: comparten decisiones.
create or replace function public.mismo_contenido(p_entregable bigint)
returns table (id bigint, version text)
language sql
stable
security definer
set search_path = ''
as $$
	select x.id, x.version
	from public.entregables e
	join public.entregables x on x.id = e.id
		or (x.promocion_id = e.promocion_id and x.tipo = e.tipo and e.huella_datos is not null
			and x.huella_datos = e.huella_datos and substr(x.version, 2)::int < substr(e.version, 2)::int)
	where e.id = p_entregable;
$$;
revoke all on function public.mismo_contenido(bigint) from public, anon, authenticated;

-- Recuento sin foto: aprobadores requeridos y la última decisión de cada uno.
-- Una aprobación de una versión anterior con el mismo contenido sigue valiendo.
-- Unos cambios pedidos en una versión anterior no: la versión nueva es la
-- respuesta a esa petición y hay que volver a validarla. La petición se
-- devuelve en «anterior» para tenerla presente al validar.
create or replace function public.recuento_validacion(p_entregable bigint)
returns table (requeridos int, aprobados int, cambios int, personas jsonb)
language sql
stable
security definer
set search_path = ''
as $$
	with e as (select * from public.entregables where id = p_entregable),
	req as (select r.* from e, public.aprobadores_requeridos(e.promocion_id, public.tipo_validacion(e.tipo)) r),
	ultimos as (
		select distinct on (v.user_id) v.user_id, v.entregable_id, v.decision, v.comentario, v.zona, v.momento, v.version
		from public.validaciones v
		join public.mismo_contenido(p_entregable) g on g.id = v.entregable_id
		order by v.user_id, v.momento desc),
	votos as (select * from ultimos where entregable_id = p_entregable or decision = 'aprobado'),
	anteriores as (select * from ultimos where entregable_id <> p_entregable and decision = 'rechazado')
	select
		(select count(*) from req)::int,
		(select count(*) from req join votos using (user_id) where votos.decision = 'aprobado')::int,
		(select count(*) from req join votos using (user_id) where votos.decision = 'rechazado')::int,
		coalesce((select jsonb_agg(jsonb_build_object(
			'user_id', req.user_id, 'nombre', req.nombre, 'decision', votos.decision, 'comentario', votos.comentario,
			'zona', votos.zona, 'momento', votos.momento, 'version', votos.version,
			'anterior', case when a.user_id is not null then jsonb_build_object(
				'comentario', a.comentario, 'zona', a.zona, 'momento', a.momento, 'version', a.version) end) order by req.nombre)
			from req left join votos using (user_id) left join anteriores a on a.user_id = req.user_id), '[]'::jsonb);
$$;
revoke all on function public.recuento_validacion(bigint) from public, anon, authenticated;

-- Estado de un elemento: aprobado (con foto, propia o del mismo contenido en una
-- versión anterior), cambios, parcial, pendiente o sin_aprobadores.
create or replace function public.estado_validacion(p_entregable bigint)
returns table (estado text, requeridos int, aprobados int, personas jsonb, heredada_de text, completada_en timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
	f record;
	c record;
begin
	select a.aprobadores, a.completada_en as cuando, x.version as v, (x.id = p_entregable) as propia into f
	from public.aprobaciones a
	join public.mismo_contenido(p_entregable) x on x.id = a.entregable_id
	order by (x.id = p_entregable) desc, substr(x.version, 2)::int desc
	limit 1;
	if found then
		return query select 'aprobado'::text, jsonb_array_length(f.aprobadores), jsonb_array_length(f.aprobadores),
			f.aprobadores, case when f.propia then null else f.v end, f.cuando;
		return;
	end if;
	select * into c from public.recuento_validacion(p_entregable);
	return query select
		case when c.requeridos = 0 then 'sin_aprobadores'
			when c.cambios > 0 then 'cambios'
			when c.aprobados = 0 then 'pendiente'
			else 'parcial' end,
		c.requeridos, c.aprobados, c.personas, null::text, null::timestamptz;
end $$;
revoke all on function public.estado_validacion(bigint) from public, anon, authenticated;

-- Al validar: solo la versión más reciente, solo quien está entre los
-- aprobadores, y no lo que ya está validado. Sin aprobadores no se valida.
create or replace function public.validacion_nueva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	e public.entregables%rowtype;
	t text;
	ultima int;
	que text;
begin
	select * into e from public.entregables where id = new.entregable_id;
	if e.id is null or e.tipo not in ('plano', 'experiencia') then
		raise exception 'Solo se validan los planos comerciales y la Experiencia 3D';
	end if;
	t := public.tipo_validacion(e.tipo);
	que := case t when 'planos' then 'los planos comerciales' else 'la Experiencia 3D' end;
	select max(substr(x.version, 2)::int) into ultima
	from public.entregables x where x.promocion_id = e.promocion_id and x.tipo = e.tipo;
	if substr(e.version, 2)::int <> ultima then
		raise exception 'Es de una versión anterior: valida la versión más reciente';
	end if;
	if not exists (select 1 from public.aprobadores_requeridos(e.promocion_id, t)) then
		raise exception 'Todavía no hay nadie designado para validar %. Elige en Equipo quién debe hacerlo: sin esa validación no se puede publicar.', que;
	end if;
	if not exists (select 1 from public.aprobadores_requeridos(e.promocion_id, t) r where r.user_id = auth.uid()) then
		raise exception 'No estás entre las personas que tienen que validar %.', que;
	end if;
	if (select s.estado from public.estado_validacion(e.id) s) = 'aprobado' then
		raise exception 'Ya está validado para esta versión';
	end if;
	if new.decision = 'aprobado' and exists (
		select 1 from (
			select v.decision from public.validaciones v
			join public.mismo_contenido(e.id) g on g.id = v.entregable_id
			where v.user_id = auth.uid() order by v.momento desc limit 1) u
		where u.decision = 'aprobado') then
		raise exception 'Ya lo has aprobado: falta que aprueben las demás personas';
	end if;
	new.promocion_id := e.promocion_id;
	new.version      := e.version;
	new.huella       := e.huella;
	new.user_id      := auth.uid();
	new.momento      := now();
	new.avisado      := false;
	if e.tipo <> 'experiencia' then
		new.zona := null;
	else
		new.zona := nullif(btrim(new.zona), '');
	end if;
	return new;
end $$;

-- Cuando aprueba el último aprobador que faltaba, se guarda la foto.
create or replace function public.validacion_completa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	c record;
begin
	if new.decision <> 'aprobado' then
		return null;
	end if;
	select * into c from public.recuento_validacion(new.entregable_id);
	if c.requeridos > 0 and c.aprobados = c.requeridos then
		insert into public.aprobaciones (entregable_id, promocion_id, version, huella, aprobadores)
		values (new.entregable_id, new.promocion_id, new.version, new.huella, c.personas)
		on conflict (entregable_id) do nothing;
	end if;
	return null;
end $$;
drop trigger if exists validacion_completa on public.validaciones;
create trigger validacion_completa after insert on public.validaciones
	for each row execute function public.validacion_completa();

-- Lo ya aprobado antes de este cambio (una aprobación por plano) sigue aprobado.
insert into public.aprobaciones (entregable_id, promocion_id, version, huella, completada_en, aprobadores)
select v.entregable_id, v.promocion_id, v.version, v.huella, v.momento,
	jsonb_build_array(jsonb_build_object('user_id', v.user_id,
		'nombre', coalesce((select m.nombre from public.miembros m where m.user_id = v.user_id order by m.id limit 1), '—'),
		'decision', 'aprobado', 'momento', v.momento, 'version', v.version))
from public.validaciones v
where v.decision = 'aprobado'
	and not exists (select 1 from public.aprobaciones a where a.entregable_id = v.entregable_id)
	and not exists (select 1 from public.validaciones w where w.entregable_id = v.entregable_id and w.momento > v.momento);

-- Estado de los elementos de una versión (planos comerciales o Experiencia 3D).
create or replace function public.validacion_de_version(p_promocion text, p_version text, p_tipo text)
returns table (
	id bigint, clave text, titulo text, detalle text, viviendas text, orden int, ruta text, miniatura text,
	huella text, vistas jsonb, estado text, requeridos int, aprobados int, personas jsonb,
	heredada_de text, completada_en timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_tipo not in ('planos', 'experiencia') then
		raise exception 'Tipo de validación no válido';
	end if;
	if not (public.es_admin() or public.es_robot()
		or (p_tipo = 'planos' and public.equipo_puede(p_promocion, 'planos'))
		or (p_tipo = 'experiencia' and public.es_miembro_de_promocion(p_promocion))) then
		raise exception 'Sin permiso';
	end if;
	return query
	select e.id, e.clave, coalesce(e.titulo, e.nombre), e.detalle, e.viviendas, e.orden, e.ruta, e.miniatura,
		e.huella, e.vistas, s.estado, s.requeridos, s.aprobados, s.personas, s.heredada_de, s.completada_en
	from public.entregables e
	cross join lateral public.estado_validacion(e.id) s
	where e.promocion_id = p_promocion and e.version = p_version
		and e.tipo = case p_tipo when 'planos' then 'plano' else 'experiencia' end
	order by e.orden, e.id;
end $$;
revoke all on function public.validacion_de_version(text, text, text) from public, anon;
grant execute on function public.validacion_de_version(text, text, text) to authenticated;

-- ¿Está validada esta parte de la versión?
-- 'sin_enviar' | 'sin_aprobadores' | 'cambios' | 'pendientes' | 'listos'
create or replace function public.validacion_lista(p_promocion text, p_version text, p_tipo text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select case
		when count(*) = 0 then 'sin_enviar'
		when bool_or(v.estado = 'sin_aprobadores') then 'sin_aprobadores'
		when bool_or(v.estado = 'cambios') then 'cambios'
		when bool_or(v.estado <> 'aprobado') then 'pendientes'
		else 'listos'
	end
	from public.validacion_de_version(p_promocion, p_version, p_tipo) v;
$$;
revoke all on function public.validacion_lista(text, text, text) from public, anon;
grant execute on function public.validacion_lista(text, text, text) to authenticated;

-- Compatibles con lo anterior (los usan la función «ejecutar» y versiones
-- anteriores de MUNE Studio y MUNE Portal).
create or replace function public.planos_de_version(p_promocion text, p_version text)
returns table (
	id bigint, clave text, titulo text, detalle text, viviendas text, orden int,
	ruta text, miniatura text, huella text, decision text, comentario text,
	momento timestamptz, persona text, heredada_de text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	return query
	select v.id, v.clave, v.titulo, v.detalle, v.viviendas, v.orden, v.ruta, v.miniatura, v.huella,
		case v.estado when 'aprobado' then 'aprobado' when 'cambios' then 'rechazado' end,
		(select p->>'comentario' from jsonb_array_elements(v.personas) p where p->>'decision' = 'rechazado' limit 1),
		v.completada_en,
		(select string_agg(p->>'nombre', ', ') from jsonb_array_elements(v.personas) p
			where (v.estado = 'aprobado' and p->>'decision' = 'aprobado') or (v.estado = 'cambios' and p->>'decision' = 'rechazado')),
		v.heredada_de
	from public.validacion_de_version(p_promocion, p_version, 'planos') v;
end $$;

create or replace function public.planos_listos(p_promocion text, p_version text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select public.validacion_lista(p_promocion, p_version, 'planos');
$$;

-- ═══ 6. Documentos con varios archivos ═══════════════════════════════════════

alter table public.requisitos add column if not exists varios boolean not null default false;
alter table public.requisitos add column if not exists contenidos text[] not null default '{}';
alter table public.documentos add column if not exists contenido text check (contenido is null or char_length(contenido) between 1 and 80);
alter table public.documentos add column if not exists detalle text check (detalle is null or char_length(detalle) <= 200);
grant insert (promocion_id, bloque, elemento, descripcion, obligatorio, orden, plantilla, varios, contenidos) on public.requisitos to authenticated;
grant insert (promocion_id, requisito_id, nombre, ruta, tipo, tamano, huella, reemplaza_a, contenido, detalle) on public.documentos to authenticated;

-- Al subir: en los documentos de varios archivos, cada archivo nuevo empieza
-- su propia cadena de versiones (y dice qué contiene); «sustituir» añade una
-- versión a ese archivo. En los demás, como siempre: una sola cadena.
create or replace function public.documento_nuevo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	anterior public.documentos%rowtype;
	req      public.requisitos%rowtype;
	carpeta  text;
begin
	select * into req from public.requisitos r where r.id = new.requisito_id and r.promocion_id = new.promocion_id;
	if req.id is null then
		raise exception 'El requisito no es de esta promoción';
	end if;

	select pr.promotora_id::text || '/' || pr.id || '/' || new.requisito_id::text || '/'
	into carpeta
	from public.promociones pr where pr.id = new.promocion_id;
	if carpeta is null or left(new.ruta, char_length(carpeta)) <> carpeta then
		raise exception 'La ruta del archivo no corresponde a este requisito';
	end if;
	if not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = new.ruta) then
		raise exception 'El archivo no está en el almacén';
	end if;

	if req.varios then
		if new.reemplaza_a is not null then
			select * into anterior from public.documentos d where d.id = new.reemplaza_a and d.requisito_id = new.requisito_id;
			if anterior.id is null then
				raise exception 'El archivo que quieres sustituir no es de este documento';
			end if;
			if exists (select 1 from public.documentos d where d.reemplaza_a = anterior.id) then
				raise exception 'Ese archivo ya se ha sustituido: sustituye su versión más reciente';
			end if;
			new.version   := anterior.version + 1;
			new.contenido := coalesce(nullif(btrim(new.contenido), ''), anterior.contenido);
			new.detalle   := coalesce(nullif(btrim(new.detalle), ''), anterior.detalle);
		else
			new.version   := 1;
			new.contenido := nullif(btrim(new.contenido), '');
			new.detalle   := nullif(btrim(new.detalle), '');
		end if;
		if new.contenido is null then
			raise exception 'Indica qué contiene el archivo';
		end if;
	else
		select * into anterior from public.documentos d
		where d.promocion_id = new.promocion_id and d.requisito_id = new.requisito_id
		order by d.version desc limit 1;
		new.version     := coalesce(anterior.version, 0) + 1;
		new.reemplaza_a := anterior.id;
		new.contenido   := null;
		new.detalle     := null;
	end if;
	new.estado       := 'pendiente';
	new.nota         := null;
	new.subido_por   := auth.uid();
	new.subido_en    := now();
	new.revisado_por := null;
	new.revisado_en  := null;
	return new;
end $$;

-- Lista estándar con los documentos que admiten varios archivos.
drop function if exists public.lista_estandar();
create function public.lista_estandar()
returns table (bloque text, elemento text, descripcion text, obligatorio boolean, orden int, plantilla text, varios boolean, contenidos text[])
language sql
immutable
set search_path = ''
as $$
	values
		('Planos', 'Plano de situación o emplazamiento',
			'Sitúa la parcela en su entorno. En PDF y, si lo tienes, también en DWG.', true, 1, null::text, false, '{}'::text[]),
		('Planos', 'Plano de urbanización o implantación',
			'Parcela, zonas comunes, accesos y viales interiores. En PDF y, si lo tienes, también en DWG.', true, 2, null, false, '{}'),
		('Planos', 'Planos de cada tipología, acotados',
			'Uno por tipología, con cotas y superficies por estancia. Añade un archivo por tipología e indica cuál es. En PDF y, si lo tienes, también en DWG.', true, 3, null, true,
			'{"Plano de tipología","Otro"}'),
		('Planos', 'Planos de plantas generales del edificio',
			'Planta por planta, con la posición de cada vivienda. Solo en plurifamiliares. En PDF y, si lo tienes, también en DWG.', false, 4, null, true,
			'{"Planta general","Otro"}'),
		('Planos', 'Alzados y secciones',
			'Fachadas y secciones con sus alturas. En PDF y, si lo tienes, también en DWG.', true, 5, null, true,
			'{"Alzado","Sección","Otro"}'),
		('Planos', 'Planos de garajes y trasteros',
			'Si la promoción los tiene, con la numeración de plazas y trasteros. En PDF y, si lo tienes, también en DWG.', false, 6, null, true,
			'{"Planta de garaje","Trasteros","Otro"}'),
		('Planos', 'Plano de cubiertas',
			'Si aplica, con la geometría de cubiertas, huecos y elementos relevantes. En PDF y, si lo tienes, también en DWG.', false, 7, null, false, '{}'),
		('Viviendas y superficies', 'Tabla de viviendas y tipologías (Excel)',
			'Descarga la plantilla, rellénala con todas las viviendas y súbela aquí.', true, 8, '/plantillas/tabla-viviendas.xlsx', false, '{}'),
		('Viviendas y superficies', 'Cuadro de superficies oficial del proyecto',
			'Documento vigente con las superficies oficiales de las viviendas, tipologías y espacios del proyecto.', true, 9, null, false, '{}'),
		('Calidades', 'Memoria de calidades técnica',
			'No la memoria comercial de la promoción. Sube la documentación técnica vigente que defina con precisión los elementos que debemos reproducir: '
			|| 'dimensiones, espesores, formatos, sistemas, materiales, acabados, marcas, modelos y referencias cuando estén definidos. '
			|| 'Por ejemplo: ventanas (medidas, perfil, sistema, vidrio y acabado), puertas (medidas, modelo, acabado y herrajes), pavimentos (material, formato, espesor y acabado), '
			|| 'cocinas, sanitarios, griferías, barandillas y revestimientos. Puede estar en la memoria técnica, el proyecto, los cuadros de carpinterías y de acabados, '
			|| 'los detalles constructivos o las fichas técnicas de los fabricantes: no hace falta reorganizarla para MUNE. Añade cada archivo por separado e indica qué contiene.',
			true, 10, null, true,
			'{"Memoria técnica","Cuadro de carpinterías","Cuadro de acabados","Detalles constructivos","Fichas técnicas de fabricantes","Otro"}')
$$;
revoke all on function public.lista_estandar() from public, anon;

create or replace function public.aplicar_lista_estandar(p_promocion text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede preparar la lista de documentos';
	end if;
	if not exists (select 1 from public.promociones where id = p_promocion) then
		raise exception 'No existe esa promoción';
	end if;
	if exists (select 1 from public.requisitos where promocion_id = p_promocion and activo) then
		raise exception 'Esta promoción ya tiene lista de documentos';
	end if;
	insert into public.requisitos (promocion_id, bloque, elemento, descripcion, obligatorio, orden, plantilla, varios, contenidos)
	select p_promocion, l.bloque, l.elemento, l.descripcion, l.obligatorio, l.orden, l.plantilla, l.varios, l.contenidos
	from public.lista_estandar() l;
	get diagnostics n = row_count;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'lista_estandar', jsonb_build_object('promocion', p_promocion, 'documentos', n));
	return n;
end $$;
revoke all on function public.aplicar_lista_estandar(text) from public, anon;
grant execute on function public.aplicar_lista_estandar(text) to authenticated;

-- Listas ya creadas: los mismos documentos pasan a admitir varios archivos.
update public.requisitos r
set varios = l.varios, contenidos = l.contenidos,
	descripcion = case when r.descripcion = '' or r.elemento = 'Memoria de calidades técnica'
		or r.elemento = 'Planos de cada tipología, acotados' then l.descripcion else r.descripcion end
from public.lista_estandar() l
where r.elemento = l.elemento and l.varios and not r.varios;

-- ═══ 7. Textos legales de la promoción ═══════════════════════════════════════

alter table public.promociones add column if not exists textos_legales jsonb not null default '{}'::jsonb
	check (jsonb_typeof(textos_legales) = 'object' and pg_column_size(textos_legales) < 8000);

create or replace function public.guardar_textos_legales(
	p_promocion text, p_planos text, p_renders text, p_experiencia text, p_personalizacion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.puede(p_promocion, 'datos') then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	if greatest(char_length(coalesce(p_planos, '')), char_length(coalesce(p_renders, '')),
		char_length(coalesce(p_experiencia, '')), char_length(coalesce(p_personalizacion, ''))) > 1000 then
		raise exception 'Cada texto legal puede tener como mucho 1000 caracteres';
	end if;
	update public.promociones set textos_legales = jsonb_strip_nulls(jsonb_build_object(
		'planos', nullif(btrim(p_planos), ''),
		'renders', nullif(btrim(p_renders), ''),
		'experiencia', nullif(btrim(p_experiencia), ''),
		'personalizacion', nullif(btrim(p_personalizacion), '')))
	where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'textos_legales', jsonb_build_object('promocion', p_promocion));
end $$;
revoke all on function public.guardar_textos_legales(text, text, text, text, text) from public, anon;
grant execute on function public.guardar_textos_legales(text, text, text, text, text) to authenticated;

-- ═══ 8. Registro automático (con administración, capacidades y tipo de validación) ═

create or replace function public.anotar_portal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- Lo que se hace a mano en el SQL Editor no tiene sesión: no se anota aquí.
	if auth.uid() is null then
		return null;
	end if;
	-- (Cada tabla en su rama: plpgsql no permite mirar campos de otra tabla.)
	if tg_table_name = 'documentos' then
		if tg_op = 'INSERT' then
			insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'documento_subido',
				jsonb_build_object('documento', new.id, 'promocion', new.promocion_id, 'requisito', new.requisito_id,
					'nombre', new.nombre, 'version', new.version, 'huella', new.huella, 'contenido', new.contenido));
		elsif new.estado is distinct from old.estado then
			insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'documento_' || new.estado,
				jsonb_build_object('documento', new.id, 'promocion', new.promocion_id, 'antes', old.estado, 'nota', new.nota));
		end if;
	elsif tg_table_name = 'validaciones' then
		insert into public.registro (user_id, accion, detalle) values (auth.uid(),
			(select case e.tipo when 'experiencia' then 'experiencia_' else 'plano_' end from public.entregables e where e.id = new.entregable_id)
				|| new.decision,
			jsonb_build_object('validacion', new.id, 'entregable', new.entregable_id, 'promocion', new.promocion_id,
				'version', new.version, 'huella', new.huella, 'zona', new.zona));
	elsif tg_table_name = 'miembros' then
		insert into public.registro (user_id, accion, detalle) values (auth.uid(),
			case when tg_op = 'INSERT' then 'acceso_dado' else 'acceso_cambiado' end,
			jsonb_build_object('persona', new.user_id, 'promotora', new.promotora_id,
				'promocion', coalesce(new.promocion_id, 'todas'), 'cargo', new.cargo, 'activo', new.activo,
				'administra', new.administra, 'capacidades', to_jsonb(new.capacidades)));
	end if;
	return null;
end $$;

-- ═══ 9. Funciones de antes, ahora por capacidad ══════════════════════════════
-- (Mismo contenido que en su archivo de origen; solo cambia quién puede.)

-- guardar_datos_promotora (de 007_equipos.sql)
create or replace function public.guardar_datos_promotora(
	p_promotora uuid, p_razon_social text, p_cif text, p_domicilio_fiscal text, p_contacto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_admin_promotora(p_promotora)) then
		raise exception 'Sin permiso para cambiar los datos de esta promotora';
	end if;
	update public.promotoras set
		razon_social = nullif(btrim(p_razon_social), ''),
		cif = nullif(upper(btrim(p_cif)), ''),
		domicilio_fiscal = nullif(btrim(p_domicilio_fiscal), ''),
		contacto = nullif(btrim(p_contacto), '')
	where id = p_promotora;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'datos_promotora', jsonb_build_object('promotora', p_promotora));
end $$;

-- guardar_datos_promocion (de 007_equipos.sql)
create or replace function public.guardar_datos_promocion(
	p_promocion text, p_razon_social text, p_cif text, p_domicilio_fiscal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.puede(p_promocion, 'datos')) then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	update public.promociones set
		razon_social = nullif(btrim(p_razon_social), ''),
		cif = nullif(upper(btrim(p_cif)), ''),
		domicilio_fiscal = nullif(btrim(p_domicilio_fiscal), '')
	where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'datos_promocion', jsonb_build_object('promocion', p_promocion));
end $$;

-- guardar_ficha_promocion (de 018_fase_proyecto.sql)
create or replace function public.guardar_ficha_promocion(
	p_promocion text, p_direccion text, p_codigo_postal text, p_municipio text, p_provincia text,
	p_referencia_catastral text, p_tipo text, p_num_viviendas int, p_num_portales int, p_num_plantas int,
	p_fecha_entrega date, p_fase_proyecto text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.puede(p_promocion, 'datos')) then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	if coalesce(p_fase_proyecto, '') not in ('', 'anteproyecto', 'basico', 'ejecucion') then
		raise exception 'Fase del proyecto no válida';
	end if;
	update public.promociones set
		direccion = nullif(btrim(p_direccion), ''),
		codigo_postal = nullif(btrim(p_codigo_postal), ''),
		municipio = nullif(btrim(p_municipio), ''),
		provincia = nullif(btrim(p_provincia), ''),
		referencia_catastral = nullif(upper(replace(btrim(p_referencia_catastral), ' ', '')), ''),
		tipo = nullif(p_tipo, ''),
		num_viviendas = p_num_viviendas,
		num_portales = p_num_portales,
		num_plantas = p_num_plantas,
		fecha_entrega = p_fecha_entrega,
		fase_proyecto = coalesce(nullif(p_fase_proyecto, ''), fase_proyecto)
	where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'ficha_promocion', jsonb_build_object('promocion', p_promocion));
end $$;

-- guardar_formalizacion (de 016_formalizacion.sql)
create or replace function public.guardar_formalizacion(
	p_promocion text,
	p_contacto_nombre text, p_contacto_email text, p_contacto_telefono text,
	p_titular text, p_banco text, p_iban text, p_bic text, p_concepto text, p_plazo_dias int, p_instrucciones text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	limpio text;
	v jsonb;
begin
	if not (public.es_admin() or public.puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes permiso para cambiar los datos de esta promoción';
	end if;
	if coalesce(btrim(p_contacto_email), '') <> '' and btrim(p_contacto_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
		raise exception 'Revisa el email de contacto: no parece válido';
	end if;
	limpio := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
	if limpio <> '' and limpio !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$' then
		raise exception 'Revisa el IBAN: no parece válido';
	end if;
	if p_plazo_dias is not null and p_plazo_dias not between 1 and 90 then
		raise exception 'El plazo tiene que estar entre 1 y 90 días';
	end if;
	if greatest(char_length(coalesce(p_contacto_nombre, '')), char_length(coalesce(p_contacto_telefono, '')), char_length(coalesce(p_titular, '')),
		char_length(coalesce(p_banco, '')), char_length(coalesce(p_bic, '')), char_length(coalesce(p_concepto, ''))) > 200
		or char_length(coalesce(p_instrucciones, '')) > 1000 then
		raise exception 'Algún texto es demasiado largo';
	end if;

	v := jsonb_strip_nulls(jsonb_build_object(
		'contacto', jsonb_strip_nulls(jsonb_build_object(
			'nombre', nullif(btrim(p_contacto_nombre), ''),
			'email', nullif(lower(btrim(p_contacto_email)), ''),
			'telefono', nullif(btrim(p_contacto_telefono), ''))),
		'pago', jsonb_strip_nulls(jsonb_build_object(
			'titular', nullif(btrim(p_titular), ''),
			'banco', nullif(btrim(p_banco), ''),
			-- el IBAN se guarda en grupos de 4, como se escribe
			'iban', nullif(btrim(regexp_replace(limpio, '(.{4})', '\1 ', 'g')), ''),
			'bic', nullif(upper(btrim(p_bic)), ''),
			'concepto', nullif(btrim(p_concepto), ''),
			'plazoDias', p_plazo_dias,
			'instrucciones', nullif(btrim(p_instrucciones), '')))));
	update public.promociones set formalizacion = v where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'formalizacion_promocion', jsonb_build_object('promocion', p_promocion));
end $$;

-- generar_codigo_comprador (de 014_codigos_comprador.sql)
create or replace function public.generar_codigo_comprador(p_promocion text, p_vivienda text, p_nuevo_comprador boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	anterior public.codigos_comprador%rowtype;
	codigo text;
	numero int;
begin
	if not (public.es_admin() or public.puede(p_promocion, 'compradores')) then
		raise exception 'Sin permiso para los códigos de esta promoción';
	end if;
	if char_length(btrim(coalesce(p_vivienda, ''))) not between 1 and 60 then
		raise exception 'Vivienda no válida';
	end if;
	select * into anterior from public.codigos_comprador
	where promocion_id = p_promocion and vivienda_ref = p_vivienda and activo;
	select coalesce(max(comprador), 0) into numero from public.codigos_comprador
	where promocion_id = p_promocion and vivienda_ref = p_vivienda;
	if numero = 0 then numero := 1;
	elsif p_nuevo_comprador then numero := numero + 1;
	end if;

	update public.codigos_comprador set activo = false where id = anterior.id;
	-- 12 cifras hexadecimales al azar (48 bits); con el límite de intentos no se pueden adivinar
	codigo := 'c-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
	insert into public.codigos_comprador (promocion_id, vivienda_ref, huella, comprador)
	values (p_promocion, p_vivienda, encode(sha256(convert_to(codigo, 'UTF8')), 'hex'), numero);

	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), case when anterior.id is null then 'genera un código de comprador'
		when p_nuevo_comprador then 'cambia el código (comprador nuevo)' else 'cambia el código (mismo comprador)' end,
		jsonb_build_object('promocion', p_promocion, 'vivienda', p_vivienda, 'comprador', numero));
	return codigo;
end $$;

-- generar_codigos_pendientes (de 014_codigos_comprador.sql)
create or replace function public.generar_codigos_pendientes(p_promocion text, p_viviendas text[])
returns table (vivienda_ref text, codigo text)
language plpgsql
security definer
set search_path = ''
as $$
declare
	ref text;
	nuevo text;
	n int := 0;
begin
	if not (public.es_admin() or public.puede(p_promocion, 'compradores')) then
		raise exception 'Sin permiso para los códigos de esta promoción';
	end if;
	if coalesce(array_length(p_viviendas, 1), 0) > 2000 then
		raise exception 'Demasiadas viviendas';
	end if;
	for ref in select distinct btrim(x) from unnest(p_viviendas) x
		where char_length(btrim(x)) between 1 and 60
			and not exists (select 1 from public.codigos_comprador c
				where c.promocion_id = p_promocion and c.vivienda_ref = btrim(x) and c.activo)
		order by 1
	loop
		nuevo := 'c-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
		insert into public.codigos_comprador (promocion_id, vivienda_ref, huella, comprador)
		values (p_promocion, ref, encode(sha256(convert_to(nuevo, 'UTF8')), 'hex'),
			greatest(1, coalesce((select max(c.comprador) from public.codigos_comprador c
				where c.promocion_id = p_promocion and c.vivienda_ref = ref), 1)));
		vivienda_ref := ref;
		codigo := nuevo;
		n := n + 1;
		return next;
	end loop;
	if n > 0 then
		insert into public.registro (user_id, accion, detalle)
		values (auth.uid(), 'genera los códigos de comprador', jsonb_build_object('promocion', p_promocion, 'viviendas', n));
	end if;
end $$;

-- codigos_de_promocion (de 014_codigos_comprador.sql)
create or replace function public.codigos_de_promocion(p_promocion text)
returns table (vivienda_ref text, comprador int, creado_en timestamptz, ultimo_acceso timestamptz, accesos int)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.puede(p_promocion, 'compradores')) then
		raise exception 'Sin permiso para los códigos de esta promoción';
	end if;
	return query
		select c.vivienda_ref, c.comprador, c.creado_en, c.ultimo_acceso, c.accesos
		from public.codigos_comprador c
		where c.promocion_id = p_promocion and c.activo
		order by c.vivienda_ref;
end $$;

-- cambiar_fase_proyecto (de 019_cambio_fase.sql)
create or replace function public.cambiar_fase_proyecto(p_promocion text, p_fase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	antes text;
begin
	if not (public.es_admin() or public.puede(p_promocion, 'documentacion')) then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	if p_fase is null or p_fase not in ('anteproyecto', 'basico', 'ejecucion') then
		raise exception 'Fase del proyecto no válida';
	end if;
	select fase_proyecto into antes from public.promociones where id = p_promocion for update;
	if antes is not distinct from p_fase then
		return;
	end if;
	update public.promociones set fase_proyecto = p_fase where id = p_promocion;
	insert into public.fases_promocion (promocion_id, fase, por) values (p_promocion, p_fase, auth.uid());
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'fase_proyecto', jsonb_build_object('promocion', p_promocion, 'de', antes, 'a', p_fase));
end $$;

-- marcar_aviso_subida (de 009_aviso_subida.sql)
create or replace function public.marcar_aviso_subida(p_documento bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	update public.documentos set avisado = true
	where id = p_documento and not avisado
		and subido_por = auth.uid()
		and subido_en > now() - interval '30 minutes'
		and public.equipo_puede(promocion_id, 'documentacion');
	get diagnostics n = row_count;
	return n = 1;
end $$;

-- ═══ 10. Lo que usan las funciones de Supabase (cuenta interna service_role) ═
-- (en el proyecto real esa cuenta necesita permiso explícito: ver 013)
grant select on public.aprobadores, public.aprobaciones to service_role;
grant execute on function public.aprobadores_requeridos(text, text) to service_role;
grant execute on function public.persona_puede(uuid, text, text) to service_role;
grant execute on function public.estado_validacion(bigint) to service_role;
grant execute on function public.recuento_validacion(bigint) to service_role;
grant execute on function public.mismo_contenido(bigint) to service_role;
-- (para apuntar en el registro las invitaciones hechas desde MUNE Portal)
grant insert on public.registro to service_role;

-- Avisos por email de la Experiencia 3D (012 solo admitía planos, rechazado y publicada).
alter table public.avisos_enviados drop constraint if exists avisos_enviados_tipo_check;
alter table public.avisos_enviados add constraint avisos_enviados_tipo_check
	check (tipo in ('planos', 'experiencia', 'rechazado', 'publicada'));

select 'Listo: equipos, administración y validaciones' as resultado;
