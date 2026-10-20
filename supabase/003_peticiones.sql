-- Panel · paso 3: peticiones de cambios y usuario robot de Claude.
--
-- Se ejecuta una vez en Supabase → SQL Editor, DESPUÉS de crear el usuario
-- robot en Authentication → Users. Es repetible.
--
-- Peticiones: la administradora escribe en el Panel lo que quiere cambiar de
-- una promoción; Claude las lee cuando ella se lo pide y va marcando su estado.
--
-- Robot (permisos aprobados por la administradora):
--  · puede leer las peticiones y la lista de promociones;
--  · puede cambiar el estado de una petición y añadir una nota y un enlace;
--  · puede anotar en el registro de actividad (todo lo que hace queda apuntado);
--  · NO puede borrar, ni crear peticiones, ni ver el registro, ni ver usuarios,
--    ni cambiar reglas, ni crear administradores, ni publicar;
--  · es un usuario normal (sin clave maestra) y se revoca bloqueándolo en
--    Authentication → Users.

create table if not exists public.robots (
	user_id   uuid primary key references auth.users (id) on delete cascade,
	nombre    text not null,
	creado_en timestamptz not null default now()
);
alter table public.robots enable row level security;
revoke all on public.robots from anon, authenticated;

create or replace function public.es_robot()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (select 1 from public.robots r where r.user_id = auth.uid());
$$;
revoke all on function public.es_robot() from public, anon;
grant execute on function public.es_robot() to authenticated;

create table if not exists public.peticiones (
	id             bigint generated always as identity primary key,
	promocion_id   text not null references public.promociones (id),
	version        text check (version is null or version ~ '^v[0-9]{1,5}$'),
	texto          text not null check (char_length(texto) between 3 and 4000),
	estado         text not null default 'pendiente'
	               check (estado in ('pendiente', 'en_curso', 'lista', 'descartada')),
	nota           text check (nota is null or char_length(nota) <= 2000),
	enlace         text check (enlace is null or enlace ~ '^https://[^\s]{1,500}$'),
	creada_en      timestamptz not null default now(),
	creada_por     uuid not null default auth.uid() references auth.users (id),
	actualizada_en timestamptz not null default now()
);
alter table public.peticiones enable row level security;

create or replace function public.peticion_actualizada()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
	new.actualizada_en := now();
	return new;
end $$;
drop trigger if exists peticion_actualizada on public.peticiones;
create trigger peticion_actualizada before update on public.peticiones
	for each row execute function public.peticion_actualizada();

-- Permisos: crear y leer; al actualizar solo se tocan estado, nota y enlace.
revoke all on public.peticiones from anon, authenticated;
grant select, insert on public.peticiones to authenticated;
grant update (estado, nota, enlace) on public.peticiones to authenticated;

drop policy if exists "admin y robot leen peticiones" on public.peticiones;
create policy "admin y robot leen peticiones" on public.peticiones
	for select to authenticated using (public.es_admin() or public.es_robot());

drop policy if exists "admin crea peticiones" on public.peticiones;
create policy "admin crea peticiones" on public.peticiones
	for insert to authenticated
	with check (public.es_admin() and creada_por = auth.uid() and estado = 'pendiente');

drop policy if exists "admin y robot actualizan peticiones" on public.peticiones;
create policy "admin y robot actualizan peticiones" on public.peticiones
	for update to authenticated
	using (public.es_admin() or public.es_robot())
	with check (public.es_admin() or public.es_robot());

-- El robot también lee la lista de promociones y anota en el registro.
drop policy if exists "robot lee promociones" on public.promociones;
create policy "robot lee promociones" on public.promociones
	for select to authenticated using (public.es_robot());

drop policy if exists "robot anota en registro" on public.registro;
create policy "robot anota en registro" on public.registro
	for insert to authenticated with check (public.es_robot() and user_id = auth.uid());

-- Alta del robot: el único usuario que no es administrador. Si no hay
-- exactamente uno, se detiene sin hacer nada.
do $$
declare
	n int;
begin
	select count(*) into n from auth.users u
	where not exists (select 1 from public.administradores a where a.user_id = u.id);
	if n <> 1 then
		raise exception 'Se esperaba exactamente 1 usuario robot (no administrador) en Authentication → Users y hay %', n;
	end if;
	insert into public.robots (user_id, nombre)
	select u.id, 'Claude' from auth.users u
	where not exists (select 1 from public.administradores a where a.user_id = u.id)
	on conflict (user_id) do nothing;
end $$;

select 'Listo: ' || (select count(*) from public.robots) || ' robot(s), tabla de peticiones creada' as resultado;
