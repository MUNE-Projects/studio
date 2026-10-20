-- Fase 1 · paso 5: cimientos del portal de promotoras.
--
-- Se ejecuta una vez en Supabase → SQL Editor. Es repetible: si se lanza de
-- nuevo no duplica nada ni pierde datos.
--
-- Qué añade:
--  · promotoras y promociones: activa sí/no (y estado visible de la promoción);
--  · miembros: qué persona pertenece a qué promotora y con qué rol
--    (gestor o aprobador);
--  · requisitos: la lista de lo que tiene que entregar cada promoción;
--  · documentos: cada archivo subido por la promotora, con su versión y su
--    huella. Solo se añaden filas; el estado (pendiente, vigente o rechazado)
--    lo cambian la administradora o el robot de Claude;
--  · entregables: planos, infografías y PDF conservados de cada versión;
--  · validaciones: aprobaciones y rechazos de planos, con la huella del
--    archivo exacto. Solo se añaden filas;
--  · almacenes privados «documentos» y «entregables».
--
-- Reglas (las comprueba el servidor, no la página):
--  · Una persona de una promotora solo ve las promociones activas de su
--    promotora activa, y sus documentos, archivos y entregables. Nada más.
--  · Solo puede subir a la carpeta de una promoción suya y activa. Lo subido
--    entra siempre como «pendiente».
--  · No puede cambiar estados, crear promociones, marcar documentos como
--    vigentes ni borrar nada. Nadie puede borrar desde la aplicación.
--  · Solo quien tiene el rol «aprobador» aprueba o rechaza planos.
--  · Robot de Claude (permiso aprobado el 6/10/2026): además de lo anterior,
--    lee requisitos, documentos y entregables y marca documentos como vigentes
--    o rechazados, con nota. No puede borrar, subir ni validar.
--  · Las subidas, los cambios de estado y las validaciones se anotan solos en
--    el registro de actividad.
--
-- Organización de los archivos:
--  · documentos/<promotora>/<promoción>/<requisito>/<archivo>
--  · entregables/<promoción>/<versión>/<archivo>

-- ─── Promotoras y promociones: activas y estado ─────────────────────────────

alter table public.promotoras add column if not exists activa boolean not null default true;
alter table public.promotoras add column if not exists cif text check (cif is null or char_length(cif) <= 20);

do $$
begin
	if not exists (
		select 1 from information_schema.columns
		where table_schema = 'public' and table_name = 'promociones' and column_name = 'estado'
	) then
		alter table public.promociones add column estado text not null default 'documentacion'
			check (estado in ('documentacion', 'en_produccion', 'en_validacion', 'publicada'));
		-- La promoción de demostración ya está publicada.
		update public.promociones set estado = 'publicada' where id = 'residencial-demo';
	end if;
end $$;
alter table public.promociones add column if not exists activa boolean not null default true;

-- ─── Miembros de cada promotora ─────────────────────────────────────────────

create table if not exists public.miembros (
	user_id      uuid not null references auth.users (id) on delete cascade,
	promotora_id uuid not null references public.promotoras (id),
	nombre       text not null check (char_length(nombre) between 1 and 120),
	email        text not null check (char_length(email) between 3 and 200),
	rol          text not null check (rol in ('gestor', 'aprobador')),
	activo       boolean not null default true,
	creado_en    timestamptz not null default now(),
	primary key (user_id, promotora_id)
);
alter table public.miembros enable row level security;

-- ¿La sesión actual puede ver esta promoción como miembro de su promotora?
-- (promoción activa, promotora activa y acceso activo)
create or replace function public.es_miembro_de_promocion(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.promociones pr
		join public.promotoras po on po.id = pr.promotora_id
		join public.miembros m on m.promotora_id = po.id
		where pr.id = p_promocion
			and pr.activa and po.activa
			and m.activo and m.user_id = auth.uid()
	);
$$;

-- Igual, pero además con rol «aprobador».
create or replace function public.es_aprobador_de_promocion(p_promocion text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.promociones pr
		join public.promotoras po on po.id = pr.promotora_id
		join public.miembros m on m.promotora_id = po.id
		where pr.id = p_promocion
			and pr.activa and po.activa
			and m.activo and m.rol = 'aprobador' and m.user_id = auth.uid()
	);
