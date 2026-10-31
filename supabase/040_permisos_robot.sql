-- Permisos del robot de Claude: solo lo necesario para producir
-- (informe «MUNE · Qué información llega a Claude», 30/10/2026; decisión 65).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 038 (y de 039, si ya
-- está). Es repetible.
--
-- El robot es un usuario normal de Supabase que usa Claude al preparar cada
-- promoción. Hasta ahora podía leer de más; desde aquí:
--  1. Ficha de la promoción: ya no lee la fila entera (con razón social, CIF,
--     domicilio fiscal, formalización —contacto, titular, IBAN y BIC— ni el
--     formulario de «Solicitar información»). Lee solo los campos técnicos con
--     ficha_para_robot(). La promotora sigue rellenándolo todo en MUNE Portal,
--     y el comprador sigue recibiendo la formalización (con el IBAN) al entrar
--     con su código (entrar_comprador), para su PDF: eso no pasa por el robot.
--  2. Comentarios: el robot recibe el texto, el sitio y los identificadores,
--     pero en lugar del nombre de quien lo escribe, su papel («Equipo de la
--     promotora» o «Equipo de MUNE»). Las personas de MUNE y de la promotora
--     siguen viendo el nombre real; en la tabla no cambia nada.
--  3. Aprobadores y validaciones: el robot deja de ver quién aprueba (la lista
--     de aprobadores, las aprobaciones con nombres y el estado de validación
--     con las personas). Sigue viendo las validaciones (aprobado o rechazado, y
--     el comentario de qué cambiar), los planos y el registro de versiones.
--     La administradora y los equipos de las promotoras, igual que antes.

-- ═══ 1. Ficha de la promoción ═══════════════════════════════════════════════

drop policy if exists "robot lee promociones" on public.promociones;

-- Lo que el robot necesita de la ficha: identificación, ubicación (para el
-- entorno), datos del edificio, módulos y textos legales (van en la web).
create or replace function public.ficha_para_robot(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo MUNE';
	end if;
	return (select jsonb_build_object(
		'id', pr.id, 'nombre', pr.nombre, 'activa', pr.activa, 'estado', pr.estado,
		'ubicacion', pr.ubicacion, 'direccion', pr.direccion, 'codigo_postal', pr.codigo_postal,
		'municipio', pr.municipio, 'provincia', pr.provincia, 'referencia_catastral', pr.referencia_catastral,
		'tipo', pr.tipo, 'num_viviendas', pr.num_viviendas, 'num_portales', pr.num_portales,
		'num_plantas', pr.num_plantas, 'fecha_entrega', pr.fecha_entrega, 'fase_proyecto', pr.fase_proyecto,
		'modulos', pr.modulos, 'publicacion', pr.publicacion, 'textos_legales', pr.textos_legales)
		from public.promociones pr where pr.id = p_promocion);
end $$;
revoke all on function public.ficha_para_robot(text) from public, anon;
grant execute on function public.ficha_para_robot(text) to authenticated;

-- ═══ 2. Comentarios: el papel en lugar del nombre, para el robot ═══════════

create or replace function public._autor_como_papel(p_hilos jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
	select coalesce(jsonb_agg(h || jsonb_build_object(
		'autor', case when (h->>'de_mune')::boolean then 'Equipo de MUNE' else 'Equipo de la promotora' end,
		'respuestas', coalesce((select jsonb_agg(r || jsonb_build_object(
			'autor', case when (r->>'de_mune')::boolean then 'Equipo de MUNE' else 'Equipo de la promotora' end)
			order by o) from jsonb_array_elements(h->'respuestas') with ordinality as x(r, o)), '[]'::jsonb))
		order by n), '[]'::jsonb)
	from jsonb_array_elements(coalesce(p_hilos, '[]'::jsonb)) with ordinality as y(h, n);
$$;
revoke all on function public._autor_como_papel(jsonb) from public, anon, authenticated;

create or replace function public.comentarios_de(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if public.es_robot() then
		return public._autor_como_papel(public._hilos(p_promocion, true));
	end if;
	if not public._puede_comentar(p_promocion) then
		raise exception 'No tienes acceso a esta promoción';
	end if;
	return public._hilos(p_promocion, public.es_admin());
end $$;
revoke all on function public.comentarios_de(text) from public, anon;
grant execute on function public.comentarios_de(text) to authenticated;

-- ═══ 3. Aprobadores y validaciones ══════════════════════════════════════════

drop policy if exists "leen aprobadores" on public.aprobadores;
create policy "leen aprobadores" on public.aprobadores for select to authenticated
	using (public.es_admin() or public.es_miembro_de_promocion(promocion_id));

drop policy if exists "leen aprobaciones" on public.aprobaciones;
create policy "leen aprobaciones" on public.aprobaciones for select to authenticated
	using (public.es_admin() or public.es_miembro_de_promocion(promocion_id));

create or replace function public.aprobadores_de(p_promocion text, p_tipo text)
returns table (user_id uuid, nombre text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso';
	end if;
	return query select * from public.aprobadores_requeridos(p_promocion, p_tipo);
end $$;
revoke all on function public.aprobadores_de(text, text) from public, anon;
grant execute on function public.aprobadores_de(text, text) to authenticated;

-- Sin cambios en lo que devuelve: solo deja de abrirse al robot.
create or replace function public.validacion_de_version(p_promocion text, p_version text, p_tipo text)
returns table (id bigint, clave text, titulo text, detalle text, viviendas text, orden integer, ruta text,
	miniatura text, huella text, vistas jsonb, estado text, requeridos integer, aprobados integer,
	personas jsonb, heredada_de text, completada_en timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if p_tipo not in ('planos', 'experiencia') then
		raise exception 'Tipo de validación no válido';
	end if;
	if not (public.es_admin()
		or (p_tipo = 'planos' and public.equipo_puede(p_promocion, 'planos'))
		or (p_tipo = 'experiencia' and public.es_miembro_de_promocion(p_promocion))) then
		raise exception 'Sin permiso';
	end if;
	return query
	select e.id, e.clave, coalesce(e.titulo, e.nombre), e.detalle, e.viviendas, e.orden, e.ruta, e.miniatura,
		e.huella, e.vistas, s.estado, s.requeridos, s.aprobados, s.personas, s.heredada_de, s.completada_en
	from public.entregables e
	cross join lateral public.estado_validacion(e.id) s
	where e.promocion_id = p_promocion and e.version = p_version
		and e.tipo = case p_tipo when 'planos' then 'plano' else 'experiencia' end
	order by e.orden, e.id;
end $$;

select 'Listo: permisos del robot ajustados' as resultado;
