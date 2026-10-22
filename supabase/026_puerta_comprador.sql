-- Lista maestra · paso 5c: puerta general del comprador («Accede a tu vivienda»).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 025. Es repetible.
--
-- Una sola página para todos los compradores de MUNE (experience…/acceso/): el
-- comprador escribe su código y MUNE sabe de qué promoción es, sin que tenga que
-- conocer la dirección de su promoción. Después entra en su vivienda como
-- siempre (entrar_comprador, en la web de su promoción).
--  · Cada código es único en todo MUNE (no solo en su promoción).
--  · Límite de intentos para toda la puerta: 10 fallos en 15 minutos desde la
--    misma dirección, o 1000 fallos en una hora en total, bloquean un rato.
--  · Solo dice de qué promoción es el código; nada de la vivienda.

-- ═══ 1. Códigos únicos en todo MUNE ═════════════════════════════════════════
-- (Con 12 cifras al azar la coincidencia es prácticamente imposible; así queda garantizado.)

create unique index if not exists codigos_comprador_huella_activa on public.codigos_comprador (huella) where activo;

-- ═══ 2. La puerta ═══════════════════════════════════════════════════════════

create or replace function public.buscar_vivienda_comprador(p_codigo text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	cabeceras json := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json;
	v_cliente text := encode(sha256(convert_to(coalesce(
		cabeceras->>'cf-connecting-ip', split_part(cabeceras->>'x-forwarded-for', ',', 1), 'desconocido'), 'UTF8')), 'hex');
	v_codigo text := lower(regexp_replace(coalesce(p_codigo, ''), '[^A-Za-z0-9]', '', 'g'));
	v_promocion text;
begin
	-- «*»: intentos de la puerta general (los de cada promoción llevan su id)
	if (select count(*) from public.intentos_comprador i where i.promocion_id = '*' and i.cliente = v_cliente
			and not i.acierto and i.momento > now() - interval '15 minutes') >= 10
		or (select count(*) from public.intentos_comprador i where i.promocion_id = '*'
			and not i.acierto and i.momento > now() - interval '1 hour') >= 1000 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;

	if char_length(v_codigo) = 13 and left(v_codigo, 1) = 'c' then v_codigo := substr(v_codigo, 2); end if;
	if v_codigo ~ '^[0-9a-f]{12}$' then
		select cc.promocion_id into v_promocion from public.codigos_comprador cc
		join public.promociones pr on pr.id = cc.promocion_id
		where cc.huella = encode(sha256(convert_to('c-' || v_codigo, 'UTF8')), 'hex')
			and cc.activo and pr.activa and coalesce((pr.modulos->>'acceso_comprador')::boolean, true);
	end if;

	insert into public.intentos_comprador (promocion_id, cliente, acierto) values ('*', v_cliente, v_promocion is not null);
	delete from public.intentos_comprador where momento < now() - interval '1 day';
	return case when v_promocion is null then null else jsonb_build_object('promocion', v_promocion) end;
end $$;
revoke all on function public.buscar_vivienda_comprador(text) from public;
grant execute on function public.buscar_vivienda_comprador(text) to anon, authenticated;

select 'Listo: puerta general del comprador' as resultado;
