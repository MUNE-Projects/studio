// Exteriores de cada vivienda: terrazas, balcones, porches, jardines, patios y
// rampas, en cualquier fachada y en cualquier planta. Lo comparten la visita,
// el plano comercial, el entorno y la revisión.

import type { Barandilla, Estancia, Orientacion, Punto, Vivienda } from './tipos';
import { puntoEnPoligono } from '../util/geo';

/** Todas las barandillas de la vivienda (o de la planta, tras `dePlanta`). */
export function barandillasDe( v: Vivienda ): Barandilla[] {

	const b = v.exterior.barandilla;
	return [ ...( b && b.recorrido.length > 1 ? [ { id: 'barandilla', ...b } ] : [] ), ...( v.exterior.barandillas ?? [] ).filter( ( x ) => x.recorrido.length > 1 ) ];

}

/** Exterior cubierto (porche, terraza bajo forjado). */
export const esCubierta = ( e: Estancia ) => e.uso === 'exterior' && ( e.cubierta ?? e.id === 'porche' );

/** Jardín o zona ajardinada (suelo de césped). */
export const esJardin = ( e: Estancia ) => e.suelo === 'cesped';

/** Límites en planta de todo lo construido: muros, barandillas y estancias. */
export function limites( v: Vivienda ): [ number, number, number, number ] {

	const pts: Punto[] = [
		...v.muros.flatMap( ( m ): Punto[] => [ [ m.rect[ 0 ], m.rect[ 1 ] ], [ m.rect[ 2 ], m.rect[ 3 ] ] ] ),
		...barandillasDe( v ).flatMap( ( b ) => b.recorrido ),
		...v.estancias.flatMap( ( e ) => e.poligono ),
	];
	if ( ! pts.length ) return [ 0, 0, 1, 1 ];
	const xs = pts.map( ( p ) => p[ 0 ] ), ys = pts.map( ( p ) => p[ 1 ] );
	return [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ];

}

/** Vector (en planta) hacia el que mira cada orientación: x este, y norte. */
export const HACIA: Record<Orientacion, Punto> = { n: [ 0, 1 ], s: [ 0, - 1 ], e: [ 1, 0 ], o: [ - 1, 0 ] };

/**
 * Lado principal de los exteriores: la fachada hacia la que se abren las
 * terrazas y jardines de la planta de calle (la de mayor superficie fuera de la
 * envolvente). Ahí van el césped de las zonas comunes, el seto y los árboles.
 */
export function ladoExterior( v: Vivienda ): Orientacion {

	const [ x0, y0, x1, y1 ] = limitesMuros( v );
	const cx = ( x0 + x1 ) / 2, cy = ( y0 + y1 ) / 2;
	const peso: Record<Orientacion, number> = { n: 0, s: 0, e: 0, o: 0 };
	for ( const e of v.estancias.filter( ( s ) => s.uso === 'exterior' && ! s.rampa ) ) {

		const [ ex, ey ] = e.poligono.reduce( ( a, p ) => [ a[ 0 ] + p[ 0 ] / e.poligono.length, a[ 1 ] + p[ 1 ] / e.poligono.length ], [ 0, 0 ] );
		const dx = ( ex - cx ) / Math.max( 0.1, x1 - x0 ), dy = ( ey - cy ) / Math.max( 0.1, y1 - y0 );
		const lado: Orientacion = Math.abs( dx ) > Math.abs( dy ) ? ( dx > 0 ? 'e' : 'o' ) : ( dy > 0 ? 'n' : 's' );
		peso[ lado ] += e.superficie;

	}
	// sin exteriores, el sur (el lado habitual de las fachadas principales)
	return ( Object.entries( peso ) as [ Orientacion, number ][] ).reduce( ( a, b ) => ( b[ 1 ] > a[ 1 ] ? b : a ), [ 's', 0 ] as [ Orientacion, number ] )[ 0 ];

}

