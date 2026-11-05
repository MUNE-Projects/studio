// Función «exportacion» de Supabase: la exportación de una promoción (o de una
// promotora) que se va a eliminar, para quien la administra, y la lista de
// eliminaciones fuera de Supabase (decisión 70, 045_cierre_y_eliminacion.sql).
// No interviene Claude.
//
// Quién puede hacer cada cosa (se comprueba aquí y en la base de datos, porque
// la función tiene «Verify JWT» apagado):
//  · «enviar» y «revocar»: solo la administradora de MUNE con el código del
//    móvil. Se comprueba con su sesión en la base de datos (es_admin(): firma
//    de la sesión, nivel aal2 y lista de administradores); una sesión
//    inventada o de una promotora recibe 403. Los destinatarios no los elige
//    nadie: son quienes administran esa promotora en MUNE Portal.
//    «enviar» deja la exportación «enviando» y lanza aviso-exportacion.yml solo
//    con su identificador: el proceso crea allí el enlace (en Supabase queda su
//    huella), envía el email y lo confirma; si falla, vuelve a «lista».
//  · «descargar»: sin sesión, solo con la clave del enlace (32 bytes al azar;
//    se busca por su huella). Devuelve, de esa exportación y de ninguna otra,
//    direcciones firmadas que caducan en 10 minutos. Caducada, revocada o con
//    un envío que no salió: 404.
//  · «caducar» y «sincronizar»: sin sesión y sin datos que devolver. «caducar»
//    solo borra lo que ya ha caducado; «sincronizar» solo pide guardar fuera
//    las eliminaciones si hay alguna sin guardar, como mucho una vez por
//    minuto. Los llaman la propia base de datos (pg_net), MUNE Studio y la
//    vigilancia.
//
// Se pega en Supabase → Edge Functions con el nombre «exportacion», con
// «Verify JWT» desactivado.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const GITHUB = Deno.env.get('GITHUB_API') ?? 'https://api.github.com';
const AVISO = `${GITHUB}/repos/MUNE-Projects/studio/actions/workflows/aviso-exportacion.yml/dispatches`;
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

