// Huecos: alturas, lado interior y tipo de carpintería, comunes al 3D, a las
// líneas de planta, a la luz, a la navegación y al plano comercial.

import type { Hueco, Muro, Vivienda } from './tipos';
import { puntoEnPoligono } from '../util/geo';

/** Ventanas y balconeras: carpintería exterior (vidrio, persiana). */
export const esCarpinteriaExterior = ( h: Hueco ) => h.tipo === 'balconera' || h.tipo === 'ventana';

/** Huecos por los que se pasa (en la visita y en el plano llevan giro o paso). */
export const sePuedeCruzar = ( h: Hueco ) => h.tipo === 'puerta' || h.tipo === 'paso';

/** Puerta de garaje sin altura en la documentación: la habitual. */
export const ALTO_GARAJE = 2.2;

/** Alturas del hueco sobre el suelo: [arranque, dintel]. */
export function alturasHueco( h: Hueco, v: Vivienda ): [ number, number ] {

	const A = v.alturas;
	switch ( h.tipo ) {

		case 'entrada': return [ 0, h.alto ?? A.puerta_entrada.valor ];
		case 'balconera': return [ 0, h.alto ?? A.balconera.valor ];
		case 'garaje': return [ 0, h.alto ?? ALTO_GARAJE ];
		case 'ventana': return [ h.antepecho ?? A.antepecho?.valor ?? 0.9, h.alto ?? A.ventana?.valor ?? A.balconera.valor ];
		default: return [ 0, h.alto ?? A.puerta_interior.valor ];

	}

}

/** Hojas de una carpintería exterior. */
export const hojasDe = ( h: Hueco ) => Math.max( 1, Math.min( 4, Math.round( h.hojas ?? ( h.hasta - h.desde < 0.9 ? 1 : 2 ) ) ) );

/**
 * Cara interior del muro de un hueco: +1 si la vivienda queda en el lado de
 * coordenada mayor (y1 en muros a lo largo de x; x1 en muros a lo largo de y),
 * −1 si queda en el menor. Sirve para cualquier fachada.
 */
export function ladoInterior( h: Hueco, v: Vivienda ): 1 | - 1 {

	const m = v.muros.find( ( w ) => w.id === h.muro ) as Muro;
	const [ x0, y0, x1, y1 ] = m.rect;
	const u = ( h.desde + h.hasta ) / 2;
	const interiores = v.estancias.filter( ( e ) => e.uso !== 'exterior' );
	const dentro = ( x: number, y: number ) => interiores.some( ( e ) => puntoEnPoligono( x, y, e.poligono ) );
	const [ mas, menos ] = h.eje === 'x' ? [ dentro( u, y1 + 0.25 ), dentro( u, y0 - 0.25 ) ] : [ dentro( x1 + 0.25, u ), dentro( x0 - 0.25, u ) ];
	return mas || ! menos ? 1 : - 1;

}
