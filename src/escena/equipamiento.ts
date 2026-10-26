// Mobiliario y equipamiento modelados por código.
//
// Cada pieza se construye en un marco local canónico: ancho W en x, fondo D
// en z con el frente mirando a +z, y en metros desde el suelo. Después se
// gira según `frente` y se coloca en el centro de su rectángulo de planta.

import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Equipamiento, Vivienda } from '../modelo/tipos';
import { unir } from '../util/geo';
import * as M from './materiales';
import { activoPara, construirActivo, activo as buscarActivo, type Ambientacion } from '../biblioteca/biblioteca';
import { alturaTecho } from '../modelo/alturas';

/**
 * Clave de material: una de las fijas (`lacado`, `cuarzo`…) o una dinámica
 * `tipo:#color` (tela, madera, metal, ceramica, marmol, emisivo, hoja,
 * terracota, lienzo) que se crea y se reutiliza bajo demanda.
 */
export type Clave = string;
const dinamicos = new Map<string, THREE.Material>();

export function materialDinamico( k: string ): THREE.Material {

	if ( MAT && k in MAT ) return ( MAT as Record<string, THREE.Material> )[ k ];
	if ( dinamicos.has( k ) ) return dinamicos.get( k )!;
	const [ tipo, tono = '#cccccc', extra ] = k.split( ':' );
	// todos los acabados comparten el material único: solo cambian colores y valores
	const m = crearDinamico( tipo, tono, extra );
	dinamicos.set( k, m );
	return m;

}

function crearDinamico( tipo: string, tono: string, extra?: string ): THREE.Material {

	let m: THREE.Material;
	switch ( tipo ) {

		case 'tela': m = M.textil( tono, extra ? Number( extra ) : 1 ); break;
		case 'boucle': m = M.boucle( tono ); break;
		case 'madera': m = M.madera( tono, M.oscurecer( tono, 0.78 ), 0.55 ); break;
		case 'metal': m = M.metalico( tono, 0.32 ); break;
		case 'ceramica': m = M.liso( tono, 0.28 ); break;
		case 'marmol': m = M.marmol( tono ); break;
		case 'terracota': m = M.liso( tono, 0.85 ); break;
		case 'hoja': m = M.hoja( tono ); break;
		case 'emisivo': m = M.emisivo( tono, extra ? Number( extra ) : 2 ); break;
		case 'lienzo': m = M.lienzo( tono.split( ',' ) ); break;
		case 'vidrio': m = M.vidrio( tono, 0.35 ); break;
		default: m = M.liso( tono, 0.7 );

	}

	return m;

}

function crearMateriales() {

	return {
		lacado: M.lacado( '#f2f0eb', 0.4 ),
		laminado: M.laminadoCocina(),
		zocalo: M.liso( '#3a3a39', 0.6 ),
		sombra: M.liso( '#1b1b1b', 0.9 ),
		cuarzo: M.cuarzo(),
		inox: M.metalico( '#cdd0d1', 0.28 ),
		cromo: M.metalico( '#c4c6c7', 0.22 ),
		negro: M.negroBrillo(),
		ceramica: M.ceramica(),
		madera: M.madera(),
		tapiceria: M.textil( '#d3ccc0' ),
		tapiceriaSilla: M.textil( '#e2dcd1' ),
		cojin: M.textil( '#e8e3da' ),
		ropa: M.textil( '#f4f2ed', 0.8 ),
		cabecero: M.textil( '#c9bfb0' ),
		metalNegro: M.liso( '#202020', 0.45, 0.7 ),
		vidrio: M.vidrio( '#e6eeee', 0.16 ),
		espejo: M.espejo(),
		resina: M.liso( '#ecebe7', 0.55 ),
	};

}

let MAT: ReturnType<typeof crearMateriales> | null = null;
export const asegurarMateriales = () => ( MAT ??= crearMateriales() );

// ------------------------------------------------------------ primitivas

export class Pieza {

	partes = new Map<Clave, THREE.BufferGeometry[]>();

	add( k: Clave, g: THREE.BufferGeometry ) {

		if ( ! this.partes.has( k ) ) this.partes.set( k, [] );
		this.partes.get( k )!.push( g );
		return g;

	}

	/** Caja por límites (x0..x1, y0..y1 altura, z0..z1 fondo). */
	caja( k: Clave, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number ) {

		// canto biselado (2-6 mm): las aristas captan la luz como un mueble real
		const w = x1 - x0, h = y1 - y0, d = z1 - z0, min = Math.min( w, h, d );
		const g = min >= 0.012 ? new RoundedBoxGeometry( w, h, d, 2, Math.min( 0.006, min * 0.2 ) ) : new THREE.BoxGeometry( w, h, d );
		g.translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
		return this.add( k, g );

	}

