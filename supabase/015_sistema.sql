-- Fase 1 · paso 15: bandeja de Inicio y avisos del sistema (Etapa 6).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 014. Es repetible.
--
-- · Llaves del sistema con su fecha de caducidad. Cuando se renueva una, se
--   apunta la fecha nueva en el Panel (Sistema → «Ya la he renovado»).
-- · Latido: el proceso «vigilancia.yml» de GitHub llama a latido() cada 3 días.
--   Así Supabase no se duerme (el plan gratuito se pausa tras 7 días sin uso)
--   y, si una llave está a punto de caducar o Supabase no responde, GitHub
--   abre un aviso y te llega el email.
-- · avisos_sistema(): lo que el Inicio del Panel enseña arriba (llaves, espacio
--   usado, vigilancia parada, invitaciones sin aceptar y accesos sin uso).
--   Solo la administradora.

-- ─── Llaves ─────────────────────────────────────────────────────────────────

create table if not exists public.llaves (
	id          text primary key check (id ~ '^[a-z0-9-]{1,40}$'),
	nombre      text not null,
	para_que    text not null,
	donde       text not null,
	caduca      date not null,
	renovada_en timestamptz
);
alter table public.llaves enable row level security;
revoke all on public.llaves from anon, authenticated;
grant select on public.llaves to authenticated;
drop policy if exists "admin lee llaves" on public.llaves;
create policy "admin lee llaves" on public.llaves for select to authenticated using (public.es_admin());

insert into public.llaves (id, nombre, para_que, donde, caduca) values
	('llave-a', 'Llave A · GITHUB_EJECUTOR', 'Publicar y volver atrás desde el Panel, y los avisos por email',
		'Supabase → Edge Functions → Secrets', date '2027-10-07'),
	('llave-b', 'Llave B · ESCAPARATE_TOKEN', 'Copiar la web al escaparate al publicar',
		'GitHub, almacén taller → Settings → Secrets and variables → Actions', date '2027-10-07')
on conflict (id) do nothing;

