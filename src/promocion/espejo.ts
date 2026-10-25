// Viviendas simétricas: se espejan los DATOS de la tipología (no la escena).
// Como toda la geometría se genera a partir de los datos, el resultado es una
// vivienda correcta (normales, giros de puerta y orientación del mobiliario)
// sin crear ni mantener un segundo modelo.

import type { Ambientacion } from '../biblioteca/biblioteca';
import type { Equipamiento, Hueco, Punto, Rect, Tipologia, Alternativa, Vista, Vivienda } from '../modelo/tipos';

/** Eje de simetría: x' = S - x, con S = xmin + xmax de la envolvente. */
export function ejeSimetria( v: Vivienda ) {

	const xs = [ ...v.muros.flatMap( ( m ) => [ m.rect[ 0 ], m.rect[ 2 ] ] ), ...v.exterior.barandilla.recorrido.map( ( p ) => p[ 0 ] ) ];
	return Math.min( ...xs ) + Math.max( ...xs );

}

const r3 = ( n: number ) => Math.round( n * 1000 ) / 1000;
const rect = ( r: Rect, S: number ): Rect => [ r3( S - r[ 2 ] ), r[ 1 ], r3( S - r[ 0 ] ), r[ 3 ] ];
const punto = ( p: Punto, S: number ): Punto => [ r3( S - p[ 0 ] ), p[ 1 ] ];
const frente = ( f: Equipamiento[ 'frente' ] ) => ( { e: 'o', o: 'e', n: 'n', s: 's' } as const )[ f ];

function hueco( h: Hueco, S: number ): Hueco {

	if ( h.eje === 'x' ) {

		return {
			...h, desde: r3( S - h.hasta ), hasta: r3( S - h.desde ),
			bisagra: h.bisagra ? ( h.bisagra === 'inicio' ? 'fin' : 'inicio' ) : undefined,
		};

	}

	return { ...h, abre: h.abre === 'e' ? 'o' : h.abre === 'o' ? 'e' : h.abre };

}

const equipamiento = ( e: Equipamiento, S: number ): Equipamiento => ( { ...e, rect: rect( e.rect, S ), frente: frente( e.frente ) } );

const vista = ( v: Vista, S: number ): Vista => ( { ...v, pos: [ r3( S - v.pos[ 0 ] ), v.pos[ 1 ], v.pos[ 2 ] ], obj: [ r3( S - v.obj[ 0 ] ), v.obj[ 1 ], v.obj[ 2 ] ] } );

export function espejarVivienda( v: Vivienda, S: number ): Vivienda {

	return {
		...v,
		muros: v.muros.map( ( m ) => ( { ...m, rect: rect( m.rect, S ) } ) ),
		huecos: v.huecos.map( ( h ) => hueco( h, S ) ),
		estancias: v.estancias.map( ( e ) => ( { ...e, poligono: e.poligono.map( ( p ) => punto( p, S ) ) } ) ),
		equipamiento: v.equipamiento.map( ( e ) => equipamiento( e, S ) ),
		exterior: {
			...v.exterior,
			barandilla: {
				...v.exterior.barandilla,
				recorrido: v.exterior.barandilla.recorrido.map( ( p ) => punto( p, S ) ),
				postes_x: v.exterior.barandilla.postes_x.map( ( x ) => r3( S - x ) ),
			},
		},
	};

}

export function espejarAlternativa( v: Alternativa, S: number ): Alternativa {

	const modificar = <T extends object>( o: Record<string, Partial<T>>, f: ( x: Partial<T> ) => Partial<T> ) =>
		Object.fromEntries( Object.entries( o ).map( ( [ k, x ] ) => [ k, f( x ) ] ) );
	return {
		...v,
		vista: v.vista ? vista( v.vista, S ) : null,
		muros: {
			quitar: v.muros.quitar,
			anadir: v.muros.anadir.map( ( m ) => ( { ...m, rect: rect( m.rect, S ) } ) ),
			modificar: modificar( v.muros.modificar, ( m ) => ( m.rect ? { ...m, rect: rect( m.rect, S ) } : m ) ),
		},
		huecos: {
			quitar: v.huecos.quitar,
			anadir: v.huecos.anadir.map( ( h ) => hueco( h, S ) ),
			modificar: v.huecos.modificar,
		},
		estancias: {
			modificar: modificar( v.estancias.modificar, ( e ) => ( e.poligono ? { ...e, poligono: e.poligono.map( ( p ) => punto( p, S ) ) } : e ) ),
		},
		equipamiento: {
			quitar: v.equipamiento.quitar,
			anadir: v.equipamiento.anadir.map( ( e ) => equipamiento( e, S ) ),
			modificar: modificar( v.equipamiento.modificar, ( e ) => ( {
				...e, ...( e.rect ? { rect: rect( e.rect, S ) } : {} ), ...( e.frente ? { frente: frente( e.frente ) } : {} ),
			} ) ),
		},
	};

}

export function espejarTipologia( t: Tipologia, S: number ): Tipologia {

	return {
		...t,
		vistas: Object.fromEntries( Object.entries( t.vistas ).map( ( [ k, v ] ) => [ k, vista( v, S ) ] ) ),
		guiadas: [ ...t.guiadas ],
		piscina: t.piscina && { ...t.piscina, rect: rect( t.piscina.rect, S ) },
	};

}

/** Decoración espejada: x -> S - x y el giro cambia de signo. */
export function espejarAmbientacion( a: Ambientacion, S: number ): Ambientacion {

	return {
		...a,
		sustituciones: { ...a.sustituciones },
		decoracion: a.decoracion.map( ( d ) => ( { ...d, pos: [ r3( S - d.pos[ 0 ] ), d.pos[ 1 ] ], rot: d.rot === 0 || Math.abs( d.rot ) === 180 ? d.rot : - d.rot } ) ),
	};

}
