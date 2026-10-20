import { createClient } from '@supabase/supabase-js';

// Datos públicos del proyecto de Supabase. La clave «publishable» está pensada
// para ir en el navegador: por sí sola no da acceso a nada, las reglas de la
// base de datos (supabase/001_panel.sql) exigen contraseña + código del móvil.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA: string = import.meta.env.VITE_SUPABASE_CLAVE ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';

// La sesión vive solo en esta pestaña y caduca tras un rato sin actividad.
export const INACTIVIDAD_MAX = 30 * 60 * 1000;

export const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
	auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

export function esc(t: string): string {
	return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/**
 * ¿Es un mensaje escrito para personas? Los de nuestras reglas y funciones
 * están en español y se pueden enseñar; los técnicos (en inglés, de la base de
 * datos o del navegador) no: se quedan en la consola para diagnosticar.
 */
function paraPersonas(m: string): boolean {
	return /^[¿¡A-ZÁÉÍÓÚÑ][^\n]{2,240}$/.test(m)
		&& !/\b(the|is|of|for|with|to|violates|denied|invalid|error|failed|null|column|relation|function|syntax|jwt|token|duplicate|constraint|permission|row-level|undefined|unexpected)\b/i.test(m);
}

export function traducir(e: unknown): string {
	const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
	if (/invalid login credentials/i.test(m)) return 'El correo o la contraseña no son correctos. Revísalos y vuelve a probar.';
	if (/rate limit|too many/i.test(m)) return 'Has hecho demasiados intentos seguidos. Espera unos minutos y vuelve a probar.';
	if (/invalid totp|invalid code|expired/i.test(m)) return 'El código no es correcto o ya ha caducado. Escribe el que aparece ahora en la app.';
	if (/failed to fetch|network/i.test(m)) return 'No hay conexión a internet. Revisa la conexión y vuelve a probar.';
	if (paraPersonas(m)) return m;
	console.error('[MUNE Studio]', e);
	return GENERICO;
}

const GENERICO = 'No se ha podido completar. Vuelve a probar en un momento; si sigue pasando, díselo a Claude.';

/**
 * Error con lo que ha pasado delante: «No se ha podido X. <motivo o qué hacer>».
 * Si el motivo no es para personas, solo se dice qué hacer.
 */
export function fallo(que: string, e: unknown): string {
	const t = traducir(e);
	return t === GENERICO ? `${que}. Vuelve a probar en un momento; si sigue pasando, díselo a Claude.` : `${que}. ${t}`;
}

/** Conecta un formulario: desactiva el botón mientras trabaja y muestra errores. */
export function alEnviar(form: HTMLFormElement, accion: (datos: FormData) => Promise<void>): void {
	const boton = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
	const error = form.querySelector<HTMLElement>('.error')!;
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		boton.disabled = true;
		error.textContent = '';
		try {
			await accion(new FormData(form));
		} catch (e) {
			error.textContent = traducir(e);
			boton.disabled = false;
		}
	});
}

/** «1 aviso», «3 avisos»: número con la palabra en singular o plural. */
export const cuantos = (n: number, uno: string, varios: string) => `${n} ${n === 1 ? uno : varios}`;

export const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export async function anotar(accion: string, detalle: Record<string, unknown> = {}): Promise<void> {
	await sb.from('registro').insert({ accion, detalle });
}

/** Formularios plegados: se abren con su botón y se cierran con «Cancelar». */
export function conectarPlegables(raiz: HTMLElement): void {
	raiz.querySelectorAll<HTMLButtonElement>('[data-abrir]').forEach((b) => {
		const form = raiz.querySelector<HTMLFormElement>(`[data-plegable="${CSS.escape(b.dataset.abrir!)}"]`)!;
		b.addEventListener('click', () => { form.hidden = false; b.hidden = true; form.querySelector<HTMLElement>('input, textarea')?.focus(); });
		form.querySelector('[data-cerrar]')?.addEventListener('click', () => { form.hidden = true; form.reset(); b.hidden = false; });
	});
}

