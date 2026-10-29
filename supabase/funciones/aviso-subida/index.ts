// Función «aviso-subida» de Supabase: aviso por email al equipo de MUNE cada
// vez que una promotora sube un documento o valida un plano comercial o una
// tipología de la Experiencia 3D (aprueba o pide cambios; con { validacion_id }
// en lugar de { documento_id }). El aviso de validación dice el avance («1 de
// 2 aprobaciones»), la zona si la indicó, y si ya está todo validado.
//
// 1. La llama el portal justo después de subir o validar, con la sesión de
//    quien lo ha hecho.
// 2. marcar_aviso_subida / marcar_aviso_validacion comprueban que lo hizo esa
//    persona y que no se ha avisado ya: cada cosa avisa una sola vez.
// 3. Pide a GitHub que arranque .github/workflows/aviso-mune.yml del taller,
//    con la llave A (secreto GITHUB_EJECUTOR, que solo permite arrancar
//    procesos del taller). El email sale del Gmail de MUNE, uno por aviso.
// 4. Publicación al aprobar la promotora (022): si la promoción está en modo
//    «automatica» y con esta aprobación queda validado todo lo que MUNE envió
//    de la versión en revisión, arranca el ejecutor (publicar.yml) con esa
//    misma versión, como haría el botón «Publicar» de MUNE Studio. El ejecutor
//    vuelve a comprobar que es la versión revisada, y al terminar avisa por
//    email al equipo de la promotora y a MUNE.
//
// 5. Comentarios visuales (038): con { comentarios: <promoción> }, un solo email
//    con todo lo nuevo que ha comentado la promotora en esa promoción y aún no
//    se había avisado (marcar_aviso_comentarios). MUNE Portal lo pide dos
//    minutos después del último comentario o al cerrar la página, así que los
//    comentarios seguidos llegan juntos. Un «Pedir cambios» lleva también los
//    comentarios nuevos en su email.
//
// Las funciones de Supabase no pueden enviar email por SMTP (Gmail), por eso
// el email lo manda GitHub. No usa la clave de servicio.
//
// Se pega en Supabase → Edge Functions con el nombre «aviso-subida».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PROCESO = 'https://api.github.com/repos/MUNE-Projects/studio/actions/workflows/aviso-mune.yml/dispatches';
const PUBLICAR = 'https://api.github.com/repos/MUNE-Projects/studio/actions/workflows/publicar.yml/dispatches';
const STUDIO = Deno.env.get('STUDIO_URL') ?? 'https://studio.mune-projects.workers.dev/';
const REVISION = Deno.env.get('REVISION_ESCAPARATE') ?? 'https://revision-experience.mune-projects.workers.dev';
const ARCHIVO: Record<string, string> = { planos: 'planos/planos.json', experiencia: 'experiencia/experiencia.json' };
const ORIGENES = [
	'https://portal.mune-projects.workers.dev',
	'https://revision-portal.mune-projects.workers.dev',
	// Solo en el Supabase local de las pruebas: el portal en el ordenador de desarrollo.
	...(Deno.env.get('ORIGENES_EXTRA')?.split(',') ?? []),
];