create or replace function public.renovar_llave(p_id text, p_caduca date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede cambiar las llaves';
	end if;
	if p_caduca is null or p_caduca <= current_date or p_caduca > current_date + 400 then
		raise exception 'Fecha no válida: tiene que ser futura y como mucho dentro de un año';
	end if;
	update public.llaves set caduca = p_caduca, renovada_en = now() where id = p_id;
	if not found then
		raise exception 'Esa llave no existe';
	end if;
	insert into public.registro (user_id, accion, detalle)
	values (auth.uid(), 'apunta una llave renovada', jsonb_build_object('llave', p_id, 'caduca', p_caduca));
end $$;
revoke all on function public.renovar_llave(text, date) from public, anon;
grant execute on function public.renovar_llave(text, date) to authenticated;

-- ─── Latido de la vigilancia automática ─────────────────────────────────────

create table if not exists public.latido (
	id      int primary key default 1 check (id = 1),
	ultimo  timestamptz not null default now(),
	veces   bigint not null default 0
);
alter table public.latido enable row level security;
revoke all on public.latido from anon, authenticated;

-- La llama vigilancia.yml con la clave pública (sin sesión). Solo apunta la
-- hora (como mucho una vez por hora) y devuelve cuántos días faltan para que
-- caduque la primera llave: nada más.
create or replace function public.latido()
returns int
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
	insert into public.latido (id, ultimo, veces) values (1, now(), 1)
	on conflict (id) do update set ultimo = now(), veces = public.latido.veces + 1
		where public.latido.ultimo < now() - interval '1 hour';
	return (select min(caduca) - current_date from public.llaves);
end $$;
revoke all on function public.latido() from public;
grant execute on function public.latido() to anon, authenticated;

-- ─── Avisos del sistema (Inicio del Panel) ──────────────────────────────────
-- nivel: 'alerta' (hay que actuar ya), 'aviso' (pronto) o 'info'.

create or replace function public.avisos_sistema()
returns table (clave text, nivel text, titulo text, detalle text, enlace text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
	l record;
	dias int;
	ultimo timestamptz;
	usado bigint;
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede ver los avisos del sistema';
	end if;

	-- Llaves: alerta a 30 días o menos, aviso a 60
	for l in select * from public.llaves order by caduca loop
		dias := l.caduca - current_date;
		if dias <= 60 then
			clave := 'llave:' || l.id;
			nivel := case when dias <= 30 then 'alerta' else 'aviso' end;
			titulo := case when dias < 0 then l.nombre || ' ha caducado'
				when dias = 0 then l.nombre || ' caduca hoy'
				else l.nombre || ' caduca en ' || dias || ' días' end;
			detalle := 'Sirve para: ' || l.para_que || '. Hay que crear una nueva en GitHub y guardarla en ' || l.donde
				|| '. Sigue la receta 19 (o pídele a Claude que te guíe) y luego apunta la fecha nueva en Sistema.';
			enlace := '#/sistema';
			return next;
		end if;
	end loop;

	-- Vigilancia automática: debería dar señales cada 3 días
	select la.ultimo into ultimo from public.latido la where la.id = 1;
	if ultimo is null or ultimo < now() - interval '4 days' then
		clave := 'latido';
		nivel := 'aviso';
		titulo := 'La vigilancia automática no da señales';
		detalle := case when ultimo is null then 'Todavía no ha llamado nunca.'
			else 'La última vez fue el ' || to_char(ultimo at time zone 'Europe/Madrid', 'DD/MM/YYYY') || '.' end
			|| ' Es el proceso de GitHub que mantiene despierto Supabase y avisa de las llaves. Díselo a Claude.';
		enlace := '#/sistema';
		return next;
	end if;

	-- Espacio del plan gratuito: base de datos 500 MB, archivos 1 GB
	usado := pg_database_size(current_database());
	if usado > 0.8 * 500 * 1024 * 1024 then
		clave := 'espacio:datos';
		nivel := case when usado > 0.95 * 500 * 1024 * 1024 then 'alerta' else 'aviso' end;
		titulo := 'La base de datos está al ' || round(100.0 * usado / (500 * 1024 * 1024)) || ' %';
		detalle := 'El plan gratuito de Supabase permite 500 MB. Habla con Claude antes de que se llene.';
		enlace := '#/sistema';
		return next;
	end if;
	select coalesce(sum((o.metadata->>'size')::bigint), 0) into usado from storage.objects o;
	if usado > 0.8 * 1024 * 1024 * 1024 then
		clave := 'espacio:archivos';
		nivel := case when usado > 0.95 * 1024 * 1024 * 1024 then 'alerta' else 'aviso' end;
		titulo := 'Los archivos ocupan el ' || round(100.0 * usado / (1024 * 1024 * 1024)) || ' % del espacio';
		detalle := 'El plan gratuito de Supabase permite 1 GB de archivos (documentación, planos y fotos). Habla con Claude antes de que se llene.';
		enlace := '#/sistema';
		return next;
	end if;

	-- Invitaciones sin aceptar desde hace más de 7 días, por promotora
	for l in
		select p.id, p.nombre, count(*) as n
		from public.miembros m
		join public.promotoras p on p.id = m.promotora_id
		join auth.users u on u.id = m.user_id
		where m.activo and u.email_confirmed_at is null and m.creado_en < now() - interval '7 days'
		group by p.id, p.nombre order by p.nombre
	loop
		clave := 'invitaciones:' || l.id;
		nivel := 'info';
		titulo := l.nombre || ': ' || l.n || case when l.n = 1 then ' invitación sin aceptar' else ' invitaciones sin aceptar' end;
		detalle := 'Hace más de una semana que se enviaron. Puedes reenviarlas desde la promotora.';
		enlace := '#/promotora/' || l.id;
		return next;
	end loop;

	-- Accesos que nadie usa desde hace más de 90 días, por promotora
	for l in
		select p.id, p.nombre, count(*) as n
		from public.miembros m
		join public.promotoras p on p.id = m.promotora_id
		join auth.users u on u.id = m.user_id
		where m.activo and u.email_confirmed_at is not null
			and coalesce(u.last_sign_in_at, m.creado_en) < now() - interval '90 days'
		group by p.id, p.nombre order by p.nombre
	loop
		clave := 'sin-uso:' || l.id;
		nivel := 'info';
		titulo := l.nombre || ': ' || l.n || case when l.n = 1 then ' acceso sin usar' else ' accesos sin usar' end || ' desde hace más de 3 meses';
		detalle := 'Si esa persona ya no trabaja en la promoción, quítale el acceso.';
		enlace := '#/promotora/' || l.id;
		return next;
	end loop;
end $$;
revoke all on function public.avisos_sistema() from public, anon;
grant execute on function public.avisos_sistema() to authenticated;

-- ─── Estado del sistema (sección Sistema del Panel) ─────────────────────────

create or replace function public.estado_sistema()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
	if not public.es_admin() then
		raise exception 'Solo la administradora puede ver el estado del sistema';
	end if;
	return jsonb_build_object(
		'datos', pg_database_size(current_database()),
		'datos_limite', 500::bigint * 1024 * 1024,
		'archivos', (select coalesce(sum((o.metadata->>'size')::bigint), 0) from storage.objects o),
		'archivos_limite', 1024::bigint * 1024 * 1024,
		'latido', (select la.ultimo from public.latido la where la.id = 1),
		'llaves', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'nombre', l.nombre, 'para_que', l.para_que,
			'donde', l.donde, 'caduca', l.caduca, 'renovada_en', l.renovada_en) order by l.caduca, l.id) from public.llaves l), '[]'::jsonb));
end $$;
revoke all on function public.estado_sistema() from public, anon;
grant execute on function public.estado_sistema() to authenticated;

select 'Listo: avisos del sistema' as resultado;