	/** Caja redondeada por límites. */
	blanda( k: Clave, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r = 0.03, seg = 3 ) {

		const w = x1 - x0, h = y1 - y0, d = z1 - z0;
		const g = new RoundedBoxGeometry( w, h, d, seg, Math.min( r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3 ) );
		g.translate( ( x0 + x1 ) / 2, ( y0 + y1 ) / 2, ( z0 + z1 ) / 2 );
		return this.add( k, g );

	}

	cilindro( k: Clave, x: number, y0: number, z: number, r: number, y1: number, seg = 24, r2 = r ) {

		const g = new THREE.CylinderGeometry( r2, r, y1 - y0, seg );
		g.translate( x, ( y0 + y1 ) / 2, z );
		return this.add( k, g );

	}

	malla( nombre: string ) {

		const g = new THREE.Group();
		g.name = nombre;
		for ( const [ k, gs ] of this.partes ) {

			const m = new THREE.Mesh( unir( gs )!, materialDinamico( k ) );
			const transparente = k === 'vidrio' || k.startsWith( 'vidrio:' );
			m.castShadow = ! transparente && k !== 'espejo' && ! k.startsWith( 'emisivo' );
			m.receiveShadow = true;
			if ( transparente ) m.renderOrder = 2;
			g.add( m );

		}

		return g;

	}

}

// ------------------------------------------------------------ piezas

/**
 * Escalera recta: sube hacia el frente (+z local) salvando `sube` metros, con
 * peldaños de unos 17,5 cm, zanca a los lados y pasamanos en el lado abierto.
 */
function escalera( p: Pieza, W: number, D: number, sube: number ) {

	const n = Math.max( 2, Math.round( sube / 0.175 ) );
	const c = sube / n, h = D / n;
	const z0 = - D / 2;
	for ( let k = 0; k < n; k ++ ) {

		const za = z0 + k * h, zb = za + h;
		// peldaño (huella de madera) sobre su tabica
		p.caja( 'lacado', - W / 2 + 0.04, k * c, za, W / 2 - 0.04, ( k + 1 ) * c - 0.03, zb );
		p.caja( 'madera', - W / 2 + 0.04, ( k + 1 ) * c - 0.03, za - 0.015, W / 2 - 0.04, ( k + 1 ) * c, zb );

	}
	// zancas laterales
	for ( const x of [ - W / 2, W / 2 - 0.04 ] ) {

		for ( let k = 0; k < n; k ++ ) p.caja( 'lacado', x, Math.max( 0, k * c - 0.1 ), z0 + k * h, x + 0.04, ( k + 1 ) * c + 0.05, z0 + ( k + 1 ) * h );

	}
	// pasamanos continuo a 0,9 m sobre la línea de peldaños, con montantes cada tres peldaños
	const largo = Math.hypot( D - h, sube - c );
	const pasamanos = new THREE.BoxGeometry( 0.02, 0.04, largo );
	pasamanos.rotateX( - Math.atan2( sube - c, D - h ) );
	pasamanos.translate( W / 2 - 0.02, ( c + sube ) / 2 + 0.9, 0 );
	p.add( 'metalNegro', pasamanos );
	for ( let k = 0; k < n; k += 3 ) p.caja( 'metalNegro', W / 2 - 0.025, ( k + 1 ) * c, z0 + k * h + h / 2 - 0.01, W / 2 - 0.015, ( k + 1 ) * c + 0.9, z0 + k * h + h / 2 + 0.01 );

}

/** Barandilla interior (hueco de escalera, altillos): vidrio con pasamanos, 1 m. */
function barandillaInterior( p: Pieza, W: number, D: number ) {

	const z = 0;
	p.caja( 'metalNegro', - W / 2, 0, z - Math.min( 0.03, D / 2 ), W / 2, 0.04, z + Math.min( 0.03, D / 2 ) );
	p.caja( 'vidrio', - W / 2, 0.04, z - 0.006, W / 2, 0.96, z + 0.006 );
	p.caja( 'metalNegro', - W / 2, 0.96, z - 0.025, W / 2, 1.0, z + 0.025 );

}

