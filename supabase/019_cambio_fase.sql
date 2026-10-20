-- Fase 1 · paso 19: cambiar de fase del proyecto, con su historial (10/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 018. Es repetible.
--
-- · La promotora (o la administradora) indica en Documentación en qué fase
--   está el proyecto: anteproyecto, proyecto básico o proyecto de ejecución.
-- · Cada cambio queda en un historial (qué fase, desde cuándo y quién la
--   indicó), que ven el equipo de la promoción y MUNE Studio.
-- · Los documentos que se suben quedan marcados con la fase de ese momento
--   (018_fase_proyecto.sql).

create table if not exists public.fases_promocion (
	id            bigint generated always as identity primary key,
	promocion_id  text not null references public.promociones (id) on delete cascade,
	fase          text not null check (fase in ('anteproyecto', 'basico', 'ejecucion')),
	desde         timestamptz not null default now(),
	por           uuid references auth.users (id) on delete set null
);
create index if not exists fases_promocion_promocion on public.fases_promocion (promocion_id, desde desc);

alter table public.fases_promocion enable row level security;
revoke all on public.fases_promocion from anon, authenticated;
grant select on public.fases_promocion to authenticated;
drop policy if exists "leen fases" on public.fases_promocion;
create policy "leen fases" on public.fases_promocion for select to authenticated
	using (public.es_admin() or public.es_miembro_de_promocion(promocion_id));

-- La fase que ya estuviera puesta (desde la ficha) pasa al historial.
insert into public.fases_promocion (promocion_id, fase)
select p.id, p.fase_proyecto from public.promociones p
where p.fase_proyecto is not null
	and not exists (select 1 from public.fases_promocion f where f.promocion_id = p.id);

create or replace function public.cambiar_fase_proyecto(p_promocion text, p_fase text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	antes text;
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
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
revoke all on function public.cambiar_fase_proyecto(text, text) from public, anon;
grant execute on function public.cambiar_fase_proyecto(text, text) to authenticated;

select 'Listo: cambio de fase del proyecto' as resultado;
