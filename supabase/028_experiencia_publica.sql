-- Lista maestra · paso 6b: la Experience pública de cada promoción.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 027. Es repetible.
--
--  · «Solicitar información»: un enlace de la promotora (su web, un formulario,
--    un email…) que la web pública enseña como botón. Lo pone el equipo con
--    «datos» en MUNE Portal (Ficha y datos) o MUNE Studio.
--  · La web pública pregunta al abrirse si su Experience pública está activa
--    (módulo de MUNE Studio, 022) y su enlace de «Solicitar información»
--    (experiencia_publica). Apagada, enseña un aviso en lugar de la visita; los
--    compradores con código y el equipo de la promotora (modo profesional)
--    siguen entrando. Si Supabase no responde, la visita se abre igual: la web
--    pública nunca depende de Supabase para funcionar.
--  · No da ninguna lista: solo responde por la promoción que se le pregunta, y
--    lo mismo (apagada) si no existe.

alter table public.promociones add column if not exists solicitar_info text
	check (solicitar_info is null or (char_length(solicitar_info) <= 500
		and (solicitar_info ~ '^https://[^\s<>"]+$' or solicitar_info ~ '^mailto:[^\s<>"@]+@[^\s<>"]+$')));

create or replace function public.guardar_solicitar_info(p_promocion text, p_enlace text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v text := nullif(btrim(coalesce(p_enlace, '')), '');
begin
	if not public.puede(p_promocion, 'datos') then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	-- un email suelto se convierte en enlace de correo
	if v ~ '^[^\s<>"@/:]+@[^\s<>"@/]+\.[a-z]{2,}$' then
		v := 'mailto:' || v;
	end if;
	if v is not null and not (char_length(v) <= 500
			and (v ~ '^https://[^\s<>"]+$' or v ~ '^mailto:[^\s<>"@]+@[^\s<>"]+$')) then
		raise exception 'El enlace de «Solicitar información» tiene que empezar por https:// (o ser un email)';
	end if;
	update public.promociones set solicitar_info = v where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'solicitar_info', jsonb_build_object('promocion', p_promocion, 'enlace', v));
end $$;
revoke all on function public.guardar_solicitar_info(text, text) from public, anon;
grant execute on function public.guardar_solicitar_info(text, text) to authenticated;

create or replace function public.experiencia_publica(p_promocion text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce((
		select jsonb_build_object(
			'activa', coalesce((p.modulos->>'experiencia_publica')::boolean, false),
			'acceso_comprador', coalesce((p.modulos->>'acceso_comprador')::boolean, false),
			'solicitar_info', p.solicitar_info)
		from public.promociones p where p.id = p_promocion),
		jsonb_build_object('activa', false, 'acceso_comprador', false, 'solicitar_info', null));
$$;
revoke all on function public.experiencia_publica(text) from public;
grant execute on function public.experiencia_publica(text) to anon, authenticated;

select 'Listo: la Experience pública de cada promoción' as resultado;
