// Muros a partir de rectángulos de planta + huecos.
// Cada muro se trocea en piezas (macizos, dinteles) y cada cara de cada pieza
// se subdivide según la estancia a la que mira: así un mismo tabique puede
// ser alicatado hacia el baño y pintado hacia el pasillo. Las caras que
// quedan dentro de otro muro se descartan (sin caras ocultas ni z-fighting).

import * as THREE from 'three/webgpu';
import type { Estancia, Hueco, Muro, Vivienda } from '../modelo/tipos';
import { puntoEnPoligono, puntoEnRect } from '../util/geo';
import { alturasHueco } from '../modelo/huecos';

export type ClaseCara = 'pintura' | 'alicatado' | 'fachada';

interface Pieza {
	x0: number; y0: number; x1: number; y1: number; z0: number; z1: number;
	muro: Muro;
}

/** Dintel del hueco (altura de su parte superior). */
export const alturaHueco = ( h: Hueco, v: Vivienda ) => alturasHueco( h, v )[ 1 ];

function piezas( v: Vivienda ): Pieza[] {

	const H = v.alturaMuros ?? v.alturas.libre.valor;
	const out: Pieza[] = [];
	for ( const m of v.muros ) {

		const [ x0, y0, x1, y1 ] = m.rect;
		const enX = x1 - x0 >= y1 - y0;
		const [ a0, a1 ] = enX ? [ x0, x1 ] : [ y0, y1 ];
		const huecos = v.huecos.filter( ( h ) => h.muro === m.id ).sort( ( a, b ) => a.desde - b.desde );
		const trozo = ( a: number, b: number, z0: number, z1: number ) => {

			if ( b - a < 1e-4 || z1 - z0 < 1e-4 ) return;
			out.push( enX ? { x0: a, x1: b, y0, y1, z0, z1, muro: m } : { x0, x1, y0: a, y1: b, z0, z1, muro: m } );

		};

		let cursor = a0;
		for ( const h of huecos ) {

			trozo( cursor, h.desde, 0, H );
			// antepecho (ventanas) y dintel
			const [ z0, z1 ] = alturasHueco( h, v );
			trozo( h.desde, h.hasta, 0, z0 );
			trozo( h.desde, h.hasta, z1, H );
			cursor = h.hasta;

		}

		trozo( cursor, a1, 0, H );

	}

	return out;

}

function clasificar( x: number, y: number, estancias: Estancia[] ): Estancia | null {

	for ( const e of estancias ) if ( puntoEnPoligono( x, y, e.poligono ) ) return e;
	return null;

}

