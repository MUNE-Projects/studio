-- Fase 1 · paso 9: aviso por email de cada documento subido (Etapa 3).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 008. Es repetible.
--
-- Cuando una persona de la promotora sube un documento, el portal llama a la
-- función «aviso-subida» de Supabase, que pide a GitHub que avise por email a
-- la administradora (igual que el aviso «versión lista para revisar»).
-- Para que cada documento avise una sola vez, y solo si lo pide quien lo
-- acaba de subir, la función usa marcar_aviso_subida.

alter table public.documentos add column if not exists avisado boolean not null default false;

-- Devuelve true solo la primera vez, solo a quien subió el documento y solo
-- durante los 30 minutos siguientes a la subida.
create or replace function public.marcar_aviso_subida(p_documento bigint)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
	n int;
begin
	update public.documentos set avisado = true
	where id = p_documento and not avisado
		and subido_por = auth.uid()
		and subido_en > now() - interval '30 minutes'
		and public.es_miembro_de_promocion(promocion_id);
	get diagnostics n = row_count;
	return n = 1;
end $$;
revoke all on function public.marcar_aviso_subida(bigint) from public, anon;
grant execute on function public.marcar_aviso_subida(bigint) to authenticated;

-- (El cambio de «avisado» no es una revisión: que no apunte revisado_por.)
create or replace function public.documento_revisado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
	if new.estado is distinct from old.estado or new.nota is distinct from old.nota then
		new.revisado_por := auth.uid();
		new.revisado_en  := now();
	end if;
	return new;
end $$;

select 'Listo: aviso por email de cada documento subido' as resultado;
