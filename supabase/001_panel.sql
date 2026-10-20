-- Panel de administración · paso 1: quién puede entrar y registro de acciones.
--
-- Se ejecuta una sola vez en Supabase → SQL Editor. Es repetible: si se lanza
-- de nuevo no duplica nada.
--
-- Reglas:
--  · Nadie ve ni escribe nada sin haber entrado con contraseña Y código del
--    móvil (nivel «aal2» de Supabase) y estar en la lista de administradores.
--  · El registro solo admite añadir filas: no se puede editar ni borrar desde
--    el Panel ni con la clave pública.
--  · La lista de administradores no se puede modificar desde el Panel.

create table if not exists public.administradores (
	user_id   uuid primary key references auth.users (id) on delete cascade,
	nombre    text not null,
	creado_en timestamptz not null default now()
);
alter table public.administradores enable row level security;

create table if not exists public.registro (
	id      bigint generated always as identity primary key,
	momento timestamptz not null default now(),
	user_id uuid not null default auth.uid() references auth.users (id),
	accion  text not null check (char_length(accion) between 1 and 60),
	detalle jsonb not null default '{}'::jsonb check (pg_column_size(detalle) < 4000)
);
alter table public.registro enable row level security;

-- ¿La sesión actual es de una administradora con doble verificación?
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
		and exists (select 1 from public.administradores a where a.user_id = auth.uid());
$$;
revoke all on function public.es_admin() from public, anon;
grant execute on function public.es_admin() to authenticated;

-- Permisos mínimos: nada para visitantes anónimos; leer y añadir al registro
-- para sesiones iniciadas (y aun así filtrado por las políticas de abajo).
revoke all on public.administradores, public.registro from anon, authenticated;
grant select on public.administradores to authenticated;
grant select, insert on public.registro to authenticated;

drop policy if exists "admin lee administradores" on public.administradores;
create policy "admin lee administradores" on public.administradores
	for select to authenticated using (public.es_admin());

drop policy if exists "admin lee registro" on public.registro;
create policy "admin lee registro" on public.registro
	for select to authenticated using (public.es_admin());

drop policy if exists "admin anota en registro" on public.registro;
create policy "admin anota en registro" on public.registro
	for insert to authenticated with check (public.es_admin() and user_id = auth.uid());

-- Alta de la primera administradora: el único usuario creado a mano en
-- Authentication → Users. Si hubiera más de uno, se detiene sin hacer nada.
do $$
declare
	n int;
begin
	select count(*) into n from auth.users;
	if n <> 1 then
		raise exception 'Se esperaba exactamente 1 usuario en Authentication → Users y hay %', n;
	end if;
	insert into public.administradores (user_id, nombre)
	select id, 'Administradora' from auth.users
	on conflict (user_id) do nothing;
end $$;

select 'Listo: ' || count(*) || ' administradora(s)' as resultado from public.administradores;