$$;

-- ¿La sesión actual es miembro activo de esta promotora activa?
create or replace function public.es_miembro_de_promotora(p_promotora uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
	select exists (
		select 1
		from public.promotoras po
		join public.miembros m on m.promotora_id = po.id
		where po.id = p_promotora and po.activa
			and m.activo and m.user_id = auth.uid()
	);
$$;

revoke all on function public.es_miembro_de_promocion(text) from public, anon;
revoke all on function public.es_aprobador_de_promocion(text) from public, anon;
revoke all on function public.es_miembro_de_promotora(uuid) from public, anon;
grant execute on function public.es_miembro_de_promocion(text) to authenticated;
grant execute on function public.es_aprobador_de_promocion(text) to authenticated;
grant execute on function public.es_miembro_de_promotora(uuid) to authenticated;

-- ─── Requisitos: lo que tiene que entregar cada promoción ───────────────────

create table if not exists public.requisitos (
	id           bigint generated always as identity primary key,
	promocion_id text not null references public.promociones (id),
	bloque       text not null check (char_length(bloque) between 1 and 80),
	elemento     text not null check (char_length(elemento) between 1 and 120),
	descripcion  text not null default '' check (char_length(descripcion) <= 1000),
	obligatorio  boolean not null default true,
	orden        int not null default 0,
	creado_en    timestamptz not null default now()
);
alter table public.requisitos enable row level security;

-- ─── Documentos subidos por la promotora (solo se añaden filas) ─────────────

create table if not exists public.documentos (
	id           bigint generated always as identity primary key,
	promocion_id text not null references public.promociones (id),
	requisito_id bigint not null references public.requisitos (id),
	nombre       text not null check (char_length(nombre) between 1 and 200),
	ruta         text not null unique check (char_length(ruta) <= 500),
	tipo         text not null default '' check (char_length(tipo) <= 120),
	tamano       bigint not null default 0 check (tamano >= 0),
	huella       text not null check (huella ~ '^[0-9a-f]{64}$'),
	version      int not null default 1,
	reemplaza_a  bigint references public.documentos (id),
	estado       text not null default 'pendiente' check (estado in ('pendiente', 'vigente', 'rechazado')),
	nota         text check (nota is null or char_length(nota) <= 2000),
	subido_por   uuid not null default auth.uid() references auth.users (id),
	subido_en    timestamptz not null default now(),
	revisado_por uuid references auth.users (id),
	revisado_en  timestamptz
);
alter table public.documentos enable row level security;

-- Al subir: la versión, a quién reemplaza, el estado y el autor los pone el
-- servidor; el requisito debe ser de esa promoción; y la ruta tiene que ser
-- un archivo que ya está en el almacén, dentro de la carpeta de ese requisito.
create or replace function public.documento_nuevo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	anterior public.documentos%rowtype;
	carpeta  text;
begin
	if not exists (select 1 from public.requisitos r where r.id = new.requisito_id and r.promocion_id = new.promocion_id) then
		raise exception 'El requisito no es de esta promoción';
	end if;

	select pr.promotora_id::text || '/' || pr.id || '/' || new.requisito_id::text || '/'
	into carpeta
	from public.promociones pr where pr.id = new.promocion_id;
	if carpeta is null or left(new.ruta, char_length(carpeta)) <> carpeta then
		raise exception 'La ruta del archivo no corresponde a este requisito';
	end if;
	if not exists (select 1 from storage.objects o where o.bucket_id = 'documentos' and o.name = new.ruta) then
		raise exception 'El archivo no está en el almacén';
	end if;

	select * into anterior from public.documentos d
	where d.promocion_id = new.promocion_id and d.requisito_id = new.requisito_id
	order by d.version desc limit 1;

	new.version      := coalesce(anterior.version, 0) + 1;
	new.reemplaza_a  := anterior.id;
	new.estado       := 'pendiente';
	new.nota         := null;
	new.subido_por   := auth.uid();
	new.subido_en    := now();
	new.revisado_por := null;
	new.revisado_en  := null;
	return new;
end $$;
drop trigger if exists documento_nuevo on public.documentos;
create trigger documento_nuevo before insert on public.documentos
	for each row execute function public.documento_nuevo();

-- Al revisar: se apunta quién y cuándo.
create or replace function public.documento_revisado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	new.revisado_por := auth.uid();
	new.revisado_en  := now();
	return new;
end $$;
drop trigger if exists documento_revisado on public.documentos;
create trigger documento_revisado before update on public.documentos
	for each row execute function public.documento_revisado();

-- ─── Entregables de cada versión ────────────────────────────────────────────

create table if not exists public.entregables (
	id           bigint generated always as identity primary key,
	promocion_id text not null references public.promociones (id),
	version      text not null check (version ~ '^v[0-9]{1,5}$'),
	tipo         text not null check (tipo in ('plano', 'infografia', 'pdf')),
	tipologia    text check (tipologia is null or char_length(tipologia) <= 60),
	nombre       text not null check (char_length(nombre) between 1 and 200),
	ruta         text not null unique check (char_length(ruta) <= 500),
	huella       text not null check (huella ~ '^[0-9a-f]{64}$'),
	creado_por   uuid not null default auth.uid() references auth.users (id),
	creado_en    timestamptz not null default now()
);
alter table public.entregables enable row level security;

-- ─── Validaciones de planos (solo se añaden filas) ──────────────────────────

create table if not exists public.validaciones (
	id            bigint generated always as identity primary key,
	entregable_id bigint not null unique references public.entregables (id),
	promocion_id  text not null references public.promociones (id),
	version       text not null,
	huella        text not null,
	decision      text not null check (decision in ('aprobado', 'rechazado')),
	confirmado    boolean not null default false,
	comentario    text check (comentario is null or char_length(comentario) <= 4000),
	user_id       uuid not null default auth.uid() references auth.users (id),
	momento       timestamptz not null default now(),
	check (decision <> 'aprobado' or confirmado),
	check (decision <> 'rechazado' or char_length(btrim(coalesce(comentario, ''))) >= 3)
);
alter table public.validaciones enable row level security;

-- La promoción, la versión y la huella se copian del plano validado: así
-- queda aprobado exactamente ese archivo, y nadie puede indicar otro.
create or replace function public.validacion_nueva()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
	e public.entregables%rowtype;
begin
	select * into e from public.entregables where id = new.entregable_id;
	if e.id is null or e.tipo <> 'plano' then
		raise exception 'Solo se validan planos';
	end if;
	new.promocion_id := e.promocion_id;
	new.version      := e.version;
	new.huella       := e.huella;
	new.user_id      := auth.uid();
	new.momento      := now();
	return new;
end $$;
drop trigger if exists validacion_nueva on public.validaciones;
create trigger validacion_nueva before insert on public.validaciones
	for each row execute function public.validacion_nueva();

-- ─── Registro automático ────────────────────────────────────────────────────

create or replace function public.anotar_portal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	-- Lo que se hace a mano en el SQL Editor no tiene sesión: no se anota aquí.
	if auth.uid() is null then
		return null;
	end if;
	-- (Cada tabla en su rama: plpgsql no permite mirar campos de otra tabla.)
	if tg_table_name = 'documentos' then
		if tg_op = 'INSERT' then
			insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'documento_subido',
				jsonb_build_object('documento', new.id, 'promocion', new.promocion_id, 'requisito', new.requisito_id,
					'nombre', new.nombre, 'version', new.version, 'huella', new.huella));
		elsif new.estado is distinct from old.estado then
			insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'documento_' || new.estado,
				jsonb_build_object('documento', new.id, 'promocion', new.promocion_id, 'antes', old.estado, 'nota', new.nota));
		end if;
	elsif tg_table_name = 'validaciones' then
		insert into public.registro (user_id, accion, detalle) values (auth.uid(), 'plano_' || new.decision,
			jsonb_build_object('validacion', new.id, 'entregable', new.entregable_id, 'promocion', new.promocion_id,
				'version', new.version, 'huella', new.huella));
	elsif tg_table_name = 'miembros' then
		insert into public.registro (user_id, accion, detalle) values (auth.uid(),
			case when tg_op = 'INSERT' then 'acceso_dado' else 'acceso_cambiado' end,
			jsonb_build_object('persona', new.user_id, 'promotora', new.promotora_id, 'rol', new.rol, 'activo', new.activo));
	end if;
	return null;