const corto = (t: unknown, n: number) => String(t ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

Deno.serve(async (req) => {
	const origen = req.headers.get('origin') ?? '';
	const cors: Record<string, string> = {
		'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : ORIGENES[0],
		'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
		'Access-Control-Allow-Methods': 'POST, OPTIONS',
		Vary: 'Origin',
	};
	const responder = (estado: number, datos: Record<string, unknown>) =>
		new Response(JSON.stringify(datos), { status: estado, headers: { ...cors, 'Content-Type': 'application/json' } });

	if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
	if (req.method !== 'POST') return responder(405, { error: 'Método no permitido' });

	const auth = req.headers.get('authorization');
	if (!auth?.startsWith('Bearer ')) return responder(401, { error: 'Sin sesión' });
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, {
		global: { headers: { Authorization: auth } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	let documento: number;
	let validacion: number;
	let comentarios: string;
	try {
		const cuerpo = await req.json();
		documento = Number(cuerpo.documento_id);
		validacion = Number(cuerpo.validacion_id);
		comentarios = typeof cuerpo.comentarios === 'string' ? cuerpo.comentarios : '';
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const llamarGitHub = (url: string, inputs: Record<string, string>) => {
		const llave = Deno.env.get('GITHUB_EJECUTOR');
		if (!llave) return null;
		return fetch(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${llave}`,
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				'User-Agent': 'mune-portal',
			},
			body: JSON.stringify({ ref: 'main', inputs }),
		});
	};

	// Comentarios nuevos de la promotora (lo nuevo, todavía sin avisar), como líneas del email.
	type Nuevo = { version: string; tipo: string; clave: string | null; con_punto: boolean; texto: string; autor: string; respuesta: boolean; titulo: string | null };
	const lineasComentarios = (lista: Nuevo[]) => lista.map((c) => {
		const lugar = c.tipo === 'version' ? `la ${c.version}` : c.tipo === 'plano' ? `el plano «${corto(c.titulo ?? c.clave, 120)}»`
			: `el 3D de «${corto(c.clave === 'entorno' ? 'Entorno y elementos generales' : c.titulo ?? c.clave, 120)}»`;
		return `${corto(c.autor, 80)} ${c.respuesta ? 'responde' : 'comenta'} en ${lugar}${c.con_punto ? ' (en un punto marcado)' : ''}${c.tipo === 'version' ? '' : ` · ${c.version}`}:\n«${corto(c.texto, 400)}»`;
	});

	if (/^[a-z0-9][a-z0-9-]{0,79}$/.test(comentarios)) {
		const { data, error } = await sb.rpc('marcar_aviso_comentarios', { p_promocion: comentarios });
		if (error) return responder(403, { error: 'Sin permiso' });
		const lista = (data ?? []) as Nuevo[];
		if (!lista.length) return responder(200, { ok: true, avisado: false });
		const { data: promo } = await sb.from('promociones').select('nombre').eq('id', comentarios).maybeSingle();
		const nombre = corto(promo?.nombre, 120) || comentarios;
		const r = await llamarGitHub(PROCESO, {
			asunto: `${nombre} · ${lista.length === 1 ? '1 comentario nuevo' : `${lista.length} comentarios nuevos`}`,
			texto: [...lineasComentarios(lista).slice(0, 12), ...(lista.length > 12 ? [`Y ${lista.length - 12} más.`] : []),
				'Respóndelos y márcalos como resueltos en MUNE Studio, en «Resumen y versiones» de la promoción.'].join('\n\n'),
			enlace: `${STUDIO}#/promocion/${comentarios}/resumen`,
		});
		if (!r) return responder(500, { error: 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
		if (!r.ok) return responder(502, { error: `GitHub no ha aceptado el aviso (${r.status})` });
		return responder(200, { ok: true, avisado: true });
	}

	// Validación de un plano comercial o de la Experiencia 3D (aprobado o cambios pedidos)
	if (Number.isInteger(validacion) && validacion > 0) {
		const { data: toca, error: eMarca } = await sb.rpc('marcar_aviso_validacion', { p_validacion: validacion });
		if (eMarca) return responder(403, { error: 'Sin permiso' });
		if (toca !== true) return responder(200, { ok: true, avisado: false });
		const { data: v } = await sb.from('validaciones')
			.select('entregable_id, promocion_id, version, decision, comentario, zona, entregables(tipo, titulo, nombre, clave), promociones(nombre)')
			.eq('id', validacion).maybeSingle();
		if (!v) return responder(404, { error: 'No se encuentra la validación' });
		const fv = v as unknown as {
			entregable_id: number; promocion_id: string; version: string; decision: string; comentario: string | null; zona: string | null;
			entregables: { tipo: string; titulo: string | null; nombre: string } | null; promociones: { nombre: string } | null;
		};
		const tipo = fv.entregables?.tipo === 'experiencia' ? 'experiencia' : 'planos';
		const { data: { user } } = await sb.auth.getUser();
		const { data: persona } = await sb.from('miembros').select('nombre').eq('user_id', user?.id ?? '').limit(1).maybeSingle();

		// Avance de este elemento (con la sesión de quien valida: es aprobador, así que lo puede ver).
		const { data: filas } = await sb.rpc('validacion_de_version', { p_promocion: fv.promocion_id, p_version: fv.version, p_tipo: tipo });
		const fila = ((filas ?? []) as { id: number; estado: string; requeridos: number; aprobados: number }[]).find((x) => x.id === fv.entregable_id);
		const avance = fila && fila.requeridos > 0
			? `${fila.aprobados} de ${fila.requeridos} ${fila.requeridos === 1 ? 'aprobación' : 'aprobaciones'}` : '';

		// ¿Está todo validado? Las dos partes, o la otra sin enviar solo si la versión no la tiene.
		const lista = async (t: string) => {
			const { data, error } = await sb.rpc('validacion_lista', { p_promocion: fv.promocion_id, p_version: fv.version, p_tipo: t });
			return error ? null : String(data);
		};
		const otra = tipo === 'planos' ? 'experiencia' : 'planos';
		const [estaParte, otraParte] = await Promise.all([lista(tipo), lista(otra)]);
		const parteLista = estaParte === 'listos';
		let otraVale = otraParte === 'listos';
		if (parteLista && otraParte === 'sin_enviar') {
			const r = await fetch(`${REVISION}/${fv.promocion_id}/${ARCHIVO[otra]}`, { cache: 'no-store' }).catch(() => null);
			otraVale = r?.status === 404;
		}
		const todos = parteLista && otraVale;

		// Publicación al aprobar la promotora (solo la versión en revisión, la que MUNE envió).
		let publicando = false;
		if (todos && fv.decision === 'aprobado') {
			const { data: promo } = await sb.from('promociones').select('publicacion, promotora_id').eq('id', fv.promocion_id).maybeSingle();
			const enRevision = await fetch(`${REVISION}/${fv.promocion_id}/version.json`, { cache: 'no-store' })
				.then((r) => r.ok ? r.json() : null).catch(() => null) as { version?: string } | null;
			if (promo?.publicacion === 'automatica' && enRevision?.version === fv.version) {
				const { data: equipo } = await sb.rpc('equipo_de_promotora', { p_promotora: promo.promotora_id });
				const correos = [...new Set(((equipo ?? []) as { email: string; activo: boolean; promocion_id: string | null }[])
					.filter((m) => m.activo && (m.promocion_id === null || m.promocion_id === fv.promocion_id)).map((m) => m.email))].slice(0, 50);
				const r = await llamarGitHub(PUBLICAR, {
					accion: 'aprobar', promocion: fv.promocion_id, version: fv.version, motivo: '',
					por: 'Publicación al aprobar la promotora', solicitud: crypto.randomUUID(),
					avisar_para: correos.join(','), nombre: corto(fv.promociones?.nombre, 120),
				});
				publicando = !!r?.ok;
				if (r && !r.ok) console.error('publicar', r.status, await r.text());
			}
		}

		const elemento = tipo === 'experiencia'
			? `Experiencia 3D · ${corto(fv.entregables?.titulo ?? fv.entregables?.nombre, 160)}`
			: corto(fv.entregables?.titulo ?? fv.entregables?.nombre, 160);
		const quien = corto(persona?.nombre, 120) || 'Alguien de la promotora';
		const nombre = corto(fv.promociones?.nombre, 120);
		const lineas = [fv.decision === 'aprobado'
			? `${quien} ha aprobado «${elemento}» de la ${fv.version}${avance ? ` (${avance})` : ''}.${fila?.estado === 'aprobado' ? ' Queda validado.' : ''}`
			: `${quien} pide cambios en «${elemento}» de la ${fv.version}${fv.zona ? ` · ${corto(fv.zona, 120)}` : ''}:\n«${corto(fv.comentario, 500)}»`];
		// los comentarios nuevos van en este mismo email (los de este elemento ya van en la petición)
		if (fv.decision === 'rechazado') {
			const { data: nuevos } = await sb.rpc('marcar_aviso_comentarios', { p_promocion: fv.promocion_id });
			const clave = (fv.entregables as unknown as { clave?: string } | null)?.clave;
			const otros = ((nuevos ?? []) as Nuevo[]).filter((c) => !(c.tipo === (tipo === 'planos' ? 'plano' : 'experiencia') && c.clave === clave));
			if (otros.length) lineas.push(`Además, comentarios nuevos:\n\n${lineasComentarios(otros).slice(0, 8).join('\n\n')}`);
		}
		if (parteLista && !todos) lineas.push(tipo === 'experiencia' ? `Todas las tipologías de la Experiencia 3D de la ${fv.version} están aprobadas.` : `Todos los planos comerciales de la ${fv.version} están aprobados.`);
		if (todos) lineas.push(publicando
			? `Está todo validado: la ${fv.version} se está publicando sola. Te llegará otro email cuando esté en la web.`
			: `Está todo validado: ya puedes publicar la ${fv.version} desde MUNE Studio.`);
		const r = await llamarGitHub(PROCESO, {
			asunto: fv.decision === 'aprobado' ? `${nombre} · ${quien} aprueba «${elemento}» (${fv.version})` : `${nombre} · cambios pedidos en «${elemento}» (${fv.version})`,
			texto: lineas.join('\n\n'),
			enlace: `${STUDIO}#/promocion/${fv.promocion_id}/resumen`,
		});
		if (!r) return responder(500, { error: 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
		if (!r.ok) return responder(502, { error: `GitHub no ha aceptado el aviso (${r.status})` });
		return responder(200, { ok: true, avisado: true, publicando });
	}

	if (!Number.isInteger(documento) || documento <= 0) return responder(400, { error: 'Documento no válido' });

	const { data: toca, error: eMarca } = await sb.rpc('marcar_aviso_subida', { p_documento: documento });
	if (eMarca) return responder(403, { error: 'Sin permiso' });
	if (toca !== true) return responder(200, { ok: true, avisado: false });

	const { data: d } = await sb.from('documentos')
		.select('nombre, version, promocion_id, requisitos!documentos_requisito_id_fkey(elemento), promociones(nombre, promotoras(nombre))')
		.eq('id', documento).maybeSingle();
	const { data: { user } } = await sb.auth.getUser();
	const { data: persona } = await sb.from('miembros').select('nombre').eq('user_id', user?.id ?? '').limit(1).maybeSingle();
	if (!d) return responder(404, { error: 'No se encuentra el documento' });
	const fila = d as unknown as {
		nombre: string; version: number; promocion_id: string;
		requisitos: { elemento: string } | null; promociones: { nombre: string; promotoras: { nombre: string } | null } | null;
	};

	const nombre = corto(fila.promociones?.nombre, 120);
	const documentoNombre = corto(fila.requisitos?.elemento, 120);
	const quien = corto(persona?.nombre, 120) || 'Alguien';
	const promotora = corto(fila.promociones?.promotoras?.nombre, 120);
	const r = await llamarGitHub(PROCESO, {
		asunto: `${nombre} · documentación nueva: ${documentoNombre}`,
		texto: `${quien}${promotora ? ` (${promotora})` : ''} ha subido «${corto(fila.nombre, 200)}»${fila.version > 1 ? ` (versión ${fila.version})` : ''} en «${documentoNombre}».\n\nRevísalo en MUNE Studio, en la pestaña Documentación, o pídeme «revisa lo nuevo de ${nombre}».`,
		enlace: `${STUDIO}#/promocion/${fila.promocion_id}/documentacion`,
	});
	if (!r) return responder(500, { error: 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
	if (!r.ok) return responder(502, { error: `GitHub no ha aceptado el aviso (${r.status})` });
	return responder(200, { ok: true, avisado: true });
});
