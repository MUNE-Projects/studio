-- Fase 1 · paso 6: accesos de las promotoras (receta 14).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 005. Es repetible.
--
-- Qué añade:
--  · cuenta_por_email: la usa SOLO la función «invitar» de Supabase (desde el
--    servidor) para saber si un correo ya tiene cuenta. Nadie más puede
--    llamarla: ni las páginas, ni las promotoras, ni el robot.
--  · accesos: para el Panel. Lista las personas con acceso a una promotora,
--    si ya han aceptado la invitación y cuándo entraron por última vez. Solo
--    la administradora (con el código del móvil).

create or replace function public.cuenta_por_email(p_email text)
returns table (user_id uuid, confirmada boolean, interna boolean)
language sql
stable
security definer
set search_path = ''
as $$
	select u.id,
		u.email_confirmed_at is not null,
		exists (select 1 from public.administradores a where a.user_id = u.id)
			or exists (select 1 from public.robots r where r.user_id = u.id)
	from auth.users u
	where lower(u.email) = lower(btrim(p_email));
$$;
revoke all on function public.cuenta_por_email(text) from public, anon, authenticated;
grant execute on function public.cuenta_por_email(text) to service_role;

-- (Si ya existe con otras columnas, por ejemplo tras 007, se rehace.)
drop function if exists public.accesos(uuid);
create function public.accesos(p_promotora uuid)
returns table (
	user_id uuid, nombre text, email text, rol text, activo boolean, creado_en timestamptz,
	aceptada boolean, ultima_entrada timestamptz
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
		select m.user_id, m.nombre, m.email, m.rol, m.activo, m.creado_en,
			u.email_confirmed_at is not null, u.last_sign_in_at
		from public.miembros m
		join auth.users u on u.id = m.user_id
		where m.promotora_id = p_promotora
		order by m.activo desc, m.nombre;
end $$;
revoke all on function public.accesos(uuid) from public, anon;
grant execute on function public.accesos(uuid) to authenticated;

select 'Listo: accesos de las promotoras preparados' as resultado;