function armario( p: Pieza, W: number, D: number, H: number ) {

	const z1 = D / 2, z0 = - D / 2;
	p.caja( 'lacado', - W / 2, 0.08, z0, W / 2, H, z1 - 0.022 );
	p.caja( 'zocalo', - W / 2 + 0.005, 0, z0, W / 2 - 0.005, 0.08, z1 - 0.05 );
	const n = Math.max( 1, Math.round( W / 0.52 ) );
	const hueco = 0.003;
	const ancho = ( W - hueco * ( n + 1 ) ) / n;
	for ( let i = 0; i < n; i ++ ) {

		const x0 = - W / 2 + hueco + i * ( ancho + hueco );
		p.caja( 'lacado', x0, 0.085, z1 - 0.02, x0 + ancho, H - 0.004, z1 );
		// tirador vertical en el canto de encuentro de cada pareja
		const derecha = i % 2 === 0;
		const xt = derecha ? x0 + ancho - 0.04 : x0 + 0.04;
		p.caja( 'cromo', xt - 0.006, 0.95, z1, xt + 0.006, 1.25, z1 + 0.012 );
		p.caja( 'cromo', xt - 0.006, 0.95, z1 + 0.012, xt + 0.006, 0.962, z1 + 0.028 );
		p.caja( 'cromo', xt - 0.006, 1.238, z1 + 0.012, xt + 0.006, 1.25, z1 + 0.028 );

	}

}

function columna( p: Pieza, W: number, D: number, H: number, hornos: boolean ) {

	const z1 = D / 2, z0 = - D / 2;
	p.caja( 'laminado', - W / 2, 0.1, z0, W / 2, H, z1 - 0.02 );
	p.caja( 'zocalo', - W / 2, 0, z0, W / 2, 0.1, z1 - 0.06 );
	const frente = ( y0: number, y1: number, k: Clave = 'laminado' ) => p.caja( k, - W / 2 + 0.002, y0, z1 - 0.02, W / 2 - 0.002, y1, z1 );
	if ( hornos ) {

		frente( 0.1, 0.76 );
		frente( 0.78, 1.38, 'negro' );
		p.caja( 'inox', - W / 2 + 0.06, 1.3, z1, W / 2 - 0.06, 1.315, z1 + 0.03 );
		frente( 1.4, 1.78, 'negro' );
		p.caja( 'inox', - W / 2 + 0.02, 1.4, z1, W / 2 - 0.02, 1.44, z1 + 0.004 );
		frente( 1.8, 2.2 );

	} else {

		frente( 0.1, 1.42 );
		frente( 1.44, 2.2 );

	}

	frente( 2.203, H - 0.003 );

}

