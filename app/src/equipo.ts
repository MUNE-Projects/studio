// Equipo de una promotora en MUNE Studio (decisión 40, 020_equipos_y_validaciones.sql).
//
// Cada acceso es a una promoción o a todas las de la promotora. Puede ser de
// administración («Administrador de la promotora» si es a todas, «Administrador
// de promoción» si es a una) o con capacidades de trabajo concretas.
//
// La promotora gestiona su propio equipo en MUNE Portal (Equipo). MUNE Studio
// lo ve todo y puede cambiarlo como soporte: dar acceso (función «invitar»),
// cambiar capacidades o administración, retirar y devolver (cambiar_acceso).

import { alEnviar, esc, fecha, sb, traducir } from './comun';

export interface Acceso {
	id: number; user_id: string; promocion_id: string | null; nombre: string; email: string; cargo: string;
	activo: boolean; aceptada: boolean; ultima_entrada: string | null; administra: boolean; capacidades: string[];
}

/** Capacidades de trabajo que se pueden dar («marca» queda reservada para la Fase 2). */
export const CAPACIDADES: [string, string][] = [
	['documentacion', 'Subir documentación'],
	['planos', 'Ver y descargar planos comerciales'],
	['compradores', 'Gestionar compradores'],
	['personalizacion', 'Gestionar personalizaciones'],
	['materiales', 'Crear y descargar renders e imágenes del 3D'],
	['datos', 'Modificar datos de la promoción'],
	['marca', 'Cambiar la marca de la promoción'],
];
export const TODAS_LAS_CAPACIDADES = CAPACIDADES.map(([k]) => k);
const NOMBRE_CAPACIDAD = new Map<string, string>(CAPACIDADES);
export const nombreCapacidad = (k: string) => NOMBRE_CAPACIDAD.get(k) ?? k;

export const ADMIN_PROMOTORA = 'Administrador de la promotora';
export const ADMIN_PROMOCION = 'Administrador de promoción';

/** Error de una función de Supabase, con su mensaje en español. */
export async function errorDeFuncion(error: unknown): Promise<Error> {
	try {
		const cuerpo = await (error as { context?: Response }).context?.json();
		if (cuerpo?.error) return new Error(cuerpo.error);
	} catch { /* sin detalle */ }
	return error instanceof Error ? error : new Error(String(error));
}

export async function leerAccesos(promotora: string): Promise<Acceso[]> {
	const { data, error } = await sb.rpc('accesos', { p_promotora: promotora });
	if (error) throw error;
	return ((data ?? []) as Acceso[]).map((a) => ({ ...a, administra: !!a.administra, capacidades: a.capacidades ?? [] }));
}

/** Insignia de administración o las capacidades de un acceso. */
export function insignias(a: Pick<Acceso, 'promocion_id' | 'administra' | 'capacidades'>): string {
	if (a.administra) return `<span class="estado admin">${a.promocion_id === null ? ADMIN_PROMOTORA : ADMIN_PROMOCION}</span>`;
	if (!a.capacidades.length) return '<span class="promo-lugar">Sin capacidades</span>';
	return `<span class="chips">${a.capacidades.map((c) => `<span class="chip">${esc(nombreCapacidad(c))}</span>`).join('')}</span>`;
}

function casillasCapacidades(marcadas: string[], desactivadas: boolean): string {
	return `<fieldset class="capacidades" data-capacidades ${desactivadas ? 'disabled' : ''}>
		<legend>Qué puede hacer</legend>
		${CAPACIDADES.map(([k, t]) => `<label class="en-linea"><input type="checkbox" name="capacidad" value="${k}" ${marcadas.includes(k) ? 'checked' : ''}> ${esc(t)}</label>`).join('')}
	</fieldset>`;
}

/** Casilla de administración: al marcarla, las capacidades no hacen falta (las tiene todas). */
function casillaAdministra(todas: boolean, marcada: boolean): string {
	return `<label class="en-linea"><input type="checkbox" name="administra" ${marcada ? 'checked' : ''}> ${todas ? ADMIN_PROMOTORA : ADMIN_PROMOCION}</label>
		<p class="ayuda">${todas
			? 'Ve todas las promociones (también las futuras), gestiona el equipo y quién valida, y puede corregir los datos de la empresa.'
			: 'Tiene todas las capacidades en esta promoción, gestiona a sus personas y decide quién valida.'}</p>`;
}

function conectarCasillas(form: HTMLFormElement): void {
	const admin = form.querySelector<HTMLInputElement>('input[name=administra]');
	const caps = form.querySelector<HTMLFieldSetElement>('[data-capacidades]');
	admin?.addEventListener('change', () => { if (caps) caps.disabled = admin.checked; });
}

