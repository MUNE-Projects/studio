-- Fase 1 · paso 7: equipos por promoción y datos de promotoras y promociones.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 006. Es repetible.
--
-- Cambios respecto a 005/006 (decisión 28 de docs/arquitectura.md):
--  · El acceso al portal es POR PROMOCIÓN: cada promoción tiene su equipo.
--    Opcionalmente, una persona puede tener acceso a TODAS las promociones de
--    su promotora (también a las que se den de alta después).
--  · Sin roles: todas las personas con acceso pueden hacer lo mismo (subir
--    documentación, aprobar o rechazar planos, descargar). Solo se guarda su
--    cargo, como texto libre.
--  · Cada persona pertenece a una sola promotora.
--  · Datos fiscales de la promotora y de cada promoción (cada proyecto puede
--    ser una sociedad distinta). Los rellenan la promotora en su portal o la
--    administradora en el Panel, con las funciones guardar_datos_*; nadie más
--    puede tocar ninguna otra columna.

-- ─── Datos de promotoras y promociones ──────────────────────────────────────

alter table public.promotoras add column if not exists razon_social text check (razon_social is null or char_length(razon_social) <= 200);
alter table public.promotoras add column if not exists domicilio_fiscal text check (domicilio_fiscal is null or char_length(domicilio_fiscal) <= 300);
alter table public.promotoras add column if not exists contacto text check (contacto is null or char_length(contacto) <= 300);
alter table public.promociones add column if not exists razon_social text check (razon_social is null or char_length(razon_social) <= 200);
alter table public.promociones add column if not exists cif text check (cif is null or char_length(cif) <= 20);
alter table public.promociones add column if not exists domicilio_fiscal text check (domicilio_fiscal is null or char_length(domicilio_fiscal) <= 300);

-- ─── Accesos: por promoción o a todas las de la promotora ───────────────────
-- (Se transforma la tabla «miembros» de 005; todavía no tiene personas.)

drop policy if exists "aprobador valida planos" on public.validaciones;
drop function if exists public.es_aprobador_de_promocion(text);

do $$
begin
	if exists (select 1 from information_schema.columns
		where table_schema = 'public' and table_name = 'miembros' and column_name = 'rol') then
		if exists (select 1 from public.miembros) then
			raise exception 'La tabla miembros ya tiene personas: avisa a Claude antes de seguir';
		end if;
		alter table public.miembros drop constraint miembros_pkey;
		alter table public.miembros drop column rol;
		alter table public.miembros add column id bigint generated always as identity primary key;
		alter table public.miembros add column promocion_id text references public.promociones (id);
		alter table public.miembros add column cargo text not null default '' check (char_length(cargo) <= 120);
	end if;
end $$;

-- Un acceso por persona y promoción (o uno a «todas»).
create unique index if not exists miembros_unico on public.miembros (user_id, promotora_id, coalesce(promocion_id, ''));

-- La promoción tiene que ser de esa promotora, y cada persona es de una sola promotora.
create or replace function public.miembro_valido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.promocion_id is not null and not exists (
		select 1 from public.promociones pr where pr.id = new.promocion_id and pr.promotora_id = new.promotora_id) then
		raise exception 'La promoción no es de esta promotora';
	end if;
	if exists (select 1 from public.miembros m where m.user_id = new.user_id and m.promotora_id <> new.promotora_id) then
		raise exception 'Esta persona ya tiene acceso en otra promotora';
	end if;
	return new;
end $$;
drop trigger if exists miembro_valido on public.miembros;
create trigger miembro_valido before insert or update on public.miembros
	for each row execute function public.miembro_valido();

-- ¿La sesión actual puede ver esta promoción? (acceso a ella o a todas las
-- de su promotora; promoción, promotora y acceso activos)
create or replace function public.es_miembro_de_promocion(p_promocion text)
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
		where pr.id = p_promocion
			and pr.activa and po.activa
			and m.activo and m.user_id = auth.uid()
			and (m.promocion_id is null or m.promocion_id = pr.id)
	);
$$;

-- Todas las personas con acceso pueden validar planos de sus promociones.
drop policy if exists "equipo valida planos" on public.validaciones;
create policy "equipo valida planos" on public.validaciones
	for insert to authenticated
	with check (public.es_miembro_de_promocion(
		(select e.promocion_id from public.entregables e where e.id = entregable_id)));

-- Permisos de la tabla (sin rol; con promoción y cargo).
revoke insert, update on public.miembros from authenticated;
grant insert (user_id, promotora_id, promocion_id, nombre, email, cargo) on public.miembros to authenticated;
grant update (nombre, cargo, activo) on public.miembros to authenticated;

-- Registro automático de los accesos, con la promoción («todas» si es nula).
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
					'nombre', new.nombre, 'version', new.version, 'huella', new.huella));
		elsif new.estado is distinct from old.estado then
			insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'documento_' || new.estado,
				jsonb_build_object('documento', new.id, 'promocion', new.promocion_id, 'antes', old.estado, 'nota', new.nota));
		end if;
	elsif tg_table_name = 'validaciones' then
		insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'plano_' || new.decision,
			jsonb_build_object('validacion', new.id, 'entregable', new.entregable_id, 'promocion', new.promocion_id,
				'version', new.version, 'huella', new.huella));
	elsif tg_table_name = 'miembros' then
		insert into public.registro (user_id, accion, detalle) values (auth.uid(),
			case when tg_op = 'INSERT' then 'acceso_dado' else 'acceso_cambiado' end,
			jsonb_build_object('persona', new.user_id, 'promotora', new.promotora_id,
				'promocion', coalesce(new.promocion_id, 'todas'), 'cargo', new.cargo, 'activo', new.activo));
	end if;
	return null;
end $$;

-- ─── Lista de accesos para el Panel (sustituye a la de 006) ─────────────────

drop function if exists public.accesos(uuid);
create function public.accesos(p_promotora uuid)
returns table (
	id bigint, user_id uuid, promocion_id text, nombre text, email text, cargo text, activo boolean,
	creado_en timestamptz, aceptada boolean, ultima_entrada timestamptz
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
			u.email_confirmed_at is not null, u.last_sign_in_at
		from public.miembros m
		join auth.users u on u.id = m.user_id
		where m.promotora_id = p_promotora
		order by m.activo desc, m.nombre;
end $$;
revoke all on function public.accesos(uuid) from public, anon;
grant execute on function public.accesos(uuid) to authenticated;

-- ─── Guardar datos (promotora y promoción) ──────────────────────────────────
-- Solo estas columnas, y solo la administradora o una persona con acceso.

create or replace function public.guardar_datos_promotora(
	p_promotora uuid, p_razon_social text, p_cif text, p_domicilio_fiscal text, p_contacto text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_miembro_de_promotora(p_promotora)) then
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

create or replace function public.guardar_datos_promocion(
	p_promocion text, p_razon_social text, p_cif text, p_domicilio_fiscal text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
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

revoke all on function public.guardar_datos_promotora(uuid, text, text, text, text) from public, anon;
revoke all on function public.guardar_datos_promocion(text, text, text, text) from public, anon;
grant execute on function public.guardar_datos_promotora(uuid, text, text, text, text) to authenticated;
grant execute on function public.guardar_datos_promocion(text, text, text, text) to authenticated;

-- La administradora ya no cambia el CIF de la promotora directamente (va por
-- guardar_datos_promotora, con el resto de datos fiscales).
revoke update on public.promotoras from authenticated;
grant update (nombre, activa) on public.promotoras to authenticated;

select 'Listo: equipos por promoción y datos de promotoras y promociones' as resultado;
