// Símbolo de planta de cada hueco (convención de plano de arquitectura), en
// coordenadas de planta (x este, y norte). Lo usan el plano comercial y las
// líneas de planta de la visita 3D, para que dibujen lo mismo.

import type { Hueco, Vivienda } from './tipos';
import { alturasHueco, esCarpinteriaExterior, hojasDe, ladoInterior } from './huecos';

/** jamba: límites del hueco · carpinteria: perfiles · vidrio · exterior: línea de fachada · hoja · giro: arco de la hoja · fino: corredera escondida */
export type Estilo = 'jamba' | 'carpinteria' | 'vidrio' | 'exterior' | 'hoja' | 'giro' | 'fino';
export interface Trazo { estilo: Estilo; puntos: [ number, number ][] }

export function simbolosHueco( h: Hueco, v: Vivienda ): Trazo[] {

	const [ x0, y0, x1, y1 ] = v.muros.find( ( m ) => m.id === h.muro )!.rect;
	const enX = h.eje === 'x';
	const P = ( u: number, w: number ): [ number, number ] => enX ? [ u, w ] : [ w, u ];
	const c0 = enX ? y0 : x0, c1 = enX ? y1 : x1;
	const t: Trazo[] = [];
	const lin = ( estilo: Estilo, ...pts: [ number, number ][] ) => t.push( { estilo, puntos: pts.map( ( [ u, w ] ) => P( u, w ) ) } );

	if ( h.tipo === 'paso' ) return t; // hueco sin puerta: solo el corte del muro

	if ( esCarpinteriaExterior( h ) ) {

		const lado = ladoInterior( h, v );
		const caraExt = lado > 0 ? c0 : c1;
		const wF = ( lado > 0 ? c1 : c0 ) - lado * 0.09;
		lin( 'jamba', [ h.desde, c0 ], [ h.desde, c1 ] );
		lin( 'jamba', [ h.hasta, c0 ], [ h.hasta, c1 ] );
		if ( h.apertura === 'corredera' ) {

			// hojas paralelas, solapadas
			const n = hojasDe( h ), paso = ( h.hasta - h.desde ) / n;
			for ( let i = 0; i < n; i ++ ) {

				const w = wF + ( i % 2 ? - 0.03 : 0.03 );
				lin( 'carpinteria', [ h.desde + i * paso - ( i ? 0.04 : 0 ), w ], [ h.desde + ( i + 1 ) * paso + ( i < n - 1 ? 0.04 : 0 ), w ] );

			}

		} else {

			for ( const dw of [ - 0.035, 0.035 ] ) lin( 'carpinteria', [ h.desde, wF + dw ], [ h.hasta, wF + dw ] );
			lin( 'vidrio', [ h.desde, wF ], [ h.hasta, wF ] );

		}
		// la ventana (con antepecho) se distingue de la balconera por la línea de alféizar
		lin( 'exterior', [ h.desde, caraExt ], [ h.hasta, caraExt ] );
		if ( h.tipo === 'ventana' ) {

			const caraInt = lado > 0 ? c1 : c0;
			lin( 'exterior', [ h.desde, caraInt ], [ h.hasta, caraInt ] );

		}
		return t;

	}

	if ( h.tipo === 'garaje' ) {

		// puerta seccional: la hoja en la fachada y, a trazos finos, por dónde sube por dentro
		const lado = ladoInterior( h, v );
		const wi = lado > 0 ? c1 : c0, fondo = Math.min( 2.4, alturasHueco( h, v )[ 1 ] );
		lin( 'jamba', [ h.desde, c0 ], [ h.desde, c1 ] );
		lin( 'jamba', [ h.hasta, c0 ], [ h.hasta, c1 ] );
		lin( 'hoja', [ h.desde, ( c0 + c1 ) / 2 ], [ h.hasta, ( c0 + c1 ) / 2 ] );
		lin( 'fino', [ h.desde + 0.05, wi ], [ h.desde + 0.05, wi + lado * fondo ], [ h.hasta - 0.05, wi + lado * fondo ], [ h.hasta - 0.05, wi ] );
		return t;

	}

	const pos = h.abre === 'n' || h.abre === 'e';
	const wb = pos ? c1 : c0, dw = pos ? 1 : - 1;
	const tipoHoja = h.tipo === 'entrada' ? 'abatible' : h.puerta ?? 'abatible';

	if ( tipoHoja === 'corredera' ) {

		const ancho = h.hasta - h.desde + 0.06;
		const lado = h.bisagra === 'inicio' ? - 1 : 1;
		const u0 = lado > 0 ? h.hasta - 0.05 : h.desde + 0.05 - ancho;
		lin( 'hoja', [ u0, wb + dw * 0.03 ], [ u0 + ancho, wb + dw * 0.03 ] );
		return t;

	}
	if ( tipoHoja === 'corredera-empotrada' ) {

		// la hoja escondida en el tabique, a trazos finos
		const ancho = h.hasta - h.desde;
		const lado = h.bisagra === 'inicio' ? - 1 : 1;
		const wm = ( c0 + c1 ) / 2;
		const u0 = lado > 0 ? h.hasta : h.desde - ancho;
		lin( 'fino', [ u0, wm ], [ u0 + ancho, wm ] );
		return t;

	}

	// abatible (una hoja) o doble: hoja abierta a 90° y arco de giro
	const hojas: [ 'inicio' | 'fin', number ][] = tipoHoja === 'doble'
		? [ [ 'inicio', ( h.hasta - h.desde ) / 2 - 0.02 ], [ 'fin', ( h.hasta - h.desde ) / 2 - 0.02 ] ]
		: [ [ h.bisagra ?? 'inicio', h.hasta - h.desde - 0.04 ] ];
	for ( const [ bisagra, r ] of hojas ) {

		const sg = bisagra === 'inicio' ? 1 : - 1;
		const u0 = bisagra === 'inicio' ? h.desde + 0.02 : h.hasta - 0.02;
		lin( 'hoja', [ u0, wb ], [ u0, wb + dw * r ] );
		const arco: [ number, number ][] = [];
		for ( let i = 0; i <= 24; i ++ ) {

			const a = ( i / 24 ) * Math.PI / 2;
			arco.push( [ u0 + sg * r * Math.cos( a ), wb + dw * r * Math.sin( a ) ] );

		}
		lin( 'giro', ...arco );

	}
	return t;

}

/** Zona que barre la puerta al abrir (para no poner rótulos encima), en planta. */
export function barridoHueco( h: Hueco, v: Vivienda ): [ number, number, number, number ] | null {

	if ( esCarpinteriaExterior( h ) || h.tipo === 'paso' || ( h.puerta && h.puerta.startsWith( 'corredera' ) ) ) return null;
	const pts = simbolosHueco( h, v ).flatMap( ( s ) => s.puntos );
	if ( ! pts.length ) return null;
	const xs = pts.map( ( p ) => p[ 0 ] ), ys = pts.map( ( p ) => p[ 1 ] );
	return [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ];

}
