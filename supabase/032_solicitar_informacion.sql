-- «Solicitar información» conectado con la promotora (29/10/2026, decidido por
-- la administradora).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 031. Es repetible.
--
-- La promotora elige en MUNE Portal (Ficha y datos, con «datos») cómo funciona
-- el botón «Solicitar información» de la experiencia pública:
--  · «enlace»: lleva a su web, a su formulario o a un email (como en 028). Si la
--    experiencia está insertada en su web, abre la página en la misma ventana;
--    si no, en otra pestaña.
--  · «formulario»: el código de inserción del formulario de su CRM (HubSpot,
--    Salesforce, Clientify…). Al pulsar el botón se abre en una ventana encima
--    del 3D, aislado: no puede leer nada de la experiencia.
-- En los dos casos llegan las UTM (utm_source=mune, utm_medium=experiencia-3d,
-- utm_campaign=<promoción>, utm_content=<tipología>), para que su CRM sepa de
-- dónde viene el interesado; en un email, el asunto lleva la tipología. MUNE no
-- ve ni guarda nada de lo que escriba el interesado. Se aplica al momento.

alter table public.promociones add column if not exists solicitar_modo text not null default 'enlace'
	check (solicitar_modo in ('enlace', 'formulario'));
alter table public.promociones add column if not exists solicitar_formulario text
	check (solicitar_formulario is null or char_length(solicitar_formulario) <= 20000);

-- Guarda cómo funciona «Solicitar información» (vacío: el botón no aparece)
create or replace function public.guardar_solicitar_informacion(p_promocion text, p_modo text, p_enlace text, p_formulario text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	v text := nullif(btrim(coalesce(p_enlace, '')), '');
	f text := nullif(btrim(coalesce(p_formulario, '')), '');
begin
	if not public.puede(p_promocion, 'datos') then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	if p_modo not in ('enlace', 'formulario') then
		raise exception 'Elige cómo funciona «Solicitar información»';
	end if;
	-- un email suelto se convierte en enlace de correo
	if v ~ '^[^\s<>"@/:]+@[^\s<>"@/]+\.[a-z]{2,}$' then
		v := 'mailto:' || v;
	end if;
	if v is not null and not (char_length(v) <= 500
			and (v ~ '^https://[^\s<>"]+$' or v ~ '^mailto:[^\s<>"@]+@[^\s<>"]+$')) then
		raise exception 'El enlace de «Solicitar información» tiene que empezar por https:// (o ser un email)';
	end if;
	if p_modo = 'formulario' then
		if f is null then
			raise exception 'Pega el código de inserción del formulario de tu CRM';
		end if;
		if char_length(f) > 20000 or f !~ '<' then
			raise exception 'Ese código de inserción no es válido: cópialo entero desde tu CRM (como mucho, 20 000 caracteres)';
		end if;
	end if;
	update public.promociones set solicitar_modo = p_modo, solicitar_info = v, solicitar_formulario = f where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'solicitar_info', jsonb_build_object('promocion', p_promocion, 'modo', p_modo, 'enlace', v,
		'formulario', f is not null));
end $$;
revoke all on function public.guardar_solicitar_informacion(text, text, text, text) from public, anon;
grant execute on function public.guardar_solicitar_informacion(text, text, text, text) to authenticated;

-- La de 028 sigue valiendo: guarda el enlace y vuelve al modo «enlace»
create or replace function public.guardar_solicitar_info(p_promocion text, p_enlace text)
returns void
language sql
security definer
set search_path = ''
as $$ select public.guardar_solicitar_informacion(p_promocion, 'enlace', p_enlace, null) $$;
revoke all on function public.guardar_solicitar_info(text, text) from public, anon;
grant execute on function public.guardar_solicitar_info(text, text) to authenticated;

-- Lo que pregunta la web pública al abrirse (028), con el modo y el formulario
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
			'solicitar_info', p.solicitar_info,
			'solicitar_modo', p.solicitar_modo,
			'solicitar_formulario', case when p.solicitar_modo = 'formulario' then p.solicitar_formulario end)
		from public.promociones p where p.id = p_promocion),
		jsonb_build_object('activa', false, 'acceso_comprador', false, 'solicitar_info', null, 'solicitar_modo', 'enlace',
			'solicitar_formulario', null));
$$;
revoke all on function public.experiencia_publica(text) from public;
grant execute on function public.experiencia_publica(text) to anon, authenticated;

select 'Listo: «Solicitar información» con enlace o formulario' as resultado;
