// Planos comerciales de cada versión: enviarlos a validar (Etapa 4).
//
// Al preparar una versión, sus planos (uno por tipología y variante, o por
// vivienda) se generan y van a la vista previa con una lista, planos.json.
// Cuando la administradora ha revisado la vista previa, «Enviar los planos a la
// promotora» los copia al almacén privado «entregables» (comprobando su huella)
// y los apunta en la base de datos: desde ese momento el equipo de la promotora
// los ve en su portal y los aprueba o pide cambios. La versión solo se puede
// publicar con todos sus planos aprobados (020, función «ejecutar»). El bloque
// «Validación de vN» (planos y Experiencia 3D) está en validacion.ts.

import { anotar, sb } from './comun';

export interface PlanoManifiesto {
	clave: string; titulo: string; detalle: string; viviendas: string; orden: number;
	pdf: string; miniatura: string; huella: string; huellaDatos: string;
}
export interface Manifiesto { promocion: string; version: string; planos: PlanoManifiesto[] }

/** Lista de planos de la vista previa (null si la versión no tiene planos generados). */
export async function leerManifiesto(revision: string, id: string, version: string): Promise<Manifiesto | null> {
	try {
		const r = await fetch(`${revision}/${encodeURIComponent(id)}/planos/planos.json`, { cache: 'no-store' });
		if (!r.ok) return null;
		const m = await r.json() as Manifiesto;
		return m.version === version && Array.isArray(m.planos) ? m : null;
	} catch {
		return null;
	}
}

async function huella(datos: ArrayBuffer): Promise<string> {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', datos))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Copia los planos de la vista previa al almacén «entregables» y los apunta para la promotora. */
export async function enviarPlanos(revision: string, id: string, m: Manifiesto, progreso: (t: string) => void): Promise<void> {
	const filas = [];
	for (const [i, p] of m.planos.entries()) {
		progreso(`Preparando ${p.titulo} (${i + 1} de ${m.planos.length})…`);
		const base = `${revision}/${encodeURIComponent(id)}/planos/`;
		const [pdf, png] = await Promise.all([p.pdf, p.miniatura].map(async (f) => {
			const r = await fetch(base + encodeURIComponent(f), { cache: 'no-store' });
			if (!r.ok) throw new Error(`No se ha podido leer el archivo ${f} de la vista previa. Recarga la página y vuelve a probar.`);
			return r.arrayBuffer();
		}));
		if ((await huella(pdf)) !== p.huella) throw new Error(`El plano «${p.titulo}» de la vista previa no coincide con el que se preparó. Hay que volver a preparar la versión: díselo a Claude.`);
		const ruta = `${id}/${m.version}/${p.clave}.pdf`;
		const miniatura = `${id}/${m.version}/${p.clave}.png`;
		for (const [r, datos, tipo] of [[ruta, pdf, 'application/pdf'], [miniatura, png, 'image/png']] as const) {
			const { error } = await sb.storage.from('entregables').upload(r, datos, { contentType: tipo });
			// si ya estaba (un envío anterior que se cortó), se reutiliza: la huella se comprueba al aprobar
			if (error && !/exists|duplicate/i.test(error.message)) throw error;
		}
		filas.push({
			promocion_id: id, version: m.version, tipo: 'plano', tipologia: p.clave, nombre: `${p.titulo}.pdf`, ruta, huella: p.huella,
			clave: p.clave, titulo: p.titulo, detalle: p.detalle, viviendas: p.viviendas, orden: p.orden, miniatura, huella_datos: p.huellaDatos,
		});
	}
	progreso('Guardando los planos…');
	const { error } = await sb.from('entregables').insert(filas);
	if (error) throw error;
	// la promoción pasa a «Planos comerciales por validar» en MUNE Portal
	await sb.from('promociones').update({ estado: 'en_validacion' }).eq('id', id);
	await anotar('envía los planos a la promotora', { promocion: id, version: m.version, planos: filas.length });
}
