// Estado de una promoción, calculado solo: nadie tiene que cambiarlo a mano.
//
//   · En validación: MUNE ha enviado a validar una versión que aún no está publicada.
//   · Publicada: lo último enviado ya está en la web (o no hay nada pendiente).
//   · En preparación: todavía no hay ninguna versión enviada ni publicada.
//
// Este archivo es igual en app/src y portal/src: si cambias uno, copia el otro.

import type { SupabaseClient } from '@supabase/supabase-js';

const num = (v: string) => Number(v.slice(1));

export async function estadoPromocion(sb: SupabaseClient, id: string, escaparate: string): Promise<[string, string]> {
	const [publicada, enviadas] = await Promise.all([
		fetch(`${escaparate}/${encodeURIComponent(id)}/version.json`, { cache: 'no-store' })
			.then((r) => (r.ok ? r.json() : null)).then((v) => (v as { version?: string } | null)?.version ?? null).catch(() => null),
		sb.from('entregables').select('version').eq('promocion_id', id).in('tipo', ['plano', 'experiencia']),
	]);
	const enviada = ((enviadas.data ?? []) as { version: string }[]).map((x) => x.version).sort((a, b) => num(b) - num(a))[0] ?? null;
	if (enviada && (!publicada || num(enviada) > num(publicada))) return ['En validación', 'pendiente'];
	if (publicada) return ['Publicada', 'al-dia'];
	return ['En preparación', ''];
}

/** Rellena las etiquetas <span data-estado-promo="id"> de la página. */
export function pintarEstados(raiz: ParentNode, sb: SupabaseClient, escaparate: string): void {
	raiz.querySelectorAll<HTMLElement>('[data-estado-promo]').forEach((el) => {
		void estadoPromocion(sb, el.dataset.estadoPromo!, escaparate).then(([texto, clase]) => {
			el.textContent = texto;
			el.className = `estado ${clase}`;
		});
	});
}