end $$;

drop trigger if exists anotar_documentos on public.documentos;
create trigger anotar_documentos after insert or update on public.documentos
	for each row execute function public.anotar_portal();
drop trigger if exists anotar_validaciones on public.validaciones;
create trigger anotar_validaciones after insert on public.validaciones
	for each row execute function public.anotar_portal();
drop trigger if exists anotar_miembros on public.miembros;
create trigger anotar_miembros after insert or update on public.miembros
	for each row execute function public.anotar_portal();

-- ─── Permisos por tabla ─────────────────────────────────────────────────────
-- Lo que no aparece aquí no se puede hacer. En ninguna tabla hay permiso de
-- borrar.

revoke all on public.promotoras, public.promociones, public.miembros, public.requisitos,
	public.documentos, public.entregables, public.validaciones from anon, authenticated;

grant select on public.promotoras, public.promociones, public.miembros, public.requisitos,
	public.documentos, public.entregables, public.validaciones to authenticated;

-- Administradora: alta y cambios (sin borrar).
grant insert (id, nombre, cif) on public.promotoras to authenticated;
grant update (nombre, cif, activa) on public.promotoras to authenticated;
grant insert (id, promotora_id, nombre, ubicacion, estado) on public.promociones to authenticated;
grant update (nombre, ubicacion, estado, activa) on public.promociones to authenticated;
grant insert (user_id, promotora_id, nombre, email, rol) on public.miembros to authenticated;
grant update (nombre, rol, activo) on public.miembros to authenticated;
grant insert (promocion_id, bloque, elemento, descripcion, obligatorio, orden) on public.requisitos to authenticated;
grant update (bloque, elemento, descripcion, obligatorio, orden) on public.requisitos to authenticated;
grant insert (promocion_id, version, tipo, tipologia, nombre, ruta, huella) on public.entregables to authenticated;

