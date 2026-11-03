// Función «exportacion» de Supabase: la exportación de una promoción (o de una
// promotora) que se va a eliminar, para quien la administra (decisión 70,
// 045_cierre_y_eliminacion.sql). No interviene Claude.
//
// MUNE Studio prepara la exportación (solo los materiales de la promotora), la
// sube al almacén privado «exportaciones» y la comprueba. Aquí:
//  · «enviar» (la administradora): manda a quien administra la promotora un
//    email con un enlace privado. El enlace lleva una clave que solo se guarda
//    como huella; cada envío invalida el anterior. Caduca a los días elegidos
//    (30 por defecto). Si el email no sale, la exportación queda «lista» y se
//    puede reintentar. Nunca va adjunta ni en una dirección permanente.
//  · «revocar» (la administradora): el enlace deja de funcionar y se borran sus
//    archivos.
//  · «descargar» (con la clave del enlace, sin sesión): devuelve las partes con
//    direcciones de descarga que caducan en 10 minutos.
//  · «caducar» (cualquiera; lo llama la vigilancia): borra los archivos de las
//    exportaciones caducadas y de las preparaciones abandonadas.
//  · «apuntar-eliminaciones» (con sesión): pide a GitHub que guarde fuera de
//    Supabase la lista de eliminaciones (eliminaciones.yml), para que una
//    recuperación no reabra nada eliminado.
//
// Se pega en Supabase → Edge Functions con el nombre «exportacion», con
// «Verify JWT» desactivado (la descarga llega sin sesión; las demás órdenes
// comprueban la sesión aquí).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PORTAL = Deno.env.get('PORTAL_URL') ?? 'https://portal.mune-projects.workers.dev/';
const GITHUB = Deno.env.get('GITHUB_API') ?? 'https://api.github.com';
const AVISO = `${GITHUB}/repos/MUNE-Projects/studio/actions/workflows/aviso-promotora.yml/dispatches`;
const ELIMINACIONES = `${GITHUB}/repos/MUNE-Projects/studio/actions/workflows/eliminaciones.yml/dispatches`;
const ORIGENES = [
	'https://studio.mune-projects.workers.dev', 'https://revision-studio.mune-projects.workers.dev',
	'https://portal.mune-projects.workers.dev', 'https://revision-portal.mune-projects.workers.dev',
	...(Deno.env.get('ORIGENES_EXTRA')?.split(',') ?? []),
];

function claveServicio(): string | undefined {
	const legado = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
	if (legado) return legado;
	try {
		const claves = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
		return claves.default ?? Object.values(claves)[0];
	} catch {
		return undefined;
	}
}

