// MUNE Portal · pestaña «Equipo» de una promoción (solo quien la administra).
//
// Quién tiene acceso a esta promoción, con qué capacidades, invitar a personas
// nuevas y elegir quién valida los planos comerciales y la Experiencia 3D
// (020_equipos_y_validaciones.sql). Las invitaciones las manda la función
// «invitar», igual que desde MUNE Studio.

import { alEnviar, esc, fecha, sb, traducir } from './comun';
import { CAPACIDADES, type Permisos } from './permisos';

interface Persona {
	id: number; user_id: string; promocion_id: string | null; nombre: string; email: string; cargo: string; activo: boolean;
	administra: boolean; capacidades: string[]; aceptada: boolean; ultima_entrada: string | null; editable: boolean;
}

/** Las funciones de Supabase devuelven sus errores en el cuerpo de la respuesta. */
async function errorDeFuncion(error: unknown): Promise<Error> {
	try {
		const cuerpo = await (error as { context?: Response }).context?.json();
		if (cuerpo?.error) return new Error(cuerpo.error);
	} catch { /* sin detalle */ }
	return error instanceof Error ? error : new Error(String(error));
}

function chipsCapacidades(p: Persona): string {
	if (p.administra) return `<span class="estado al-dia">${p.promocion_id ? 'Administra esta promoción' : 'Administra la promotora'}</span>`;
	const caps = CAPACIDADES.filter(([k]) => p.capacidades.includes(k));
	return caps.length ? caps.map(([, t]) => `<span class="chip">${esc(t)}</span>`).join('') : '<span class="promo-lugar">Sin capacidades</span>';
}

function estadoPersona(p: Persona): string {
	if (!p.activo) return '<span class="estado rechazado">Acceso retirado</span>';
	if (!p.aceptada) return '<span class="estado pendiente">Invitación pendiente</span>';
	return `<span class="promo-lugar">${p.ultima_entrada ? `Última entrada: ${esc(fecha(p.ultima_entrada))}` : 'Todavía no ha entrado'}</span>`;
}

