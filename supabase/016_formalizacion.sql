-- Fase 1 · paso 16: contacto y datos de pago de la formalización (decisión 39).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 015. Es repetible.
--
-- · Cada promoción guarda a quién envía el comprador su documento de selección
--   firmado (nombre opcional, email, teléfono opcional) y los datos para la
--   transferencia (titular, entidad, IBAN, BIC, concepto, plazo e instrucciones).
--   Los rellena el equipo de la promotora en MUNE Portal (o la administradora
--   en MUNE Studio).
-- · Antes iban en los datos de la web pública; ahora solo llegan al navegador
--   cuando el comprador entra con un código válido (entrar_comprador).

alter table public.promociones add column if not exists formalizacion jsonb not null default '{}'::jsonb
	check (jsonb_typeof(formalizacion) = 'object' and pg_column_size(formalizacion) < 8000);

create or replace function public.guardar_formalizacion(
	p_promocion text,
	p_contacto_nombre text, p_contacto_email text, p_contacto_telefono text,
	p_titular text, p_banco text, p_iban text, p_bic text, p_concepto text, p_plazo_dias int, p_instrucciones text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	limpio text;
	v jsonb;
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'No tienes permiso para cambiar los datos de esta promoción';
	end if;
	if coalesce(btrim(p_contacto_email), '') <> '' and btrim(p_contacto_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
		raise exception 'Revisa el email de contacto: no parece válido';
	end if;
	limpio := upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g'));
	if limpio <> '' and limpio !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{8,30}$' then
		raise exception 'Revisa el IBAN: no parece válido';
	end if;
	if p_plazo_dias is not null and p_plazo_dias not between 1 and 90 then
		raise exception 'El plazo tiene que estar entre 1 y 90 días';
	end if;
	if greatest(char_length(coalesce(p_contacto_nombre, '')), char_length(coalesce(p_contacto_telefono, '')), char_length(coalesce(p_titular, '')),
		char_length(coalesce(p_banco, '')), char_length(coalesce(p_bic, '')), char_length(coalesce(p_concepto, ''))) > 200
		or char_length(coalesce(p_instrucciones, '')) > 1000 then
		raise exception 'Algún texto es demasiado largo';
	end if;

	v := jsonb_strip_nulls(jsonb_build_object(
		'contacto', jsonb_strip_nulls(jsonb_build_object(
			'nombre', nullif(btrim(p_contacto_nombre), ''),
			'email', nullif(lower(btrim(p_contacto_email)), ''),
			'telefono', nullif(btrim(p_contacto_telefono), ''))),
		'pago', jsonb_strip_nulls(jsonb_build_object(
			'titular', nullif(btrim(p_titular), ''),
			'banco', nullif(btrim(p_banco), ''),
			-- el IBAN se guarda en grupos de 4, como se escribe
			'iban', nullif(btrim(regexp_replace(limpio, '(.{4})', '\1 ', 'g')), ''),
			'bic', nullif(upper(btrim(p_bic)), ''),
			'concepto', nullif(btrim(p_concepto), ''),
			'plazoDias', p_plazo_dias,
			'instrucciones', nullif(btrim(p_instrucciones), '')))));
	update public.promociones set formalizacion = v where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'formalizacion_promocion', jsonb_build_object('promocion', p_promocion));
end $$;
revoke all on function public.guardar_formalizacion(text, text, text, text, text, text, text, text, text, int, text) from public, anon;
grant execute on function public.guardar_formalizacion(text, text, text, text, text, text, text, text, text, int, text) to authenticated;

-- Lo que había en los datos de la promoción de demostración (antes en su promocion.json).
update public.promociones set formalizacion = jsonb_build_object(
	'contacto', jsonb_build_object('nombre', 'Equipo comercial', 'email', 'ventas@promotora-demo.example', 'telefono', '900 000 000'),
	'pago', jsonb_build_object('titular', 'Promotora Demo S.L.', 'banco', 'Banco Ejemplo', 'iban', 'ES00 0000 0000 0000 0000 0000',
		'bic', 'EJEMESMMXXX', 'concepto', '{promocion} · {ref} · {pack}', 'plazoDias', 10,
		'instrucciones', 'La selección queda confirmada cuando recibimos el documento firmado y el justificante de pago. Si la transferencia no llega dentro del plazo, la selección de este pack queda sin efecto.'))
where id = 'residencial-demo' and formalizacion = '{}'::jsonb;

-- ─── Entrar como comprador: ahora devuelve también la formalización ─────────
-- (igual que en 014, con «formalizacion» en la respuesta)

create or replace function public.entrar_comprador(p_promocion text, p_codigo text)
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
	c public.codigos_comprador%rowtype;
	fallos int;
	fallos_promocion int;
begin
	if p_promocion !~ '^[a-z0-9-]{1,60}$' then
		raise exception 'Promoción no válida';
	end if;
	select count(*) into fallos from public.intentos_comprador i
	where promocion_id = p_promocion and i.cliente = v_cliente and not acierto and momento > now() - interval '15 minutes';
	select count(*) into fallos_promocion from public.intentos_comprador
	where promocion_id = p_promocion and not acierto and momento > now() - interval '1 hour';
	if fallos >= 10 or fallos_promocion >= 300 then
		raise exception 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	end if;

	if char_length(v_codigo) = 13 and left(v_codigo, 1) = 'c' then v_codigo := substr(v_codigo, 2); end if;
	v_codigo := 'c-' || v_codigo;
	select cc.* into c from public.codigos_comprador cc
	join public.promociones pr on pr.id = cc.promocion_id
	where cc.huella = encode(sha256(convert_to(v_codigo, 'UTF8')), 'hex')
		and cc.promocion_id = p_promocion and cc.activo and pr.activa;

	insert into public.intentos_comprador (promocion_id, cliente, acierto) values (p_promocion, v_cliente, c.id is not null);
	delete from public.intentos_comprador where momento < now() - interval '1 day';
	if c.id is null then
		return null;
	end if;

	update public.codigos_comprador set ultimo_acceso = now(), accesos = accesos + 1 where id = c.id;
	return jsonb_build_object(
		'vivienda', c.vivienda_ref,
		'selecciones', coalesce((
			select jsonb_object_agg(s.pack, jsonb_build_object('fecha', s.fecha, 'opciones', s.opciones))
			from public.selecciones_comprador s
			where s.promocion_id = c.promocion_id and s.vivienda_ref = c.vivienda_ref and s.comprador = c.comprador
		), '{}'::jsonb),
		'formalizacion', (select pr.formalizacion from public.promociones pr where pr.id = c.promocion_id));
end $$;
revoke all on function public.entrar_comprador(text, text) from public;
grant execute on function public.entrar_comprador(text, text) to anon, authenticated;

select 'Listo: formalización' as resultado;
