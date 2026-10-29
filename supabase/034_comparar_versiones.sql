-- Comparar versiones: lo privado (29/10/2026, decidido por la administradora).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 033. Es repetible.
--
-- Cada versión trae en su carpeta cambios/cambios.json lo que cambia respecto a
-- la publicada (estancias, superficies, huecos, equipamiento, acabados) y los
-- planos de antes y de ahora con las diferencias en rojo («preparar»,
-- herramientas/cambios.mjs). Lo privado se compara aquí, con los datos privados
-- de las dos versiones (024) y los ajustes de la promotora (029):
--  · el catálogo: opciones nuevas o quitadas, precios que cambian y lo que se
--    ofrece en cada tipología;
--  · los compradores afectados: quien tiene elegida una opción que en la versión
--    nueva ya no existe, ya no se ofrece en su vivienda o cambia de precio, para
--    avisarle. (Quien ya la eligió la conserva: 029.)
-- Lo ven MUNE Studio y el equipo de la promotora con «personalizacion».

-- 1900 → «1.900 €»; 1900.5 → «1.900,50 €»
create or replace function public._euros(n numeric)
returns text
language sql
immutable
set search_path = ''
as $$
	select regexp_replace(translate(to_char(coalesce(n, 0), 'FM999,999,990.00'), ',.', '.,'), ',00$', '') || ' €';
$$;
revoke all on function public._euros(numeric) from public, anon, authenticated;

