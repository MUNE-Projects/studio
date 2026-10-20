-- Fase 1 · paso 8: ficha de la promoción y lista estándar de documentos.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 007. Es repetible.
--
-- Qué añade:
--  · Ficha de la promoción (la rellena la promotora en su portal, o la
--    administradora en el Panel): dirección, referencia catastral, tipo
--    (plurifamiliar o unifamiliar), número de viviendas, portales y plantas,
--    y fecha prevista de entrega. Se guarda solo con guardar_ficha_promocion.
--  · Lista estándar de documentos: aplicar_lista_estandar la añade a una
--    promoción que todavía no tiene lista (solo la administradora).
--  · Requisitos que se pueden quitar de la lista (sin borrarlos: dejan de
--    verse, y lo ya subido se conserva) y con plantilla para descargar.

-- ─── Ficha de la promoción ──────────────────────────────────────────────────

alter table public.promociones add column if not exists direccion text check (direccion is null or char_length(direccion) <= 200);
alter table public.promociones add column if not exists codigo_postal text check (codigo_postal is null or codigo_postal ~ '^[0-9]{5}$');
alter table public.promociones add column if not exists municipio text check (municipio is null or char_length(municipio) <= 120);
alter table public.promociones add column if not exists provincia text check (provincia is null or char_length(provincia) <= 120);
alter table public.promociones add column if not exists referencia_catastral text check (referencia_catastral is null or char_length(referencia_catastral) <= 40);
alter table public.promociones add column if not exists tipo text check (tipo is null or tipo in ('plurifamiliar', 'unifamiliar'));
alter table public.promociones add column if not exists num_viviendas int check (num_viviendas is null or num_viviendas between 1 and 5000);
alter table public.promociones add column if not exists num_portales int check (num_portales is null or num_portales between 1 and 500);
alter table public.promociones add column if not exists num_plantas int check (num_plantas is null or num_plantas between 1 and 100);
alter table public.promociones add column if not exists fecha_entrega date;

create or replace function public.guardar_ficha_promocion(
	p_promocion text, p_direccion text, p_codigo_postal text, p_municipio text, p_provincia text,
	p_referencia_catastral text, p_tipo text, p_num_viviendas int, p_num_portales int, p_num_plantas int,
	p_fecha_entrega date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not (public.es_admin() or public.es_miembro_de_promocion(p_promocion)) then
		raise exception 'Sin permiso para cambiar los datos de esta promoción';
	end if;
	update public.promociones set
		direccion = nullif(btrim(p_direccion), ''),
		codigo_postal = nullif(btrim(p_codigo_postal), ''),
		municipio = nullif(btrim(p_municipio), ''),
		provincia = nullif(btrim(p_provincia), ''),
		referencia_catastral = nullif(upper(replace(btrim(p_referencia_catastral), ' ', '')), ''),
		tipo = nullif(p_tipo, ''),
		num_viviendas = p_num_viviendas,
		num_portales = p_num_portales,
		num_plantas = p_num_plantas,
		fecha_entrega = p_fecha_entrega
	where id = p_promocion;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'ficha_promocion', jsonb_build_object('promocion', p_promocion));
end $$;
revoke all on function public.guardar_ficha_promocion(text, text, text, text, text, text, text, int, int, int, date) from public, anon;
grant execute on function public.guardar_ficha_promocion(text, text, text, text, text, text, text, int, int, int, date) to authenticated;

-- ─── Requisitos: quitar de la lista y plantilla ─────────────────────────────

alter table public.requisitos add column if not exists activo boolean not null default true;
alter table public.requisitos add column if not exists plantilla text check (plantilla is null or plantilla ~ '^/plantillas/[a-z0-9-]+\.(xlsx|pdf)$');
grant update (activo) on public.requisitos to authenticated;
grant insert (promocion_id, bloque, elemento, descripcion, obligatorio, orden, plantilla) on public.requisitos to authenticated;

-- La promotora solo ve los requisitos que siguen en la lista.
drop policy if exists "leen requisitos" on public.requisitos;
create policy "leen requisitos" on public.requisitos
	for select to authenticated
	using (public.es_admin() or public.es_robot() or (activo and public.es_miembro_de_promocion(promocion_id)));

-- ─── Lista estándar de documentos ───────────────────────────────────────────

create or replace function public.aplicar_lista_estandar(p_promocion text)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede preparar la lista de documentos';
	end if;
	if not exists (select 1 from public.promociones where id = p_promocion) then
		raise exception 'No existe esa promoción';
	end if;
	if exists (select 1 from public.requisitos where promocion_id = p_promocion and activo) then
		raise exception 'Esta promoción ya tiene lista de documentos';
	end if;
	insert into public.requisitos (promocion_id, bloque, elemento, descripcion, obligatorio, orden, plantilla)
	select p_promocion, l.bloque, l.elemento, coalesce(l.descripcion, ''), l.obligatorio, l.orden, l.plantilla
	from (values
		('Planos', 'Plano de situación o emplazamiento', 'En PDF; si lo tenéis, también en DWG.', true, 1, null),
		('Planos', 'Plano de urbanización o implantación', 'Parcela, zonas comunes y accesos. En PDF y, si lo tenéis, en DWG.', true, 2, null),
		('Planos', 'Planos de cada tipología, acotados', 'Uno por tipología, con cotas y superficies por estancia. En PDF y, si lo tenéis, en DWG.', true, 3, null),
		('Planos', 'Planos de plantas generales del edificio', 'Planta por planta. Solo en plurifamiliares.', false, 4, null),
		('Planos', 'Alzados y secciones', 'En PDF; si lo tenéis, también en DWG.', true, 5, null),
		('Planos', 'Planos de garajes y trasteros', 'Si la promoción los tiene.', false, 6, null),
		('Planos', 'Plano de cubiertas', null, false, 7, null),
		('Viviendas y superficies', 'Tabla de viviendas y tipologías (Excel)', 'Descargad la plantilla, rellenadla con todas las viviendas y subidla aquí.', true, 8, '/plantillas/tabla-viviendas.xlsx'),
		('Viviendas y superficies', 'Cuadro de superficies oficial del proyecto', null, true, 9, null),
		('Calidades', 'Memoria de calidades vigente', null, true, 10, null),
		('Proyecto', 'Proyecto básico o de ejecución', 'Como referencia, si lo tenéis disponible.', false, 11, null)
	) as l (bloque, elemento, descripcion, obligatorio, orden, plantilla);
	get diagnostics n = row_count;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'lista_estandar', jsonb_build_object('promocion', p_promocion, 'documentos', n));
	return n;
end $$;
revoke all on function public.aplicar_lista_estandar(text) from public, anon;
grant execute on function public.aplicar_lista_estandar(text) to authenticated;

select 'Listo: ficha de la promoción y lista estándar de documentos' as resultado;
