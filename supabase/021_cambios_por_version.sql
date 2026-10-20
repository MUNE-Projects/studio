-- Fase 1 · paso 21: los cambios pedidos no pasan a la versión siguiente (12/10/2026).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 020. Es repetible.
--
-- · Una aprobación de una versión anterior con el mismo contenido sigue valiendo.
-- · Unos cambios pedidos en una versión anterior ya no cuentan en la nueva: la
--   versión nueva es la respuesta y el elemento vuelve a «Pendiente de validar».
-- · La petición anterior se sigue viendo («En la v9 pidió cambios: …») para
--   comprobar que está resuelta.
-- (020_equipos_y_validaciones.sql ya incluye este cambio.)

-- Recuento sin foto: aprobadores requeridos y la última decisión de cada uno.
-- Una aprobación de una versión anterior con el mismo contenido sigue valiendo.
-- Unos cambios pedidos en una versión anterior no: la versión nueva es la
-- respuesta a esa petición y hay que volver a validarla. La petición se
-- devuelve en «anterior» para tenerla presente al validar.
create or replace function public.recuento_validacion(p_entregable bigint)
returns table (requeridos int, aprobados int, cambios int, personas jsonb)
language sql
stable
security definer
set search_path = ''
as $$
	with e as (select * from public.entregables where id = p_entregable),
	req as (select r.* from e, public.aprobadores_requeridos(e.promocion_id, public.tipo_validacion(e.tipo)) r),
	ultimos as (
		select distinct on (v.user_id) v.user_id, v.entregable_id, v.decision, v.comentario, v.zona, v.momento, v.version
		from public.validaciones v
		join public.mismo_contenido(p_entregable) g on g.id = v.entregable_id
		order by v.user_id, v.momento desc),
	votos as (select * from ultimos where entregable_id = p_entregable or decision = 'aprobado'),
	anteriores as (select * from ultimos where entregable_id <> p_entregable and decision = 'rechazado')
	select
		(select count(*) from req)::int,
		(select count(*) from req join votos using (user_id) where votos.decision = 'aprobado')::int,
		(select count(*) from req join votos using (user_id) where votos.decision = 'rechazado')::int,
		coalesce((select jsonb_agg(jsonb_build_object(
			'user_id', req.user_id, 'nombre', req.nombre, 'decision', votos.decision, 'comentario', votos.comentario,
			'zona', votos.zona, 'momento', votos.momento, 'version', votos.version,
			'anterior', case when a.user_id is not null then jsonb_build_object(
				'comentario', a.comentario, 'zona', a.zona, 'momento', a.momento, 'version', a.version) end) order by req.nombre)
			from req left join votos using (user_id) left join anteriores a on a.user_id = req.user_id), '[]'::jsonb);
$$;
revoke all on function public.recuento_validacion(bigint) from public, anon, authenticated;

select 'Listo: los cambios pedidos se responden con la versión nueva' as resultado;