-- Promotora: subir documentos y validar planos.
grant insert (promocion_id, requisito_id, nombre, ruta, tipo, tamano, huella) on public.documentos to authenticated;
grant insert (entregable_id, decision, confirmado, comentario) on public.validaciones to authenticated;

-- Administradora y robot: revisar documentos (solo estado y nota).
grant update (estado, nota) on public.documentos to authenticated;

-- ─── Políticas: quién ve y quién escribe cada fila ──────────────────────────

-- promotoras
drop policy if exists "miembro lee su promotora" on public.promotoras;
create policy "miembro lee su promotora" on public.promotoras
	for select to authenticated using (public.es_miembro_de_promotora(id));
drop policy if exists "admin crea promotoras" on public.promotoras;
create policy "admin crea promotoras" on public.promotoras
	for insert to authenticated with check (public.es_admin());
drop policy if exists "admin cambia promotoras" on public.promotoras;
create policy "admin cambia promotoras" on public.promotoras
	for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- promociones («admin lee» y «robot lee» ya existen)
drop policy if exists "miembro lee sus promociones" on public.promociones;
create policy "miembro lee sus promociones" on public.promociones
	for select to authenticated using (public.es_miembro_de_promocion(id));
drop policy if exists "admin crea promociones" on public.promociones;
create policy "admin crea promociones" on public.promociones
	for insert to authenticated with check (public.es_admin());
drop policy if exists "admin cambia promociones" on public.promociones;
create policy "admin cambia promociones" on public.promociones
	for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- miembros: cada persona ve solo su propio acceso; la administradora, todos.
drop policy if exists "admin lee miembros" on public.miembros;
create policy "admin lee miembros" on public.miembros
	for select to authenticated using (public.es_admin());
drop policy if exists "miembro lee su acceso" on public.miembros;
create policy "miembro lee su acceso" on public.miembros
	for select to authenticated using (user_id = auth.uid() and activo);
drop policy if exists "admin da accesos" on public.miembros;
create policy "admin da accesos" on public.miembros
	for insert to authenticated with check (public.es_admin());
