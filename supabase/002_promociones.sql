-- Panel · paso 2: lista privada de promotoras y promociones.
--
-- Se ejecuta una vez en Supabase → SQL Editor. Es repetible.
--
-- La lista de promociones (y de qué promotora es cada una) es información
-- del negocio: no está en la web pública, solo aquí. Cada promoción enlaza con
-- su carpeta del taller (promociones/<id>) y con su visita en el escaparate
-- (/<id>/). Las versiones las sigue leyendo el Panel del propio escaparate.
--
-- Hoy solo las ve la administradora (con doble verificación). En la Fase 1
-- cada promotora verá únicamente las suyas.

create table if not exists public.promotoras (
	id        uuid primary key default gen_random_uuid(),
	nombre    text not null check (char_length(nombre) between 1 and 120),
	creada_en timestamptz not null default now()
);
alter table public.promotoras enable row level security;

create table if not exists public.promociones (
	id           text primary key check (id ~ '^[a-z0-9-]{1,60}$'),
	promotora_id uuid not null references public.promotoras (id),
	nombre       text not null check (char_length(nombre) between 1 and 120),
	ubicacion    text not null default '' check (char_length(ubicacion) <= 120),
	creada_en    timestamptz not null default now()
);
alter table public.promociones enable row level security;

revoke all on public.promotoras, public.promociones from anon, authenticated;
grant select on public.promotoras, public.promociones to authenticated;

drop policy if exists "admin lee promotoras" on public.promotoras;
create policy "admin lee promotoras" on public.promotoras
	for select to authenticated using (public.es_admin());

drop policy if exists "admin lee promociones" on public.promociones;
create policy "admin lee promociones" on public.promociones
	for select to authenticated using (public.es_admin());

-- Datos de la prueba (ficticios)
insert into public.promotoras (id, nombre)
values ('00000000-0000-4000-8000-000000000001', 'Promotora Demo')
on conflict (id) do nothing;

insert into public.promociones (id, promotora_id, nombre, ubicacion)
values ('residencial-demo', '00000000-0000-4000-8000-000000000001', 'Residencial Demo', 'Alovera (Guadalajara)')
on conflict (id) do nothing;

select 'Listo: ' || count(*) || ' promoción(es)' as resultado from public.promociones;
