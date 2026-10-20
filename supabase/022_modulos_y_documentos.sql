-- Fase 1 · paso 22: módulos de cada promoción, modo de publicación y
-- documentos que cubren varios requisitos (12/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 021. Es repetible.
--
-- 1. Módulos de cada promoción (los activa o desactiva MUNE Studio):
--    · Experience pública: si está apagada, las direcciones públicas dejan de
--      funcionar (se aplica cuando la Experience del Portal sea privada).
--    · Acceso comprador: sin él no hay códigos ni puerta de comprador.
--    · Personalización: independiente de los otros dos.
--    La Experience profesional del Portal no tiene interruptor.
-- 2. Modo de publicación: «automatica» (al validar la promotora todo lo que
--    MUNE le envió, se publica esa misma versión) o «manual» (publica MUNE
--    Studio con el botón). El visto bueno de MUNE es enviar a validar.
-- 3. Un archivo puede cubrir varios requisitos de la lista de documentos: la
--    lista es de información, no de archivos.
-- 4. La relación de viviendas ya no lleva plantilla de MUNE.

-- ═══ 1 y 2. Módulos y modo de publicación ═══════════════════════════════════

alter table public.promociones add column if not exists modulos jsonb not null
	default '{"experiencia_publica": true, "acceso_comprador": true, "personalizacion": true}'::jsonb;
alter table public.promociones drop constraint if exists promociones_modulos_check;
alter table public.promociones add constraint promociones_modulos_check check (
	jsonb_typeof(modulos) = 'object'
	and jsonb_typeof(modulos->'experiencia_publica') = 'boolean'
	and jsonb_typeof(modulos->'acceso_comprador') = 'boolean'
	and jsonb_typeof(modulos->'personalizacion') = 'boolean');
alter table public.promociones add column if not exists publicacion text not null default 'automatica';
alter table public.promociones drop constraint if exists promociones_publicacion_check;
alter table public.promociones add constraint promociones_publicacion_check check (publicacion in ('automatica', 'manual'));

create or replace function public.modulo_activo(p_promocion text, p_modulo text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select coalesce((select (p.modulos->>p_modulo)::boolean from public.promociones p where p.id = p_promocion), false);
$$;
revoke all on function public.modulo_activo(text, text) from public;
grant execute on function public.modulo_activo(text, text) to anon, authenticated, service_role;

create or replace function public.guardar_modulos(
	p_promocion text, p_experiencia_publica boolean, p_acceso_comprador boolean, p_personalizacion boolean, p_publicacion text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	antes jsonb;
	nuevos jsonb := jsonb_build_object('experiencia_publica', coalesce(p_experiencia_publica, true),
		'acceso_comprador', coalesce(p_acceso_comprador, true), 'personalizacion', coalesce(p_personalizacion, true));
begin
	if not public.es_admin() then
		raise exception 'Solo MUNE Studio activa o desactiva partes de una promoción';
	end if;
	if p_publicacion not in ('automatica', 'manual') then
		raise exception 'Modo de publicación no válido';
	end if;
	select modulos into antes from public.promociones where id = p_promocion for update;
	if not found then
		raise exception 'No existe esa promoción';
	end if;
	update public.promociones set modulos = nuevos, publicacion = p_publicacion where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'modulos', jsonb_build_object('promocion', p_promocion, 'antes', antes, 'ahora', nuevos, 'publicacion', p_publicacion));
end $$;
revoke all on function public.guardar_modulos(text, boolean, boolean, boolean, text) from public, anon;
grant execute on function public.guardar_modulos(text, boolean, boolean, boolean, text) to authenticated;

-- Sin «Acceso comprador» no se crean códigos…
create or replace function public.codigo_con_acceso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.modulo_activo(new.promocion_id, 'acceso_comprador') then
		raise exception 'Esta promoción no tiene activado el acceso de compradores';
	end if;
	return new;
end $$;
drop trigger if exists codigo_con_acceso on public.codigos_comprador;
create trigger codigo_con_acceso before insert on public.codigos_comprador
	for each row execute function public.codigo_con_acceso();

-- …ni se entra con ellos (igual que en 016, con la comprobación del módulo).
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
		and cc.promocion_id = p_promocion and cc.activo and pr.activa
		and coalesce((pr.modulos->>'acceso_comprador')::boolean, true);

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

-- ═══ 3. Un archivo que cubre varios requisitos ══════════════════════════════
-- El archivo se sube en un requisito (el principal) y se marca qué otros
-- requisitos de la lista también cubre. Un requisito cubierto así cuenta como
-- entregado, con el estado del archivo (pendiente, vigente o rechazado).

create table if not exists public.documento_cubre (
	documento_id bigint not null references public.documentos (id) on delete cascade,
	requisito_id bigint not null references public.requisitos (id) on delete cascade,
	primary key (documento_id, requisito_id)
);
create index if not exists documento_cubre_requisito on public.documento_cubre (requisito_id);
alter table public.documento_cubre enable row level security;
revoke all on public.documento_cubre from anon, authenticated;
grant select on public.documento_cubre to authenticated;
grant select on public.documento_cubre to service_role;
drop policy if exists "leen lo que cubre cada documento" on public.documento_cubre;
create policy "leen lo que cubre cada documento" on public.documento_cubre for select to authenticated
	using (exists (select 1 from public.documentos d where d.id = documento_id
		and (public.es_admin() or public.es_robot() or public.equipo_puede(d.promocion_id, 'documentacion'))));

-- Marca (o cambia) qué otros requisitos cubre un archivo.
create or replace function public.cubrir_requisitos(p_documento bigint, p_requisitos bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
	d public.documentos%rowtype;
begin
	select * into d from public.documentos where id = p_documento;
	if d.id is null then
		raise exception 'No existe ese documento';
	end if;
	if not (public.es_admin() or public.equipo_puede(d.promocion_id, 'documentacion')) then
		raise exception 'Sin permiso para cambiar los documentos de esta promoción';
	end if;
	if exists (select 1 from unnest(coalesce(p_requisitos, '{}')) r(id)
		where not exists (select 1 from public.requisitos q where q.id = r.id and q.promocion_id = d.promocion_id and q.activo)) then
		raise exception 'Alguno de esos documentos no es de la lista de esta promoción';
	end if;
	delete from public.documento_cubre where documento_id = p_documento;
	insert into public.documento_cubre (documento_id, requisito_id)
	select p_documento, r.id from unnest(coalesce(p_requisitos, '{}')) r(id)
	where r.id <> d.requisito_id
	on conflict do nothing;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'documento_cubre', jsonb_build_object('promocion', d.promocion_id, 'documento', p_documento, 'requisitos', to_jsonb(coalesce(p_requisitos, '{}'))));
end $$;
revoke all on function public.cubrir_requisitos(bigint, bigint[]) from public, anon;
grant execute on function public.cubrir_requisitos(bigint, bigint[]) to authenticated;

-- Al sustituir un archivo por una versión nueva, la nueva cubre lo mismo.
create or replace function public.cubre_lo_mismo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.reemplaza_a is not null then
		insert into public.documento_cubre (documento_id, requisito_id)
		select new.id, c.requisito_id from public.documento_cubre c
		where c.documento_id = new.reemplaza_a and c.requisito_id <> new.requisito_id
		on conflict do nothing;
	end if;
	return null;
end $$;
drop trigger if exists cubre_lo_mismo on public.documentos;
create trigger cubre_lo_mismo after insert on public.documentos
	for each row execute function public.cubre_lo_mismo();

-- ═══ 4. La relación de viviendas sin plantilla ══════════════════════════════

-- Lista estándar: la relación de viviendas ya no lleva plantilla.
drop function if exists public.lista_estandar();
create function public.lista_estandar()
returns table (bloque text, elemento text, descripcion text, obligatorio boolean, orden int, plantilla text, varios boolean, contenidos text[])
language sql
immutable
set search_path = ''
as $$
	values
		('Planos', 'Plano de situación o emplazamiento',
			'Sitúa la parcela en su entorno. En PDF y, si lo tienes, también en DWG.', true, 1, null::text, false, '{}'::text[]),
		('Planos', 'Plano de urbanización o implantación',
			'Parcela, zonas comunes, accesos y viales interiores. En PDF y, si lo tienes, también en DWG.', true, 2, null, false, '{}'),
		('Planos', 'Planos de cada tipología, acotados',
			'Uno por tipología, con cotas y superficies por estancia. Añade un archivo por tipología e indica cuál es. En PDF y, si lo tienes, también en DWG.', true, 3, null, true,
			'{"Plano de tipología","Otro"}'),
		('Planos', 'Planos de plantas generales del edificio',
			'Planta por planta, con la posición de cada vivienda. Solo en plurifamiliares. En PDF y, si lo tienes, también en DWG.', false, 4, null, true,
			'{"Planta general","Otro"}'),
		('Planos', 'Alzados y secciones',
			'Fachadas y secciones con sus alturas. En PDF y, si lo tienes, también en DWG.', true, 5, null, true,
			'{"Alzado","Sección","Otro"}'),
		('Planos', 'Planos de garajes y trasteros',
			'Si la promoción los tiene, con la numeración de plazas y trasteros. En PDF y, si lo tienes, también en DWG.', false, 6, null, true,
			'{"Planta de garaje","Trasteros","Otro"}'),
		('Planos', 'Plano de cubiertas',
			'Si aplica, con la geometría de cubiertas, huecos y elementos relevantes. En PDF y, si lo tienes, también en DWG.', false, 7, null, false, '{}'),
		('Viviendas y superficies', 'Relación de viviendas, tipologías y superficies',
			'Todas las viviendas con su tipología, su planta y sus superficies. En el formato que ya tengas (Excel, PDF, el listado comercial…): no hace falta adaptarlo a MUNE.', true, 8, null, false, '{}'),
		('Viviendas y superficies', 'Cuadro de superficies oficial del proyecto',
			'Documento vigente con las superficies oficiales de las viviendas, tipologías y espacios del proyecto.', true, 9, null, false, '{}'),
		('Calidades', 'Memoria de calidades técnica',
			'No la memoria comercial de la promoción. Sube la documentación técnica vigente que defina con precisión los elementos que debemos reproducir: '
			|| 'dimensiones, espesores, formatos, sistemas, materiales, acabados, marcas, modelos y referencias cuando estén definidos. '
			|| 'Por ejemplo: ventanas (medidas, perfil, sistema, vidrio y acabado), puertas (medidas, modelo, acabado y herrajes), pavimentos (material, formato, espesor y acabado), '
			|| 'cocinas, sanitarios, griferías, barandillas y revestimientos. Puede estar en la memoria técnica, el proyecto, los cuadros de carpinterías y de acabados, '
			|| 'los detalles constructivos o las fichas técnicas de los fabricantes: no hace falta reorganizarla para MUNE. Añade cada archivo por separado e indica qué contiene.',
			true, 10, null, true,
			'{"Memoria técnica","Cuadro de carpinterías","Cuadro de acabados","Detalles constructivos","Fichas técnicas de fabricantes","Otro"}')
$$;
revoke all on function public.lista_estandar() from public, anon;

update public.requisitos
set elemento = 'Relación de viviendas, tipologías y superficies', plantilla = null,
	descripcion = 'Todas las viviendas con su tipología, su planta y sus superficies. En el formato que ya tengas (Excel, PDF, el listado comercial…): no hace falta adaptarlo a MUNE.'
where elemento = 'Tabla de viviendas y tipologías (Excel)';

select 'Listo: módulos, modo de publicación y documentos que cubren varios requisitos' as resultado;
