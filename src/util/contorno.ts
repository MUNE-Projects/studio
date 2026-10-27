// Contorno de la unión de varios polígonos (las viviendas, terrazas y núcleos de
// una planta del edificio): se rasterizan en una cuadrícula fina y se recorre su
// borde. Así el forjado y la cubierta salen de una pieza, sin juntas entre
// estancias ni huecos sobre los tabiques, sea cual sea la forma del edificio
// (en L, en U, con patio…).

import type { Punto } from '../modelo/tipos';
import { puntoEnPoligono } from './geo';

export interface Contorno {
	/** borde exterior, en sentido antihorario */
	exterior: Punto[];
	/** patios (huecos), en sentido horario */
	huecos: Punto[][];
}

const area = ( p: Punto[] ) => p.reduce( ( s, [ x, y ], i ) => {

	const [ x1, y1 ] = p[ ( i + 1 ) % p.length ];
	return s + x * y1 - x1 * y;

}, 0 ) / 2;

/** Quita los vértices alineados con sus vecinos. */
function simplificar( p: Punto[] ): Punto[] {

	const r: Punto[] = [];
	for ( let i = 0; i < p.length; i ++ ) {

		const a = p[ ( i + p.length - 1 ) % p.length ], b = p[ i ], c = p[ ( i + 1 ) % p.length ];
		const cruz = ( b[ 0 ] - a[ 0 ] ) * ( c[ 1 ] - b[ 1 ] ) - ( b[ 1 ] - a[ 1 ] ) * ( c[ 0 ] - b[ 0 ] );
		if ( Math.abs( cruz ) > 1e-9 ) r.push( b );

	}
	return r;

}

/**
 * Contornos de la unión de los polígonos, con una cuadrícula de `paso` metros.
 * `cierre` rellena rendijas más estrechas que esa medida (juntas entre
 * viviendas vecinas, medianeras con distinto grueso).
 */