const sinSesion = { persistSession: false, autoRefreshToken: false };
const huella = async (t: string) =>
	[...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const claveNueva = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

type Parte = { ruta: string; tamano: number; huella: string };
type Exportacion = {
	id: string; promotora_id: string; promocion_id: string | null; titulo: string; estado: string; partes: Parte[];
	archivos: number | null; tamano: number | null; dias: number; caduca_en: string | null; descargas: number;
};

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

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const clave = claveServicio();
	if (!clave) return responder(500, { error: 'Falta la configuración del servidor' });
	const servicio = createClient(SUPABASE_URL, clave, { auth: sinSesion });
	const accion = String(cuerpo.accion ?? '');
	const borrarArchivos = async (e: Exportacion) => {
		const rutas = (e.partes ?? []).map((p) => p.ruta);
		const { data: sueltas } = await servicio.storage.from('exportaciones').list(e.id, { limit: 1000 });
		for (const s of sueltas ?? []) if (s.id) rutas.push(`${e.id}/${s.name}`);
		const unicas = [...new Set(rutas)];
		if (unicas.length) {
			const { error } = await servicio.storage.from('exportaciones').remove(unicas);
			if (error) throw error;
		}
	};

	// ── Sin sesión ──────────────────────────────────────────────────────────
	if (accion === 'descargar') {
		const token = String(cuerpo.token ?? '');
		const invalido = () => responder(404, { error: 'Este enlace no es válido, ha caducado o se ha revocado. Si necesitas la exportación, escribe al equipo de MUNE.' });
		if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return invalido();
		const { data: e } = await servicio.from('exportaciones').select('*').eq('token_huella', await huella(token)).maybeSingle();
		const exp = e as Exportacion | null;
		if (!exp || exp.estado !== 'enviada' || !exp.caduca_en || new Date(exp.caduca_en) <= new Date()) return invalido();
		const partes = [];
		for (const [i, p] of exp.partes.entries()) {
			const nombre = `MUNE-${exp.titulo.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').slice(0, 60)}-parte-${i + 1}.zip`;
			const { data: firmada, error } = await servicio.storage.from('exportaciones').createSignedUrl(p.ruta, 600, { download: nombre });
			if (error || !firmada) return responder(500, { error: 'No se ha podido preparar la descarga. Vuelve a probar en unos minutos.' });
			partes.push({ nombre, tamano: p.tamano, huella: p.huella, url: firmada.signedUrl });
		}
		await servicio.from('exportaciones').update({ descargas: (exp.descargas ?? 0) + 1, ultima_descarga: new Date().toISOString() }).eq('id', exp.id);
		return responder(200, { titulo: exp.titulo, caduca_en: exp.caduca_en, archivos: exp.archivos, partes });
	}

	if (accion === 'caducar') {
		const ahora = new Date();
		const hace2 = new Date(ahora.getTime() - 2 * 86400000).toISOString();
		const hace7 = new Date(ahora.getTime() - 7 * 86400000).toISOString();
		const { data: filas } = await servicio.from('exportaciones').select('*')
			.or(`and(estado.in.(enviada,lista),caduca_en.lt.${ahora.toISOString()}),and(estado.in.(preparando,fallida),creada_en.lt.${hace2}),and(estado.eq.lista,caduca_en.is.null,creada_en.lt.${hace7})`);
		let n = 0;
		for (const e of (filas ?? []) as Exportacion[]) {
			try {
				await borrarArchivos(e);
				await servicio.from('exportaciones').update({ estado: e.estado === 'enviada' || e.estado === 'lista' ? 'caducada' : 'fallida', token_huella: null, terminada_en: ahora.toISOString() }).eq('id', e.id);
				n++;
			} catch (err) {
				console.error('caducar', e.id, err);
			}
		}
		return responder(200, { ok: true, caducadas: n });
	}

	// ── Con sesión ──────────────────────────────────────────────────────────
	const auth = req.headers.get('authorization');
	if (!auth?.startsWith('Bearer ')) return responder(401, { error: 'Sin sesión' });
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, { global: { headers: { Authorization: auth } }, auth: sinSesion });
	const llave = Deno.env.get('GITHUB_EJECUTOR');
	const lanzar = (url: string, inputs: Record<string, string>) => llave
		? fetch(url, {
			method: 'POST',
			headers: { Authorization: `Bearer ${llave}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mune-exportacion' },
			body: JSON.stringify({ ref: 'main', inputs }),
		}).catch(() => null)
		: Promise.resolve(null);

	if (accion === 'apuntar-eliminaciones') {
		const { data: { user } } = await sb.auth.getUser();
		if (!user) return responder(401, { error: 'Sin sesión' });
		const r = await lanzar(ELIMINACIONES, {});
		return r?.ok ? responder(202, { ok: true }) : responder(502, { error: 'No se ha podido pedir que se guarden las eliminaciones; se guardarán esta noche con la copia.' });
	}

	const { data: esAdmin } = await sb.rpc('es_admin');
	if (esAdmin !== true) return responder(403, { error: 'Solo la administradora, con el código del móvil.' });
	const id = String(cuerpo.id ?? '');
	if (!/^[0-9a-f-]{36}$/.test(id)) return responder(400, { error: 'Exportación no válida' });
	const { data: fila } = await servicio.from('exportaciones').select('*').eq('id', id).maybeSingle();
	const e = fila as Exportacion | null;
	if (!e) return responder(404, { error: 'No existe esa exportación' });

	if (accion === 'revocar') {
		if (!['lista', 'enviada', 'fallida', 'preparando'].includes(e.estado)) return responder(409, { error: 'Esa exportación ya no está disponible' });
		try {
			await borrarArchivos(e);
		} catch {
			return responder(500, { error: 'No se han podido borrar los archivos. Vuelve a probar.' });
		}
		await servicio.from('exportaciones').update({ estado: 'revocada', token_huella: null, terminada_en: new Date().toISOString() }).eq('id', id);
		await sb.from('registro').insert({ accion: 'revoca una exportación', detalle: { exportacion: id, promotora: e.promotora_id, promocion: e.promocion_id } });
		return responder(200, { ok: true });
	}

	if (accion !== 'enviar') return responder(400, { error: 'Orden no válida' });
	if (!['lista', 'enviada'].includes(e.estado)) return responder(409, { error: 'La exportación todavía no está preparada y comprobada' });
	if (e.caduca_en && new Date(e.caduca_en) <= new Date()) return responder(409, { error: 'Esta exportación ha caducado: prepara otra.' });

	// Quien administra la promotora (o esa promoción), con su acceso activo.
	let consulta = servicio.from('miembros').select('email').eq('promotora_id', e.promotora_id).eq('activo', true).eq('administra', true);
	consulta = e.promocion_id ? consulta.or(`promocion_id.is.null,promocion_id.eq.${e.promocion_id}`) : consulta.is('promocion_id', null);
	const { data: responsables } = await consulta;
	const para = [...new Set(((responsables ?? []) as { email: string }[]).map((m) => m.email.trim().toLowerCase()).filter((x) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(x)))];
	if (!para.length) {
		return responder(409, { error: 'Nadie administra esta promotora en MUNE Portal. Dale a la persona responsable un acceso de administración y vuelve a enviar.' });
	}

	const token = claveNueva();
	const caduca = e.caduca_en ?? new Date(Date.now() + e.dias * 86400000).toISOString();
	const enlace = `${PORTAL}descarga/#${token}`;
	const que = e.promocion_id ? `la promoción «${e.titulo}»` : `las promociones de ${e.titulo}`;
	const asunto = `${e.titulo} · tu exportación de MUNE`;
	const texto = `El equipo de MUNE ha preparado la exportación de ${que}: la documentación que subisteis, con todas sus versiones, los planos y materiales entregados y los datos de la promoción.\n\n`
		+ `Descárgala con el enlace de este email. Es personal: no lo reenvíes. Funciona hasta el ${fecha(caduca)}; después se borra.\n\n`
		+ `Cuando MUNE elimine la información de ${e.promocion_id ? 'la promoción' : 'la promotora'}, esta exportación será la copia que te queda. Si tienes cualquier duda, responde a este email.`;
	const r = await lanzar(AVISO, { para: para.join(','), asunto, texto, enlace });
	if (!r?.ok) {
		await servicio.from('exportaciones').update({ error: llave ? `El email no ha salido (GitHub ${r?.status ?? 'sin respuesta'})` : 'Falta la llave A (GITHUB_EJECUTOR)' }).eq('id', id);
		return responder(502, { error: 'No se ha podido enviar el email. La exportación sigue preparada: vuelve a pulsar «Enviar» en un momento.' });
	}
	await servicio.from('exportaciones').update({
		estado: 'enviada', token_huella: await huella(token), caduca_en: caduca, enviada_en: new Date().toISOString(), destinatarios: para.length, error: null,
	}).eq('id', id);
	await sb.from('registro').insert({ accion: 'envía una exportación a la promotora', detalle: { exportacion: id, promotora: e.promotora_id, promocion: e.promocion_id, destinatarios: para.length, caduca_en: caduca } });
	return responder(200, { ok: true, destinatarios: para.length, caduca_en: caduca });
});
