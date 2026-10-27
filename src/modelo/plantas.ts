// Viviendas en varias plantas (dúplex, unifamiliares, sótano, garaje). Cada muro, estancia y
// elemento dice en qué planta está; los huecos van con su muro. La visita y el
// plano trabajan planta a planta con `dePlanta`.

import type { Vivienda } from './tipos';

export interface Planta { id: string; nombre: string; cota: number }

/** Plantas de la vivienda (una sola si no se indica). */
export const plantasDe = ( v: Vivienda ): Planta[] => v.plantas?.length ? v.plantas : [ { id: 'unica', nombre: 'Planta', cota: 0 } ];

export const esMultiplanta = ( v: Vivienda ) => plantasDe( v ).length > 1;

/** Planta de calle: la de cota 0 (o la más cercana). Ahí van la terraza general y el paisaje. */
export function plantaCalle( v: Vivienda ): number {

	const ps = plantasDe( v );
	return ps.reduce( ( m, p, i ) => Math.abs( p.cota ) < Math.abs( ps[ m ].cota ) ? i : m, 0 );

}

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
		// la barandilla general es de la planta de calle; las demás dicen su planta
		exterior: {
			barandilla: i === plantaCalle( v ) ? v.exterior.barandilla : undefined,
			barandillas: ( v.exterior.barandillas ?? [] ).filter( en( i ) ),
		},
		cotaPlanta: plantasDe( v )[ i ].cota,
		huella: v.estancias.filter( ( e ) => e.uso !== 'exterior' ).map( ( e ) => e.poligono ),
		plantas: undefined,
		// los muros suben hasta el suelo de la planta de encima (sin hueco entre plantas)
		alturaMuros: i < plantasDe( v ).length - 1 ? alturaEntrePlantas( v, i ) : undefined,
	};

}

/** Altura que salva la escalera que sube desde la planta i. */
export function alturaEntrePlantas( v: Vivienda, i: number ): number {

	const p = plantasDe( v );
	return p[ i + 1 ] ? p[ i + 1 ].cota - p[ i ].cota : v.alturas.libre.valor + v.alturas.forjado.valor;

}
