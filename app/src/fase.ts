// Fase del proyecto de una promoción (018_fase_proyecto.sql y 019_cambio_fase.sql).
//
// La promoción indica en Documentación si su proyecto está en anteproyecto,
// proyecto básico o proyecto de ejecución. Cada documento que se sube queda
// marcado con la fase de ese momento. Cada cambio queda en el historial.
//
// Este archivo es igual en app/src y portal/src: si cambias uno, copia el otro.

import type { SupabaseClient } from '@supabase/supabase-js';

export const FASES: Record<string, string> = {
	anteproyecto: 'Anteproyecto',
	basico: 'Proyecto básico',
	ejecucion: 'Proyecto de ejecución',
};

export interface CambioFase { fase: string; desde: string }

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const dia = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

/** Texto corto para cabeceras: «Proyecto básico» o «Fase sin indicar». */
export const textoFase = (fase: string | null | undefined) => (fase && FASES[fase]) || 'Fase sin indicar';

export async function leerHistorialFases(sb: SupabaseClient, promocion: string): Promise<CambioFase[]> {
	const { data, error } = await sb.from('fases_promocion').select('fase, desde').eq('promocion_id', promocion).order('desde', { ascending: false });
	if (error) throw error;
	return (data ?? []) as CambioFase[];
}

/** Bloque «Fase del proyecto»: la actual, el historial y el cambio de fase. */
export function htmlFase(actual: string | null | undefined, historial: CambioFase[], quien: 'promotora' | 'administradora'): string {
	const desde = historial.find((h) => h.fase === actual)?.desde;
	const opciones = Object.entries(FASES).map(([k, t]) => `<option value="${k}" ${k === actual ? 'selected' : ''}>${esc(t)}</option>`).join('');
	return `<div class="bloque-fase" data-fase>
		<h3>Fase del proyecto</h3>
		${actual
			? `<p><strong>${esc(textoFase(actual))}</strong>${desde ? ` <span class="promo-lugar">desde el ${esc(dia(desde))}</span>` : ''}</p>
				<p class="ayuda">${quien === 'promotora'
					? 'Los documentos que subas quedan marcados con esta fase. Cuando el proyecto pase a otra fase, cámbiala aquí antes de subir los documentos nuevos.'
					: 'Los documentos que sube la promotora quedan marcados con esta fase.'}</p>`
			: `<p class="aviso">${quien === 'promotora'
				? 'Antes de subir documentos, indica en qué fase está el proyecto.'
				: 'La promotora todavía no ha indicado en qué fase está el proyecto.'}</p>`}
		<form class="fila-fase" data-cambiar-fase novalidate>
			<label>${actual ? 'Cambiar a' : 'Fase'} <select name="fase"><option value="">Elige una fase</option>${opciones}</select></label>
			<button class="boton secundario pequeno" type="submit">${actual ? 'Cambiar de fase' : 'Guardar la fase'}</button>
		</form>
		<p class="error" role="alert"></p>
		${historial.length > 1 ? `<details class="historial-fases"><summary>Historial de fases</summary><ul>${historial.map((h) =>
			`<li>${esc(textoFase(h.fase))} · desde el ${esc(dia(h.desde))}</li>`).join('')}</ul></details>` : ''}
	</div>`;
}

/** Conecta el cambio de fase. Llama a alCambiar después de guardar. */
export function conectarFase(raiz: HTMLElement, sb: SupabaseClient, promocion: string, actual: string | null | undefined,
	alCambiar: () => void | Promise<void>, traducir: (e: unknown) => string): void {
	const form = raiz.querySelector<HTMLFormElement>('[data-cambiar-fase]');
	if (!form) return;
	const error = raiz.querySelector<HTMLElement>('[data-fase] .error')!;
	form.addEventListener('submit', async (ev) => {
		ev.preventDefault();
		error.textContent = '';
		const fase = String(new FormData(form).get('fase') ?? '');
		if (!fase) { error.textContent = 'Elige una fase.'; return; }
		if (fase === actual) { error.textContent = 'El proyecto ya está en esa fase.'; return; }
		if (actual && !confirm(`¿Cambiar la fase del proyecto a «${textoFase(fase)}»?\n\nLos documentos que se suban a partir de ahora quedarán marcados con esta fase. Los anteriores conservan la suya.`)) return;
		const boton = form.querySelector<HTMLButtonElement>('button')!;
		boton.disabled = true;
		const { error: e } = await sb.rpc('cambiar_fase_proyecto', { p_promocion: promocion, p_fase: fase });
		boton.disabled = false;
		if (e) { error.textContent = traducir(e); return; }
		await alCambiar();
	});
}