function encimera( p: Pieza, W: number, D: number, H: number, e: Equipamiento, cy: number ) {

	// rangos de planta (y norte) -> x local: con el frente al oeste x local = cy - y;
	// con el frente al este (vivienda simétrica) x local = y - cy
	const rango = ( r?: [ number, number ] ): [ number, number ] | null => ! r ? null
		: e.frente === 'e' ? [ r[ 0 ] - cy, r[ 1 ] - cy ] : [ cy - r[ 1 ], cy - r[ 0 ] ];
	const placa = rango( e.placa ), freg = rango( e.fregadero ), lava = rango( e.lavavajillas );
	const z1 = D / 2, z0 = - D / 2;
	const yE = 0.87, yT = 0.9;

	// muebles bajos
	p.caja( 'laminado', - W / 2, 0.1, z0, W / 2, yE, z1 - 0.06 );
	p.caja( 'zocalo', - W / 2, 0, z0, W / 2, 0.1, z1 - 0.1 );
	// frentes: módulos de ~0.6 m respetando fregadero y lavavajillas
	const cortes = new Set<number>( [ - W / 2, W / 2 ] );
	for ( const r of [ placa, freg, lava ] ) if ( r ) {

		cortes.add( Math.max( - W / 2, r[ 0 ] ) );
		cortes.add( Math.min( W / 2, r[ 1 ] ) );

	}

	const xs = [ ...cortes ].sort( ( a, b ) => a - b );
	for ( let i = 0; i < xs.length - 1; i ++ ) {

		const a = xs[ i ], b = xs[ i + 1 ];
		const n = Math.max( 1, Math.round( ( b - a ) / 0.6 ) );
		for ( let j = 0; j < n; j ++ ) {

			const x0 = a + ( ( b - a ) * j ) / n + 0.0015, x1 = a + ( ( b - a ) * ( j + 1 ) ) / n - 0.0015;
			const esPlaca = placa && x0 >= placa[ 0 ] - 0.01 && x1 <= placa[ 1 ] + 0.01;
			if ( esPlaca ) {

				// cajoneros bajo la placa
				p.caja( 'laminado', x0, 0.1, z1 - 0.06, x1, 0.47, z1 - 0.04 );
				p.caja( 'laminado', x0, 0.475, z1 - 0.06, x1, yE - 0.06, z1 - 0.04 );

			} else p.caja( 'laminado', x0, 0.1, z1 - 0.06, x1, yE - 0.06, z1 - 0.04 );

		}

	}

	// gola (tirador integrado) bajo la encimera
	p.caja( 'sombra', - W / 2, yE - 0.06, z1 - 0.07, W / 2, yE, z1 - 0.058 );
	p.caja( 'laminado', - W / 2, yE - 0.06, z1 - 0.1, W / 2, yE - 0.052, z1 - 0.06 );

	// encimera de cuarzo con hueco para el fregadero
	if ( freg ) {

		const [ fa, fb ] = freg;
		const fz0 = z0 + 0.1, fz1 = z1 - 0.08;
		p.caja( 'cuarzo', - W / 2, yE, z0, fa, yT, z1 );
		p.caja( 'cuarzo', fb, yE, z0, W / 2, yT, z1 );
		p.caja( 'cuarzo', fa, yE, z0, fb, yT, fz0 );
		p.caja( 'cuarzo', fa, yE, fz1, fb, yT, z1 );
		// cubeta de inox bajo encimera
		const y0 = yE - 0.19;
		p.caja( 'inox', fa, y0, fz0, fb, y0 + 0.004, fz1 );
		p.caja( 'inox', fa, y0, fz0, fa + 0.004, yE, fz1 );
		p.caja( 'inox', fb - 0.004, y0, fz0, fb, yE, fz1 );
		p.caja( 'inox', fa, y0, fz0, fb, yE, fz0 + 0.004 );
		p.caja( 'inox', fa, y0, fz1 - 0.004, fb, yE, fz1 );
		p.cilindro( 'sombra', ( fa + fb ) / 2, y0 + 0.004, ( fz0 + fz1 ) / 2, 0.04, y0 + 0.006 );
		// grifo monomando de caño alto
		const xg = ( fa + fb ) / 2, zg = fz0 - 0.05;
		p.cilindro( 'cromo', xg, yT, zg, 0.026, yT + 0.03 );
		p.cilindro( 'cromo', xg, yT + 0.03, zg, 0.014, yT + 0.3, 16 );
		const curva = new THREE.QuadraticBezierCurve3( new THREE.Vector3( xg, yT + 0.3, zg ), new THREE.Vector3( xg, yT + 0.42, zg + 0.02 ), new THREE.Vector3( xg, yT + 0.34, zg + 0.2 ) );
		p.add( 'cromo', new THREE.TubeGeometry( curva, 20, 0.011, 12 ) );
		p.cilindro( 'cromo', xg, yT + 0.25, zg, 0.009, yT + 0.34, 12 ).translate( 0.04, 0, 0 );

	} else p.caja( 'cuarzo', - W / 2, yE, z0, W / 2, yT, z1 );

	// placa de inducción enrasada
	if ( placa ) {

		const [ a, b ] = placa;
		p.caja( 'negro', a + 0.01, yT, z0 + 0.06, b - 0.01, yT + 0.004, z1 - 0.06 );

	}

	// frontal de cuarzo y muebles altos con campana integrada sobre la placa
	const yA = 1.45, yA1 = 2.2, fA = 0.35;
	p.caja( 'cuarzo', - W / 2, yT, z0, W / 2, yA, z0 + 0.012 );
	p.caja( 'laminado', - W / 2, yA, z0, W / 2, yA1, z0 + fA - 0.02 );
	const nA = Math.max( 1, Math.round( W / 0.6 ) );
	for ( let j = 0; j < nA; j ++ ) {

		const x0 = - W / 2 + ( W * j ) / nA + 0.0015, x1 = - W / 2 + ( W * ( j + 1 ) ) / nA - 0.0015;
		p.caja( 'laminado', x0, yA + 0.002, z0 + fA - 0.02, x1, yA1, z0 + fA );

	}

	p.caja( 'laminado', - W / 2, yA1 + 0.003, z0, W / 2, H - 0.003, z0 + fA );
	if ( placa ) {

		const [ a, b ] = placa;
		p.caja( 'sombra', a + 0.02, yA - 0.004, z0 + 0.03, b - 0.02, yA, z0 + fA - 0.03 );
		p.caja( 'inox', a + 0.05, yA - 0.006, z0 + 0.06, b - 0.05, yA - 0.004, z0 + fA - 0.06 );

	}

}