create or replace function public.comparar_version(p_promocion text, p_version text, p_anterior text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	da jsonb;
	db jsonb;
	ca jsonb;
	cb jsonb;
	oa jsonb;
	ob jsonb;
	t jsonb;
	ta jsonb;
	v jsonb;
	s record;
	cat text;
	elegida text;
	permitidas jsonb;
	nombre_cat text;
	precio_antes numeric;
	catalogo jsonb := '[]'::jsonb;
	tipologias jsonb := '[]'::jsonb;
	afectados jsonb := '[]'::jsonb;
	problemas jsonb;
	nombre_de jsonb;
begin
	if not (public.es_admin() or public.equipo_puede(p_promocion, 'personalizacion')) then
		raise exception 'No tienes acceso a la personalización de esta promoción';
	end if;
	select public._aplicar_catalogo(p_promocion, dp.contenido) into db from public.datos_privados dp
	where dp.promocion_id = p_promocion and dp.version = p_version;
	select public._aplicar_catalogo(p_promocion, dp.contenido) into da from public.datos_privados dp
	where dp.promocion_id = p_promocion and dp.version = p_anterior;
	if db is null then
		return jsonb_build_object('version', p_version, 'anterior', p_anterior, 'sin_datos', true);
	end if;

	-- ── el catálogo (solo si hay versión anterior con datos)
	if da is not null then
		for cb in select x from jsonb_array_elements(coalesce(db->'catalogo'->'categorias', '[]'::jsonb)) x loop
			select x into ca from jsonb_array_elements(coalesce(da->'catalogo'->'categorias', '[]'::jsonb)) x where x->>'id' = cb->>'id';
			if ca is null then
				catalogo := catalogo || to_jsonb(format('Nueva categoría: %s (%s opciones).', cb->>'nombre', jsonb_array_length(coalesce(cb->'opciones', '[]'::jsonb))));
				continue;
			end if;
			for ob in select x from jsonb_array_elements(coalesce(cb->'opciones', '[]'::jsonb)) x loop
				select x into oa from jsonb_array_elements(coalesce(ca->'opciones', '[]'::jsonb)) x where x->>'id' = ob->>'id';
				if oa is null then
					catalogo := catalogo || to_jsonb(format('%s: nueva opción %s (%s).', cb->>'nombre', ob->>'nombre', public._euros((ob->>'precio')::numeric)));
				elsif coalesce((oa->>'precio')::numeric, 0) <> coalesce((ob->>'precio')::numeric, 0) then
					catalogo := catalogo || to_jsonb(format('%s · %s: %s → %s.', cb->>'nombre', ob->>'nombre',
						public._euros((oa->>'precio')::numeric), public._euros((ob->>'precio')::numeric)));
				end if;
			end loop;
			for oa in select x from jsonb_array_elements(coalesce(ca->'opciones', '[]'::jsonb)) x loop
				if not exists (select 1 from jsonb_array_elements(coalesce(cb->'opciones', '[]'::jsonb)) x where x->>'id' = oa->>'id') then
					catalogo := catalogo || to_jsonb(format('%s: se quita la opción %s.', cb->>'nombre', oa->>'nombre'));
				end if;
			end loop;
		end loop;
		for ca in select x from jsonb_array_elements(coalesce(da->'catalogo'->'categorias', '[]'::jsonb)) x loop
			if not exists (select 1 from jsonb_array_elements(coalesce(db->'catalogo'->'categorias', '[]'::jsonb)) x where x->>'id' = ca->>'id') then
				catalogo := catalogo || to_jsonb(format('Se quita la categoría %s.', ca->>'nombre'));
			end if;
		end loop;

		-- lo que se ofrece en cada tipología
		for t in select x from jsonb_array_elements(coalesce(db->'tipologias', '[]'::jsonb)) x loop
			select x into ta from jsonb_array_elements(coalesce(da->'tipologias', '[]'::jsonb)) x where x->>'id' = t->>'id';
			continue when ta is null;
			for cat in select jsonb_object_keys(coalesce(t->'opciones', '{}'::jsonb)) union select jsonb_object_keys(coalesce(ta->'opciones', '{}'::jsonb)) loop
				select coalesce(x->>'nombre', cat) into nombre_cat from jsonb_array_elements(coalesce(db->'catalogo'->'categorias', '[]'::jsonb)) x where x->>'id' = cat;
				for elegida in select jsonb_array_elements_text(coalesce(t->'opciones'->cat, '[]'::jsonb))
					except select jsonb_array_elements_text(coalesce(ta->'opciones'->cat, '[]'::jsonb)) loop
					tipologias := tipologias || to_jsonb(format('Tipología %s · %s: ahora se ofrece %s.', upper(t->>'id'), coalesce(nombre_cat, cat),
						coalesce((select o->>'nombre' from jsonb_array_elements(coalesce(db->'catalogo'->'categorias', '[]'::jsonb)) k,
							jsonb_array_elements(k->'opciones') o where k->>'id' = cat and o->>'id' = elegida limit 1), elegida)));
				end loop;
				for elegida in select jsonb_array_elements_text(coalesce(ta->'opciones'->cat, '[]'::jsonb))
					except select jsonb_array_elements_text(coalesce(t->'opciones'->cat, '[]'::jsonb)) loop
					tipologias := tipologias || to_jsonb(format('Tipología %s · %s: ya no se ofrece %s.', upper(t->>'id'), coalesce(nombre_cat, cat),
						coalesce((select o->>'nombre' from jsonb_array_elements(coalesce(da->'catalogo'->'categorias', '[]'::jsonb)) k,
							jsonb_array_elements(k->'opciones') o where k->>'id' = cat and o->>'id' = elegida limit 1), elegida)));
				end loop;
			end loop;
		end loop;
	end if;

	-- ── los compradores afectados: lo que tienen elegido, en la versión nueva
	for s in select sc.vivienda_ref, sc.pack, sc.estado, sc.opciones, sc.detalle from public.selecciones_comprador sc
		where sc.promocion_id = p_promocion
			and sc.comprador = coalesce((select cc.comprador from public.codigos_comprador cc
				where cc.promocion_id = sc.promocion_id and cc.vivienda_ref = sc.vivienda_ref and cc.activo limit 1), sc.comprador)
		order by sc.vivienda_ref, sc.pack loop
		problemas := '[]'::jsonb;
		select x into v from jsonb_array_elements(coalesce(db->'viviendas', '[]'::jsonb)) x where x->>'ref' = s.vivienda_ref;
		if v is null then
			afectados := afectados || jsonb_build_array(jsonb_build_object('vivienda', s.vivienda_ref, 'pack', s.pack, 'estado', s.estado,
				'problemas', jsonb_build_array('La vivienda ya no está en la versión nueva.')));
			continue;
		end if;
		select x into t from jsonb_array_elements(coalesce(db->'tipologias', '[]'::jsonb)) x where x->>'id' = v->>'tipologia';
		for cat, elegida in select key, value from jsonb_each_text(coalesce(s.opciones, '{}'::jsonb)) loop
			select x into cb from jsonb_array_elements(coalesce(db->'catalogo'->'categorias', '[]'::jsonb)) x where x->>'id' = cat;
			nombre_de := (select d from jsonb_array_elements(coalesce(s.detalle, '[]'::jsonb)) d where d->>'categoria' = cat limit 1);
			if cb is null then
				problemas := problemas || to_jsonb(format('%s: la categoría ya no está en el catálogo.', coalesce(nombre_de->>'nombre_categoria', cat)));
				continue;
			end if;
			select x into ob from jsonb_array_elements(coalesce(cb->'opciones', '[]'::jsonb)) x where x->>'id' = elegida;
			if ob is null then
				problemas := problemas || to_jsonb(format('%s: «%s» ya no existe.', cb->>'nombre', coalesce(nombre_de->>'nombre', elegida)));
				continue;
			end if;
			permitidas := coalesce(v->'opciones'->cat, t->'opciones'->cat, '[]'::jsonb);
			if not permitidas ? elegida then
				problemas := problemas || to_jsonb(format('%s: «%s» ya no se ofrece en esta vivienda (la conserva).', cb->>'nombre', ob->>'nombre'));
			end if;
			precio_antes := (nombre_de->>'precio')::numeric;
			if precio_antes is not null and precio_antes <> coalesce((ob->>'precio')::numeric, 0) then
				problemas := problemas || to_jsonb(format('%s: «%s» costaba %s y ahora %s.', cb->>'nombre', ob->>'nombre',
					public._euros(precio_antes), public._euros((ob->>'precio')::numeric)));
			end if;
		end loop;
		if jsonb_array_length(problemas) > 0 then
			afectados := afectados || jsonb_build_array(jsonb_build_object('vivienda', s.vivienda_ref, 'pack', s.pack, 'estado', s.estado, 'problemas', problemas));
		end if;
	end loop;

	return jsonb_build_object('version', p_version, 'anterior', p_anterior, 'sin_anterior', da is null,
		'catalogo', catalogo, 'tipologias', tipologias, 'afectados', afectados);
end $$;
revoke all on function public.comparar_version(text, text, text) from public, anon;
grant execute on function public.comparar_version(text, text, text) to authenticated;

select 'Listo: comparar versiones (catálogo y compradores afectados)' as resultado;
