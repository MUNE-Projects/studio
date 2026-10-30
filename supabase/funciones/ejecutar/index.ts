// Función «ejecutar» de Supabase: el botón Publicar / Volver del Panel.
//
// 1. Comprueba que quien llama es administradora con contraseña + código del
//    móvil (la misma regla es_admin() de la base de datos).
// 2. Valida la orden (aprobar o volver, promoción existente, versión, motivo).
// 3. Pide a GitHub que arranque el proceso .github/workflows/publicar.yml del
//    taller, con la llave A (secreto GITHUB_EJECUTOR, que solo permite arrancar
//    procesos del taller). La llave nunca sale de aquí.
// 4. Lo anota en el registro de actividad.
//
// «retirar» (037_borrado_completo.sql): después de borrar una promoción en MUNE
// Studio, arranca desplegar.yml para que la web pública y la vista previa se
// vuelvan a montar sin ella.
//
// Publicar exige que la promotora haya validado esa versión entera (020): todos
// los planos comerciales y todas las tipologías de la Experiencia 3D. Las
// versiones preparadas antes de existir una de esas partes (sin planos.json o
// sin experiencia/experiencia.json en la vista previa) no la necesitan.
//
// Se pega en Supabase → Edge Functions con el nombre «ejecutar».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const ORIGENES = [
	'https://studio.mune-projects.workers.dev', 'https://revision-studio.mune-projects.workers.dev',
];
const PROCESO = 'https://api.github.com/repos/MUNE-Projects/studio/actions/workflows/publicar.yml/dispatches';
// «retirar» (037): después de borrar una promoción, vuelve a enviar la web a Cloudflare sin ella
const DESPLEGAR = 'https://api.github.com/repos/MUNE-Projects/studio/actions/workflows/desplegar.yml/dispatches';
const REVISION = Deno.env.get('REVISION_ESCAPARATE') ?? 'https://revision-experience.mune-projects.workers.dev';
const PARTES = {
	planos: { que: 'los planos comerciales', archivo: 'planos/planos.json' },
	experiencia: { que: 'la Experiencia 3D', archivo: 'experiencia/experiencia.json' },
} as const;
const NO_LISTOS: Record<string, (que: string) => string> = {
	sin_enviar: (que) => `primero envía a validar ${que} a la promotora.`,
	sin_aprobadores: (que) => `la promotora todavía no ha definido quién valida ${que} (lo hace quien la administra, en MUNE Portal).`,
	pendientes: (que) => `faltan aprobaciones de ${que}.`,
	cambios: (que) => `la promotora ha pedido cambios en ${que}: hay que corregirlo y preparar una versión nueva.`,
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

	const auth = req.headers.get('authorization');
	if (!auth?.startsWith('Bearer ')) return responder(401, { error: 'Sin sesión' });
	const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
		global: { headers: { Authorization: auth } },
		auth: { persistSession: false, autoRefreshToken: false },
	});

	const { data: esAdmin, error: eAdmin } = await sb.rpc('es_admin');
	if (eAdmin || esAdmin !== true) {
		return responder(403, { error: 'Solo la administradora, con el código del móvil, puede publicar.' });
	}

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const accion = String(cuerpo.accion ?? '');
	const promocion = String(cuerpo.promocion ?? '');
	const version = String(cuerpo.version ?? '');
	const motivo = String(cuerpo.motivo ?? '').trim();
	if (accion !== 'aprobar' && accion !== 'volver' && accion !== 'retirar') return responder(400, { error: 'Acción no válida' });
	if (!/^[a-z0-9-]{1,60}$/.test(promocion)) return responder(400, { error: 'Promoción no válida' });

	const llaveA = Deno.env.get('GITHUB_EJECUTOR');
	if (!llaveA) return responder(500, { error: 'Falta la llave A (GITHUB_EJECUTOR) en los secretos de Supabase' });
	const lanzar = (url: string, inputs: Record<string, string>) => fetch(url, {
		method: 'POST',
		headers: { Authorization: `Bearer ${llaveA}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'mune-panel' },
		body: JSON.stringify({ ref: 'main', inputs }),
	});

	// Retirar de la web una promoción ya borrada: la web se vuelve a montar con lo
	// que dice el registro de versiones, que ya no la tiene.
	if (accion === 'retirar') {
		const { data: sigue } = await sb.from('promociones').select('id').eq('id', promocion).maybeSingle();
		if (sigue) return responder(409, { error: 'Esa promoción no está borrada: para quitarla de la web, bórrala primero.' });
		const r = await lanzar(DESPLEGAR, { destino: 'ambas' });
		if (!r.ok) return responder(502, { error: `GitHub no ha aceptado la orden (${r.status}). ${(await r.text()).slice(0, 200)}` });
		await sb.from('registro').insert({ accion: 'retira de la web una promoción borrada', detalle: { promocion } });
		return responder(202, { ok: true });
	}
	// «aprobar»: la versión revisada en la vista previa (el ejecutor comprueba que sigue siendo esa)
	if (!/^v[0-9]{1,5}$/.test(version)) return responder(400, { error: 'Versión no válida' });
	if (accion === 'volver' && (motivo.length < 3 || motivo.length > 500)) {
		return responder(400, { error: 'Indica el motivo (entre 3 y 500 caracteres)' });
	}

	const { data: promo } = await sb.from('promociones').select('id').eq('id', promocion).maybeSingle();
	if (!promo) return responder(404, { error: 'No existe esa promoción' });
	if (accion === 'aprobar') {
		for (const [tipo, parte] of Object.entries(PARTES)) {
			const { data: lista, error: eLista } = await sb.rpc('validacion_lista', { p_promocion: promocion, p_version: version, p_tipo: tipo });
			if (eLista) return responder(500, { error: `No se ha podido comprobar la validación de ${parte.que}. Vuelve a probar en un momento.` });
			if (lista === 'listos') continue;
			// sin enviar: solo se permite si la versión no tiene esa parte (preparada antes de existir)
			const r = lista === 'sin_enviar' ? await fetch(`${REVISION}/${promocion}/${parte.archivo}`, { cache: 'no-store' }).catch(() => null) : null;
			if (r?.status === 404) continue;
			const motivo = NO_LISTOS[String(lista)]?.(parte.que) ?? `falta validar ${parte.que}.`;
			return responder(409, { error: `No se puede publicar ${version}: ${motivo}` });
		}
	}
	const { data: { user } } = await sb.auth.getUser();
	const { data: admin } = await sb.from('administradores').select('nombre').eq('user_id', user?.id ?? '').maybeSingle();

	const solicitud = crypto.randomUUID();
	const r = await lanzar(PROCESO, { accion, promocion, version, motivo, por: admin?.nombre ?? 'Administradora', solicitud });
	if (!r.ok) {
		const detalle = (await r.text()).slice(0, 200);
		return responder(502, { error: `GitHub no ha aceptado la orden (${r.status}). ${detalle}` });
	}

	await sb.from('registro').insert({
		accion: accion === 'aprobar' ? 'publica desde el Panel' : 'vuelve a una versión anterior',
		detalle: { promocion, version, motivo: motivo || null, solicitud },
	});
	return responder(202, { ok: true, solicitud });
});