function banera( p: Pieza, W: number, D: number ) {

	const alto = 0.55, borde = 0.07, r = 0.14;
	const ext = new THREE.Shape();
	ext.moveTo( - W / 2, - D / 2 ); ext.lineTo( W / 2, - D / 2 ); ext.lineTo( W / 2, D / 2 ); ext.lineTo( - W / 2, D / 2 ); ext.lineTo( - W / 2, - D / 2 );
	const hueco = new THREE.Path();
	const iw = W / 2 - borde, id = D / 2 - borde;
	hueco.moveTo( - iw + r, - id );
	hueco.lineTo( iw - r, - id ); hueco.quadraticCurveTo( iw, - id, iw, - id + r );
	hueco.lineTo( iw, id - r ); hueco.quadraticCurveTo( iw, id, iw - r, id );
	hueco.lineTo( - iw + r, id ); hueco.quadraticCurveTo( - iw, id, - iw, id - r );
	hueco.lineTo( - iw, - id + r ); hueco.quadraticCurveTo( - iw, - id, - iw + r, - id );
	ext.holes.push( hueco );
	const g = new THREE.ExtrudeGeometry( ext, { depth: alto - 0.02, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.008, bevelSegments: 3, curveSegments: 10 } );
	g.rotateX( - Math.PI / 2 );
	g.translate( 0, 0.01, 0 );
	p.add( 'ceramica', g );
	p.caja( 'ceramica', - iw, 0, - id, iw, 0.16, id );
	p.cilindro( 'cromo', iw - 0.12, 0.16, 0, 0.022, 0.165 );
	// termostática con barra en la pared del fondo
	p.caja( 'cromo', - 0.14, 0.72, - D / 2 - 0.0, 0.14, 0.77, - D / 2 + 0.06 );
	p.cilindro( 'cromo', - W / 2 + 0.22, 1.0, - D / 2 + 0.035, 0.012, 1.85, 12 );
	p.blanda( 'cromo', - W / 2 + 0.2, 1.55, - D / 2 + 0.05, - W / 2 + 0.24, 1.78, - D / 2 + 0.09, 0.015 );

}

function ducha( p: Pieza, W: number, D: number ) {

	p.caja( 'resina', - W / 2, 0, - D / 2, W / 2, 0.03, D / 2 );
	p.caja( 'inox', - W / 2 + 0.1, 0.03, - D / 2 + 0.06, W / 2 - 0.1, 0.032, - D / 2 + 0.11 );
	// mampara fija en la mitad este, con perfil superior y brazo estabilizador
	const x0 = W / 2 - 1.0;
	p.caja( 'vidrio', x0, 0.03, D / 2 - 0.02, W / 2, 2.0, D / 2 - 0.01 );
	p.caja( 'cromo', x0, 0.03, D / 2 - 0.025, x0 + 0.012, 2.0, D / 2 - 0.005 );
	p.caja( 'cromo', x0 + 0.08, 1.94, - D / 2, x0 + 0.1, 1.96, D / 2 - 0.02 );
	// rociador de techo + termostática
	p.cilindro( 'cromo', 0.15, 2.18, - D / 2 + 0.3, 0.14, 2.19, 40 );
	p.caja( 'cromo', 0.14, 2.19, - D / 2, 0.16, 2.21, - D / 2 + 0.3 );
	p.caja( 'cromo', 0.0, 1.05, - D / 2, 0.3, 1.11, - D / 2 + 0.06 );
	p.cilindro( 'cromo', 0.45, 1.0, - D / 2 + 0.035, 0.012, 2.0, 12 );

}

function inodoro( p: Pieza, W: number, D: number ) {

	const z0 = - D / 2;
	p.blanda( 'ceramica', - 0.17, 0, z0 + 0.12, 0.17, 0.38, D / 2 - 0.06, 0.06, 4 );
	p.blanda( 'ceramica', - 0.185, 0.36, z0 + 0.1, 0.185, 0.41, D / 2 - 0.02, 0.07, 4 );
	p.blanda( 'ceramica', - 0.18, 0.41, z0 + 0.12, 0.18, 0.435, D / 2 - 0.03, 0.07, 4 );
	p.blanda( 'ceramica', - Math.min( 0.2, W / 2 ), 0.4, z0, Math.min( 0.2, W / 2 ), 0.8, z0 + 0.17, 0.04, 3 );
	p.blanda( 'cromo', - 0.06, 0.8, z0 + 0.05, 0.06, 0.806, z0 + 0.12, 0.003, 2 );

}

