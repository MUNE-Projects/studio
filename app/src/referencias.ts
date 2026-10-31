// Viviendas de referencia (041_viviendas_referencia.sql, decisión 66). Igual en
// portal/src y app/src.
//
// Desde dentro de cada tipología, por las ventanas se ve lo que hay de verdad
// alrededor, según dónde esté la vivienda. La promotora elige una vivienda
// concreta de cada tipología (y variante) en MUNE Portal, en Documentación; en
// MUNE Studio se ve lo elegido y se le puede pedir por email lo que falta.

import type { SupabaseClient } from '@supabase/supabase-js';

interface Unidad {
	unidad: string; tipologia: string; espejo: boolean;
	viviendas: { ref: string; portal: string | number | null; planta: string | null }[];
	elegida: string | null; elegida_en: string | null;
}

export interface DepsReferencias {
	sb: SupabaseClient;
	esc: (s: string) => string;
	traducir: (e: unknown, accion?: string) => string;
	/** «promotora»: elige (MUNE Portal); «administradora»: lo ve y pide lo que falta (MUNE Studio). */
	modo: 'promotora' | 'administradora';
}

const nombreUnidad = (u: Unidad) => `Tipología ${u.tipologia.toUpperCase()}${u.espejo ? ' · espejo' : ''}`;
const nombreVivienda = (v: Unidad['viviendas'][number]) =>
	[v.ref, v.portal != null && v.portal !== '' ? `portal ${v.portal}` : '', v.planta ? `planta ${v.planta}` : ''].filter(Boolean).join(' · ');

/** Pinta la lista de tipologías con su vivienda de referencia. Devuelve cuántas faltan (null si no hay lista). */
export async function pintarReferencias(zona: HTMLElement, d: DepsReferencias, promocion: string): Promise<number | null> {
	const { esc } = d;
	const { data, error } = await d.sb.rpc('viviendas_para_referencia', { p_promocion: promocion });
	if (error) {
		zona.innerHTML = `<h3>Viviendas de referencia para el 3D</h3><p class="error">${esc(d.traducir(error, 'leer las viviendas'))}</p>`;
		return null;
	}
	const unidades = (data ?? []) as Unidad[];
	const faltan = unidades.filter((u) => !u.elegida).length;
	const promotora = d.modo === 'promotora';
	zona.innerHTML = `
		<h3>Viviendas de referencia para el 3D</h3>
		<p class="ayuda">${promotora
			? 'Cada tipología se repite en varias plantas y portales. Elige una vivienda concreta de cada una: desde dentro de la Experiencia 3D, por sus ventanas se verá lo que hay alrededor de esa vivienda (la urbanización en un bajo, o el entorno en una planta alta).'
			: 'La promotora elige en MUNE Portal (Documentación) una vivienda concreta de cada tipología: desde dentro de la Experiencia 3D, por sus ventanas se ve lo que hay alrededor de esa vivienda. Si falta alguna, «preparar» no sigue.'}</p>
		${!unidades.length ? `<p class="vacio">${promotora
			? 'Aparecerá cuando el equipo de MUNE haya pasado tu tabla de viviendas a la plataforma.'
			: 'Todavía no hay tabla de viviendas en los datos de la promoción.'}</p>`
		: `${faltan ? `<p class="aviso">${faltan === 1 ? 'Falta elegir 1 vivienda de referencia' : `Faltan ${faltan} viviendas de referencia`}.</p>` : '<p class="ok">Todas elegidas.</p>'}
		<ul class="lista-referencias">${unidades.map((u) => `<li data-unidad="${esc(u.unidad)}">
			<span class="referencia-tipo">${esc(nombreUnidad(u))}</span>
			${promotora
				? `<select data-elegir="${esc(u.unidad)}" aria-label="Vivienda de referencia de ${esc(nombreUnidad(u))}">
					${u.elegida ? '' : '<option value="" selected disabled>Elige una vivienda…</option>'}
					${u.viviendas.map((v) => `<option value="${esc(v.ref)}" ${v.ref === u.elegida ? 'selected' : ''}>${esc(nombreVivienda(v))}</option>`).join('')}
				</select>`
				: `<span class="${u.elegida ? '' : 'pendiente-texto'}">${u.elegida ? esc(nombreVivienda(u.viviendas.find((v) => v.ref === u.elegida) ?? { ref: u.elegida, portal: null, planta: null })) : 'Sin elegir'}</span>`}
			<span class="ok" data-guardada role="status"></span>
		</li>`).join('')}</ul>
		${!promotora && faltan ? '<div class="acciones"><button class="boton secundario" type="button" data-pedir-referencias>Pedir a la promotora que las elija</button></div><p class="aviso" data-estado-referencias role="status" hidden></p>' : ''}`}`;

	zona.querySelectorAll<HTMLSelectElement>('[data-elegir]').forEach((sel) => sel.addEventListener('change', async () => {
		const li = sel.closest('li')!;
		const estado = li.querySelector<HTMLElement>('[data-guardada]')!;
		sel.disabled = true;
		const { error: e } = await d.sb.rpc('elegir_vivienda_referencia', { p_promocion: promocion, p_unidad: sel.dataset.elegir, p_ref: sel.value });
		sel.disabled = false;
		if (e) {
			estado.className = 'error';
			estado.textContent = d.traducir(e, 'guardar la vivienda');
			return;
		}
		await pintarReferencias(zona, d, promocion);
		const nuevo = zona.querySelector<HTMLElement>(`li[data-unidad="${CSS.escape(sel.dataset.elegir!)}"] [data-guardada]`);
		if (nuevo) nuevo.textContent = '✓ Guardada';
	}));

	zona.querySelector<HTMLButtonElement>('[data-pedir-referencias]')?.addEventListener('click', async (ev) => {
		const boton = ev.currentTarget as HTMLButtonElement;
		const estado = zona.querySelector<HTMLElement>('[data-estado-referencias]')!;
		boton.disabled = true;
		estado.hidden = false;
		estado.textContent = 'Enviando…';
		const { data: r, error: e } = await d.sb.functions.invoke('avisar-promotora', { body: { tipo: 'referencias', promocion } });
		if (e) {
			let mensaje = d.traducir(e);
			try {
				const cuerpo = await (e as { context?: Response }).context?.json() as { error?: string } | undefined;
				if (cuerpo?.error) mensaje = cuerpo.error;
			} catch { /* el mensaje genérico */ }
			estado.textContent = mensaje;
			boton.disabled = false;
			return;
		}
		const res = r as { enviado?: boolean; motivo?: string; destinatarios?: number };
		estado.textContent = res.enviado
			? `✓ Email enviado a ${res.destinatarios === 1 ? '1 persona' : `${res.destinatarios} personas`} de la promotora.`
			: (res.motivo === 'Este aviso ya se había enviado' ? 'Ya se les había pedido. Se les volverá a pedir si cambia lo que falta.' : res.motivo ?? 'No se ha enviado.');
	});
	return faltan;
}