function leerCapacidades(d: FormData): string[] {
	return d.getAll('capacidad').map(String).filter((c) => TODAS_LAS_CAPACIDADES.includes(c));
}

function estadoAcceso(a: Acceso): [string, string] {
	return !a.activo ? ['Sin acceso', '']
		: !a.aceptada ? ['Invitación enviada', 'pendiente']
		: a.ultima_entrada ? [`Entró el ${fecha(a.ultima_entrada)}`, 'al-dia']
		: ['Aún no ha entrado', 'al-dia'];
}

/** Tabla de personas con su acceso, estado y botones (reenviar, cambiar, quitar, devolver). */
export function tablaPersonas(lista: Acceso[]): string {
	if (!lista.length) return '<p class="vacio">Nadie todavía.</p>';
	return `<div class="tabla"><table><thead><tr><th>Persona</th><th>Acceso</th><th>Estado</th><th></th></tr></thead><tbody>
		${lista.map((a) => {
			const [texto, clase] = estadoAcceso(a);
			return `<tr data-acceso="${a.id}">
				<td>${esc(a.nombre)}<br><span class="promo-lugar">${esc(a.email)}${a.cargo ? ` · ${esc(a.cargo)}` : ''}</span></td>
				<td>${insignias(a)}</td>
				<td><span class="estado ${clase}">${esc(texto)}</span></td>
				<td><div class="acciones">
					${a.activo ? `<button class="boton secundario pequeno" type="button" data-cambiar>Cambiar acceso</button>
						<button class="boton secundario pequeno" type="button" data-reenviar>Reenviar email</button>
						<button class="boton secundario pequeno" type="button" data-quitar-movil>Quitar código del móvil</button>
						<button class="boton secundario pequeno" type="button" data-quitar>Quitar acceso</button>`
						: '<button class="boton secundario pequeno" type="button" data-devolver>Devolver acceso</button>'}
				</div></td>
			</tr>
			${a.activo ? `<tr data-editar="${a.id}" hidden><td colspan="4">
				<form class="peticion-form" data-cambiar-acceso="${a.id}" novalidate>
					${casillaAdministra(a.promocion_id === null, a.administra)}
					${casillasCapacidades(a.administra ? TODAS_LAS_CAPACIDADES : a.capacidades, a.administra)}
					<label>Cargo (opcional) <input name="cargo" maxlength="120" value="${esc(a.cargo ?? '')}"></label>
					<p class="error" role="alert"></p>
					<div class="acciones">
						<button class="boton pequeno" type="submit">Guardar cambios</button>
						<button class="boton secundario pequeno" type="button" data-cerrar-edicion>Cancelar</button>
					</div>
				</form>
			</td></tr>` : ''}`;
		}).join('')}
	</tbody></table></div>`;
}

/** Botón + formulario plegado para dar acceso (a una promoción, o a todas si clave = «todas»). */
export function formAcceso(clave: string, texto: string): string {
	const todas = clave === 'todas';
	return `<div class="acciones"><button class="boton secundario pequeno" type="button" data-abrir="acceso">${esc(texto)}</button></div>
		<form class="peticion-form" data-dar-acceso="${esc(clave)}" data-plegable="acceso" novalidate hidden>
			<p class="ayuda">Normalmente es la promotora quien gestiona su equipo, en MUNE Portal (Equipo); desde aquí lo haces como soporte.
				La persona recibirá un email para crear su contraseña y entrar en MUNE Portal, con acceso ${todas ? 'a todas las promociones de la promotora' : 'a esta promoción'}.
				Si ya tenía cuenta, entra con su contraseña de siempre.</p>
			<label>Nombre <input name="nombre" maxlength="120" required></label>
			<label>Correo <input name="email" type="email" maxlength="200" required></label>
			<label>Cargo (opcional) <input name="cargo" maxlength="120" placeholder="Por ejemplo: Dirección comercial"></label>
			${casillaAdministra(todas, false)}
			${casillasCapacidades(TODAS_LAS_CAPACIDADES, false)}
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Dar acceso</button>
				<button class="boton secundario" type="button" data-cerrar>Cancelar</button>
			</div>
		</form>`;
}

/** Llama a la función «invitar». Devuelve su mensaje o lanza el error en español. */
export async function invitar(cuerpo: {
	promotora_id: string; promocion_id: string | null; nombre: string; email: string; cargo: string;
	administra: boolean; capacidades: string[];
}): Promise<string> {
	const { data, error } = await sb.functions.invoke('invitar', { body: { accion: 'invitar', ...cuerpo } });
	if (error) throw await errorDeFuncion(error);
	return (data as { mensaje: string }).mensaje;
}

