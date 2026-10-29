// Versiones de una promoción: lo publicado y lo que espera revisión.
//
// La versión de cada promoción se lee de su version.json en producción y en la
// vista previa del escaparate, y se comparan. Publicar y volver atrás pasan por
// el brazo ejecutor (función «ejecutar» de Supabase → GitHub Actions).

import { alEnviar, anotar, esc, fallo, fecha, sb, traducir } from './comun';
import { pintarComparacion } from './comparacion';
import { avisarPromotora } from './avisos';
import { apuntarSinNadaNuevo, leerValidacion, listaParaPublicar, motivoNoPublicar, pintarValidacion, type Validacion } from './validacion';

export const ESCAPARATE: string = import.meta.env.VITE_ESCAPARATE ?? 'https://experience.mune-projects.workers.dev';
export const REVISION: string = import.meta.env.VITE_REVISION ?? 'https://revision-experience.mune-projects.workers.dev';

export interface Version { version: string; fecha: string }
export interface EstadoVersiones { pub: Version | null; rev: Version | null; pendiente: boolean; sinComprobar: boolean }

/** Versión de una promoción en un entorno; null si no está o no se pudo leer. */
async function leerVersion(base: string, id: string): Promise<Version | null | 'error'> {
	try {
		const r = await fetch(`${base}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' });
		if (r.status === 404) return null;
		if (!r.ok) return 'error';
		const v = await r.json() as Version;
		return typeof v.version === 'string' ? v : 'error';
	} catch {
		return 'error';
	}
}

/** Publicada y en revisión de una promoción. */
export async function estadoVersiones(id: string): Promise<EstadoVersiones> {
	const [pubL, revL] = await Promise.all([leerVersion(ESCAPARATE, id), leerVersion(REVISION, id)]);
	const pub = pubL === 'error' ? null : pubL;
	const rev = revL === 'error' ? null : revL;
	return { pub, rev, pendiente: !!rev && rev.version !== pub?.version, sinComprobar: pubL === 'error' };
}

/** Etiqueta de estado (Al día, vN pendiente de tu revisión…). */
export function etiquetaVersiones(e: EstadoVersiones): string {
	return e.sinComprobar ? '<span class="estado">Sin comprobar</span>'
		: !e.pub && !e.rev ? '<span class="estado">Sin versiones todavía</span>'
		: !e.pub ? `<span class="estado pendiente">${esc(e.rev!.version)} por revisar</span>`
		: e.pendiente ? `<span class="estado pendiente">${esc(e.rev!.version)} por revisar</span>`
		: '<span class="estado al-dia">Al día</span>';
}

export function enlace(href: string, texto: string, accion: string, detalle: Record<string, string>, principal = false): string {
	return `<a class="boton${principal ? '' : ' secundario'}" href="${esc(href)}" target="_blank" rel="noopener noreferrer"
		data-anotar="${esc(accion)}" data-detalle="${esc(JSON.stringify(detalle))}">${esc(texto)}</a>`;
}

/** Anota en el registro los clics en enlaces externos (vista previa, publicada…). */
export function anotarEnlaces(destino: HTMLElement): void {
	destino.querySelectorAll<HTMLAnchorElement>('a[data-anotar]').forEach((a) => a.addEventListener('click', () => {
		void anotar(a.dataset.anotar!, JSON.parse(a.dataset.detalle ?? '{}'));
	}));
}

/** Versiones anteriores a la indicada: v1 … v(n-1). */
function anteriores(version: string): string[] {
	const n = Number(version.slice(1));
	return Array.from({ length: Math.max(0, n - 1) }, (_, i) => `v${i + 1}`);
}

/**
 * Lanza el brazo ejecutor y sigue el resultado mirando la versión publicada
 * hasta que cambia. Al terminar, vuelve a pintar el bloque de versiones.
 */
async function ejecutar(aviso: HTMLElement, id: string, orden: Record<string, string>, esperada: string, repintar: () => void, avisar = true): Promise<boolean> {
	aviso.hidden = false;
	aviso.classList.remove('error');
	aviso.textContent = 'Poniéndolo en marcha…';
	const { error } = await sb.functions.invoke('ejecutar', { body: orden });
	if (error) {
		let texto = error.message;
		try { texto = (await (error as { context?: Response }).context?.json())?.error ?? texto; } catch { /* sin detalle */ }
		aviso.classList.add('error');
		aviso.textContent = fallo(`No se ha podido ${orden.accion === 'aprobar' ? 'publicar' : 'volver a'} la ${esperada}`, new Error(texto));
		return false;
	}
	aviso.textContent = `En marcha: ${orden.accion === 'aprobar' ? 'publicando' : 'volviendo a'} la ${esperada}. Suele tardar 2 o 3 minutos; mientras, puedes seguir trabajando.`;
	const inicio = Date.now();
	const mirar = async (): Promise<void> => {
		const v = await leerVersion(ESCAPARATE, id);
		if (v && v !== 'error' && v.version === esperada) {
			aviso.textContent = `✓ Hecho: la ${esperada} ya es la versión publicada.`;
			if (orden.accion === 'aprobar' && avisar) aviso.textContent += ` ${await avisarPromotora({ tipo: 'publicada', promocion: id, version: esperada })}`;
			setTimeout(() => { if (aviso.isConnected) repintar(); }, 10000);
			return;
		}
		if (Date.now() - inicio > 8 * 60 * 1000) {
			aviso.classList.add('error');
			aviso.textContent = 'Está tardando más de lo normal. Recarga la página en unos minutos; si sigue sin cambiar, díselo a Claude.';
			return;
		}
		setTimeout(() => void mirar(), 15000);
	};
	setTimeout(() => void mirar(), 30000);
	return true;
}

/** Bloque de versiones de una promoción: ver, publicar y volver a una anterior. */
export async function pintarVersiones(destino: HTMLElement, p: { id: string; nombre: string; promotora_id: string; publicacion?: string }): Promise<void> {
	destino.innerHTML = '<p class="vacio">Comprobando las versiones…</p>';
	const e = await estadoVersiones(p.id);
	const { pub, rev, pendiente } = e;
	const id = p.id;
	const volver = pub ? anteriores(pub.version) : [];
	// validación de la versión en revisión (planos comerciales y Experiencia 3D): sin todo aprobado no se publica
	let validacion: Validacion | null = null;
	let bloqueo = '';
	if (pendiente) {
		try {
			validacion = await leerValidacion(REVISION, id, rev!.version, pub?.version ?? null);
			bloqueo = listaParaPublicar(validacion) ? '' : motivoNoPublicar(validacion);
		} catch (err) {
			console.error('[MUNE Studio]', err);
			bloqueo = 'No se ha podido comprobar la validación de la promotora. Recarga la página en un momento.';
		}
	}
	destino.innerHTML = `
		<div class="promo-cabeza">
			<p class="promo-versiones">${pub ? `Publicada: <strong>${esc(pub.version)}</strong> · ${esc(fecha(pub.fecha))}` : e.sinComprobar ? 'No se ha podido comprobar la versión publicada. Recarga la página en un momento.' : 'Todavía sin publicar'}
				${pendiente ? ` · En revisión: <strong>${esc(rev!.version)}</strong> · ${esc(fecha(rev!.fecha))}` : ''}</p>
			${etiquetaVersiones(e)}
		</div>
		<div class="acciones">
			${pub ? enlace(`${ESCAPARATE}/${id}/`, `Ver la publicada (${pub.version})`, 'abre la publicada', { id, version: pub.version }) : ''}
			${pendiente ? enlace(`${REVISION}/${id}/`, `Ver la vista previa (${rev!.version})`, 'abre la vista previa', { id, version: rev!.version }, true) : ''}
			${pendiente ? `<button class="boton" type="button" data-publicar ${bloqueo ? 'disabled' : ''}>Publicar ${esc(rev!.version)}</button>` : ''}
			${volver.length ? '<button class="boton secundario" type="button" data-abrir-volver>Volver a una anterior</button>' : ''}
		</div>
		${bloqueo ? `<p class="ayuda">${esc(bloqueo)}</p>` : ''}
		${pendiente && p.publicacion !== 'manual' && !validacion?.igualQue ? `<p class="ayuda">Esta promoción se publica al aprobar la promotora: cuando valide todo lo enviado, la ${esc(rev!.version)} se publicará sola y te llegará un email.</p>` : ''}
		<p class="aviso" data-progreso role="status" hidden></p>
		<div data-validacion></div>
		${pendiente ? '<section class="comparacion" data-comparacion hidden></section>' : ''}
		${volver.length ? `<form class="peticion-form" data-volver hidden novalidate>
			<label>Volver la experiencia publicada de ${esc(p.nombre)} a la
				<select name="version">${volver.reverse().map((v) => `<option>${v}</option>`).join('')}</select>
			</label>
			<label>Motivo
				<input name="motivo" maxlength="500" required placeholder="Por ejemplo: la ${esc(pub!.version)} tiene un error en el plano">
			</label>
			<p class="error" role="alert"></p>
			<div class="acciones">
				<button class="boton" type="submit">Volver</button>
				<button class="boton secundario" type="button" data-cancelar>Cancelar</button>
			</div>
		</form>` : ''}`;

	const aviso = destino.querySelector<HTMLElement>('[data-progreso]')!;
	const repintar = () => void pintarVersiones(destino, p);
	anotarEnlaces(destino);
	if (validacion) void pintarValidacion(destino.querySelector<HTMLElement>('[data-validacion]')!, REVISION, p, validacion, repintar);
	// qué cambia respecto a la publicada (comparacion.ts)
	if (pendiente) void pintarComparacion(destino.querySelector<HTMLElement>('[data-comparacion]')!, { sb, esc, traducir, base: REVISION, privado: true }, id, rev!.version);

	destino.querySelector<HTMLButtonElement>('[data-publicar]')?.addEventListener('click', async (ev) => {
		const b = ev.currentTarget as HTMLButtonElement;
		if (!confirm(`¿Publicar la ${rev!.version} de ${p.nombre}?\n\n${pub ? `Sustituirá a la ${pub.version}, la versión que ven ahora los visitantes.` : 'Será la primera versión publicada.'}`)) return;
		b.disabled = true;
		if (validacion?.igualQue) {
			// sin nada nuevo que validar: se apunta para la promotora sin avisarla y se publica
			aviso.hidden = false;
			aviso.classList.remove('error');
			try {
				if (!await apuntarSinNadaNuevo(REVISION, id, validacion, (t) => { aviso.textContent = t; })) {
					aviso.textContent = `Hay algo nuevo que validar desde la ${validacion.igualQue}: se ha enviado a la promotora para que lo valide${p.publicacion === 'manual' ? '. Podrás publicar cuando lo haga' : ' y se publicará cuando lo haga'}.`;
					setTimeout(() => { if (aviso.isConnected) repintar(); }, 8000);
					return;
				}
			} catch (err) {
				aviso.classList.add('error');
				aviso.textContent = fallo(`No se ha podido publicar la ${rev!.version}`, err);
				b.disabled = false;
				return;
			}
		}
		// sin nada nuevo que validar (una mejora de MUNE), la promotora no recibe el email de publicada
		const ok = await ejecutar(aviso, id, { accion: 'aprobar', promocion: id, version: rev!.version }, rev!.version, repintar, !validacion?.igualQue);
		if (!ok) b.disabled = false;
	});

	const abrir = destino.querySelector<HTMLButtonElement>('[data-abrir-volver]');
	const form = destino.querySelector<HTMLFormElement>('form[data-volver]');
	if (abrir && form) {
		const cerrar = () => { form.hidden = true; form.reset(); abrir.hidden = false; };
		abrir.addEventListener('click', () => { form.hidden = false; abrir.hidden = true; form.querySelector('select')!.focus(); });
		form.querySelector('[data-cancelar]')!.addEventListener('click', cerrar);
		alEnviar(form, async (d) => {
			const version = String(d.get('version'));
			const motivo = String(d.get('motivo')).trim();
			if (motivo.length < 3) throw new Error('Escribe el motivo para volver atrás.');
			if (!confirm(`¿Volver ${p.nombre} de la ${pub!.version} a la ${version}?\n\nLos visitantes verán la ${version}. La ${pub!.version} se conserva y se puede recuperar.`)) {
				form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled = false;
				return;
			}
			const ok = await ejecutar(aviso, id, { accion: 'volver', promocion: id, version, motivo }, version, repintar);
			if (ok) cerrar(); else throw new Error('No se ha podido poner en marcha. Mira el aviso de arriba.');
		});
	}
}
