-- Los datos de cada promoción, fuera de GitHub (auditoría de seguridad del
-- 28/10/2026, propuesta 1; aprobado por la administradora el 29/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 034 (o de 033, si 034 aún no está). Es repetible.
--
-- Lo que el equipo de MUNE saca de los planos y la memoria de cada promoción
-- (promocion.json, catalogo.json, tipologías, alternativas, ambientación…) ya
-- no se guarda en GitHub, sino aquí:
--  · la versión de trabajo: cada vez que se guarda, una fila nueva (solo se
--    añaden filas; la última es la vigente);
--  · cada versión preparada (v1, v2…): una copia exacta de los datos con los
--    que se preparó, y el commit del código usado. No se puede cambiar nunca.
-- Claude trabaja en una carpeta de su ordenador que nunca va a GitHub
-- (herramientas/promociones.mjs bajar | subir).
--
-- Quién: solo la administradora (con el código del móvil) y el robot de Claude
-- leen y guardan. Nadie de las promotoras lo ve. Al borrar una promoción, se
-- borra todo lo suyo de aquí.
--
-- Permiso nuevo del robot (aprobado el 29/10/2026): guardar los datos de una
-- promoción y los de cada versión que prepara. No puede cambiar ni borrar
-- los de una versión ya preparada.

create table if not exists public.modelo_promocion (
	id           bigint generated always as identity primary key,
	promocion_id text not null references public.promociones (id) on delete cascade,
	-- null: la versión de trabajo; vN: la copia de una versión preparada
	version      text check (version is null or version ~ '^v[0-9]{1,5}$'),
	-- { "promocion.json": "<texto del archivo>", "tipologias/a/vivienda.json": "…" }
	archivos     jsonb not null check (jsonb_typeof(archivos) = 'object' and pg_column_size(archivos) < 20000000),
	huella       text not null check (huella ~ '^[0-9a-f]{64}$'),
	-- commit del código de MUNE con el que se preparó la versión
	codigo       text check (codigo is null or codigo ~ '^[0-9a-f]{40}$'),
	nota         text not null default '' check (char_length(nota) <= 500),
	guardado_por uuid not null default auth.uid() references auth.users (id),
	guardado_en  timestamptz not null default now()
);
create unique index if not exists modelo_promocion_version on public.modelo_promocion (promocion_id, version) where version is not null;
create index if not exists modelo_promocion_trabajo on public.modelo_promocion (promocion_id, id desc) where version is null;
alter table public.modelo_promocion enable row level security;
revoke all on public.modelo_promocion from anon, authenticated;
grant select on public.modelo_promocion to authenticated;
drop policy if exists "MUNE lee los datos de las promociones" on public.modelo_promocion;
create policy "MUNE lee los datos de las promociones" on public.modelo_promocion
	for select to authenticated using (public.es_admin() or public.es_robot());

-- Guarda los datos de una promoción: la versión de trabajo (p_version null) o
-- la copia de una versión preparada (p_version = vN, con el commit del código).
-- Cada archivo es texto JSON, con una ruta sencilla dentro de la promoción.
create or replace function public.guardar_modelo_promocion(
	p_promocion text, p_archivos jsonb, p_version text default null, p_codigo text default null, p_nota text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
	v_huella text;
	r record;
	n int := 0;
begin
	if not (public.es_admin() or public.es_robot()) then
		raise exception 'Solo MUNE puede guardar los datos de una promoción';
	end if;
	if not exists (select 1 from public.promociones where id = p_promocion) then
		raise exception 'Esa promoción no existe';
	end if;
	if jsonb_typeof(p_archivos) is distinct from 'object' or not (p_archivos ? 'promocion.json') then
		raise exception 'Faltan los datos de la promoción (promocion.json)';
	end if;
	for r in select key, value from jsonb_each(p_archivos) loop
		n := n + 1;
		if r.key !~ '^[A-Za-z0-9_-][A-Za-z0-9_.-]*(/[A-Za-z0-9_-][A-Za-z0-9_.-]*)*\.json$' or r.key ~ '(^|/)\.\.?(/|$)' or char_length(r.key) > 200 then
			raise exception 'Nombre de archivo no válido: %', left(r.key, 200);
		end if;
		if jsonb_typeof(r.value) <> 'string' then
			raise exception 'El archivo % tiene que ir como texto', r.key;
		end if;
		begin
			perform (r.value #>> '{}')::jsonb;
		exception when others then
			raise exception 'El archivo % no es un JSON válido', r.key;
		end;
	end loop;
	if n > 500 then
		raise exception 'Demasiados archivos (% > 500)', n;
	end if;
	if p_version is not null then
		if p_version !~ '^v[0-9]{1,5}$' then
			raise exception 'Versión no válida';
		end if;
		if coalesce(p_codigo, '') !~ '^[0-9a-f]{40}$' then
			raise exception 'Falta el commit del código con el que se prepara la versión';
		end if;
		if exists (select 1 from public.modelo_promocion f where f.promocion_id = p_promocion and f.version = p_version) then
			raise exception 'Los datos de la % ya están guardados y no se pueden cambiar', p_version;
		end if;
	elsif p_codigo is not null then
		raise exception 'El commit del código solo va con una versión';
	end if;
	if char_length(coalesce(p_nota, '')) > 500 then
		raise exception 'La nota es demasiado larga';
	end if;

	v_huella := encode(sha256(convert_to(p_archivos::text, 'UTF8')), 'hex');
	insert into public.modelo_promocion (promocion_id, version, archivos, huella, codigo, nota, guardado_por)
	values (p_promocion, p_version, p_archivos, v_huella, p_codigo, coalesce(p_nota, ''), auth.uid());
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), case when p_version is null then 'guarda los datos de una promoción' else 'guarda los datos de una versión' end,
		jsonb_build_object('promocion', p_promocion, 'version', p_version, 'archivos', n, 'huella', left(v_huella, 12)));
	return v_huella;
end $$;
revoke all on function public.guardar_modelo_promocion(text, jsonb, text, text, text) from public, anon;
grant execute on function public.guardar_modelo_promocion(text, jsonb, text, text, text) to authenticated;

select 'Listo: datos de las promociones fuera de GitHub' as resultado;
