// Función «invitar» de Supabase: dar acceso a MUNE Portal a una persona de una
// promotora (receta 14). La llaman MUNE Studio (soporte) y quien administra en
// MUNE Portal (Equipo).
//
// 1. Comprueba, con la sesión de quien llama, que puede dar ese acceso
//    (puede_dar_acceso: MUNE Studio con el código del móvil, quien administra
//    la promotora, o quien administra esa promoción para personas sin
//    administración).
// 2. «invitar»: si el correo no tiene cuenta, la crea y Supabase le envía el
//    email de invitación con el enlace para elegir su contraseña en el portal.
//    Después le da el acceso (dar_acceso) TAMBIÉN con la sesión de quien llama:
//    así lo comprueban las reglas de la base de datos y queda en el registro.
//    «reenviar»: vuelve a enviar la invitación o, si ya la aceptó, un enlace
//    para cambiar la contraseña.
//    «quitar-movil»: si la persona ha perdido el móvil, le quita el código del
//    móvil (032_movil_promotoras.sql); al volver a entrar, lo vincula de nuevo.
//
// Para crear cuentas hace falta la clave de servicio de Supabase. Supabase se
// la da a la función automáticamente y no sale nunca de sus servidores: no
// está en MUNE Studio ni en MUNE Portal, ni en GitHub, ni se copia a ningún
// sitio. La función solo la usa para buscar o crear la cuenta, comprobar
// accesos y enviar el email; el acceso lo da siempre la sesión de quien llama.
//
// Se pega en Supabase → Edge Functions con el nombre «invitar».

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const CLAVE_PUBLICA = Deno.env.get('CLAVE_PUBLICA') ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const PORTAL = Deno.env.get('PORTAL_URL') ?? 'https://portal.mune-projects.workers.dev/';
const ORIGENES = [
	'https://studio.mune-projects.workers.dev',
	'https://revision-studio.mune-projects.workers.dev',
	'https://portal.mune-projects.workers.dev',
	'https://revision-portal.mune-projects.workers.dev',
	// Solo en el Supabase local de las pruebas: MUNE Studio y MUNE Portal en el ordenador de desarrollo.
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

// Capacidades de trabajo (020). «marca» queda reservada para la Fase 2.
const CAPACIDADES = ['documentacion', 'planos', 'compradores', 'personalizacion', 'materiales', 'datos', 'marca'];
const CAPACIDADES_TRABAJO = ['documentacion', 'planos', 'compradores', 'personalizacion', 'materiales', 'datos'];

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

	const clave = claveServicio();
	if (!clave) return responder(500, { error: 'Supabase no ha dado a la función su clave de servicio' });
	const servicio = createClient(SUPABASE_URL, clave, { auth: sinSesion });

	let cuerpo: Record<string, unknown>;
	try {
		cuerpo = await req.json();
	} catch {
		return responder(400, { error: 'Orden no válida' });
	}
	const accion = String(cuerpo.accion ?? '');
	const promotora = String(cuerpo.promotora_id ?? '');
	if (accion !== 'invitar' && accion !== 'reenviar' && accion !== 'quitar-movil') return responder(400, { error: 'Acción no válida' });
	if (!/^[0-9a-f-]{36}$/.test(promotora)) return responder(400, { error: 'Promotora no válida' });

	const [{ data: esAdmin }, { data: { user: quien } }] = await Promise.all([sb.rpc('es_admin'), sb.auth.getUser()]);
	if (!quien) return responder(401, { error: 'Sin sesión' });
	const desdeStudio = esAdmin === true;
	const sinPermiso = () => responder(403, {
		error: desdeStudio ? 'No tienes permiso para dar este acceso.'
			: 'No puedes dar este acceso: solo quien administra la promotora (o esta promoción, para personas sin administración) puede hacerlo.',
	});
	// ¿Puede quien llama dar acceso a este alcance? (con su sesión, mismas reglas que la base de datos)
	const puede = async (promocion: string | null, administra: boolean) => {
		const { data, error } = await sb.rpc('puede_dar_acceso', { p_promotora: promotora, p_promocion: promocion, p_administra: administra });
		return !error && data === true;
	};

	const { data: po } = await servicio.from('promotoras').select('id, nombre, activa').eq('id', promotora).maybeSingle();
	if (!po) return desdeStudio ? responder(404, { error: 'No existe esa promotora' }) : sinPermiso();

	if (accion === 'invitar') {
		const nombre = String(cuerpo.nombre ?? '').trim();
		const email = String(cuerpo.email ?? '').trim().toLowerCase();
		const cargo = String(cuerpo.cargo ?? '').trim();
		// Sin promoción = acceso a todas las promociones de la promotora.
		const promocion = cuerpo.promocion_id ? String(cuerpo.promocion_id) : null;
		const administra = cuerpo.administra === true;
		// Sin capacidades indicadas: todas las de trabajo (como antes de 020).
		const capacidades = cuerpo.capacidades === undefined || cuerpo.capacidades === null ? CAPACIDADES_TRABAJO : cuerpo.capacidades;
		if (cuerpo.administra !== undefined && typeof cuerpo.administra !== 'boolean') return responder(400, { error: 'Orden no válida' });
		if (!Array.isArray(capacidades) || capacidades.some((c) => typeof c !== 'string' || !CAPACIDADES.includes(c))) {
			return responder(400, { error: 'Alguna capacidad no es válida' });
		}
		if (!(await puede(promocion, administra))) return sinPermiso();
		if (nombre.length < 2 || nombre.length > 120) return responder(400, { error: 'Escribe el nombre de la persona' });
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return responder(400, { error: 'El correo no es válido' });
		if (cargo.length > 120) return responder(400, { error: 'El cargo es demasiado largo' });
		if (!administra && !capacidades.length) return responder(400, { error: 'Marca al menos una capacidad (o dale la administración).' });
		if (!po.activa) return responder(409, { error: 'La promotora está desactivada. Actívala antes de dar accesos.' });
		if (promocion) {
			const { data: pr } = await servicio.from('promociones').select('id').eq('id', promocion).eq('promotora_id', promotora).maybeSingle();
			if (!pr) return responder(404, { error: 'Esa promoción no es de esta promotora' });
		}

		const { data: cuentas, error: eCuenta } = await servicio.rpc('cuenta_por_email', { p_email: email });
		if (eCuenta) {
			console.error('cuenta_por_email', eCuenta);
			return responder(500, { error: 'No se ha podido comprobar el correo. Vuelve a probar en un momento.' });
		}
		const cuenta = (cuentas as { user_id: string; confirmada: boolean; interna: boolean }[] | null)?.[0];
		if (cuenta?.interna) return responder(409, { error: 'Ese correo es de una cuenta interna de MUNE: no puede tener acceso a MUNE Portal.' });

		if (cuenta) {
			const { data: filas } = await servicio.from('miembros').select('promotora_id, promocion_id, activo').eq('user_id', cuenta.user_id);
			const suyas = (filas ?? []) as { promotora_id: string; promocion_id: string | null; activo: boolean }[];
			if (suyas.some((m) => m.promotora_id !== promotora)) return responder(409, { error: 'Ese correo ya tiene acceso en otra promotora.' });
			if (suyas.some((m) => m.activo && (m.promocion_id ?? '') === (promocion ?? ''))) {
				return responder(409, { error: 'Esa persona ya tiene este acceso. Si quieres cambiar lo que puede hacer, usa «Cambiar acceso».' });
			}
		}

		let userId = cuenta?.user_id;
		let enviada = false;
		if (!userId) {
			const { data, error } = await servicio.auth.admin.inviteUserByEmail(email, { redirectTo: PORTAL, data: { nombre } });
			if (error) {
				console.error('inviteUserByEmail', error);
				return responder(502, { error: 'No se ha podido enviar la invitación. Revisa el correo y vuelve a probar en un momento.' });
			}
			userId = data.user.id;
			enviada = true;
		}

		// El acceso lo da la sesión de quien llama: las reglas de la base de datos lo comprueban otra vez.
		const { error: eAcceso } = await sb.rpc('dar_acceso', {
			p_user: userId, p_promotora: promotora, p_promocion: promocion, p_nombre: nombre, p_cargo: cargo,
			p_administra: administra, p_capacidades: administra ? CAPACIDADES_TRABAJO : capacidades,
		});
		if (eAcceso) {
			console.error('dar_acceso', eAcceso);
			if (/otra promotora/.test(eAcceso.message)) return responder(409, { error: 'Ese correo ya tiene acceso en otra promotora.' });
			if (/interna/.test(eAcceso.message)) return responder(409, { error: 'Ese correo es de una cuenta interna de MUNE: no puede tener acceso a MUNE Portal.' });
			if (/permiso/i.test(eAcceso.message)) return sinPermiso();
			return responder(500, { error: 'No se ha podido dar el acceso. Vuelve a probar en un momento.' });
		}
		const detalle = { promotora, promocion: promocion ?? 'todas', email, cargo, administra, capacidades: administra ? CAPACIDADES_TRABAJO : capacidades, invitacion: enviada };
		// MUNE Studio deja su apunte; desde MUNE Portal basta el que hace la base de datos (acceso_dado).
		if (desdeStudio) await sb.from('registro').insert({ accion: 'da acceso al portal', detalle });
		return responder(200, {
			ok: true,
			mensaje: enviada
				? `Invitación enviada a ${email}. Le llegará un email para elegir su contraseña.`
				: `${email} ya tenía cuenta: puede entrar en MUNE Portal con su contraseña de siempre.`,
		});
	}

	// «reenviar» y «quitar-movil»: solo a quien tiene un acceso activo que quien llama podría dar.
	const userId = String(cuerpo.user_id ?? '');
	if (!/^[0-9a-f-]{36}$/.test(userId)) return responder(400, { error: 'Persona no válida' });
	const { data: filas } = await servicio.from('miembros').select('email, promocion_id, administra')
		.eq('promotora_id', promotora).eq('user_id', userId).eq('activo', true);
	// MUNE Portal indica también el acceso concreto (promocion_id, o null para «todas»): se mira solo ese.
	const alcance = 'promocion_id' in cuerpo ? (cuerpo.promocion_id ? String(cuerpo.promocion_id) : null) : undefined;
	const activas = ((filas ?? []) as { email: string; promocion_id: string | null; administra: boolean }[])
		.filter((m) => alcance === undefined || m.promocion_id === alcance);
	if (!activas.length) return responder(409, { error: 'Esa persona no tiene ningún acceso activo en esta promotora' });
	let permitido = false;
	for (const m of activas) if (!permitido) permitido = await puede(m.promocion_id, m.administra);
	if (!permitido) return sinPermiso();

	const { data: u, error: eU } = await servicio.auth.admin.getUserById(userId);
	if (eU || !u.user) return responder(404, { error: 'No se encuentra la cuenta' });
	const email = u.user.email!;

	if (accion === 'quitar-movil') {
		if (userId === quien.id) return responder(409, { error: 'No puedes quitarte tu propio código del móvil: pídeselo a quien administra tu equipo o al equipo de MUNE.' });
		const { data: cuentas } = await servicio.rpc('cuenta_por_email', { p_email: email });
		if ((cuentas as { interna: boolean }[] | null)?.[0]?.interna) return sinPermiso();
		const { data: lista, error: eLista } = await servicio.auth.admin.mfa.listFactors({ userId });
		if (eLista) {
			console.error('listFactors', eLista);
			return responder(500, { error: 'No se ha podido quitar el código del móvil. Vuelve a probar en un momento.' });
		}
		for (const f of lista.factors) {
			const { error } = await servicio.auth.admin.mfa.deleteFactor({ id: f.id, userId });
			if (error) {
				console.error('deleteFactor', error);
				return responder(500, { error: 'No se ha podido quitar el código del móvil. Vuelve a probar en un momento.' });
			}
		}
		await servicio.from('registro').insert({ user_id: quien.id, accion: 'quita el código del móvil', detalle: { promotora, email } });
		return responder(200, {
			ok: true,
			mensaje: `Hecho. La próxima vez que ${email} entre en MUNE Portal, vinculará de nuevo su móvil.`,
		});
	}
	const { error } = u.user.email_confirmed_at
		? await createClient(SUPABASE_URL, CLAVE_PUBLICA, { auth: sinSesion }).auth.resetPasswordForEmail(email, { redirectTo: PORTAL })
		: await servicio.auth.admin.inviteUserByEmail(email, { redirectTo: PORTAL });
	if (error) {
		console.error('reenviar', error);
		return responder(502, { error: 'No se ha podido enviar el email. Vuelve a probar en un momento.' });
	}
	if (desdeStudio) await sb.from('registro').insert({ accion: 'reenvía acceso al portal', detalle: { promotora, email } });
	return responder(200, {
		ok: true,
		mensaje: u.user.email_confirmed_at
			? `Enviado a ${email} un enlace para elegir una contraseña nueva.`
			: `Invitación reenviada a ${email}.`,
	});
});
