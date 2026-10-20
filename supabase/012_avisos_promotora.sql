-- Fase 1 · paso 12: avisos por email a la promotora.
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 011. Es repetible.
--
-- La función «avisar-promotora» envía (a través de GitHub y el Gmail de MUNE)
-- un email al equipo de una promoción cuando:
--   · hay planos nuevos para validar (al pulsar «Enviar los planos a la promotora»);
--   · se rechaza un documento (con la nota);
--   · se publica una versión.
-- Esta tabla guarda qué avisos se han enviado, para no repetir ninguno. Solo la
-- lee la administradora; la escribe la función.

create table if not exists public.avisos_enviados (
	id            bigint generated always as identity primary key,
	tipo          text not null check (tipo in ('planos', 'rechazado', 'publicada')),
	clave         text not null check (char_length(clave) <= 120),
	promocion_id  text not null,
	destinatarios int not null default 0,
	enviado_en    timestamptz not null default now(),
	unique (tipo, clave)
);
alter table public.avisos_enviados enable row level security;
revoke all on public.avisos_enviados from anon, authenticated;
grant select on public.avisos_enviados to authenticated;

drop policy if exists "admin lee avisos" on public.avisos_enviados;
create policy "admin lee avisos" on public.avisos_enviados
	for select to authenticated using (public.es_admin());

select 'Listo: avisos por email a la promotora' as resultado;
