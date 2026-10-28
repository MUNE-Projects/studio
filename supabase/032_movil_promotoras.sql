-- Código del móvil también para las promotoras (auditoría de seguridad del
-- 28/10/2026, aprobado por la administradora).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 031. Es repetible.
--
-- Hasta ahora las personas de las promotoras entraban en MUNE Portal solo con
-- su contraseña. Desde aquí, como en MUNE Studio, hace falta además el código
-- de 6 cifras de la app del móvil (nivel «aal2» de Supabase). Lo comprueba la
-- base de datos, no la página: con una sesión de solo contraseña, una persona
-- de una promotora no ve ni cambia nada, ni siquiera su propio acceso.
--
-- No cambia:
--  · el robot de Claude y la cuenta de copias (cuentas internas, sin móvil);
--  · los compradores (entran con su código de comprador, sin cuenta);
--  · las comprobaciones que hace el servidor sobre OTRA persona (por ejemplo,
--    a quién avisar de una validación): esas no dependen de la sesión.
--
-- Si alguien pierde el móvil, la administradora (MUNE Studio) o quien
-- administra su promotora o su promoción (MUNE Portal → Equipo) pulsan
-- «Quitar código del móvil» (función «invitar», acción «quitar-movil»): al
-- volver a entrar, esa persona vincula el móvil de nuevo.

-- ¿La sesión ha entrado con contraseña + código del móvil?
create or replace function public.sesion_con_movil()
returns boolean
language sql
stable
set search_path = ''
as $$
	select coalesce(auth.jwt() ->> 'aal', '') = 'aal2';
$$;
revoke all on function public.sesion_con_movil() from public, anon;
grant execute on function public.sesion_con_movil() to authenticated;

-- ─── Las comprobaciones de equipo exigen el código del móvil ────────────────
-- (mismas funciones que en 005, 007 y 020, con una condición más)

create or replace function public.es_miembro_de_promocion(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.sesion_con_movil() and exists (
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

create or replace function public.es_miembro_de_promotora(p_promotora uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.sesion_con_movil() and exists (
		select 1
		from public.promotoras po
		join public.miembros m on m.promotora_id = po.id
		where po.id = p_promotora and po.activa
			and m.activo and m.user_id = auth.uid()
	);
$$;

create or replace function public.es_admin_promotora(p_promotora uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.sesion_con_movil() and exists (
		select 1 from public.miembros m
		join public.promotoras po on po.id = m.promotora_id
		where m.promotora_id = p_promotora and po.activa
			and m.activo and m.user_id = auth.uid() and m.promocion_id is null and m.administra);
$$;

create or replace function public.administra_promocion(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select public.sesion_con_movil() and exists (
		select 1
		from public.promociones pr
		join public.promotoras po on po.id = pr.promotora_id
		join public.miembros m on m.promotora_id = po.id
		where pr.id = p_promocion and pr.activa and po.activa
			and m.activo and m.user_id = auth.uid() and m.administra
			and (m.promocion_id is null or m.promocion_id = pr.id));
$$;

-- Si se pregunta por la propia sesión, también exige el código del móvil; si
-- es por otra persona (lo usa el servidor), no depende de la sesión.
create or replace function public.persona_puede(p_user uuid, p_promocion text, p_capacidad text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select (p_user is distinct from auth.uid() or public.sesion_con_movil()) and exists (
		select 1
		from public.promociones pr
		join public.promotoras po on po.id = pr.promotora_id
		join public.miembros m on m.promotora_id = po.id
		where pr.id = p_promocion and pr.activa and po.activa
			and m.activo and m.user_id = p_user
			and (m.promocion_id is null or m.promocion_id = pr.id)
			and (p_capacidad is null or m.administra or p_capacidad = any (m.capacidades)));
$$;

-- Cada persona ve su propio acceso solo con el código del móvil.
drop policy if exists "miembro lee su acceso" on public.miembros;
create policy "miembro lee su acceso" on public.miembros
	for select to authenticated using (user_id = auth.uid() and activo and public.sesion_con_movil());

-- La lista del equipo (020), con la misma condición.
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
	if not global and (not public.sesion_con_movil() or not exists (
		select 1 from public.miembros m
		where m.promotora_id = p_promotora and m.user_id = auth.uid() and m.activo)) then
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