function lavabo( p: Pieza, W: number, D: number, doble: boolean ) {

	const z0 = - D / 2, z1 = D / 2;
	p.caja( 'madera', - W / 2, 0.35, z0, W / 2, 0.82, z1 - 0.02 );
	p.caja( 'madera', - W / 2 + 0.002, 0.352, z1 - 0.02, W / 2 - 0.002, 0.8, z1 );
	p.caja( 'sombra', - W / 2 + 0.002, 0.8, z1 - 0.03, W / 2 - 0.002, 0.82, z1 - 0.02 );
	p.caja( 'ceramica', - W / 2, 0.82, z0, W / 2, 0.84, z1 + 0.005 );
	const n = doble ? 2 : 1;
	for ( let i = 0; i < n; i ++ ) {

		const x = doble ? ( i === 0 ? - W / 4 : W / 4 ) : 0;
		const perfil = [ [ 0, 0 ], [ 0.16, 0.0 ], [ 0.19, 0.03 ], [ 0.2, 0.12 ], [ 0.192, 0.125 ], [ 0.182, 0.035 ], [ 0.15, 0.012 ], [ 0, 0.012 ] ].map( ( [ a, b ] ) => new THREE.Vector2( a, b ) );
		const cuenco = new THREE.LatheGeometry( perfil, 40 );
		cuenco.scale( 1, 1, 0.82 );
		cuenco.translate( x, 0.84, 0.02 );
		p.add( 'ceramica', cuenco );
		p.cilindro( 'sombra', x, 0.853, 0.02, 0.018, 0.855 );
		// grifo alto
		p.cilindro( 'cromo', x, 0.84, z0 + 0.06, 0.02, 1.12, 20 );
		p.caja( 'cromo', x - 0.012, 1.1, z0 + 0.06, x + 0.012, 1.12, z0 + 0.2 );
		p.caja( 'cromo', x - 0.004, 1.13, z0 + 0.05, x + 0.004, 1.14, z0 + 0.11 );

	}

	p.caja( 'espejo', - W / 2 + 0.02, 1.05, z0, W / 2 - 0.02, 1.85, z0 + 0.012 );

}

function lavadora( p: Pieza, W: number, D: number ) {

	const z0 = - D / 2, z1 = D / 2 - 0.02;
	p.blanda( 'lacado', - W / 2 + 0.01, 0, z0, W / 2 - 0.01, 0.85, z1, 0.02 );
	const aro = new THREE.TorusGeometry( 0.165, 0.022, 12, 48 );
	aro.translate( 0, 0.42, z1 + 0.012 );
	p.add( 'cromo', aro );
	const disco = new THREE.CylinderGeometry( 0.15, 0.15, 0.01, 40 );
	disco.rotateX( Math.PI / 2 );
	disco.translate( 0, 0.42, z1 + 0.006 );
	p.add( 'negro', disco );
	p.caja( 'zocalo', - W / 2 + 0.03, 0.74, z1, W / 2 - 0.03, 0.82, z1 + 0.004 );

}

function mesaComedor( p: Pieza, W: number, D: number ) {

	p.blanda( 'madera', - W / 2, 0.715, - D / 2, W / 2, 0.75, D / 2, 0.008, 2 );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const x = sx * ( W / 2 - 0.08 ), z = sz * ( D / 2 - 0.1 );
		p.caja( 'madera', x - 0.022, 0, z - 0.022, x + 0.022, 0.715, z + 0.022 );

	}

}

function silla( p: Pieza, W: number, D: number ) {

	const w = Math.min( W, 0.46 ), d = Math.min( D, 0.48 );
	p.blanda( 'tapiceriaSilla', - w / 2, 0.4, - d / 2 + 0.02, w / 2, 0.47, d / 2, 0.03 );
	const resp = p.blanda( 'tapiceriaSilla', - w / 2 + 0.01, 0.0, - 0.03, w / 2 - 0.01, 0.4, 0.02, 0.025 );
	resp.rotateX( - 0.12 );
	resp.translate( 0, 0.46, - d / 2 + 0.04 );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) p.cilindro( 'madera', sx * ( w / 2 - 0.05 ), 0, sz * ( d / 2 - 0.06 ), 0.014, 0.41, 12, 0.017 );

}

