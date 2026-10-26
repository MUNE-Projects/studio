// Altura del techo en cada punto: la general de la vivienda, un falso techo
// más bajo o un techo inclinado (estancia.techo). La usan techos, focos,
// armarios hasta el techo, volúmenes y la comprobación automática.

import type { Estancia, Vivienda } from './tipos';
import { puntoEnPoligono } from '../util/geo';

/** Altura del techo de una estancia en el punto (x, y) de planta. */
export function alturaEn( e: Estancia, v: Vivienda, x: number, y: number ): number {

	const H = v.alturas.libre.valor;
	const t = e.techo;
	if ( ! t ) return H;
	if ( ! t.inclinado ) return t.altura ?? H;
	const { bajo, alto, sube } = t.inclinado;
	const xs = e.poligono.map( ( p ) => p[ 0 ] ), ys = e.poligono.map( ( p ) => p[ 1 ] );
	const [ x0, x1, y0, y1 ] = [ Math.min( ...xs ), Math.max( ...xs ), Math.min( ...ys ), Math.max( ...ys ) ];
	const f = sube === 'n' ? ( y - y0 ) / ( y1 - y0 ) : sube === 's' ? ( y1 - y ) / ( y1 - y0 )
		: sube === 'e' ? ( x - x0 ) / ( x1 - x0 ) : ( x1 - x ) / ( x1 - x0 );
	return bajo + Math.max( 0, Math.min( 1, f ) ) * ( alto - bajo );

}

/** Altura del techo en un punto de la vivienda (la general si no cae en ninguna estancia). */
export function alturaTecho( v: Vivienda, x: number, y: number ): number {

	const e = v.estancias.find( ( s ) => s.uso !== 'exterior' && puntoEnPoligono( x, y, s.poligono ) );
	return e ? alturaEn( e, v, x, y ) : v.alturas.libre.valor;

}

/** Altura más baja y más alta del techo de una estancia. */
export function alturasEstancia( e: Estancia, v: Vivienda ): [ number, number ] {

	const t = e.techo;
	if ( t?.inclinado ) return [ Math.min( t.inclinado.bajo, t.inclinado.alto ), Math.max( t.inclinado.bajo, t.inclinado.alto ) ];
	const h = t?.altura ?? v.alturas.libre.valor;
	return [ h, h ];

}
