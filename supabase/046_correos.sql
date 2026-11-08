-- Correos de los avisos sin pasar por GitHub (decisión 71; preparado el 8/11/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 045. Es repetible.
--
-- Hasta ahora, las funciones «avisar-promotora» y «aviso-subida» pasaban a los
-- procesos de GitHub (aviso-promotora.yml, aviso-mune.yml y publicar.yml) los
-- correos de las personas, el asunto y el texto como datos de entrada, que se
-- quedan a la vista en el historial de GitHub. Ahora dejan cada email en este
-- buzón y al proceso solo le llega su número: el proceso entra con la cuenta
-- «ejecutor», lo lee, lo envía y lo borra. Lo que no se llega a enviar se borra
-- solo a los 2 días.

create table if not exists public.correos_pendientes (
	id        uuid primary key default gen_random_uuid(),
	para      text[] check (para is null or cardinality(para) between 1 and 50),  -- null: al equipo de MUNE (secreto AVISOS_MUNE_PARA)
	asunto    text not null check (char_length(asunto) between 1 and 200),
	texto     text not null check (char_length(texto) between 1 and 3000),
	enlace    text not null check (enlace ~ '^https://[a-z0-9-]+\.mune-projects\.workers\.dev/'),
	creado_en timestamptz not null default now()
);
alter table public.correos_pendientes enable row level security;
revoke all on public.correos_pendientes from anon, authenticated;
grant select, insert, delete on public.correos_pendientes to service_role;

-- El proceso de GitHub (cuenta «ejecutor») lee un email del buzón para enviarlo.
create or replace function public.correo_para_enviar(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
	c public.correos_pendientes%rowtype;
begin
	if not public.es_ejecutor() then raise exception 'Solo la cuenta ejecutor'; end if;
	delete from public.correos_pendientes where creado_en < now() - interval '2 days';
	select * into c from public.correos_pendientes where id = p_id;
	if not found then raise exception 'Ese email no está en el buzón (ya se envió o caducó)'; end if;
	return jsonb_build_object('para', to_jsonb(c.para), 'asunto', c.asunto, 'texto', c.texto, 'enlace', c.enlace);
end $$;
revoke all on function public.correo_para_enviar(uuid) from public, anon;
grant execute on function public.correo_para_enviar(uuid) to authenticated;

-- Enviado: se borra (no queda copia de los correos en Supabase ni en GitHub).
create or replace function public.correo_enviado(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
	if not public.es_ejecutor() then raise exception 'Solo la cuenta ejecutor'; end if;
	delete from public.correos_pendientes where id = p_id;
end $$;
revoke all on function public.correo_enviado(uuid) from public, anon;
grant execute on function public.correo_enviado(uuid) to authenticated;

select 'Listo: correos de los avisos sin pasar por GitHub' as resultado;