function sofa( p: Pieza, W: number, D: number ) {

	const z0 = - D / 2, z1 = D / 2, brazo = 0.15;
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) p.cilindro( 'metalNegro', sx * ( W / 2 - 0.08 ), 0, sz * ( D / 2 - 0.08 ), 0.018, 0.07, 12 );
	p.blanda( 'tapiceria', - W / 2, 0.07, z0, W / 2, 0.28, z1, 0.03 );
	p.blanda( 'tapiceria', - W / 2, 0.07, z0, - W / 2 + brazo, 0.6, z1, 0.05 );
	p.blanda( 'tapiceria', W / 2 - brazo, 0.07, z0, W / 2, 0.6, z1, 0.05 );
	p.blanda( 'tapiceria', - W / 2 + brazo - 0.01, 0.2, z0, W / 2 - brazo + 0.01, 0.72, z0 + 0.18, 0.05 );
	const util = W - 2 * brazo;
	const n = Math.max( 1, Math.round( util / 0.7 ) );
	const w = util / n;
	for ( let i = 0; i < n; i ++ ) {

		const x0 = - W / 2 + brazo + i * w;
		p.blanda( 'tapiceria', x0 + 0.004, 0.28, z0 + 0.19, x0 + w - 0.004, 0.44, z1 - 0.01, 0.06, 4 );
		const resp = p.blanda( 'cojin', x0 + 0.01, - 0.2, - 0.08, x0 + w - 0.01, 0.2, 0.08, 0.07, 4 );
		resp.rotateX( - 0.18 );
		resp.translate( 0, 0.62, z0 + 0.26 );

	}

}

function mesaCentro( p: Pieza, W: number, D: number ) {

	p.blanda( 'madera', - W / 2, 0.34, - D / 2, W / 2, 0.38, D / 2, 0.01, 2 );
	p.caja( 'metalNegro', - W / 2 + 0.12, 0, - D / 2 + 0.12, W / 2 - 0.12, 0.34, D / 2 - 0.12 );

}

function mesaAuxiliar( p: Pieza, W: number ) {

	const r = W / 2 - 0.01;
	p.cilindro( 'madera', 0, 0.5, 0, r, 0.52, 40 );
	p.cilindro( 'metalNegro', 0, 0.01, 0, 0.012, 0.5, 12 );
	p.cilindro( 'metalNegro', 0, 0, 0, r * 0.7, 0.012, 32 );

}

function muebleTV( p: Pieza, W: number, D: number ) {

	const z0 = - D / 2, z1 = D / 2;
	p.caja( 'zocalo', - W / 2 + 0.02, 0, z0, W / 2 - 0.02, 0.08, z1 - 0.05 );
	p.caja( 'madera', - W / 2, 0.08, z0, W / 2, 0.46, z1 - 0.02 );
	const n = Math.max( 2, Math.round( W / 0.6 ) );
	for ( let i = 0; i < n; i ++ ) {

		const x0 = - W / 2 + ( W * i ) / n + 0.002, x1 = - W / 2 + ( W * ( i + 1 ) ) / n - 0.002;
		p.caja( 'madera', x0, 0.082, z1 - 0.02, x1, 0.458, z1 );

	}

}

function cama( p: Pieza, W: number, D: number, doble: boolean ) {

	const z0 = - D / 2, z1 = D / 2, cab = 0.08;
	p.caja( 'zocalo', - W / 2 + 0.05, 0, z0 + cab + 0.05, W / 2 - 0.05, 0.06, z1 - 0.05 );
	p.blanda( 'cabecero', - W / 2, 0.06, z0 + cab, W / 2, 0.32, z1, 0.03 );
	p.blanda( 'ropa', - W / 2 + 0.01, 0.31, z0 + cab + 0.01, W / 2 - 0.01, 0.54, z1 - 0.01, 0.06, 4 );
	// edredón que cae por los laterales y embozo doblado
	const largo = ( D - cab ) * 0.74;
	p.blanda( 'ropa', - W / 2 - 0.025, 0.26, z1 - largo, W / 2 + 0.025, 0.575, z1 + 0.02, 0.05, 4 );
	p.blanda( 'ropa', - W / 2 - 0.03, 0.5, z1 - largo - 0.02, W / 2 + 0.03, 0.6, z1 - largo + 0.24, 0.045, 4 );
	// almohadas
	const n = doble ? 2 : 1;
	const aw = doble ? ( W - 0.16 ) / 2 : W - 0.2;
	for ( let i = 0; i < n; i ++ ) {

		const x0 = doble ? - W / 2 + 0.06 + i * ( aw + 0.04 ) : - aw / 2;
		const alm = p.blanda( 'cojin', x0, - 0.07, - 0.19, x0 + aw, 0.07, 0.19, 0.06, 4 );
		alm.rotateX( - 0.35 );
		alm.translate( 0, 0.62, z0 + cab + 0.24 );

	}

	p.blanda( 'cabecero', - W / 2 - 0.04, 0.06, z0, W / 2 + 0.04, 1.12, z0 + cab, 0.03 );

}

