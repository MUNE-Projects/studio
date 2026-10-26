// Regla de vistas guiadas: toda estancia principal de la tipología tiene al
// menos una vista, y las estancias grandes (o con varias zonas) más de una.
//
// Las vistas buenas se componen a mano (cámaras maestras en tipologia.json).
// Si falta alguna —una tipología nueva, una estancia que se olvidó— se genera
// una automática desde la puerta de la estancia hacia su fondo, para que el
// comprador nunca se quede sin poder ver una estancia. El Studio avisa de las
// vistas automáticas para que se sustituyan por una compuesta.

import type { Estancia, Punto, Tipologia, Vista, Vivienda } from '../modelo/tipos';
import { areaPoligono, centroide, puntoEnPoligono } from '../util/geo';
import { esCarpinteriaExterior } from '../modelo/huecos';

/** Superficie a partir de la cual una estancia pide dos vistas. */
export const SUPERFICIE_GRANDE = 25;

/** Estancias que el comprador espera ver: vivideras, baños, recibidor y la terraza. */
export function estanciasPrincipales( v: Vivienda ): Estancia[] {

	const entrada = v.huecos.find( ( h ) => h.tipo === 'entrada' );
	const exteriores = v.estancias.filter( ( e ) => e.uso === 'exterior' ).sort( ( a, b ) => b.superficie - a.superficie );
	return [
		...v.estancias.filter( ( e ) => {

			if ( e.uso === 'dia' || e.uso === 'noche' || e.uso === 'humedo' ) return true;
			// el recibidor (la estancia por la que se entra) también
			return e.uso === 'circulacion' && !! entrada && junto( e, v, entrada.muro, ( entrada.desde + entrada.hasta ) / 2, entrada.eje );

		} ),
		...exteriores.slice( 0, 1 ),
	];

}

function junto( e: Estancia, v: Vivienda, muro: string, c: number, eje: 'x' | 'y' ) {

	const r = v.muros.find( ( m ) => m.id === muro )?.rect;
	if ( ! r ) return false;
	const pts: Punto[] = eje === 'x' ? [ [ c, r[ 1 ] - 0.06 ], [ c, r[ 3 ] + 0.06 ] ] : [ [ r[ 0 ] - 0.06, c ], [ r[ 2 ] + 0.06, c ] ];
	return pts.some( ( [ x, y ] ) => puntoEnPoligono( x, y, e.poligono ) );

}

/** ¿La vista enseña la estancia? (terraza y porche cuentan como un único exterior) */
const cubre = ( x: Vista | undefined, e: Estancia, v: Vivienda ) => !! x?.estancia && ( x.estancia === e.id
	|| ( e.uso === 'exterior' && v.estancias.some( ( o ) => o.id === x.estancia && o.uso === 'exterior' ) ) );

const r3 = ( n: number ) => Math.round( n * 1000 ) / 1000;

/** Vistas automáticas de una estancia: desde su puerta hacia el fondo (y la inversa si es grande). */
export function vistasAutomaticas( e: Estancia, v: Vivienda ): Vista[] {

	const c = centroide( e.poligono );
	// punto de entrada: el centro de una puerta de la estancia, 45 cm hacia dentro
	let ojo: Punto = c;
	for ( const h of v.huecos.filter( ( x ) => ! esCarpinteriaExterior( x ) ) ) {

		const r = v.muros.find( ( m ) => m.id === h.muro )?.rect;
		if ( ! r ) continue;
		const m = ( h.desde + h.hasta ) / 2;
		const lados: Punto[] = h.eje === 'x' ? [ [ m, r[ 1 ] - 0.45 ], [ m, r[ 3 ] + 0.45 ] ] : [ [ r[ 0 ] - 0.45, m ], [ r[ 2 ] + 0.45, m ] ];
		const dentro = lados.find( ( [ x, y ] ) => puntoEnPoligono( x, y, e.poligono ) );
		if ( dentro ) {

			ojo = dentro;
			break;

		}

	}

	const lejano = ( desde: Punto ) => e.poligono.reduce( ( a, p ) => ( Math.hypot( p[ 0 ] - desde[ 0 ], p[ 1 ] - desde[ 1 ] ) > Math.hypot( a[ 0 ] - desde[ 0 ], a[ 1 ] - desde[ 1 ] ) ? p : a ) );
	const haciaCentro = ( p: Punto, f: number ): Punto => [ p[ 0 ] + ( c[ 0 ] - p[ 0 ] ) * f, p[ 1 ] + ( c[ 1 ] - p[ 1 ] ) * f ];
	const area = areaPoligono( e.poligono );
	const exterior = e.uso === 'exterior';
	const vista = ( desde: Punto, hacia: Punto, nombre: string ): Vista => ( {
		nombre, pos: [ r3( desde[ 0 ] ), exterior ? 1.6 : 1.5, r3( - desde[ 1 ] ) ], obj: [ r3( hacia[ 0 ] ), 0.95, r3( - hacia[ 1 ] ) ],
		fov: area < 8 ? 66 : 58, interior: ! exterior, estancia: e.id, automatica: true,
	} );
	const fondo = haciaCentro( lejano( ojo ), 0.3 );
	if ( area < SUPERFICIE_GRANDE ) return [ vista( ojo, fondo, e.nombre ) ];
	// estancia grande: también desde el fondo hacia la entrada
	const otro = haciaCentro( lejano( ojo ), 0.25 );
	return [ vista( ojo, fondo, `${ e.nombre } · 1` ), vista( otro, haciaCentro( ojo, 0.2 ), `${ e.nombre } · 2` ) ];

}

/** Añade a la tipología las vistas que falten según la regla. Devuelve qué se añadió. */
export function completarVistas( t: Tipologia, v: Vivienda ) {

	const añadidas: string[] = [];
	for ( const e of estanciasPrincipales( v ) ) {

		const propias = t.guiadas.filter( ( k ) => cubre( t.vistas[ k ], e, v ) );
		const necesarias = areaPoligono( e.poligono ) >= SUPERFICIE_GRANDE && e.uso !== 'exterior' ? 2 : 1;
		if ( propias.length >= necesarias ) continue;
		const nuevas = vistasAutomaticas( e, v ).slice( propias.length ? 1 : 0, necesarias );
		nuevas.forEach( ( x, i ) => {

			const k = `auto-${ e.id }-${ i + propias.length + 1 }`;
			t.vistas[ k ] = x;
			t.guiadas.push( k );
			añadidas.push( x.nombre );

		} );

	}

	if ( añadidas.length ) console.info( 'Vistas guiadas añadidas automáticamente:', añadidas.join( ', ' ) );
	return añadidas;

}

/** Revisión para el Studio: estancias sin vista compuesta, grandes con una sola vista. */
export function revisarVistas( t: Tipologia, v: Vivienda ) {

	const avisos: string[] = [];
	for ( const e of estanciasPrincipales( v ) ) {

		const propias = t.guiadas.map( ( k ) => t.vistas[ k ] ).filter( ( x ) => cubre( x, e, v ) );
		if ( ! propias.length ) avisos.push( `«${ e.nombre }» no tiene vista guiada.` );
		else if ( propias.every( ( x ) => x.automatica ) ) avisos.push( `«${ e.nombre }» solo tiene una vista automática: conviene componer una en Cámaras.` );
		if ( e.uso !== 'exterior' && areaPoligono( e.poligono ) >= SUPERFICIE_GRANDE && propias.length < 2 ) avisos.push( `«${ e.nombre }» es grande y tiene una sola vista.` );

	}

	return avisos;

}