export function construirMuros( v: Vivienda ) {

	const H = v.alturaMuros ?? v.alturas.libre.valor;
	const lista = piezas( v );
	const buffers: Record<ClaseCara, number[]> = { pintura: [], alicatado: [], fachada: [] };
	const normales: Record<ClaseCara, number[]> = { pintura: [], alicatado: [], fachada: [] };
	const bases: Record<ClaseCara, number[]> = { pintura: [], alicatado: [], fachada: [] };
	let baseActual = 0;

	// cuadrilátero en mundo (x, altura, -y) a partir de 4 vértices de planta+altura
	const quad = ( clase: ClaseCara, p: number[][], n: number[] ) => {

		const w = p.map( ( [ x, y, z ] ) => [ x, z, - y ] );
		const tri = [ 0, 1, 2, 0, 2, 3 ];
		for ( const i of tri ) {

			buffers[ clase ].push( ...w[ i ] );
			normales[ clase ].push( n[ 0 ], n[ 2 ], - n[ 1 ] );
			bases[ clase ].push( baseActual );

		}

	};

	const paso = 0.02;

	for ( const pz of lista ) {

		const { x0, y0, x1, y1, z0, z1 } = pz;
		baseActual = z0;
		// caras laterales: [normal en planta, recorrido]
		const caras: { n: [ number, number ]; a: [ number, number ]; b: [ number, number ] }[] = [
			{ n: [ 0, - 1 ], a: [ x0, y0 ], b: [ x1, y0 ] },
			{ n: [ 1, 0 ], a: [ x1, y0 ], b: [ x1, y1 ] },
			{ n: [ 0, 1 ], a: [ x1, y1 ], b: [ x0, y1 ] },
			{ n: [ - 1, 0 ], a: [ x0, y1 ], b: [ x0, y0 ] },
		];
		const largoPieza = Math.max( x1 - x0, y1 - y0 );

		for ( const c of caras ) {

			const L = Math.hypot( c.b[ 0 ] - c.a[ 0 ], c.b[ 1 ] - c.a[ 1 ] );
			const esExtremo = L < largoPieza - 1e-6 || ( x1 - x0 === y1 - y0 );
			const pasos = Math.max( 1, Math.ceil( L / paso ) );
			let claseActual: ClaseCara | null | undefined = undefined;
			let inicio = 0;
			const cerrar = ( t: number ) => {

				if ( claseActual ) {

					const p0 = [ c.a[ 0 ] + ( c.b[ 0 ] - c.a[ 0 ] ) * inicio, c.a[ 1 ] + ( c.b[ 1 ] - c.a[ 1 ] ) * inicio ];
					const p1 = [ c.a[ 0 ] + ( c.b[ 0 ] - c.a[ 0 ] ) * t, c.a[ 1 ] + ( c.b[ 1 ] - c.a[ 1 ] ) * t ];
					quad( claseActual, [ [ p0[ 0 ], p0[ 1 ], z0 ], [ p1[ 0 ], p1[ 1 ], z0 ], [ p1[ 0 ], p1[ 1 ], z1 ], [ p0[ 0 ], p0[ 1 ], z1 ] ], [ c.n[ 0 ], c.n[ 1 ], 0 ] );

				}

			};

			for ( let i = 0; i < pasos; i ++ ) {

				const t = ( i + 0.5 ) / pasos;
				const sx = c.a[ 0 ] + ( c.b[ 0 ] - c.a[ 0 ] ) * t + c.n[ 0 ] * 0.01;
				const sy = c.a[ 1 ] + ( c.b[ 1 ] - c.a[ 1 ] ) * t + c.n[ 1 ] * 0.01;
				let clase: ClaseCara | null;
				// dentro de otra pieza que cubre toda la altura de esta cara -> cara oculta
				const tapada = lista.some( ( o ) => o !== pz && o.z0 <= z0 + 1e-4 && o.z1 >= z1 - 1e-4 &&
					puntoEnRect( sx, sy, [ o.x0, o.y0, o.x1, o.y1 ], - 0.001 ) );
				if ( tapada ) clase = null;
				else {

					const e = clasificar( sx, sy, v.estancias );
					// sin estancia en esta planta: dentro de la casa si otra planta tiene una
					// estancia interior ahí (hueco de escalera, doble altura); si no, fachada
					if ( ! e ) clase = esExtremo || v.huella?.some( ( pol ) => puntoEnPoligono( sx, sy, pol ) ) ? 'pintura' : 'fachada';
					else if ( e.uso === 'exterior' ) clase = 'fachada';
					else if ( e.uso === 'humedo' ) clase = 'alicatado';
					else clase = 'pintura';

				}

				if ( clase !== claseActual ) {

					if ( claseActual !== undefined ) cerrar( i / pasos );
					claseActual = clase;
					inicio = i / pasos;

				}

			}

			cerrar( 1 );

		}

		// cara superior (sección) y cara inferior de dinteles
		if ( z1 >= H - 1e-4 ) quad( pz.muro.tipo === 'envolvente' ? 'fachada' : 'pintura', [ [ x0, y0, z1 ], [ x1, y0, z1 ], [ x1, y1, z1 ], [ x0, y1, z1 ] ], [ 0, 0, 1 ] );
		if ( z0 > 0 ) quad( 'pintura', [ [ x0, y0, z0 ], [ x0, y1, z0 ], [ x1, y1, z0 ], [ x1, y0, z0 ] ], [ 0, 0, - 1 ] );

	}

	const geos = {} as Record<ClaseCara, THREE.BufferGeometry>;
	for ( const k of Object.keys( buffers ) as ClaseCara[] ) {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( buffers[ k ], 3 ) );
		g.setAttribute( 'normal', new THREE.Float32BufferAttribute( normales[ k ], 3 ) );
		g.setAttribute( 'base', new THREE.Float32BufferAttribute( bases[ k ], 1 ) ); // cota inferior de la pieza (dinteles > 0)
		g.setAttribute( 'uv', new THREE.Float32BufferAttribute( new Float32Array( buffers[ k ].length / 3 * 2 ), 2 ) );
		geos[ k ] = g;

	}

	return { geos, piezas: lista };

}
