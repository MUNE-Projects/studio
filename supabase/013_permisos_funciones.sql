-- Fase 1 · paso 13: permisos de la cuenta interna de las funciones (service_role).
--
-- Se ejecuta una vez en Supabase → SQL Editor, después de 012. Es repetible.
--
-- En el proyecto real, la cuenta interna con la que trabajan las funciones de
-- Supabase no tenía permiso sobre estas tablas (en el Supabase local de las
-- pruebas sí lo tiene por defecto). «avisar-promotora» las necesita para leer
-- el documento, la promoción y el equipo, y para apuntar el aviso enviado.
-- Esa cuenta solo existe dentro de Supabase: no está en el navegador ni en GitHub.

grant select, insert, delete on public.avisos_enviados to service_role;
grant select on public.documentos, public.requisitos, public.promociones,
	public.promotoras, public.miembros, public.entregables to service_role;

select 'Listo: permisos de la función de avisos' as resultado;
