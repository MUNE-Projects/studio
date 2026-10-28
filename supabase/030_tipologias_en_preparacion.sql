-- Lista maestra · paso 8b: en qué tipologías se ofrece lo que está en preparación
-- (decidido por la administradora el 28/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 029. Es repetible.
--
-- Las restricciones de la personalización son por tipología, no por vivienda
-- concreta, y no hay reglas entre opciones. Lo que ya está en el catálogo se
-- ajusta por tipología desde 029 (columna «Tipologías»). Ahora la promotora
-- también marca las tipologías de una opción mientras está en preparación, y
-- MUNE la prepara solo para esas (opciones_pedidas_pendientes las da). Sin
-- marcar ninguna, se ofrece en todas.

alter table public.opciones_pedidas add column if not exists tipologias text[];

create or replace function public.catalogo_de_promocion(p_promocion text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	d jsonb;
	e jsonb;
begin
	if not (public.es_admin() or public.es_robot() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	-- sin versión preparada todavía: catálogo vacío (la promotora ya puede añadir sus primeras opciones)
	d := public._datos_o_vacio(p_promocion);
	e := public._aplicar_catalogo(p_promocion, d);
	return jsonb_build_object(
		'hoy', public._hoy_espana(),
		'catalogo', e->'catalogo',
		-- los packs con todas sus categorías, también las que están en preparación
		'packs', public._packs_de(p_promocion, d),
		-- categorías nuevas en preparación: { id: nombre }
		'en_preparacion', public._categorias_en_preparacion(p_promocion),
		-- en qué tipologías se ofrece cada opción ahora, y cuál es la incluida de cada tipología
		'tipologias', coalesce(e->'tipologias', '[]'::jsonb),
		'tipologias_version', coalesce(d->'tipologias', '[]'::jsonb),
		'lanzadas', coalesce((select jsonb_agg(c->>'id') from jsonb_array_elements(coalesce(d->'catalogo'->'categorias', '[]'::jsonb)) c
			where public._categoria_lanzada(p_promocion, e, c->>'id')), '[]'::jsonb),
		'packs_actualizado', (select jsonb_build_object('en', pp.actualizado_en, 'por',
			case when public.es_admin_usuario(pp.actualizado_por) then 'MUNE' else 'la promotora' end)
			from public.packs_promocion pp where pp.promocion_id = p_promocion),
		'cambios', coalesce((select jsonb_agg(jsonb_build_object('categoria', ca.categoria, 'opcion', ca.opcion,
			'actualizado_en', ca.actualizado_en, 'por', case when public.es_admin_usuario(ca.actualizado_por) then 'MUNE' else 'la promotora' end)
			order by ca.actualizado_en desc)
			from public.catalogo_ajustes ca where ca.promocion_id = p_promocion), '[]'::jsonb),
		'pedidas', coalesce((select jsonb_agg(jsonb_build_object('id', op.id, 'categoria', op.categoria, 'nombre', op.nombre,
			'descripcion', op.descripcion, 'precio', op.precio, 'pedido_en', op.pedido_en, 'estado', op.estado, 'nota', op.nota,
			'archivos', op.archivos, 'categoria_nueva', op.categoria_nueva, 'tipologias', op.tipologias)
			order by op.pedido_en desc)
			from public.opciones_pedidas op where op.promocion_id = p_promocion), '[]'::jsonb));
end $$;
revoke all on function public.catalogo_de_promocion(text) from public, anon;
grant execute on function public.catalogo_de_promocion(text) to authenticated;

-- Guarda los cambios de la sección «Catálogo y precios», todos o ninguno.
-- p_cambios: [{ categoria, opcion, nombre?, detalle?, precio?, ofrecida?, tipologias? }]
-- o, para cambiar el nombre de una categoría: [{ categoria, nombre_categoria }]
-- o, para una opción en preparación: [{ pedida, nombre?, detalle?, precio?, tipologias? }] y,
-- para retirarla, [{ pedida, quitar: true }]
create or replace function public.guardar_catalogo(p_promocion text, p_cambios jsonb)
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
	d jsonb;
	e jsonb;
	x jsonb;
	k jsonb;
	o jsonb;
	t jsonb;
	n int := 0;
	v_tipologias text[];
	v_precio numeric;
	pe public.opciones_pedidas%rowtype;
	nuevas jsonb := public._categorias_en_preparacion(p_promocion);
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso al catálogo de esta promoción';
	end if;
	if jsonb_typeof(p_cambios) is distinct from 'array' or jsonb_array_length(p_cambios) > 500 then
		raise exception 'Cambios no válidos';
	end if;
	d := public._datos_o_vacio(p_promocion);
	e := public._aplicar_catalogo(p_promocion, d);

	for x in select y from jsonb_array_elements(p_cambios) y loop
		v_tipologias := null;
		-- una opción en preparación: los compradores aún no la ven, así que todo se puede cambiar
		if x ? 'pedida' then
			select * into pe from public.opciones_pedidas op
			where op.id = (x->>'pedida')::bigint and op.promocion_id = p_promocion and op.estado = 'pendiente';
			if pe.id is null then
				raise exception 'Esa opción ya no está en preparación';
			end if;
			if (x->>'quitar')::boolean then
				update public.opciones_pedidas set estado = 'descartada', atendido_en = now(),
					nota = case when public.es_admin() then 'Retirada por MUNE' else 'Retirada por la promotora' end
				where id = pe.id;
				-- su categoría nueva, si ya no le queda nada, sale de los packs
				if pe.categoria_nueva is not null and not exists (select 1 from public.opciones_pedidas op
					where op.promocion_id = p_promocion and op.categoria = pe.categoria and op.estado in ('pendiente', 'hecha'))
					and not exists (select 1 from jsonb_array_elements(e->'catalogo'->'categorias') c where c->>'id' = pe.categoria) then
					update public.packs_promocion pp set packs = coalesce((select jsonb_agg(p || jsonb_build_object('categorias', public._sin(p->'categorias', pe.categoria)))
						from jsonb_array_elements(pp.packs) p
						where not ((p->>'individual')::boolean and p->'categorias' ? pe.categoria)), '[]'::jsonb)
					where pp.promocion_id = p_promocion;
				end if;
			else
				if x ? 'nombre' and char_length(btrim(coalesce(x->>'nombre', ''))) not between 1 and 80 then
					raise exception 'Escribe el nombre de la opción (como mucho, 80 letras)';
				end if;
				if x ? 'detalle' and char_length(coalesce(x->>'detalle', '')) > 1000 then
					raise exception 'La descripción de «%» es demasiado larga', pe.nombre;
				end if;
				if x ? 'precio' then
					v_precio := round((x->>'precio')::numeric, 2);
					if v_precio is null or v_precio < 0 or v_precio > 10000000 then
						raise exception 'El precio de «%» no es válido', pe.nombre;
					end if;
				end if;
				if x ? 'tipologias' then
					select array_agg(y) into v_tipologias from jsonb_array_elements_text(x->'tipologias') y;
					if v_tipologias is null then
						raise exception 'Elige al menos una tipología para «%»', pe.nombre;
					end if;
					if exists (select 1 from unnest(v_tipologias) y where not exists (
						select 1 from jsonb_array_elements(coalesce(d->'tipologias', '[]'::jsonb)) tt where tt->>'id' = y)) then
						raise exception 'Esa tipología no está en la promoción';
					end if;
				end if;
				update public.opciones_pedidas set
					tipologias = case when x ? 'tipologias' then v_tipologias else tipologias end,
					nombre = case when x ? 'nombre' then btrim(x->>'nombre') else nombre end,
					descripcion = case when x ? 'detalle' then nullif(btrim(coalesce(x->>'detalle', '')), '') else descripcion end,
					precio = case when x ? 'precio' then v_precio else precio end
				where id = pe.id;
			end if;
			n := n + 1;
			continue;
		end if;
		select c into k from jsonb_array_elements(e->'catalogo'->'categorias') c where c->>'id' = x->>'categoria' limit 1;
		-- nombre de la categoría (también de una nueva en preparación)
		if x ? 'nombre_categoria' and x->>'opcion' is null then
			if k is null and not nuevas ? (x->>'categoria') then raise exception 'Esa categoría no está en el catálogo'; end if;
			if char_length(btrim(coalesce(x->>'nombre_categoria', ''))) not between 1 and 60 then
				raise exception 'Escribe el nombre de la categoría (como mucho, 60 letras)';
			end if;
			insert into public.catalogo_categorias as cc (promocion_id, categoria, nombre, actualizado_por, actualizado_en)
			values (p_promocion, x->>'categoria', btrim(x->>'nombre_categoria'), auth.uid(), now())
			on conflict (promocion_id, categoria) do update set nombre = excluded.nombre, actualizado_por = excluded.actualizado_por, actualizado_en = now();
			if k is null then
				update public.opciones_pedidas set categoria_nueva = btrim(x->>'nombre_categoria')
				where promocion_id = p_promocion and categoria = x->>'categoria' and estado = 'pendiente' and categoria_nueva is not null;
			end if;
			n := n + 1;
			continue;
		end if;
		select op into o from jsonb_array_elements(coalesce(k->'opciones', '[]'::jsonb)) op where op->>'id' = x->>'opcion' limit 1;
		if o is null then
			raise exception 'Esa opción no está en el catálogo';
		end if;
		-- una mejora lanzada nunca cambia de precio
		if x ? 'precio' then
			v_precio := round((x->>'precio')::numeric, 2);
			if v_precio < 0 or v_precio > 10000000 then
				raise exception 'El precio de «%» no es válido', o->>'nombre';
			end if;
			if v_precio <> coalesce((o->>'precio')::numeric, 0) and public._categoria_lanzada(p_promocion, e, k->>'id') then
				raise exception 'La categoría «%» ya está abierta a los compradores: sus precios ya no se pueden cambiar', k->>'nombre';
			end if;
		end if;
		if x ? 'tipologias' then
			select array_agg(y) into v_tipologias from jsonb_array_elements_text(x->'tipologias') y;
		end if;
		-- la opción incluida de serie (la primera de una tipología) no se puede quitar de esa tipología
		for t in select y from jsonb_array_elements(coalesce(d->'tipologias', '[]'::jsonb)) y loop
			if t->'opciones'->(k->>'id')->>0 = o->>'id'
				and ((x->>'ofrecida')::boolean is false or (x ? 'tipologias' and not (t->>'id') = any (coalesce(v_tipologias, '{}')))) then
				raise exception '«%» es la opción incluida de serie: no se puede dejar de ofrecer', o->>'nombre';
			end if;
		end loop;
		insert into public.catalogo_ajustes as ca (promocion_id, categoria, opcion, nombre, detalle, precio, ofrecida, tipologias, actualizado_por, actualizado_en)
		values (p_promocion, k->>'id', o->>'id',
			nullif(btrim(x->>'nombre'), ''), case when x ? 'detalle' then btrim(coalesce(x->>'detalle', '')) end,
			case when x ? 'precio' then v_precio end, (x->>'ofrecida')::boolean,
			case when x ? 'tipologias' then coalesce(v_tipologias, '{}') end, auth.uid(), now())
		on conflict (promocion_id, categoria, opcion) do update set
			nombre = coalesce(excluded.nombre, ca.nombre),
			detalle = case when x ? 'detalle' then excluded.detalle else ca.detalle end,
			precio = case when x ? 'precio' then excluded.precio else ca.precio end,
			ofrecida = case when x ? 'ofrecida' then excluded.ofrecida else ca.ofrecida end,
			tipologias = case when x ? 'tipologias' then excluded.tipologias else ca.tipologias end,
			actualizado_por = excluded.actualizado_por, actualizado_en = now();
		n := n + 1;
	end loop;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'cambia el catálogo', jsonb_build_object('promocion', p_promocion, 'cambios', n,
		'opciones', (select jsonb_agg(case when y ? 'pedida' then 'en preparación:' || (y->>'pedida') || case when (y->>'quitar')::boolean then ':retirada' else '' end
			else y->>'categoria' || ':' || coalesce(y->>'opcion', 'nombre') end) from jsonb_array_elements(p_cambios) y)));
	return n;
end $$;
revoke all on function public.guardar_catalogo(text, jsonb) from public, anon;
grant execute on function public.guardar_catalogo(text, jsonb) to authenticated;

create or replace function public.opciones_pedidas_pendientes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo MUNE ve las opciones pedidas de todas las promociones';
	end if;
	return coalesce((select jsonb_agg(jsonb_build_object('id', op.id, 'promocion_id', op.promocion_id, 'promocion', pr.nombre,
		-- categoria: el identificador que hay que usar al prepararla (también si es nueva)
		'nombre', op.nombre, 'categoria', op.categoria, 'categoria_nombre', coalesce(cc.nombre, op.categoria_nueva, op.categoria),
		'categoria_nueva', op.categoria_nueva is not null, 'precio', op.precio, 'descripcion', op.descripcion,
		'archivos', op.archivos, 'pedido_en', op.pedido_en,
		-- en qué tipologías se ofrecerá (null: en todas)
		'tipologias', op.tipologias,
		-- con qué fechas se elegirá: su pack (o «por separado»)
		'pack', (select jsonb_build_object('id', p->>'id', 'titulo', p->>'titulo', 'desde', p->>'desde', 'hasta', p->>'hasta')
			from jsonb_array_elements(coalesce(pp.packs, '[]'::jsonb)) p where p->'categorias' ? op.categoria limit 1)) order by op.pedido_en)
		from public.opciones_pedidas op join public.promociones pr on pr.id = op.promocion_id
		left join public.catalogo_categorias cc on cc.promocion_id = op.promocion_id and cc.categoria = op.categoria
		left join public.packs_promocion pp on pp.promocion_id = op.promocion_id
		where op.estado = 'pendiente'), '[]'::jsonb);
end $$;
revoke all on function public.opciones_pedidas_pendientes() from public, anon;
grant execute on function public.opciones_pedidas_pendientes() to authenticated;

select 'Listo: tipologías de lo que está en preparación' as resultado;
