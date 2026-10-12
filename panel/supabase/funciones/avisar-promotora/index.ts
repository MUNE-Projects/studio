// Función «avisar-promotora» de Supabase: email a quien tiene que actuar.
//
//   { tipo: 'planos', promocion, version }      planos comerciales para validar (MUNE Studio)
//   { tipo: 'experiencia', promocion, version } Experiencia 3D para validar (MUNE Studio)
//   { tipo: 'publicada', promocion, version }   versión publicada (MUNE Studio)
//   { tipo: 'rechazado', documento_id }         documento rechazado, con su nota
//                                               (MUNE Studio o robot de Claude)
//
// A quién (decisión 40): planos y Experiencia 3D, solo a las personas que
// tienen que validarlos (sus aprobadores). Si la promotora aún no los ha
// definido, a quien administra la promoción, para que los defina. Versión
// publicada: a todo el equipo de la promoción. Documento rechazado: a quien
// tiene la capacidad «Documentación» o administra.
//
// 1. Comprueba quién llama: la administradora (con el código del móvil) o, solo
//    para «rechazado», el robot de Claude.
// 2. Comprueba que lo que se avisa es cierto (hay planos de esa versión, la web
//    ya está en esa versión, el documento está rechazado) y que no se avisó ya.
// 3. Busca los correos con la clave de servicio, que Supabase da a la función
//    y no sale de aquí: quien llama nunca ve los correos.
// 4. Pide a GitHub que arranque .github/workflows/aviso-promotora.yml, que
//    envía el email desde el Gmail de MUNE (contraseña de aplicación guardada
//    como secreto AVISOS_GMAIL_CLAVE en GitHub). Sin coste.
//
// Se pega en Supabase → Edge Functions con el nombre «avisar-promotora».

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PORTAL = Deno.env.get('PORTAL_URL') ?? 'https://portal.mune-projects.workers.dev/';
const ESCAPARATE = Deno.env.get('ESCAPARATE_URL') ?? 'https://escaparate.mune-projects.workers.dev';
const PROCESO = 'https://api.github.com/repos/MUNE-Projects/taller/actions/workflows/aviso-promotora.yml/dispatches';
const ORIGENES = [
	'https://panel.mune-projects.workers.dev',
	'https://revision-panel.mune-projects.workers.dev',
	...(Deno.env.get('ORIGENES_EXTRA')?.split(',') ?? []),
];

// Claves de servicio que Supabase da a la función: las nuevas (sb_secret_…) y la
// antigua (service_role). Se usa la primera que funcione en este proyecto.
function clavesServicio(): string[] {
	const claves: string[] = [];
	try {
		claves.push(...Object.values(JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>));
	} catch { /* sin claves nuevas */ }
	const legado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (legado) claves.push(legado);
	return claves.filter(Boolean);
}

