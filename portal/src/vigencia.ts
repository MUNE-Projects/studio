// Vigencia de planos y tipologías (044_vigencia.sql, decisión 69). Igual en
// portal/src y app/src.
//
// Cada plano comercial y cada tipología de la Experiencia 3D lleva UNA sola
// etiqueta, que responde a «¿puedo usar esto?»:
//   ✅ Al día              aprobado y sin cambios pendientes: se puede usar.
//   👀 Te toca revisar     hay una versión nueva esperando tu visto bueno.
//   ⏳ Pendiente de validar falta el visto bueno de otras personas del equipo.
//   🔄 En actualización    la promotora ha enviado planos nuevos de esa tipología
//                          (Claude lo marca al revisarlos) o ha pedido cambios:
//                          el equipo de MUNE prepara la versión nueva. Se puede
//                          descargar, avisando de que no es el último.
// Lo demás (quién ha aprobado, versiones) va en «Ver detalle».

import type { SupabaseClient } from '@supabase/supabase-js';

export interface Actualizacion {
	id: number; promocion_id: string; tipo: 'plano' | 'experiencia'; clave: string; nota: string;
	documento_id: number | null; marcada_en: string;
}

/** Lo marcado «En actualización» de una promoción (o de todas las visibles, sin promoción). */
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

export const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

export type Estado = 'al-dia' | 'te-toca' | 'pendiente' | 'actualizando';

/**
 * La etiqueta de un plano o una tipología.
 *  · `estado`: el de su validación (aprobado, parcial, pendiente, cambios, sin_aprobadores).
 *  · `marca`: si Claude lo ha puesto «En actualización».
 *  · `toca`: si a quien mira le toca darle el visto bueno.
 */
export function estadoDe(estado: string, marca: Actualizacion | null, toca: boolean): Estado {
	if (marca || estado === 'cambios') return 'actualizando';
	if (estado === 'aprobado') return 'al-dia';
	return toca ? 'te-toca' : 'pendiente';
}

const ETIQUETAS: Record<Estado, [string, string]> = {
	'al-dia': ['✅ Al día', 'al-dia'],
	'te-toca': ['👀 Te toca revisar', 'te-toca'],
	pendiente: ['⏳ Pendiente de validar', 'pendiente'],
	actualizando: ['🔄 En actualización', 'actualizando'],
};

export const chip = (e: Estado) => `<span class="estado ${ETIQUETAS[e][1]}">${ETIQUETAS[e][0]}</span>`;

/** La frase que acompaña a la etiqueta, solo cuando hace falta explicar algo. */
export function frase(esc: (s: string) => string, e: Estado, marca: Actualizacion | null, quien: 'promotora' | 'mune'): string {
	if (e !== 'actualizando') return '';
	const porque = marca
		? `${quien === 'promotora' ? 'Has enviado' : 'La promotora ha enviado'} cambios para esta tipología (${esc(fechaCorta(marca.marcada_en))}): ${esc(marca.nota)}`
		: `${quien === 'promotora' ? 'Habéis pedido' : 'La promotora ha pedido'} cambios.`;
	return `<p class="frase-vigencia">${porque} ${quien === 'promotora'
		? 'El equipo de MUNE está preparando la versión nueva. Puedes descargar este, pero no es el último.'
		: 'Va en la próxima versión.'}</p>`;
}

/**
 * Entre que la promotora sube documentación y el equipo de MUNE la revisa, las
 * etiquetas aún no lo reflejan: un aviso general lo dice. Vacío si no hay nada por revisar.
 */
export async function avisoEnRevision(sb: SupabaseClient, esc: (s: string) => string, promocion: string, quien: 'promotora' | 'mune'): Promise<string> {
	const { data } = await sb.from('documentos').select('subido_en').eq('promocion_id', promocion).eq('estado', 'pendiente')
		.order('subido_en', { ascending: false }).limit(1);
	const ultimo = (data?.[0] as { subido_en: string } | undefined)?.subido_en;
	if (!ultimo) return '';
	return `<p class="aviso aviso-revision">${quien === 'promotora'
		? `Has enviado documentación nueva (${esc(fechaCorta(ultimo))}). El equipo de MUNE la está revisando; cuando termine, verás aquí qué se actualiza.`
		: `Hay documentación nueva sin revisar (${esc(fechaCorta(ultimo))}). Al revisarla, Claude pone «En actualización» lo que cambia.`}</p>`;
}
