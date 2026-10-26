// Viviendas en varias plantas (dúplex, unifamiliares). Cada muro, estancia y
// elemento dice en qué planta está; los huecos van con su muro. La visita y el
// plano trabajan planta a planta con `dePlanta`.

import type { Vivienda } from './tipos';

export interface Planta { id: string; nombre: string; cota: number }

/** Plantas de la vivienda (una sola si no se indica). */
export const plantasDe = ( v: Vivienda ): Planta[] => v.plantas?.length ? v.plantas : [ { id: 'unica', nombre: 'Planta', cota: 0 } ];

export const esMultiplanta = ( v: Vivienda ) => plantasDe( v ).length > 1;

const en = ( i: number ) => ( x: { planta?: number } ) => ( x.planta ?? 0 ) === i;

/** La vivienda reducida a una planta (mismas alturas y metadatos). */
export function dePlanta( v: Vivienda, i: number ): Vivienda {

	if ( ! esMultiplanta( v ) ) return v;
	const muros = v.muros.filter( en( i ) );
	const ids = new Set( muros.map( ( m ) => m.id ) );
	return {
		...v,
		muros,
		huecos: v.huecos.filter( ( h ) => ids.has( h.muro ) ),
		estancias: v.estancias.filter( en( i ) ),
		equipamiento: v.equipamiento.filter( en( i ) ).map( ( e ) => e.tipo === 'escalera' && e.sube === undefined ? { ...e, sube: alturaEntrePlantas( v, i ) } : e ),
		// la terraza de la barandilla general es de la primera planta
		exterior: i === 0 ? v.exterior : { ...v.exterior, barandilla: { recorrido: [], postes_x: [] } },
		plantas: undefined,
	};

}

/** Altura que salva la escalera que sube desde la planta i. */
export function alturaEntrePlantas( v: Vivienda, i: number ): number {

	const p = plantasDe( v );
	return p[ i + 1 ] ? p[ i + 1 ].cota - p[ i ].cota : v.alturas.libre.valor + v.alturas.forjado.valor;

}
