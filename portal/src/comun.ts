import { createClient } from '@supabase/supabase-js';

// MUNE Portal (espacio de trabajo de las promotoras) · lo común a todas las pantallas.
//
// Cada persona entra con su correo y su contraseña
// (la elige al aceptar la invitación) y solo ve las promociones de su
// promotora: lo comprueban las reglas de la base de datos
// (supabase/005_portal.sql), no esta página.
//
// Datos públicos del proyecto de Supabase: la clave «publishable» está pensada
// para ir en el navegador y por sí sola no da acceso a nada.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = import.meta.env.VITE_SUPABASE_CLAVE ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
export const ESCAPARATE: string = import.meta.env.VITE_ESCAPARATE ?? 'https://experience.mune-projects.workers.dev';
export const REVISION: string = import.meta.env.VITE_REVISION ?? 'https://revision-experience.mune-projects.workers.dev';

// La sesión vive solo en esta pestaña y caduca tras un rato sin actividad.
export const INACTIVIDAD_MAX = 60 * 60 * 1000;
export const MAX_TAM = 50 * 1024 * 1024;
export const MIN_CLAVE = 10;

// Los enlaces de los emails (invitación o contraseña nueva) llegan con la
// sesión en la dirección. Se mira de qué tipo es antes de que Supabase la lea.
const enlaceEmail = new URLSearchParams(location.hash.slice(1));
export const tipoEnlace = enlaceEmail.get('type');
export const errorEnlace = enlaceEmail.get('error_description');

export const sb = createClient(SUPABASE_URL, SUPABASE_CLAVE_PUBLICA, {
	auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export const app = document.getElementById('app')!;

export function esc(t: string): string {
	return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function pintar(html: string): void {
	app.innerHTML = html;
	app.querySelector<HTMLElement>('[autofocus]')?.focus();
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

/** Mensaje para personas. `que` completa el genérico: «No se ha podido {que}». */
export function traducir(e: unknown, que = 'completar'): string {
	const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String(e.message) : String(e);
	if (/invalid login credentials/i.test(m)) return 'El correo o la contraseña no son correctos. Revísalos y vuelve a probar.';
	if (/invalid totp|invalid code|expired/i.test(m)) return 'El código no es correcto o ya ha caducado. Escribe el que aparece ahora en la app.';
	if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
	if (/should be different/i.test(m)) return 'La contraseña nueva tiene que ser distinta de la anterior.';
	if (/password/i.test(m) && /weak|short|characters/i.test(m)) return `La contraseña es demasiado débil. Usa al menos ${MIN_CLAVE} caracteres, mezclando letras y números.`;
	if (/payload too large|exceeded the maximum/i.test(m)) return 'El archivo pesa más de 50 MB y no se ha podido subir. Si necesitas enviar uno más grande, escribe al equipo de MUNE.';
	if (/failed to fetch|network/i.test(m)) return 'No se ha podido conectar. Revisa tu conexión a internet y vuelve a probar.';
	if (paraPersonas(m)) return m;
	console.error('[MUNE Portal]', e);
	return `No se ha podido ${que}. Vuelve a probar en unos minutos y, si sigue pasando, escribe al equipo de MUNE.`;
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

export const CABECERA = '<p class="marca">MUNE Portal</p>';
export const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