type Parte = { ruta: string; tamano: number; huella: string };
type Exportacion = {
	id: string; promotora_id: string; promocion_id: string | null; titulo: string; estado: string; partes: Parte[];
	archivos: number | null; tamano: number | null; dias: number; caduca_en: string | null; descargas: number;
	token_huella: string | null; enviando_desde: string | null; creada_en: string;
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
		new Response(JSON.stringify(datos), { status: estado, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
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
	const llave = Deno.env.get('GITHUB_EJECUTOR');
	const lanzar = (url: string, inputs: Record<string, string>) => llave
		? fetch(url, {
			method: 'POST',
			headers: { Authorization: `Bearer ${llave}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mune-exportacion' },
			body: JSON.stringify({ ref: 'main', inputs }),
		}).catch(() => null)
		: Promise.resolve(null);
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
		if (!exp || !['enviando', 'enviada'].includes(exp.estado) || !exp.caduca_en || new Date(exp.caduca_en) <= new Date()) return invalido();
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
		const hace1h = new Date(ahora.getTime() - 3600000).toISOString();
		const hace2 = new Date(ahora.getTime() - 2 * 86400000).toISOString();
		const hace7 = new Date(ahora.getTime() - 7 * 86400000).toISOString();
		// un envío sin confirmar en una hora: vuelve a «lista», sin enlace válido
		await servicio.from('exportaciones').update({ estado: 'lista', token_huella: null, enviando_desde: null, error: 'El email no se ha confirmado: vuelve a enviarlo' })
			.eq('estado', 'enviando').lt('enviando_desde', hace1h);
		const { data: filas } = await servicio.from('exportaciones').select('*')
			.or(`and(estado.in.(enviada,enviando,lista),caduca_en.lt.${ahora.toISOString()}),and(estado.in.(preparando,fallida),creada_en.lt.${hace2}),and(estado.eq.lista,caduca_en.is.null,creada_en.lt.${hace7})`);
		let n = 0;
		for (const e of (filas ?? []) as Exportacion[]) {
			try {
				await borrarArchivos(e);
				await servicio.from('exportaciones').update({ estado: ['enviada', 'enviando', 'lista'].includes(e.estado) ? 'caducada' : 'fallida', token_huella: null, terminada_en: ahora.toISOString() }).eq('id', e.id);
				n++;
			} catch (err) {
				console.error('caducar', e.id, err);
			}
		}
		return responder(200, { ok: true, caducadas: n });
	}

	if (accion === 'sincronizar') {
		const { count } = await servicio.from('eliminaciones').select('id', { count: 'exact', head: true }).is('guardada_en', null);
		if (!count) return responder(200, { ok: true });
		const hace = new Date(Date.now() - 60000).toISOString();
		const { data: turno } = await servicio.from('sincronizacion').update({ ultima_peticion: new Date().toISOString() })
			.eq('id', 1).or(`ultima_peticion.is.null,ultima_peticion.lt.${hace}`).select('id');
		if (!turno?.length) return responder(202, { ok: true });
		const r = await lanzar(ELIMINACIONES, {});
		if (!r?.ok) {
			await servicio.from('sincronizacion').update({ ultima_peticion: null }).eq('id', 1);
			return responder(502, { error: 'No se ha podido pedir que se guarden las eliminaciones; se vuelve a intentar sola.' });
		}
		return responder(202, { ok: true });
	}

	// ── Solo la administradora de MUNE (con el código del móvil) ─────────────
	const auth = req.headers.get('authorization');
	if (!auth?.startsWith('Bearer ')) return responder(401, { error: 'Sin sesión' });
	const sb = createClient(SUPABASE_URL, CLAVE_PUBLICA, { global: { headers: { Authorization: auth } }, auth: sinSesion });
	const { data: esAdmin } = await sb.rpc('es_admin');
	if (esAdmin !== true) return responder(403, { error: 'Solo la administradora, con el código del móvil.' });
	const id = String(cuerpo.id ?? '');
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) return responder(400, { error: 'Exportación no válida' });
	const { data: fila } = await servicio.from('exportaciones').select('*').eq('id', id).maybeSingle();
	const e = fila as Exportacion | null;
	if (!e) return responder(404, { error: 'No existe esa exportación' });

	if (accion === 'revocar') {
		if (!['lista', 'enviando', 'enviada', 'fallida', 'preparando'].includes(e.estado)) return responder(409, { error: 'Esa exportación ya no está disponible' });
		// primero el enlace (deja de valer al momento), después los archivos
		await servicio.from('exportaciones').update({ estado: 'revocada', token_huella: null, enviando_desde: null, terminada_en: new Date().toISOString() }).eq('id', id);
		try {
			await borrarArchivos(e);
		} catch {
			return responder(500, { error: 'El enlace ya no funciona, pero no se han podido borrar los archivos: se borrarán solos esta semana.' });
		}
		await sb.from('registro').insert({ accion: 'revoca una exportación', detalle: { exportacion: id, promotora: e.promotora_id, promocion: e.promocion_id } });
		return responder(200, { ok: true });
	}

	if (accion !== 'enviar') return responder(400, { error: 'Orden no válida' });
	if (!['lista', 'enviada'].includes(e.estado)) {
		return responder(409, { error: e.estado === 'enviando' ? 'Ya se está enviando: espera un par de minutos.' : 'La exportación todavía no está preparada y comprobada' });
	}
	if (e.caduca_en && new Date(e.caduca_en) <= new Date()) return responder(409, { error: 'Esta exportación ha caducado: prepara otra.' });
	const { count: responsables } = await servicio.from('miembros').select('id', { count: 'exact', head: true })
		.eq('promotora_id', e.promotora_id).eq('activo', true).eq('administra', true)
		.or(e.promocion_id ? `promocion_id.is.null,promocion_id.eq.${e.promocion_id}` : 'promocion_id.is.null');
	if (!responsables) {
		return responder(409, { error: 'Nadie administra esta promotora en MUNE Portal. Dale a la persona responsable un acceso de administración y vuelve a enviar.' });
	}
	// Un solo envío a la vez (dos clics seguidos no mandan dos emails). Un enlace anterior deja de valer.
	const { data: turno } = await servicio.from('exportaciones')
		.update({ estado: 'enviando', enviando_desde: new Date().toISOString(), token_huella: null, error: null })
		.eq('id', id).eq('estado', e.estado).select('id');
	if (!turno?.length) return responder(409, { error: 'Ya se está enviando: espera un par de minutos.' });
	const r = await lanzar(AVISO, { exportacion: id });
	if (!r?.ok) {
		await servicio.from('exportaciones').update({ estado: 'lista', enviando_desde: null, error: llave ? `No se ha podido pedir el email (GitHub ${r?.status ?? 'sin respuesta'})` : 'Falta la llave A (GITHUB_EJECUTOR)' }).eq('id', id);
		return responder(502, { error: 'No se ha podido enviar el email. La exportación sigue preparada: vuelve a pulsar «Enviar» en un momento.' });
	}
	return responder(202, { ok: true, destinatarios: responsables });
});
