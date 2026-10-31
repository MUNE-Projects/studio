// Entorno real de la promoción (039_entorno.sql, decisión 64), etapa 1: en Ficha
// y datos, «Generar el entorno» pide a GitHub (función «ejecutar», acción
// «entorno») que lo descargue de fuentes públicas a partir de la referencia
// catastral; aquí se revisa en un plano: la foto aérea con la parcela, los
// edificios de alrededor con sus plantas, las calles y los árboles. Entra en el
// 3D al preparar la versión siguiente (etapa 2).

import { esc, fecha, sb, traducir } from './comun';

interface Entorno {
	generado: string; referencia: string; latlon: [ number, number ]; radio: number;
	parcela: number[][];
	edificios: { contorno: number[][]; plantas: number; enParcela: boolean }[];
	calles: { tipo: string; nombre: string | null; linea: number[][] }[];
	arboles: number[][];
	verdes: { tipo: string; contorno: number[][] }[];
	relieve: { cota: number; alturas: number[] } | null;
	orto: { archivo: string } | null;
	capas: { capa: string; que: string; fuente: string; licencia: string; fiabilidad: string }[];
	avisos: string[];
}

const PRINCIPALES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'living_street', 'service']);

/** Plano del entorno: la foto aérea y encima la parcela, los edificios, las calles y los árboles. */
function svgEntorno(e: Entorno, foto: string | null): string {
	const r = e.radio;
	const xy = (p: number[]) => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`;
	const poli = (pts: number[][]) => pts.map(xy).join(' ');
	const max = Math.max(1, ...e.edificios.map((b) => b.plantas));
	return `<svg class="plano-entorno" viewBox="${-r} ${-r} ${2 * r} ${2 * r}" role="img" aria-label="Plano del entorno de la parcela">
		${foto ? `<image href="${esc(foto)}" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="none"/>` : `<rect x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" fill="#eceae4"/>`}
		${e.verdes.map((v) => `<polygon points="${poli(v.contorno)}" fill="${v.tipo === 'water' ? '#7fb3d5' : '#8fbf7f'}" fill-opacity="0.35" stroke="none"/>`).join('')}
		${e.calles.filter((c) => PRINCIPALES.has(c.tipo)).map((c) => `<polyline points="${poli(c.linea)}" fill="none" stroke="#fff" stroke-opacity="0.85" stroke-width="${c.tipo === 'service' ? 2 : 4}" stroke-linecap="round"><title>${esc(c.nombre ?? c.tipo)}</title></polyline>`).join('')}
		${e.edificios.filter((b) => !b.enParcela).map((b) => `<polygon points="${poli(b.contorno)}" fill="#3c3a36" fill-opacity="${(0.25 + 0.55 * b.plantas / max).toFixed(2)}" stroke="#fff" stroke-width="0.6"><title>${b.plantas} planta${b.plantas === 1 ? '' : 's'}</title></polygon>`).join('')}
		${e.arboles.map((t) => `<circle cx="${t[0].toFixed(1)}" cy="${(-t[1]).toFixed(1)}" r="2" fill="#3f7d3a" fill-opacity="0.85"/>`).join('')}
		<polygon points="${poli(e.parcela)}" fill="#c2410c" fill-opacity="0.18" stroke="#c2410c" stroke-width="2.5"/>
		<g transform="translate(${r - 22} ${-r + 26})"><path d="M0 -14 L6 6 L0 2 L-6 6 Z" fill="#fff" stroke="#1c1c1a" stroke-width="1"/><text y="20" text-anchor="middle" font-size="11" fill="#fff" stroke="#1c1c1a" stroke-width="0.4">N</text></g>
		<g transform="translate(${-r + 14} ${r - 16})"><rect width="100" height="4" fill="#fff" stroke="#1c1c1a" stroke-width="0.6"/><text x="50" y="-4" text-anchor="middle" font-size="11" fill="#fff" stroke="#1c1c1a" stroke-width="0.4">100 m</text></g>
	</svg>`;
}

export async function pintarEntorno(zona: HTMLElement, id: string, referencia: string | null): Promise<void> {
	const { data: fila } = await sb.from('entornos').select('generado_en, resumen').eq('promocion_id', id).maybeSingle();
	let e: Entorno | null = null;
	let foto: string | null = null;
	if (fila) {
		const [json, img] = await Promise.all([
			sb.storage.from('entornos').download(`${id}/entorno.json`),
			sb.storage.from('entornos').createSignedUrl(`${id}/orto.jpg`, 3600),
		]);
		if (json.data) e = JSON.parse(await json.data.text()) as Entorno;
		foto = img.data?.signedUrl ?? null;
	}
	const vecinos = e ? e.edificios.filter((b) => !b.enParcela) : [];
	zona.innerHTML = `
		<h2 class="separado">Entorno real</h2>
		<p class="ayuda">Lo que rodea a la parcela, de fuentes públicas y gratuitas (Catastro, IGN y OpenStreetMap): los edificios de alrededor con sus plantas, las calles, los árboles, el relieve y la foto aérea, en unos ${e?.radio ?? 250} m. Sale de la referencia catastral de la ficha. Revísalo aquí; entrará en el 3D al preparar la versión siguiente.</p>
		${!referencia ? '<p class="aviso">Pon la referencia catastral en la ficha (arriba) para poder generarlo.</p>' : ''}
		${e ? `<p class="promo-versiones">Generado el ${esc(fecha(e.generado))} · referencia ${esc(e.referencia)} · ${vecinos.length} edificios alrededor · ${e.calles.length} calles y caminos · ${e.arboles.length} árboles${e.relieve ? ` · cota ${e.relieve.cota} m` : ''}</p>
			<div class="entorno-plano">${svgEntorno(e, foto)}</div>
			<p class="ayuda">En naranja, la parcela; en gris, los edificios de alrededor (más oscuro cuantas más plantas); en blanco, las calles; en verde, los árboles y las zonas verdes. Los edificios que hoy hay dentro de la parcela no se dibujan.</p>
			${e.avisos.length ? `<div class="aviso"><p><strong>No se ha podido descargar todo:</strong></p><ul>${e.avisos.map((a) => `<li>${esc(a)}</li>`).join('')}</ul></div>` : ''}
			<details><summary>Fuentes y fiabilidad</summary>
				<ul class="lista-simple">${e.capas.map((c) => `<li><strong>${esc(c.que)}</strong>: ${esc(c.fuente)} (${esc(c.licencia)}). ${esc(c.fiabilidad)}.</li>`).join('')}</ul>
			</details>`
		: fila ? '<p class="error">No se ha podido abrir el entorno guardado. Vuelve a generarlo.</p>' : '<p class="vacio">Todavía no se ha generado.</p>'}
		${referencia ? `<div class="acciones"><button class="boton ${e ? 'secundario' : ''}" type="button" data-generar-entorno>${e ? 'Volver a generar el entorno' : 'Generar el entorno'}</button></div>` : ''}
		<p class="aviso" data-estado-entorno role="status" hidden></p>`;

	zona.querySelector<HTMLButtonElement>('[data-generar-entorno]')?.addEventListener('click', async (ev) => {
		const boton = ev.currentTarget as HTMLButtonElement;
		const estado = zona.querySelector<HTMLElement>('[data-estado-entorno]')!;
		boton.disabled = true;
		estado.hidden = false;
		estado.textContent = 'Pidiendo el entorno…';
		const { error } = await sb.functions.invoke('ejecutar', { body: { accion: 'entorno', promocion: id } });
		if (error) {
			let mensaje = traducir(error);
			try {
				const cuerpo = await (error as { context?: Response }).context?.json() as { error?: string } | undefined;
				if (cuerpo?.error) mensaje = cuerpo.error;
			} catch { /* el mensaje genérico */ }
			estado.textContent = mensaje;
			boton.disabled = false;
			return;
		}
		estado.textContent = 'En marcha: GitHub lo está descargando y tarda unos minutos. Vuelve a esta pestaña en un rato para verlo.';
	});
}