async function cambiarAcceso(id: number, cambios: { activo?: boolean; administra?: boolean; capacidades?: string[]; cargo?: string }): Promise<void> {
	const { error } = await sb.rpc('cambiar_acceso', {
		p_id: id, p_activo: cambios.activo ?? null, p_administra: cambios.administra ?? null,
		p_capacidades: cambios.capacidades ?? null, p_cargo: cambios.cargo ?? null,
	});
	if (error) throw error;
}

/** Botones de cada persona y el formulario de dar acceso. */
export function conectarPersonas(raiz: HTMLElement, accesos: Acceso[], promotora: string, recargar: () => Promise<void>,
	avisar: (texto: string, esError?: boolean) => void): void {
	raiz.querySelectorAll<HTMLTableRowElement>('tr[data-acceso]').forEach((fila) => {
		const a = accesos.find((x) => x.id === Number(fila.dataset.acceso))!;
		fila.querySelector('[data-quitar]')?.addEventListener('click', async () => {
			if (!confirm(`¿Quitar el acceso a ${a.nombre}?\n\nDejará de poder entrar desde este momento. Puedes devolvérselo más tarde.`)) return;
			try { await cambiarAcceso(a.id, { activo: false }); await recargar(); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector('[data-devolver]')?.addEventListener('click', async () => {
			try { await cambiarAcceso(a.id, { activo: true }); await recargar(); } catch (e) { avisar(traducir(e), true); }
		});
		fila.querySelector<HTMLButtonElement>('[data-reenviar]')?.addEventListener('click', async (ev) => {
			const b = ev.currentTarget as HTMLButtonElement;
			b.disabled = true;
			const { data: r, error } = await sb.functions.invoke('invitar', { body: { accion: 'reenviar', promotora_id: promotora, user_id: a.user_id } });
			b.disabled = false;
			if (error) avisar(traducir(await errorDeFuncion(error)), true);
			else avisar(r.mensaje);
		});
		fila.querySelector<HTMLButtonElement>('[data-quitar-movil]')?.addEventListener('click', async (ev) => {
			if (!confirm(`¿Quitar el código del móvil a ${a.nombre}?\n\nHazlo solo si ha perdido o cambiado el móvil. La próxima vez que entre en MUNE Portal, vinculará el móvil de nuevo.`)) return;
			const b = ev.currentTarget as HTMLButtonElement;
			b.disabled = true;
			const { data: r, error } = await sb.functions.invoke('invitar', { body: { accion: 'quitar-movil', promotora_id: promotora, user_id: a.user_id } });
			b.disabled = false;
			if (error) avisar(traducir(await errorDeFuncion(error)), true);
			else avisar(r.mensaje);
		});
		const edicion = raiz.querySelector<HTMLTableRowElement>(`tr[data-editar="${a.id}"]`);
		const cambiar = fila.querySelector<HTMLButtonElement>('[data-cambiar]');
		if (edicion && cambiar) {
			const form = edicion.querySelector<HTMLFormElement>('form')!;
			conectarCasillas(form);
			cambiar.addEventListener('click', () => { edicion.hidden = !edicion.hidden; });
			form.querySelector('[data-cerrar-edicion]')!.addEventListener('click', () => { form.reset(); edicion.hidden = true; });
			alEnviar(form, async (d) => {
				const administra = d.get('administra') === 'on';
				const capacidades = administra ? a.capacidades : leerCapacidades(d);
				if (!administra && !capacidades.length) throw new Error('Marca al menos una capacidad, o márcala como administración.');
				await cambiarAcceso(a.id, { administra, capacidades, cargo: String(d.get('cargo') ?? '').trim() });
				await recargar();
				avisar(`✓ Acceso de ${a.nombre} actualizado.`);
			});
		}
	});
	raiz.querySelectorAll<HTMLFormElement>('[data-dar-acceso]').forEach((form) => {
		conectarCasillas(form);
		alEnviar(form, async (d) => {
			const clave = form.dataset.darAcceso!;
			const administra = d.get('administra') === 'on';
			const capacidades = administra ? TODAS_LAS_CAPACIDADES : leerCapacidades(d);
			if (!administra && !capacidades.length) throw new Error('Marca al menos una capacidad, o márcala como administración.');
			const mensaje = await invitar({
				promotora_id: promotora, promocion_id: clave === 'todas' ? null : clave,
				nombre: String(d.get('nombre')).trim(), email: String(d.get('email')).trim(), cargo: String(d.get('cargo')).trim(),
				administra, capacidades,
			});
			await recargar();
			avisar(mensaje);
		});
	});
}