function limitesMuros( v: Vivienda ): [ number, number, number, number ] {

	if ( ! v.muros.length ) return limites( v );
	const xs = v.muros.flatMap( ( m ) => [ m.rect[ 0 ], m.rect[ 2 ] ] ), ys = v.muros.flatMap( ( m ) => [ m.rect[ 1 ], m.rect[ 3 ] ] );
	return [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ];

}

/** Altura del suelo de una estancia en un punto (las rampas suben; el resto, plano). */
export function alturaSueloEn( e: Estancia, x: number, y: number ): number {

	const r = e.rampa;
	if ( ! r ) return 0;
	const xs = e.poligono.map( ( p ) => p[ 0 ] ), ys = e.poligono.map( ( p ) => p[ 1 ] );
	const [ x0, x1, y0, y1 ] = [ Math.min( ...xs ), Math.max( ...xs ), Math.min( ...ys ), Math.max( ...ys ) ];
	const t = r.sube === 'n' ? ( y - y0 ) / ( y1 - y0 ) : r.sube === 's' ? ( y1 - y ) / ( y1 - y0 ) : r.sube === 'e' ? ( x - x0 ) / ( x1 - x0 ) : ( x1 - x ) / ( x1 - x0 );
	return r.desde + ( r.hasta - r.desde ) * Math.min( 1, Math.max( 0, t ) );

}

/** Pendiente de una rampa, en tanto por uno. */
export function pendiente( e: Estancia ): number {

	const r = e.rampa;
	if ( ! r ) return 0;
	const xs = e.poligono.map( ( p ) => p[ 0 ] ), ys = e.poligono.map( ( p ) => p[ 1 ] );
	const largo = r.sube === 'n' || r.sube === 's' ? Math.max( ...ys ) - Math.min( ...ys ) : Math.max( ...xs ) - Math.min( ...xs );
	return Math.abs( r.hasta - r.desde ) / Math.max( 0.01, largo );

}

/** ¿Tiene la estancia alguna barandilla junto a su borde? */
export function conBarandilla( e: Estancia, v: Vivienda ): boolean {

	return barandillasDe( v ).some( ( b ) => b.recorrido.some( ( p ) => cercaDelBorde( p, e.poligono, 0.35 ) ) );

}

function cercaDelBorde( [ px, py ]: Punto, pol: Punto[], d: number ) {

	for ( let i = 0; i < pol.length; i ++ ) {

		const [ ax, ay ] = pol[ i ], [ bx, by ] = pol[ ( i + 1 ) % pol.length ];
		const L2 = ( bx - ax ) ** 2 + ( by - ay ) ** 2 || 1e-9;
		const t = Math.max( 0, Math.min( 1, ( ( px - ax ) * ( bx - ax ) + ( py - ay ) * ( by - ay ) ) / L2 ) );
		if ( Math.hypot( px - ( ax + t * ( bx - ax ) ), py - ( ay + t * ( by - ay ) ) ) <= d ) return true;

	}
	return puntoEnPoligono( px, py, pol );

}

/**
 * Bordes libres de una estancia (los que no están contra un muro ni una
 * barandilla), unidos en tramos: la proyección de un porche se dibuja en ellos.
 */
export function bordesLibres( e: Estancia, v: Vivienda ): Punto[][] {

	const pol = e.poligono, n = pol.length;
	const contraMuro = ( x: number, y: number ) => v.muros.some( ( m ) => x >= m.rect[ 0 ] - 0.05 && x <= m.rect[ 2 ] + 0.05 && y >= m.rect[ 1 ] - 0.05 && y <= m.rect[ 3 ] + 0.05 );
	const contraBarandilla = ( p: Punto ) => barandillasDe( v ).some( ( b ) => b.recorrido.some( ( _, i ) => i > 0 && distSegmento( p, b.recorrido[ i - 1 ], b.recorrido[ i ] ) < 0.08 ) );
	const libre = pol.map( ( a, i ) => {

		const b = pol[ ( i + 1 ) % n ];
		const m: Punto = [ ( a[ 0 ] + b[ 0 ] ) / 2, ( a[ 1 ] + b[ 1 ] ) / 2 ];
		return ! contraMuro( m[ 0 ], m[ 1 ] ) && ! contraBarandilla( m );

	} );
	if ( libre.every( Boolean ) ) return [ [ ...pol, pol[ 0 ] ] ];
	// empieza tras un borde ocupado para no partir un tramo en dos
	const inicio = libre.findIndex( ( l, i ) => ! l && libre[ ( i + 1 ) % n ] );
	const tramos: Punto[][] = [];
	let actual: Punto[] | null = null;
	for ( let k = 1; k <= n; k ++ ) {

		const i = ( inicio + k ) % n;
		if ( libre[ i ] ) {

			actual ??= [ pol[ i ] ];
			actual.push( pol[ ( i + 1 ) % n ] );

		} else if ( actual ) {

			tramos.push( actual );
			actual = null;

		}

	}
	if ( actual ) tramos.push( actual );
	return tramos;

}