export function contornos( polis: Punto[][], paso = 0.05, cierre = 0.12 ): Contorno[] {

	if ( ! polis.length ) return [];
	const xs = polis.flat().map( ( p ) => p[ 0 ] ), ys = polis.flat().map( ( p ) => p[ 1 ] );
	const m = cierre + paso * 2;
	const x0 = Math.floor( ( Math.min( ...xs ) - m ) / paso ) * paso, y0 = Math.floor( ( Math.min( ...ys ) - m ) / paso ) * paso;
	const nx = Math.ceil( ( Math.max( ...xs ) + m - x0 ) / paso ), ny = Math.ceil( ( Math.max( ...ys ) + m - y0 ) / paso );
	let celdas = new Uint8Array( nx * ny );
	for ( const pol of polis ) {

		const px = pol.map( ( p ) => p[ 0 ] ), py = pol.map( ( p ) => p[ 1 ] );
		const i0 = Math.max( 0, Math.floor( ( Math.min( ...px ) - x0 ) / paso ) ), i1 = Math.min( nx - 1, Math.ceil( ( Math.max( ...px ) - x0 ) / paso ) );
		const j0 = Math.max( 0, Math.floor( ( Math.min( ...py ) - y0 ) / paso ) ), j1 = Math.min( ny - 1, Math.ceil( ( Math.max( ...py ) - y0 ) / paso ) );
		for ( let j = j0; j <= j1; j ++ ) for ( let i = i0; i <= i1; i ++ ) {

			if ( ! celdas[ j * nx + i ] && puntoEnPoligono( x0 + ( i + 0.5 ) * paso, y0 + ( j + 0.5 ) * paso, pol ) ) celdas[ j * nx + i ] = 1;

		}

	}

	// cierre morfológico (dilatar y erosionar): une lo que está casi pegado
	const r = Math.round( cierre / paso / 2 );
	const morfo = ( src: Uint8Array, dilatar: boolean ) => {

		const out = new Uint8Array( src.length );
		for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

			let v = dilatar ? 0 : 1;
			for ( let dj = - r; dj <= r && v === ( dilatar ? 0 : 1 ); dj ++ ) for ( let di = - r; di <= r; di ++ ) {

				const ii = i + di, jj = j + dj;
				const s = ii >= 0 && jj >= 0 && ii < nx && jj < ny ? src[ jj * nx + ii ] : 0;
				if ( dilatar && s ) { v = 1; break; }
				if ( ! dilatar && ! s ) { v = 0; break; }

			}
			out[ j * nx + i ] = v;

		}
		return out;

	};
	if ( r > 0 ) celdas = morfo( morfo( celdas, true ), false );
	const lleno = ( i: number, j: number ) => i >= 0 && j >= 0 && i < nx && j < ny && celdas[ j * nx + i ] === 1;

	// aristas del borde, orientadas con lo lleno a la izquierda (vértices de la cuadrícula)
	const salidas = new Map<number, number[]>();
	const clave = ( i: number, j: number ) => j * ( nx + 1 ) + i;
	const arista = ( a: number, b: number ) => {

		if ( ! salidas.has( a ) ) salidas.set( a, [] );
		salidas.get( a )!.push( b );

	};
	for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

		if ( ! lleno( i, j ) ) continue;
		if ( ! lleno( i, j - 1 ) ) arista( clave( i, j ), clave( i + 1, j ) );
		if ( ! lleno( i + 1, j ) ) arista( clave( i + 1, j ), clave( i + 1, j + 1 ) );
		if ( ! lleno( i, j + 1 ) ) arista( clave( i + 1, j + 1 ), clave( i, j + 1 ) );
		if ( ! lleno( i - 1, j ) ) arista( clave( i, j + 1 ), clave( i, j ) );

	}

	const lazos: Punto[][] = [];
	const aPunto = ( k: number ): Punto => [ x0 + ( k % ( nx + 1 ) ) * paso, y0 + Math.floor( k / ( nx + 1 ) ) * paso ];
	for ( const inicio of [ ...salidas.keys() ] ) {

		while ( salidas.get( inicio )?.length ) {

			const lazo: Punto[] = [];
			let a = inicio, prev = - 1;
			do {

				const opciones = salidas.get( a )!;
				// en un vértice con dos salidas (esquinas que se tocan) se gira a la izquierda
				let k = 0;
				if ( opciones.length > 1 && prev >= 0 ) {

					const [ px, py ] = aPunto( prev ), [ ax, ay ] = aPunto( a );
					const giro = ( b: number ) => {

						const [ bx, by ] = aPunto( b );
						return ( ax - px ) * ( by - ay ) - ( ay - py ) * ( bx - ax );

					};
					k = opciones.reduce( ( m, b, n ) => giro( b ) > giro( opciones[ m ] ) ? n : m, 0 );

				}
				const b = opciones.splice( k, 1 )[ 0 ];
				lazo.push( aPunto( a ) );
				prev = a;
				a = b;

			} while ( a !== inicio && salidas.get( a )?.length );
			if ( lazo.length >= 4 ) lazos.push( simplificar( lazo ) );

		}

	}

	// exteriores (antihorario) y patios (horario): cada patio va con el exterior que lo contiene
	const exteriores = lazos.filter( ( l ) => area( l ) > 0 ).map( ( exterior ) => ( { exterior, huecos: [] as Punto[][] } ) );
	for ( const h of lazos.filter( ( l ) => area( l ) < 0 ) ) {

		const dueño = exteriores.find( ( e ) => puntoEnPoligono( h[ 0 ][ 0 ] + 1e-6, h[ 0 ][ 1 ] + 1e-6, e.exterior ) );
		dueño?.huecos.push( h );

	}
	return exteriores;

}

/** Desplaza un polígono ortogonal o casi (antihorario) hacia fuera `d` metros (hacia dentro si es negativo). */
export function desplazar( p: Punto[], d: number ): Punto[] {

	const n = p.length;
	return p.map( ( b, i ) => {

		const a = p[ ( i + n - 1 ) % n ], c = p[ ( i + 1 ) % n ];
		const n1 = normalFuera( a, b ), n2 = normalFuera( b, c );
		const bx = n1[ 0 ] + n2[ 0 ], by = n1[ 1 ] + n2[ 1 ];
		const cos = n1[ 0 ] * n2[ 0 ] + n1[ 1 ] * n2[ 1 ];
		const f = d / ( 1 + cos );
		return [ b[ 0 ] + bx * f, b[ 1 ] + by * f ] as Punto;

	} );

}

/** Normal exterior (a la derecha) de un lado de un polígono antihorario. */
function normalFuera( a: Punto, b: Punto ): Punto {

	const dx = b[ 0 ] - a[ 0 ], dy = b[ 1 ] - a[ 1 ], l = Math.hypot( dx, dy ) || 1;
	return [ dy / l, - dx / l ];

}