function mesilla( p: Pieza, W: number, D: number ) {

	p.caja( 'zocalo', - W / 2 + 0.03, 0, - D / 2 + 0.02, W / 2 - 0.03, 0.06, D / 2 - 0.05 );
	p.caja( 'madera', - W / 2, 0.06, - D / 2, W / 2, 0.5, D / 2 - 0.02 );
	p.caja( 'madera', - W / 2 + 0.003, 0.3, D / 2 - 0.02, W / 2 - 0.003, 0.48, D / 2 );
	p.caja( 'madera', - W / 2 + 0.003, 0.08, D / 2 - 0.02, W / 2 - 0.003, 0.296, D / 2 );

}

// ------------------------------------------------------------ montaje

export const GIRO: Record<string, number> = { s: 0, n: Math.PI, e: Math.PI / 2, o: - Math.PI / 2 };

export function construirEquipamiento( v: Vivienda, amb?: Ambientacion | null ) {

	MAT ??= crearMateriales();
	const fijo = new THREE.Group(); fijo.name = 'equipamiento-fijo';
	const mobiliario = new THREE.Group(); mobiliario.name = 'mobiliario';
	const decoracion = new THREE.Group(); decoracion.name = 'decoracion';

	for ( const e of v.equipamiento ) {

		const [ x0, y0, x1, y1 ] = e.rect;
		const cx = ( x0 + x1 ) / 2, cy = ( y0 + y1 ) / 2;
		// armarios y columnas llegan hasta el techo de su estancia (falso techo o inclinado)
		const H = alturaTecho( v, cx, cy );
		const girado = e.frente === 'e' || e.frente === 'o';
		const W = girado ? y1 - y0 : x1 - x0;
		const D = girado ? x1 - x0 : y1 - y0;
		const p = new Pieza();

		// el mobiliario (no fijo) sale de la biblioteca de activos
		const a = e.fijo ? undefined : activoPara( e.id, e.tipo, amb );
		let g: THREE.Group;
		if ( a ) g = construirActivo( a, W, D, a.dims[ 2 ], { techo: H, elev: 0, semilla: e.id } );
		else {

			switch ( e.tipo ) {

				case 'armario': armario( p, W, D, H ); break;
				case 'columna-frigorifico': columna( p, W, D, H, false ); break;
				case 'columna-hornos': columna( p, W, D, H, true ); break;
				case 'encimera': encimera( p, W, D, H, e, cy ); break;
				case 'banera': banera( p, W, D ); break;
				case 'ducha': ducha( p, W, D ); break;
				case 'inodoro': inodoro( p, W, D ); break;
				case 'lavabo': lavabo( p, W, D, false ); break;
				case 'lavabo-doble': lavabo( p, W, D, true ); break;
				case 'lavadora': lavadora( p, W, D ); break;
				case 'mesa-comedor': mesaComedor( p, W, D ); break;
				case 'silla': silla( p, W, D ); break;
				case 'sofa': sofa( p, W, D ); break;
				case 'mesa-centro': mesaCentro( p, W, D ); break;
				case 'mesa-auxiliar': mesaAuxiliar( p, W ); break;
				case 'mueble-tv': muebleTV( p, W, D ); break;
				case 'cama': cama( p, W, D, W > 1.2 ); break;
				case 'mesilla': mesilla( p, W, D ); break;
				case 'escalera': escalera( p, W, D, e.sube ?? v.alturas.libre.valor + v.alturas.forjado.valor ); break;
				case 'barandilla': barandillaInterior( p, W, D ); break;
				default: console.warn( 'Equipamiento sin modelo:', e.tipo );

			}

			g = p.malla( e.id );

		}

		g.rotation.y = GIRO[ e.frente ];
		g.position.set( cx, 0, - cy );
		g.userData = { fijo: e.fijo, x: cx, equipo: e.id, tipo: e.tipo, activo: a?.id ?? null };
		( e.fijo ? fijo : mobiliario ).add( g );

	}

	for ( const d of amb?.decoracion ?? [] ) {

		const a = buscarActivo( d.activo );
		if ( ! a ) {

			console.warn( 'Decoración con activo desconocido:', d.activo );
			continue;

		}

		const [ W, D, Ha ] = d.dims ?? a.dims;
		const g = construirActivo( a, W, D, Ha, { techo: alturaTecho( v, d.pos[ 0 ], d.pos[ 1 ] ), elev: d.elev, semilla: d.id } );
		g.rotation.y = THREE.MathUtils.degToRad( d.rot );
		g.position.set( d.pos[ 0 ], d.elev, - d.pos[ 1 ] );
		g.userData = { fijo: false, x: d.pos[ 0 ], decoracion: d.id, activo: a.id };
		decoracion.add( g );

	}

	return { fijo, mobiliario, decoracion };

}