function distSegmento( [ px, py ]: Punto, [ ax, ay ]: Punto, [ bx, by ]: Punto ) {

	const L2 = ( bx - ax ) ** 2 + ( by - ay ) ** 2 || 1e-9;
	const t = Math.max( 0, Math.min( 1, ( ( px - ax ) * ( bx - ax ) + ( py - ay ) * ( by - ay ) ) / L2 ) );
	return Math.hypot( px - ( ax + t * ( bx - ax ) ), py - ( ay + t * ( by - ay ) ) );

}

/**
 * Marco del entorno, en coordenadas del mundo (x este, z sur): centro de la
 * vivienda, dirección hacia su lado exterior (`w`), dirección a lo largo de esa
 * fachada (`u`), distancia del centro al borde exterior (`frente`) y tramo que
 * ocupan los exteriores a lo largo de la fachada (`t0`, `t1`, medidos desde el
 * centro). El césped, el seto y los árboles se colocan con él.
 */
export interface Marco { cx: number; cz: number; angulo: number; w: [ number, number ]; u: [ number, number ]; frente: number; t0: number; t1: number }

export function marcoEntorno( v: Vivienda ): Marco {

	const [ x0, y0, x1, y1 ] = limites( v );
	const cx = ( x0 + x1 ) / 2, cz = - ( y0 + y1 ) / 2;
	const lado = ladoExterior( v );
	const angulo = { s: 0, n: Math.PI, e: Math.PI / 2, o: - Math.PI / 2 }[ lado ];
	const w: [ number, number ] = [ Math.sin( angulo ), Math.cos( angulo ) ];
	const u: [ number, number ] = [ Math.cos( angulo ), - Math.sin( angulo ) ];
	const mundo = ( [ x, y ]: Punto ): [ number, number ] => [ x - cx, - y - cz ];
	const todos: Punto[] = [
		...v.muros.flatMap( ( m ): Punto[] => [ [ m.rect[ 0 ], m.rect[ 1 ] ], [ m.rect[ 2 ], m.rect[ 3 ] ], [ m.rect[ 0 ], m.rect[ 3 ] ], [ m.rect[ 2 ], m.rect[ 1 ] ] ] ),
		...barandillasDe( v ).flatMap( ( b ) => b.recorrido ),
		...v.estancias.flatMap( ( e ) => e.poligono ),
	];
	const exteriores: Punto[] = [ ...barandillasDe( v ).flatMap( ( b ) => b.recorrido ), ...v.estancias.filter( ( e ) => e.uso === 'exterior' && ! e.rampa ).flatMap( ( e ) => e.poligono ) ];
	const sobre = ( p: Punto, d: [ number, number ] ) => {

		const [ a, b ] = mundo( p );
		return a * d[ 0 ] + b * d[ 1 ];

	};
	const frente = Math.max( ...todos.map( ( p ) => sobre( p, w ) ), 0 );
	const ts = ( exteriores.length ? exteriores : todos ).map( ( p ) => sobre( p, u ) );
	return { cx, cz, angulo, w, u, frente, t0: Math.min( ...ts ), t1: Math.max( ...ts ) };

}