drop policy if exists "admin cambia accesos" on public.miembros;
create policy "admin cambia accesos" on public.miembros
	for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- requisitos
drop policy if exists "leen requisitos" on public.requisitos;
create policy "leen requisitos" on public.requisitos
	for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));
drop policy if exists "admin crea requisitos" on public.requisitos;
create policy "admin crea requisitos" on public.requisitos
	for insert to authenticated with check (public.es_admin());
drop policy if exists "admin cambia requisitos" on public.requisitos;
create policy "admin cambia requisitos" on public.requisitos
	for update to authenticated using (public.es_admin()) with check (public.es_admin());

-- documentos
drop policy if exists "leen documentos" on public.documentos;
create policy "leen documentos" on public.documentos
	for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));
drop policy if exists "miembro sube documentos" on public.documentos;
create policy "miembro sube documentos" on public.documentos
	for insert to authenticated with check (public.es_miembro_de_promocion(promocion_id));
drop policy if exists "admin y robot revisan documentos" on public.documentos;
create policy "admin y robot revisan documentos" on public.documentos
	for update to authenticated
	using (public.es_admin() or public.es_robot())
	with check (public.es_admin() or public.es_robot());

-- entregables
drop policy if exists "leen entregables" on public.entregables;
create policy "leen entregables" on public.entregables
	for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));
drop policy if exists "admin crea entregables" on public.entregables;
create policy "admin crea entregables" on public.entregables
	for insert to authenticated with check (public.es_admin());

-- validaciones
drop policy if exists "leen validaciones" on public.validaciones;
create policy "leen validaciones" on public.validaciones
	for select to authenticated
	using (public.es_admin() or public.es_robot() or public.es_miembro_de_promocion(promocion_id));
drop policy if exists "aprobador valida planos" on public.validaciones;
create policy "aprobador valida planos" on public.validaciones
	for insert to authenticated
	with check (public.es_aprobador_de_promocion(
		(select e.promocion_id from public.entregables e where e.id = entregable_id)));

-- ─── Almacenes de archivos (privados, sin dirección pública) ────────────────

insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos', 'documentos', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

insert into storage.buckets (id, name, public, file_size_limit)
values ('entregables', 'entregables', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- documentos/<promotora>/<promoción>/<requisito>/<archivo>
-- La promoción tiene que ser de esa promotora, y el requisito de esa promoción.
create or replace function public.carpeta_de_documentos_valida(p_ruta text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
	select pr.id
	from public.promociones pr
	join public.requisitos r on r.promocion_id = pr.id
	where pr.promotora_id::text = (storage.foldername(p_ruta))[1]
		and pr.id = (storage.foldername(p_ruta))[2]
		and r.id::text = (storage.foldername(p_ruta))[3]
		and array_length(storage.foldername(p_ruta), 1) = 3;
$$;
revoke all on function public.carpeta_de_documentos_valida(text) from public, anon;
grant execute on function public.carpeta_de_documentos_valida(text) to authenticated;

drop policy if exists "miembro sube a sus documentos" on storage.objects;
create policy "miembro sube a sus documentos" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'documentos'
		and public.es_miembro_de_promocion(public.carpeta_de_documentos_valida(name)));

drop policy if exists "ven documentos" on storage.objects;
create policy "ven documentos" on storage.objects
	for select to authenticated
	using (bucket_id = 'documentos' and (public.es_admin() or public.es_robot()
		or public.es_miembro_de_promocion(public.carpeta_de_documentos_valida(name))));

-- entregables/<promoción>/<versión>/<archivo>
drop policy if exists "admin sube entregables" on storage.objects;
create policy "admin sube entregables" on storage.objects
	for insert to authenticated
	with check (bucket_id = 'entregables' and public.es_admin());

drop policy if exists "ven entregables" on storage.objects;
create policy "ven entregables" on storage.objects
	for select to authenticated
	using (bucket_id = 'entregables' and (public.es_admin() or public.es_robot()
		or public.es_miembro_de_promocion((storage.foldername(name))[1])));

select 'Listo: portal de promotoras preparado (miembros, requisitos, documentos, entregables y validaciones)' as resultado;