const sinSesion = { persistSession: false, autoRefreshToken: false };

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
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, { global: { headers: { Authorization: auth } }, auth: sinSesion });

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const tipo = String(cuerpo.tipo ?? '');
	if (!['planos', 'experiencia', 'publicada', 'rechazado'].includes(tipo)) return responder(400, { error: 'Tipo de aviso no válido' });

	const [{ data: esAdmin }, { data: esRobot }] = await Promise.all([sb.rpc('es_admin'), sb.rpc('es_robot')]);
	if (esAdmin !== true && !(tipo === 'rechazado' && esRobot === true)) return responder(403, { error: 'Sin permiso' });

	// deno-lint-ignore no-explicit-any
	let servicio: SupabaseClient<any> | null = null;
	for (const clave of clavesServicio()) {
		const prueba = createClient(SUPABASE_URL, clave, { auth: sinSesion });
		const { error } = await prueba.from('avisos_enviados').select('id').limit(1);
		if (!error) { servicio = prueba; break; }
	}
	if (!servicio) return responder(500, { error: 'La función no puede leer la base de datos (clave de servicio o falta pegar 012_avisos_promotora.sql)' });

	// ── Qué se avisa ──
	let promocion = String(cuerpo.promocion ?? '');
	const version = String(cuerpo.version ?? '');
	let claveAviso = '';
	let asunto = '';
	let texto = '';
	let enlace = '';
	const { data: doc, error: eDoc } = tipo === 'rechazado'
		? await servicio.from('documentos').select('id, promocion_id, estado, nota, version, nombre, contenido, requisitos!documentos_requisito_id_fkey(elemento)').eq('id', Number(cuerpo.documento_id)).maybeSingle()
		: { data: null, error: null };
	if (eDoc) {
		console.error('documento', eDoc);
		return responder(500, { error: 'No se ha podido leer el documento. Vuelve a probar en un momento.' });
	}
	if (tipo === 'rechazado') {
		if (!doc) return responder(404, { error: `No se encuentra el documento ${Number(cuerpo.documento_id)}` });
		if (doc.estado !== 'rechazado') return responder(409, { error: 'Ese documento no está rechazado' });
		promocion = doc.promocion_id;
	}
	if (!/^[a-z0-9-]{1,60}$/.test(promocion)) return responder(400, { error: 'Promoción no válida' });
	const { data: promo } = await servicio.from('promociones').select('id, nombre, activa, promotora_id, promotoras(activa)').eq('id', promocion).maybeSingle();
	if (!promo) return responder(404, { error: 'No existe esa promoción' });
	const activa = promo.activa && (promo.promotoras as unknown as { activa: boolean } | null)?.activa;
	if (!activa) return responder(200, { ok: true, enviado: false, motivo: 'La promoción o la promotora está desactivada' });

	// El equipo activo de la promoción (con acceso a ella o a todas las de la promotora).
	const { data: filasEquipo } = await servicio.from('miembros').select('user_id, email, promocion_id, administra, capacidades')
		.eq('promotora_id', promo.promotora_id).eq('activo', true).or(`promocion_id.is.null,promocion_id.eq.${promocion}`);
	const equipo = (filasEquipo ?? []) as { user_id: string; email: string; promocion_id: string | null; administra: boolean; capacidades: string[] | null }[];
	let para: string[] = [];

	if (tipo === 'planos' || tipo === 'experiencia' || tipo === 'publicada') {
		if (!/^v[0-9]{1,5}$/.test(version)) return responder(400, { error: 'Versión no válida' });
		claveAviso = `${promocion}/${version}`;
	}
	if (tipo === 'planos' || tipo === 'experiencia') {
		const esPlanos = tipo === 'planos';
		const { count } = await servicio.from('entregables').select('id', { count: 'exact', head: true })
			.eq('promocion_id', promocion).eq('version', version).eq('tipo', esPlanos ? 'plano' : 'experiencia');
		if (!count) return responder(409, { error: esPlanos ? 'Esa versión no tiene planos comerciales enviados' : 'Esa versión no tiene Experiencia 3D enviada' });
		const { data: requeridos, error: eReq } = await servicio.rpc('aprobadores_requeridos', { p_promocion: promocion, p_tipo: tipo });
		if (eReq) {
			console.error('aprobadores_requeridos', eReq);
			return responder(500, { error: 'No se ha podido saber quién tiene que validar (falta pegar 020_equipos_y_validaciones.sql)' });
		}
		const aprobadores = new Set(((requeridos ?? []) as { user_id: string }[]).map((r) => r.user_id));
		const k = aprobadores.size;
		const que = esPlanos ? 'los planos comerciales' : 'la Experiencia 3D';
		const cuantos = esPlanos
			? (count === 1 ? 'Tienes 1 plano para revisar' : `Tienes ${count} planos para revisar`)
			: (count === 1 ? 'Tienes 1 tipología para revisar' : `Tienes ${count} tipologías o variantes para revisar`);
		asunto = esPlanos ? `${promo.nombre} · planos comerciales para validar (${version})` : `${promo.nombre} · Experiencia 3D para validar (${version})`;
		enlace = `${PORTAL}#/promocion/${promocion}/${esPlanos ? 'planos' : 'experiencia'}`;
		if (k) {
			para = equipo.filter((m) => aprobadores.has(m.user_id)).map((m) => m.email);
			texto = `El equipo de MUNE ha preparado ${que} de la ${version} de ${promo.nombre} y estás entre las personas que tienen que ${esPlanos ? 'validarlos' : 'validarla'}.\n\n`
				+ `${cuantos} en MUNE Portal. ${esPlanos ? 'Aprueba cada plano' : 'Recorre cada tipología en la Experiencia 3D y apruébala'} o pide cambios explicando qué hay que corregir. `
				+ (k === 1 ? 'Cada uno queda validado cuando lo apruebas.' : `Cada uno queda validado cuando aprueban todas las personas designadas (${k}).`)
				+ ' La versión se publicará cuando esté todo validado.';
		} else {
			// Sin aprobadores no se valida: se avisa a quien administra la promoción para que los defina.
			para = equipo.filter((m) => m.administra).map((m) => m.email);
			texto = `El equipo de MUNE ha preparado ${que} de la ${version} de ${promo.nombre} para que los valide tu equipo.\n\n`
				+ `Para poder publicar la versión, alguien tiene que validar ${que}, y todavía no hay nadie designado. Elige en MUNE Portal (Equipo) quién debe hacerlo.`;
		}
	}
	if (tipo === 'publicada') {
		const r = await fetch(`${ESCAPARATE}/${promocion}/version.json`, { cache: 'no-store' }).catch(() => null);
		const publicada = r?.ok ? (await r.json().catch(() => null))?.version : null;
		if (publicada !== version) return responder(409, { error: 'La web todavía no está en esa versión' });
		asunto = `${promo.nombre} · ${version} publicada`;
		texto = `La ${version} de ${promo.nombre} ya está publicada. Ya la pueden ver interesados y compradores.`;
		enlace = `${ESCAPARATE}/${promocion}/`;
		para = equipo.map((m) => m.email);
	}
	if (tipo === 'rechazado') {
		const elemento = (doc!.requisitos as unknown as { elemento: string } | null)?.elemento ?? 'un documento';
		const archivo = doc!.contenido ? `${doc!.contenido}: «${doc!.nombre}»` : `«${doc!.nombre}»`;
		claveAviso = `documento/${doc!.id}`;
		asunto = `${promo.nombre} · documento por corregir: ${elemento}`;
		texto = `El equipo de MUNE ha revisado ${archivo} (${elemento}, versión ${doc!.version}) de ${promo.nombre} y necesita una corrección:\n\n«${doc!.nota ?? ''}»\n\n`
			+ 'Sube una versión nueva desde MUNE Portal, en Documentación.';
		enlace = `${PORTAL}#/promocion/${promocion}/documentacion`;
		para = equipo.filter((m) => m.administra || (m.capacidades ?? []).includes('documentacion')).map((m) => m.email);
	}

	para = [...new Set(para.map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(e)))];
	if (!para.length) {
		return responder(200, {
			ok: true, enviado: false,
			motivo: tipo === 'planos' || tipo === 'experiencia' ? 'Nadie de la promoción puede validarlo ni administrarla' : 'La promoción no tiene a nadie a quien avisar',
		});
	}

	// ── Una sola vez por aviso ──
	const tipoAviso = tipo;
	const { error: eRepetido } = await servicio.from('avisos_enviados').insert({ tipo: tipoAviso, clave: claveAviso, promocion_id: promocion, destinatarios: para.length });
	if (eRepetido) return responder(200, { ok: true, enviado: false, motivo: 'Este aviso ya se había enviado' });

	const llave = Deno.env.get('GITHUB_EJECUTOR');
	const r = llave ? await fetch(PROCESO, {
		method: 'POST',
		headers: { Authorization: `Bearer ${llave}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mune-avisos' },
		body: JSON.stringify({ ref: 'main', inputs: { para: para.join(','), asunto: asunto.slice(0, 200), texto: texto.slice(0, 3000), enlace } }),
	}).catch(() => null) : null;
	if (!r?.ok) {
		// no se ha enviado: se puede volver a intentar
		await servicio.from('avisos_enviados').delete().eq('tipo', tipoAviso).eq('clave', claveAviso);
		return responder(502, { error: llave ? `GitHub no ha aceptado el aviso (${r?.status ?? 'sin respuesta'})` : 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
	}
	await sb.from('registro').insert({ accion: 'avisa a la promotora por email', detalle: { promocion, tipo, version: version || null, destinatarios: para.length } });
	return responder(200, { ok: true, enviado: true, destinatarios: para.length });
});
