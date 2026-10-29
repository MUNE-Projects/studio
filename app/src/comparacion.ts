// Qué cambia en una versión respecto a la publicada (comparar versiones). El mismo
// archivo está en MUNE Studio (app/src) y en MUNE Portal (portal/src): si cambias
// uno, copia el otro.
//
// · Lo que va en la versión (cambios/cambios.json, de «preparar»): estancias y
//   superficies, huecos, equipamiento, acabados y, de cada plano que cambia, el de
//   antes, el de ahora y otro con las diferencias en rojo.
// · Lo privado (comparar_version, 034): el catálogo y los precios, lo que se ofrece
//   en cada tipología y los compradores afectados. Solo con «personalizacion» (o
//   MUNE Studio).

import type { SupabaseClient } from '@supabase/supabase-js';

interface Dependencias {
	sb: SupabaseClient;
	esc: (t: string) => string;
	traducir: (e: unknown) => string;
	/** Dirección de la vista previa (donde está la versión que se revisa). */
	base: string;
	/** Enseñar también el catálogo, los precios y los compradores afectados. */
	privado: boolean;
}
interface Cambios {
	version: string; anterior: string | null; sinComparar?: boolean;
	grupos: { titulo: string; cambios: string[] }[];
	planos: { clave: string; titulo: string; ahora: string; antes?: string; diferencias?: string; nuevo?: boolean }[];
}
interface Privado {
	sin_datos?: boolean; sin_anterior?: boolean; catalogo?: string[]; tipologias?: string[];
	afectados?: { vivienda: string; pack: string; estado: string; problemas: string[] }[];
}

const lista = (esc: Dependencias['esc'], xs: string[]) => `<ul class="lista-cambios">${xs.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;

export async function pintarComparacion(caja: HTMLElement, d: Dependencias, promocion: string, version: string): Promise<void> {
	const { esc } = d;
	const carpeta = `${d.base}/${encodeURIComponent(promocion)}/cambios`;
	let c: Cambios;
	try {
		const r = await fetch(`${carpeta}/cambios.json`, { cache: 'no-store' });
		if (!r.ok) {
			caja.hidden = true;
			return;
		}
		c = await r.json() as Cambios;
	} catch {
		caja.hidden = true;
		return;
	}
	if (c.version && c.version !== version) {
		caja.hidden = true;
		return;
	}
	caja.hidden = false;
	if (!c.anterior) {
		caja.innerHTML = `<h3>Qué cambia en la ${esc(version)}</h3><p class="vacio">Es la primera versión publicada: no hay otra con la que compararla.</p>`;
		return;
	}
	const url = (f: string) => (f.startsWith('../') ? `${d.base}/${encodeURIComponent(promocion)}/${f.slice(3)}` : `${carpeta}/${f}`);
	const imagen = (f: string | undefined, titulo: string) => f
		? `<figure><a href="${esc(url(f))}" target="_blank" rel="noopener"><img src="${esc(url(f))}" alt="${esc(titulo)}" loading="lazy"></a><figcaption>${esc(titulo)}</figcaption></figure>`
		: '';
	const datos = c.grupos.length
		? c.grupos.map((g) => `<h4>${esc(g.titulo)}</h4>${lista(esc, g.cambios)}`).join('')
		: `<p class="vacio">${c.sinComparar ? 'No se ha podido comparar con la versión anterior.' : 'No cambia nada de las viviendas (distribución, superficies, huecos, equipamiento ni acabados).'}</p>`;
	const planos = c.planos.length ? `<h4>Planos comerciales que cambian</h4>
		<p class="ayuda">Pulsa una imagen para verla en grande. En «Diferencias», lo que cambia está en rojo.</p>
		${c.planos.map((p) => `<div class="comparar-plano">
			<p><strong>${esc(p.titulo)}</strong>${p.nuevo ? ' · plano nuevo' : ''}</p>
			<div class="comparar-imagenes">
				${imagen(p.antes, `Antes (${c.anterior})`)}
				${imagen(p.ahora, `Ahora (${version})`)}
				${imagen(p.diferencias, 'Diferencias')}
			</div>
		</div>`).join('')}` : '';
	caja.innerHTML = `<h3>Qué cambia en la ${esc(version)} respecto a la ${esc(c.anterior)}</h3>
		${datos}${planos}<div data-comparar-privado></div>`;

	if (!d.privado) return;
	const zona = caja.querySelector<HTMLElement>('[data-comparar-privado]')!;
	const { data, error } = await d.sb.rpc('comparar_version', { p_promocion: promocion, p_version: version, p_anterior: c.anterior });
	if (error) return;
	const p = data as Privado;
	if (p.sin_datos) return;
	const afectados = p.afectados ?? [];
	zona.innerHTML = `
		<h4>Catálogo y precios</h4>
		${p.sin_anterior ? '<p class="vacio">La versión anterior no tenía catálogo con el que comparar.</p>'
			: (p.catalogo?.length || p.tipologias?.length) ? lista(esc, [...(p.catalogo ?? []), ...(p.tipologias ?? [])]) : '<p class="vacio">No cambia el catálogo ni los precios.</p>'}
		<h4>Compradores afectados</h4>
		${afectados.length ? `<p class="ayuda">Compradores con una selección que la versión nueva cambia. Quien ya eligió una opción la conserva; avísales si hace falta.</p>
			<div class="tabla"><table>
				<thead><tr><th>Vivienda</th><th>Pack</th><th>Estado</th><th>Qué cambia</th></tr></thead>
				<tbody>${afectados.map((a) => `<tr><td>${esc(a.vivienda)}</td><td>${esc(a.pack)}</td><td>${esc(a.estado === 'cerrada' ? 'Cerrada' : 'Seleccionada')}</td><td>${lista(esc, a.problemas)}</td></tr>`).join('')}</tbody>
			</table></div>` : '<p class="vacio">Ningún comprador se ve afectado.</p>'}`;
}
