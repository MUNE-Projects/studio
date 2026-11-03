// Vigencia de planos y tipologías (044_vigencia.sql, decisión 69). Igual en
// portal/src y app/src.
//
// Cada plano comercial y cada tipología de la Experiencia 3D se ve como
// «Vigente» (aprobado, en la versión publicada o la última validada),
// «Pendiente de validar» (en la versión que se valida) o «Requiere actualizar»:
// el equipo de MUNE lo marca cuando la documentación nueva de la promotora
// cambia algo ya preparado, y se resuelve al preparar la versión que lo incorpora.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Actualizacion {
	id: number; promocion_id: string; tipo: 'plano' | 'experiencia'; clave: string; nota: string;
	documento_id: number | null; marcada_en: string;
}

/** Las marcas abiertas de una promoción (o de todas las visibles, sin promoción). */
export async function leerActualizaciones(sb: SupabaseClient, promocion?: string): Promise<Actualizacion[]> {
	let q = sb.from('actualizaciones').select('id, promocion_id, tipo, clave, nota, documento_id, marcada_en')
		.is('resuelta_en', null).is('quitada_en', null).order('marcada_en');
	if (promocion) q = q.eq('promocion_id', promocion);
	const { data, error } = await q;
	// sin 044 pegado todavía: como si no hubiera ninguna
	if (error) return [];
	return (data ?? []) as Actualizacion[];
}

export const deElemento = (abiertas: Actualizacion[], tipo: Actualizacion['tipo'], clave: string) =>
	abiertas.find((a) => a.tipo === tipo && a.clave === clave) ?? null;

const fecha = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

/**
 * La etiqueta de un plano o una tipología: «Requiere actualizar» si está
 * marcado; «Vigente» si está aprobado en la versión vigente; si no, la de su
 * validación (`normal`).
 */
export function chipVigencia(esc: (s: string) => string, estado: string, marca: Actualizacion | null, enVersionVigente: boolean, normal: string): string {
	if (marca) return `<span class="estado rechazado" title="${esc(marca.nota)}">Requiere actualizar</span>`;
	if (estado === 'aprobado' && enVersionVigente) return '<span class="estado al-dia">Vigente</span>';
	return normal;
}

/** La nota de por qué requiere actualizar, debajo del título. */
export function htmlMarca(esc: (s: string) => string, marca: Actualizacion | null, quien: 'promotora' | 'administradora'): string {
	if (!marca) return '';
	return `<p class="aviso aviso-actualizar"><strong>Requiere actualizar</strong> (desde el ${esc(fecha(marca.marcada_en))}): ${esc(marca.nota)}
		${quien === 'promotora' ? ' El equipo de MUNE lo incorporará en la próxima versión, que volverás a validar.' : ''}</p>`;
}