function casillasCapacidades(marcadas: string[], nombre = 'capacidad'): string {
	return `<fieldset class="capacidades"><legend>Qué puede hacer</legend>${CAPACIDADES.map(([k, t]) =>
		`<label class="casilla"><input type="checkbox" name="${nombre}" value="${k}" ${marcadas.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}</fieldset>`;
}

function htmlPersona(p: Persona, permisos: Permisos): string {
	const puedeAdmin = permisos.esAdminPromotora;
	return `<article class="persona" data-persona="${p.id}">
		<div class="requisito-cabeza">
			<span><span class="requisito-nombre">${esc(p.nombre)}</span>${p.cargo ? ` <span class="promo-lugar">· ${esc(p.cargo)}</span>` : ''}<br>
				<span class="promo-lugar">${esc(p.email)}</span></span>
			${estadoPersona(p)}
		</div>
		<div class="chips"><span class="chip alcance">${p.promocion_id ? 'Esta promoción' : 'Todas las promociones'}</span>${chipsCapacidades(p)}</div>
		${p.editable ? `<div class="acciones">
			${p.activo ? `<button class="boton secundario pequeno" type="button" data-retirar>Retirar acceso</button>`
				: `<button class="boton secundario pequeno" type="button" data-devolver>Devolver acceso</button>`}
			${p.activo && !p.aceptada ? '<button class="boton secundario pequeno" type="button" data-reenviar>Reenviar invitación</button>' : ''}
		</div>
		${p.activo ? `<details class="cambiar-acceso"><summary>Cambiar lo que puede hacer</summary>
			<form class="peticion-form" data-cambiar novalidate>
				${puedeAdmin ? `<label class="casilla"><input type="checkbox" name="administra" ${p.administra ? 'checked' : ''}>
					${p.promocion_id ? 'Administra esta promoción' : 'Administra la promotora'}</label>` : ''}
				<div data-caps ${p.administra ? 'hidden' : ''}>${casillasCapacidades(p.capacidades)}</div>
				<p class="ayuda" data-todas ${p.administra ? '' : 'hidden'}>Quien administra tiene todas las capacidades.</p>
				<p class="error" role="alert"></p>
				<div class="acciones"><button class="boton pequeno" type="submit">Guardar cambios</button></div>
			</form>
		</details>` : ''}` : ''}
	</article>`;
}

/** Muestra u oculta las capacidades según la casilla «Administra». */
function conectarAdministra(form: HTMLElement): void {
	const casilla = form.querySelector<HTMLInputElement>('input[name=administra]');
	if (!casilla) return;
	const actualizar = () => {
		form.querySelector<HTMLElement>('[data-caps]')!.hidden = casilla.checked;
		form.querySelector<HTMLElement>('[data-todas]')!.hidden = !casilla.checked;
	};
	casilla.addEventListener('change', actualizar);
	actualizar();
}

export async function pintarEquipo(caja: HTMLElement, promo: { id: string; nombre: string; promotora_id: string }, permisos: Permisos,
	recargar: (mensaje?: string) => Promise<void>): Promise<void> {
	const [equipo, apPlanos, apExperiencia] = await Promise.all([
		sb.rpc('equipo_de_promotora', { p_promotora: promo.promotora_id }),
		sb.rpc('aprobadores_de', { p_promocion: promo.id, p_tipo: 'planos' }),
		sb.rpc('aprobadores_de', { p_promocion: promo.id, p_tipo: 'experiencia' }),
	]);
	for (const r of [equipo, apPlanos, apExperiencia]) if (r.error) throw r.error;
	const personas = ((equipo.data ?? []) as Persona[]).filter((p) => p.promocion_id === null || p.promocion_id === promo.id);
	const activos = personas.filter((p) => p.activo);
	const elegidos = (r: { data: unknown }) => new Set(((r.data ?? []) as { user_id: string }[]).map((x) => x.user_id));
	const selPlanos = elegidos(apPlanos);
	const selExperiencia = elegidos(apExperiencia);

	// Quién puede validar: una línea por persona (aunque tenga dos accesos).
	const candidatos = (tipo: 'planos' | 'experiencia') => {
		const vistos = new Map<string, Persona>();
		for (const p of activos) {
			if (tipo === 'planos' && !(p.administra || p.capacidades.includes('planos')) && !activos.some((q) => q.user_id === p.user_id && (q.administra || q.capacidades.includes('planos')))) continue;
			if (!vistos.has(p.user_id)) vistos.set(p.user_id, p);
		}
		return [...vistos.values()];
	};
	const bloqueAprobadores = (tipo: 'planos' | 'experiencia', titulo: string, seleccion: Set<string>) => {
		const lista = candidatos(tipo);
		const que = tipo === 'planos' ? 'los planos comerciales' : 'la Experiencia 3D';
		return `<form class="peticion-form bloque-aprobadores" data-aprobadores="${tipo}" novalidate>
			<h3>${titulo}</h3>
			${seleccion.size ? '' : `<p class="aviso">Define quién debe validar ${que} antes de iniciar la revisión.</p>`}
			<p class="ayuda">${tipo === 'planos'
				? 'Cada plano queda validado cuando lo aprueban todas las personas marcadas. Solo aparecen quienes pueden ver los planos comerciales.'
				: 'Cada tipología queda validada cuando la aprueban todas las personas marcadas.'}</p>
			${lista.length ? lista.map((p) => `<label class="casilla"><input type="checkbox" name="persona" value="${esc(p.user_id)}" ${seleccion.has(p.user_id) ? 'checked' : ''}>
				<span>${esc(p.nombre)}${p.cargo ? ` <span class="promo-lugar">· ${esc(p.cargo)}</span>` : ''}${p.aceptada ? '' : ' <span class="promo-lugar">· invitación pendiente</span>'}</span></label>`).join('')
				: '<p class="vacio">Todavía no hay nadie que pueda validar. Invita primero a las personas.</p>'}
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton pequeno" type="submit" ${lista.length ? '' : 'disabled'}>Guardar</button></div>
			<p class="ok" data-guardado role="status"></p>
		</form>`;
	};

	const admin = permisos.esAdminPromotora;
	caja.innerHTML = `
		<h2>Equipo</h2>
		<p class="ayuda">Las personas que tienen acceso a ${esc(promo.nombre)} y lo que puede hacer cada una. El cargo es solo informativo.</p>
		<div class="personas">${personas.length ? personas.map((p) => htmlPersona(p, permisos)).join('') : '<p class="vacio">Todavía no hay nadie.</p>'}</div>
		<p class="aviso" data-aviso-equipo role="status" hidden></p>

		<h2 class="separado">Invitar a una persona</h2>
		<p class="ayuda">Le llegará un email para elegir su contraseña y entrar en MUNE Portal.</p>
		<form class="peticion-form" data-invitar novalidate>
			<label>Nombre <input name="nombre" maxlength="120" autocomplete="off"></label>
			<label>Correo <input name="email" type="email" maxlength="200" autocomplete="off"></label>
			<label>Cargo (opcional) <input name="cargo" maxlength="120" placeholder="Por ejemplo: Dirección comercial" autocomplete="off"></label>
			${admin ? `<label>Acceso a <select name="alcance">
				<option value="promocion">Esta promoción</option>
				<option value="todas">Todas las promociones</option>
			</select></label>
			<label class="casilla"><input type="checkbox" name="administra"> <span data-texto-administra>Administrador de esta promoción</span></label>`
			: '<input type="hidden" name="alcance" value="promocion">'}
			<div data-caps>${casillasCapacidades([])}</div>
			<p class="ayuda" data-todas hidden>Tiene todas las capacidades.</p>
			<p class="error" role="alert"></p>
			<div class="acciones"><button class="boton" type="submit">Enviar la invitación</button></div>
		</form>

		<h2 class="separado" id="quien-valida">Quién valida</h2>
		<p class="ayuda">Las personas que tienen que aprobar cada versión antes de publicarla. Sin nadie elegido no se puede validar.</p>
		${bloqueAprobadores('planos', 'Planos comerciales', selPlanos)}
		${bloqueAprobadores('experiencia', 'Experiencia 3D', selExperiencia)}`;

	const aviso = caja.querySelector<HTMLElement>('[data-aviso-equipo]')!;
	const avisar = (texto: string, error = false) => {
		aviso.hidden = false;
		aviso.classList.toggle('error', error);
		aviso.textContent = texto;
	};

	// Cada persona: retirar, devolver, reenviar y cambiar capacidades.
	caja.querySelectorAll<HTMLElement>('[data-persona]').forEach((fila) => {
		const p = personas.find((x) => x.id === Number(fila.dataset.persona))!;
		const cambiar = (cambios: { activo?: boolean; administra?: boolean; capacidades?: string[] }) =>
			sb.rpc('cambiar_acceso', {
				p_id: p.id, p_activo: cambios.activo ?? null, p_administra: cambios.administra ?? null,
				p_capacidades: cambios.capacidades ?? null, p_cargo: null,
			});
		fila.querySelector('[data-retirar]')?.addEventListener('click', async () => {
			if (!confirm(`¿Retirar el acceso a ${p.nombre}?\n\nDejará de poder entrar desde este momento. Puedes devolvérselo más tarde.`)) return;
			const { error } = await cambiar({ activo: false });
			if (error) { avisar(traducir(error, 'retirar el acceso'), true); return; }
			await recargar(`Has retirado el acceso a ${p.nombre}.`);
		});
		fila.querySelector('[data-devolver]')?.addEventListener('click', async () => {
			const { error } = await cambiar({ activo: true });
			if (error) { avisar(traducir(error, 'devolver el acceso'), true); return; }
			await recargar(`${p.nombre} vuelve a tener acceso.`);
		});
		fila.querySelector<HTMLButtonElement>('[data-reenviar]')?.addEventListener('click', async (ev) => {
			const b = ev.currentTarget as HTMLButtonElement;
			b.disabled = true;
			const { data: r, error } = await sb.functions.invoke('invitar', {
				body: { accion: 'reenviar', promotora_id: promo.promotora_id, promocion_id: p.promocion_id, user_id: p.user_id, email: p.email },
			});
			b.disabled = false;
			if (error) avisar(traducir(await errorDeFuncion(error), 'reenviar la invitación'), true);
			else avisar(r?.mensaje ?? `Hemos reenviado la invitación a ${p.email}.`);
		});
		const form = fila.querySelector<HTMLFormElement>('[data-cambiar]');
		if (form) {
			conectarAdministra(form);
			alEnviar(form, async (d) => {
				const administra = form.querySelector<HTMLInputElement>('input[name=administra]') ? d.get('administra') === 'on' : undefined;
				const capacidades = d.getAll('capacidad').map(String);
				if (!(administra ?? p.administra) && !capacidades.length) throw new Error('Marca al menos una cosa que pueda hacer, o retírale el acceso.');
				const { error } = await cambiar({ administra, capacidades: (administra ?? p.administra) ? undefined : capacidades });
				if (error) throw error;
				await recargar(`Cambios guardados para ${p.nombre}.`);
			});
		}
	});

	// Invitar.
	const invitar = caja.querySelector<HTMLFormElement>('[data-invitar]')!;
	const alcance = invitar.querySelector<HTMLSelectElement>('select[name=alcance]');
	const casillaAdmin = invitar.querySelector<HTMLInputElement>('input[name=administra]');
	const actualizarInvitar = () => {
		const todas = alcance?.value === 'todas';
		const textoAdmin = invitar.querySelector<HTMLElement>('[data-texto-administra]');
		if (textoAdmin) textoAdmin.textContent = todas ? 'Administrador de la promotora' : 'Administrador de esta promoción';
		const esAdmin = !!casillaAdmin?.checked;
		invitar.querySelector<HTMLElement>('[data-caps]')!.hidden = esAdmin;
		invitar.querySelector<HTMLElement>('[data-todas]')!.hidden = !esAdmin;
	};
	alcance?.addEventListener('change', actualizarInvitar);
	casillaAdmin?.addEventListener('change', actualizarInvitar);
	actualizarInvitar();
	alEnviar(invitar, async (d) => {
		const nombre = String(d.get('nombre') ?? '').trim();
		const email = String(d.get('email') ?? '').trim().toLowerCase();
		if (!nombre) throw new Error('Escribe el nombre de la persona.');
		if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Escribe un correo válido.');
		const todas = admin && d.get('alcance') === 'todas';
		const administra = admin && d.get('administra') === 'on';
		const capacidades = administra ? [] : d.getAll('capacidad').map(String);
		if (!administra && !capacidades.length) throw new Error('Marca al menos una cosa que pueda hacer.');
		const { data: r, error } = await sb.functions.invoke('invitar', {
			body: {
				accion: 'invitar', promotora_id: promo.promotora_id, promocion_id: todas ? null : promo.id,
				nombre, email, cargo: String(d.get('cargo') ?? '').trim(), administra, capacidades,
			},
		});
		if (error) throw await errorDeFuncion(error);
		await recargar(r?.mensaje ?? `Hemos enviado la invitación a ${email}.`);
	});

	// Quién valida.
	caja.querySelectorAll<HTMLFormElement>('[data-aprobadores]').forEach((form) => alEnviar(form, async (d) => {
		const tipo = form.dataset.aprobadores!;
		const { error } = await sb.rpc('guardar_aprobadores', { p_promocion: promo.id, p_tipo: tipo, p_personas: d.getAll('persona').map(String) });
		if (error) throw error;
		form.querySelector<HTMLElement>('[data-guardado]')!.textContent = 'Guardado.';
		form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
		form.querySelector('.aviso')?.remove();
		if (!d.getAll('persona').length) {
			form.querySelector('h3')!.insertAdjacentHTML('afterend', `<p class="aviso">Define quién debe validar ${tipo === 'planos' ? 'los planos comerciales' : 'la Experiencia 3D'} antes de iniciar la revisión.</p>`);
		}
	}));
}
