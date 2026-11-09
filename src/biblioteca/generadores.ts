// Generadores procedurales de la biblioteca de mobiliario y decoración.
//
// Cada generador dibuja una pieza en el marco canónico del equipamiento:
// ancho W en x, fondo D en z con el frente hacia +z, alto desde y = 0.
// No reproduce ningún producto concreto: son aproximaciones ligeras y
// paramétricas (medidas, materiales, colores y forma) que se pueden
// editar desde el Studio sin tocar código.

import * as THREE from 'three/webgpu';
import type { Pieza } from '../escena/equipamiento';
import { existeModelo } from './modelos';

/** Parámetros de una pieza: materiales (`tela:#hex`, `madera:#hex`…) y opciones de forma. */
export type Params = Record<string, string | number | boolean>;

export interface Contexto {
	W: number; D: number; H: number;
	/** Altura libre del techo (para colgantes). */
	techo: number;
	/** Altura a la que se apoya la pieza (0 = suelo). */
	elev: number;
	/** Semilla para la variación (hojas, libros…). */
	semilla: string;
	p: Params;
}

type Gen = ( k: Pieza, c: Contexto ) => void;

// ------------------------------------------------------------ utilidades

const s = ( c: Contexto, k: string, d: string ) => String( c.p[ k ] ?? d );
const n = ( c: Contexto, k: string, d: number ) => Number( c.p[ k ] ?? d );

/** Generador pseudoaleatorio determinista (mulberry32) a partir de un texto. */
export function azar( semilla: string ) {

	let h = 1779033703;
	for ( let i = 0; i < semilla.length; i ++ ) h = Math.imul( h ^ semilla.charCodeAt( i ), 3432918353 ), h = ( h << 13 ) | ( h >>> 19 );
	return () => {

		h = ( h + 0x6d2b79f5 ) | 0;
		let t = Math.imul( h ^ ( h >>> 15 ), 1 | h );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

/** Sólido de revolución a partir de un perfil [radio, altura]. */
function torno( k: Pieza, mat: string, perfil: [ number, number ][], x = 0, y = 0, z = 0, seg = 32 ) {

	const g = new THREE.LatheGeometry( perfil.map( ( [ r, h ] ) => new THREE.Vector2( r, h ) ), seg );
	g.translate( x, y, z );
	return k.add( mat, g );

}

function esfera( k: Pieza, mat: string, x: number, y: number, z: number, r: number, sx = 1, sy = 1, sz = 1, seg = 16 ) {

	const g = new THREE.SphereGeometry( r, seg, Math.max( 6, seg * 0.6 ) );
	g.scale( sx, sy, sz );
	g.translate( x, y, z );
	return k.add( mat, g );

}

function tubo( k: Pieza, mat: string, pts: THREE.Vector3[], r: number, seg = 24 ) {

	return k.add( mat, new THREE.TubeGeometry( new THREE.CatmullRomCurve3( pts ), seg, r, 8 ) );

}

/** Cilindro recto entre dos puntos. */
function barra( k: Pieza, mat: string, a: THREE.Vector3, b: THREE.Vector3, r: number ) {

	const g = new THREE.CylinderGeometry( r, r, a.distanceTo( b ), 12 );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), b.clone().sub( a ).normalize() ) );
	g.translate( ( a.x + b.x ) / 2, ( a.y + b.y ) / 2, ( a.z + b.z ) / 2 );
	return k.add( mat, g );

}

/** Hoja plana lanceolada, orientada según `dir` desde `base`. */
function hojaPlana( k: Pieza, mat: string, base: THREE.Vector3, dir: THREE.Vector3, largo: number, ancho: number, giro: number ) {

	const f = new THREE.Shape();
	f.moveTo( 0, 0 );
	f.quadraticCurveTo( ancho, largo * 0.4, 0, largo );
	f.quadraticCurveTo( - ancho, largo * 0.4, 0, 0 );
	const g = new THREE.ShapeGeometry( f, 4 );
	// curvar ligeramente la hoja
	const pos = g.attributes.position;
	for ( let i = 0; i < pos.count; i ++ ) pos.setZ( i, - Math.pow( pos.getY( i ) / largo, 2 ) * largo * 0.25 );
	g.computeVertexNormals();
	g.rotateY( giro );
	g.applyQuaternion( new THREE.Quaternion().setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), dir.clone().normalize() ) );
	g.translate( base.x, base.y, base.z );
	return k.add( mat, g );

}

/** Cojín mullido. */
function cojin( k: Pieza, mat: string, x: number, y: number, z: number, w: number, h: number, inclinacion = 0.25, giro = 0 ) {

	// almohada de verdad: gruesa en el centro, fina en el borde, esquinas pellizcadas
	const g = k.almohada( mat, w, h, 0.17, x * 7 + z * 3 );
	g.rotateX( - inclinacion );
	g.rotateY( giro );
	g.translate( x, y, z );

}

const lista = ( v: string ) => v.split( '|' ).filter( Boolean );

// ------------------------------------------------------------ asientos

const sofa: Gen = ( k, c ) => {

	const { W, D } = c;
	const tela = s( c, 'tela', 'tela:#d8d0c3' ), patas = s( c, 'patas', 'madera:#8a6d52' );
	const curvo = c.p.forma === 'curvo';
	const r = curvo ? 0.12 : 0.05;
	const z0 = - D / 2, z1 = D / 2, brazo = curvo ? 0.2 : 0.16;
	const hPata = n( c, 'patas_alto', 0.09 );
	if ( hPata > 0 ) for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) k.cilindro( patas, sx * ( W / 2 - 0.1 ), 0, sz * ( D / 2 - 0.1 ), 0.016, hPata, 10, 0.022 );
	else k.blanda( 'zocalo', - W / 2 + 0.04, 0, z0 + 0.04, W / 2 - 0.04, 0.05, z1 - 0.04, 0.01 );
	const y0 = Math.max( hPata, 0.05 );
	k.blanda( tela, - W / 2, y0, z0, W / 2, y0 + 0.2, z1, r );
	k.acolchada( tela, - W / 2, y0, z0, - W / 2 + brazo, y0 + ( curvo ? 0.5 : 0.52 ), z1, r, 0.006, 0.004, 3 );
	k.acolchada( tela, W / 2 - brazo, y0, z0, W / 2, y0 + ( curvo ? 0.5 : 0.52 ), z1, r, 0.006, 0.004, 4 );
	k.blanda( tela, - W / 2 + brazo - 0.02, y0 + 0.12, z0, W / 2 - brazo + 0.02, y0 + 0.66, z0 + 0.2, r );
	const util = W - 2 * brazo;
	const nA = Math.max( 1, Math.round( util / 0.75 ) );
	const w = util / nA;
	for ( let i = 0; i < nA; i ++ ) {

		const x0 = - W / 2 + brazo + i * w;
		// asiento relleno, con el hundido del uso
		k.acolchada( tela, x0 + 0.004, y0 + 0.2, z0 + 0.2, x0 + w - 0.004, y0 + 0.37, z1 - 0.01, 0.06, 0.014, 0.012, i + 1, 0.004, tela );
		const resp = k.acolchada( tela, x0 + 0.01, - 0.2, - 0.09, x0 + w - 0.01, 0.2, 0.09, 0.07, 0.02, 0.004, i + 11, 0.001 );
		resp.rotateX( - 0.2 );
		resp.translate( 0, y0 + 0.56, z0 + 0.28 );

	}

	// cojines decorativos y manta (según parámetros)
	const cojines = lista( s( c, 'cojines', '' ) );
	cojines.forEach( ( m, i ) => {

		const lado = i % 2 === 0 ? - 1 : 1;
		const orden = Math.floor( i / 2 );
		const x = lado * ( W / 2 - brazo - 0.24 - orden * 0.3 );
		cojin( k, m, x, y0 + 0.57, z0 + 0.4 + orden * 0.05, 0.44 - orden * 0.06, 0.42 - orden * 0.06, 0.3, lado * - 0.18 );

	} );
	const manta = s( c, 'manta', '' );
	if ( manta ) {

		// cae por encima del brazo derecho, a los dos lados, con su grosor de lana
		const sobreBrazo = k.edredon( manta, brazo + 0.02, 0.5, 0, 0.3, 0.02, W * 2, false, 2.5 );
		sobreBrazo.translate( W / 2 - brazo / 2, y0 + ( curvo ? 0.5 : 0.52 ), 0.03 );
		// doblada sobre el asiento, con sus pliegues
		const doblez = k.tela( manta, 0.6, 0.48, 0.04, 3, 0.016, W );
		doblez.rotateY( 0.12 );
		doblez.translate( W / 2 - brazo - 0.35, y0 + 0.36, 0.05 );

	}

};

const sillon: Gen = ( k, c ) => {

	const { W, D } = c;
	const tela = s( c, 'tela', 'boucle:#ece6db' ), patas = s( c, 'patas', 'madera:#8a6d52' );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) k.cilindro( patas, sx * ( W / 2 - 0.1 ), 0, sz * ( D / 2 - 0.1 ), 0.014, 0.12, 10, 0.02 );
	k.blanda( tela, - W / 2, 0.12, - D / 2, W / 2, 0.42, D / 2, 0.12, 4 );
	k.blanda( tela, - W / 2, 0.3, - D / 2, W / 2, 0.78, - D / 2 + 0.2, 0.1, 4 );
	for ( const sx of [ - 1, 1 ] ) k.blanda( tela, sx > 0 ? W / 2 - 0.14 : - W / 2, 0.3, - D / 2, sx > 0 ? W / 2 : - W / 2 + 0.14, 0.62, D / 2 - 0.04, 0.07, 4 );
	const coj = s( c, 'cojin', '' );
	if ( coj ) cojin( k, coj, 0, 0.6, - D / 2 + 0.3, 0.38, 0.32, 0.25 );

};

const sillonExterior: Gen = ( k, c ) => {

	const { W, D } = c;
	const madera = s( c, 'estructura', 'madera:#9b7652' ), tela = s( c, 'tela', 'tela:#e8e3d8' );
	for ( const sx of [ - 1, 1 ] ) {

		const x = sx * ( W / 2 - 0.03 );
		k.caja( madera, x - 0.03, 0, - D / 2, x + 0.03, 0.06, D / 2 );
		k.caja( madera, x - 0.03, 0.54, - D / 2 + 0.05, x + 0.03, 0.58, D / 2 );
		k.caja( madera, x - 0.025, 0.06, D / 2 - 0.06, x + 0.025, 0.54, D / 2 - 0.02 );
		k.caja( madera, x - 0.025, 0.06, - D / 2 + 0.03, x + 0.025, 0.7, - D / 2 + 0.07 );

	}

	for ( let i = 0; i < 6; i ++ ) {

		const z = - D / 2 + 0.12 + i * ( D - 0.2 ) / 6;
		k.caja( madera, - W / 2 + 0.06, 0.24, z, W / 2 - 0.06, 0.26, z + 0.06 );

	}

	k.blanda( tela, - W / 2 + 0.07, 0.26, - D / 2 + 0.08, W / 2 - 0.07, 0.38, D / 2 - 0.02, 0.04 );
	const resp = k.blanda( tela, - W / 2 + 0.08, - 0.22, - 0.06, W / 2 - 0.08, 0.22, 0.06, 0.05 );
	resp.rotateX( - 0.25 );
	resp.translate( 0, 0.6, - D / 2 + 0.16 );

};

const silla: Gen = ( k, c ) => {

	const w = Math.min( c.W, 0.48 ), d = Math.min( c.D, 0.5 );
	const tela = s( c, 'tela', 'tela:#e2dcd1' ), madera = s( c, 'madera', 'madera:#b08d69' );
	k.blanda( tela, - w / 2, 0.42, - d / 2 + 0.03, w / 2, 0.48, d / 2, 0.025 );
	k.caja( madera, - w / 2 + 0.01, 0.4, - d / 2 + 0.03, w / 2 - 0.01, 0.425, d / 2 - 0.01 );
	// respaldo curvo de madera
	const curva = new THREE.Shape();
	curva.absarc( 0, 0, w * 0.62, Math.PI * 0.32, Math.PI * 0.68, false );
	curva.absarc( 0, 0, w * 0.62 - 0.018, Math.PI * 0.68, Math.PI * 0.32, true );
	const g = new THREE.ExtrudeGeometry( curva, { depth: 0.16, bevelEnabled: false, curveSegments: 16 } );
	g.rotateX( - Math.PI / 2 );
	g.translate( 0, 0.68, - d / 2 + 0.03 + w * 0.62 );
	k.add( madera, g );
	for ( const sx of [ - 1, 1 ] ) {

		k.cilindro( madera, sx * ( w / 2 - 0.04 ), 0, d / 2 - 0.05, 0.015, 0.41, 10, 0.018 );
		k.cilindro( madera, sx * ( w / 2 - 0.05 ), 0, - d / 2 + 0.06, 0.015, 0.84, 10, 0.018 );

	}

};

// ------------------------------------------------------------ mesas

const mesaComedor: Gen = ( k, c ) => {

	const { W, D } = c;
	const tapa = s( c, 'tapa', 'madera:#b89574' ), pie = s( c, 'pie', tapa );
	if ( c.p.forma === 'pedestal' ) {

		k.blanda( tapa, - W / 2, 0.72, - D / 2, W / 2, 0.75, D / 2, 0.012, 2 );
		for ( const sx of [ - 1, 1 ] ) {

			torno( k, pie, [ [ 0, 0 ], [ 0.2, 0 ], [ 0.2, 0.02 ], [ 0.1, 0.1 ], [ 0.085, 0.6 ], [ 0.14, 0.72 ], [ 0, 0.72 ] ], sx * W * 0.25, 0, 0, 28 );

		}

		return;

	}

	k.blanda( tapa, - W / 2, 0.715, - D / 2, W / 2, 0.75, D / 2, 0.008, 2 );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) {

		const x = sx * ( W / 2 - 0.09 ), z = sz * ( D / 2 - 0.1 );
		k.cilindro( pie, x, 0, z, 0.02, 0.715, 12, 0.028 );

	}

	k.caja( pie, - W / 2 + 0.09, 0.66, - D / 2 + 0.1, W / 2 - 0.09, 0.715, - D / 2 + 0.12 );
	k.caja( pie, - W / 2 + 0.09, 0.66, D / 2 - 0.12, W / 2 - 0.09, 0.715, D / 2 - 0.1 );

};

const mesaCentro: Gen = ( k, c ) => {

	const { W, D } = c;
	const tapa = s( c, 'tapa', 'madera:#b89574' ), pie = s( c, 'pie', 'metalNegro' );
	const alto = n( c, 'alto', 0.36 );
	if ( c.p.forma === 'redonda' ) {

		// dos mesas nido redondas
		const r = Math.min( W, D ) / 2 - 0.02;
		k.cilindro( tapa, - W * 0.12, alto - 0.03, - D * 0.04, r, alto, 48 );
		k.cilindro( pie, - W * 0.12, 0, - D * 0.04, r * 0.55, alto - 0.03, 32, r * 0.5 );
		const r2 = r * 0.62;
		k.cilindro( tapa, W / 2 - r2 - 0.02, alto * 0.78 - 0.03, D / 2 - r2 - 0.02, r2, alto * 0.78, 40 );
		k.cilindro( pie, W / 2 - r2 - 0.02, 0, D / 2 - r2 - 0.02, r2 * 0.5, alto * 0.78 - 0.03, 24, r2 * 0.45 );
		return;

	}

	k.blanda( tapa, - W / 2, alto - 0.04, - D / 2, W / 2, alto, D / 2, 0.012, 2 );
	k.caja( tapa, - W / 2 + 0.06, 0.1, - D / 2 + 0.06, W / 2 - 0.06, 0.12, D / 2 - 0.06 );
	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) k.caja( pie, sx * ( W / 2 - 0.05 ) - 0.02, 0, sz * ( D / 2 - 0.05 ) - 0.02, sx * ( W / 2 - 0.05 ) + 0.02, alto - 0.04, sz * ( D / 2 - 0.05 ) + 0.02 );

};

const mesaAuxiliar: Gen = ( k, c ) => {

	const r = Math.min( c.W, c.D ) / 2 - 0.01;
	const tapa = s( c, 'tapa', 'madera:#b89574' ), pie = s( c, 'pie', 'metalNegro' );
	const alto = n( c, 'alto', 0.52 );
	k.cilindro( tapa, 0, alto - 0.025, 0, r, alto, 40 );
	k.cilindro( pie, 0, 0.012, 0, 0.014, alto - 0.025, 12 );
	k.cilindro( pie, 0, 0, 0, r * 0.65, 0.012, 32 );

};

const mesaExterior: Gen = ( k, c ) => {

	const r = Math.min( c.W, c.D ) / 2;
	const tapa = s( c, 'tapa', 'madera:#9b7652' );
	k.cilindro( tapa, 0, 0.38, 0, r, 0.42, 36 );
	for ( let i = 0; i < 3; i ++ ) {

		const a = ( i / 3 ) * Math.PI * 2;
		tubo( k, tapa, [ new THREE.Vector3( 0, 0.38, 0 ), new THREE.Vector3( Math.cos( a ) * r * 0.5, 0.18, Math.sin( a ) * r * 0.5 ), new THREE.Vector3( Math.cos( a ) * r * 0.75, 0, Math.sin( a ) * r * 0.75 ) ], 0.018, 12 );

	}

};

// ------------------------------------------------------------ almacenaje

const muebleBajo: Gen = ( k, c ) => {

	const { W, D } = c;
	const H = n( c, 'alto', 0.5 );
	const mat = s( c, 'material', 'madera:#b89574' );
	const acanalado = !! c.p.acanalado;
	const z0 = - D / 2, z1 = D / 2;
	const zocalo = n( c, 'zocalo', 0.1 );
	if ( c.p.patas ) for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) k.cilindro( mat, sx * ( W / 2 - 0.06 ), 0, sz * ( D / 2 - 0.06 ), 0.015, zocalo, 10, 0.02 );
	else k.caja( 'zocalo', - W / 2 + 0.02, 0, z0, W / 2 - 0.02, zocalo, z1 - 0.05 );
	k.caja( mat, - W / 2, zocalo, z0, W / 2, H, z1 - 0.02 );
	const nP = Math.max( 2, Math.round( W / 0.55 ) );
	for ( let i = 0; i < nP; i ++ ) {

		const x0 = - W / 2 + ( W * i ) / nP + 0.002, x1 = - W / 2 + ( W * ( i + 1 ) ) / nP - 0.002;
		k.caja( mat, x0, zocalo + 0.004, z1 - 0.02, x1, H - 0.004, z1 );
		if ( acanalado ) {

			const nc = Math.floor( ( x1 - x0 ) / 0.03 );
			for ( let j = 0; j < nc; j ++ ) {

				const x = x0 + ( j + 0.5 ) * ( x1 - x0 ) / nc;
				const g = new THREE.CylinderGeometry( 0.011, 0.011, H - zocalo - 0.03, 8, 1, false, - Math.PI / 2, Math.PI );
				g.translate( x, ( zocalo + H ) / 2, z1 );
				k.add( mat, g );

			}

		}

	}

};

const mesilla: Gen = ( k, c ) => {

	const { W, D } = c;
	const mat = s( c, 'material', 'madera:#b89574' );
	const alto = n( c, 'alto', 0.5 );
	if ( c.p.forma === 'redonda' ) {

		const r = Math.min( W, D ) / 2 - 0.01;
		k.cilindro( mat, 0, 0, 0, r * 0.9, alto - 0.03, 36 );
		k.cilindro( mat, 0, alto - 0.03, 0, r, alto, 40 );
		k.caja( 'sombra', - r * 0.6, alto * 0.62, r * 0.9 - 0.005, r * 0.6, alto * 0.62 + 0.004, r * 0.9 + 0.002 );
		return;

	}

	for ( const sx of [ - 1, 1 ] ) for ( const sz of [ - 1, 1 ] ) k.cilindro( mat, sx * ( W / 2 - 0.04 ), 0, sz * ( D / 2 - 0.05 ), 0.012, 0.14, 10, 0.016 );
	k.blanda( mat, - W / 2, 0.14, - D / 2, W / 2, alto, D / 2 - 0.02, 0.01, 2 );
	k.caja( mat, - W / 2 + 0.01, 0.16, D / 2 - 0.02, W / 2 - 0.01, alto - 0.02, D / 2 );
	k.caja( 'sombra', - W / 2 + 0.01, ( alto + 0.14 ) / 2 - 0.002, D / 2 - 0.003, W / 2 - 0.01, ( alto + 0.14 ) / 2 + 0.002, D / 2 + 0.001 );
	barra( k, 'metal:#b8a07a', new THREE.Vector3( 0, alto - 0.1, D / 2 ), new THREE.Vector3( 0, alto - 0.1, D / 2 + 0.015 ), 0.012 );

};

// ------------------------------------------------------------ camas

const cama: Gen = ( k, c ) => {

	const { W, D } = c;
	const doble = W > 1.2;
	const base = s( c, 'base', 'tela:#c9bfb0' ), cabecero = s( c, 'cabecero', base );
	const ropa = s( c, 'ropa', 'tela:#f4f2ed:0.8' ), almohada = s( c, 'almohada', 'tela:#f7f5f1' );
	const altoCab = n( c, 'cabecero_alto', 1.15 );
	const z0 = - D / 2, z1 = D / 2, cab = 0.09;
	k.caja( 'zocalo', - W / 2 + 0.06, 0, z0 + cab + 0.06, W / 2 - 0.06, 0.08, z1 - 0.06 );
	k.blanda( base, - W / 2, 0.08, z0 + cab, W / 2, 0.33, z1, 0.035 );
	// colchón con la sábana bajera
	k.acolchada( ropa, - W / 2 + 0.01, 0.32, z0 + cab + 0.01, W / 2 - 0.01, 0.55, z1 - 0.01, 0.06, 0.008, 0.004, 7, 0.001 );
	// edredón: cubre desde el embozo hasta los pies y cae por los lados con pliegues
	const largo = ( D - cab ) * 0.74;
	const ed = k.edredon( ropa, W, largo, 0.55, 0.26, 0.035, W * 3 );
	ed.translate( 0, 0, z1 - largo / 2 );
	// embozo: la sábana y el edredón doblados hacia atrás bajo las almohadas
	const embozo = k.acolchada( ropa, - W / 2 - 0.02, 0, - 0.12, W / 2 + 0.02, 0.07, 0.12, 0.035, 0.012, 0.002, 5, 0.003 );
	embozo.translate( 0, 0.55, z1 - largo + 0.06 );
	// almohadas y cojines
	const nA = doble ? 2 : 1;
	const aw = doble ? ( W - 0.16 ) / 2 : W - 0.24;
	for ( let i = 0; i < nA; i ++ ) {

		const x = doble ? ( i === 0 ? - W / 4 : W / 4 ) : 0;
		// almohada de verdad, recostada contra el cabecero
		const alm = k.almohada( almohada, aw, 0.42, 0.18, i + 3 );
		alm.rotateX( - Math.PI / 2 + 0.55 );
		alm.translate( x, 0.66, z0 + cab + 0.24 );

	}

	// cojines como se ponen de verdad: uno apoyado en cada almohada (en la cama de
	// matrimonio, por pares). `cojines` es una lista de filas: la primera, los grandes;
	// la segunda, si la hay, otros más pequeños delante. Nunca un número impar.
	lista( s( c, 'cojines', '' ) ).slice( 0, 2 ).forEach( ( m, fila ) => {

		const lado = fila === 0 ? ( doble ? 0.5 : 0.46 ) : ( doble ? 0.38 : 0.36 );
		const alto = fila === 0 ? lado * 0.94 : lado * 0.8;
		for ( let i = 0; i < nA; i ++ ) {

			const x = doble ? ( i === 0 ? - W / 4 : W / 4 ) : 0;
			cojin( k, m, x * ( fila === 0 ? 1 : 0.92 ), fila === 0 ? 0.76 : 0.71, z0 + cab + ( fila === 0 ? 0.42 : 0.56 ), lado, alto, fila === 0 ? 0.3 : 0.24, ( i === 0 ? 1 : - 1 ) * ( doble ? 0.06 : 0 ) );

		}

	} );
	const pie = s( c, 'plaid', '' );
	if ( pie ) {

		// plaid doblado a los pies, encima del edredón, que cae por los lados
		const z = z1 - 0.42;
		const plaid = k.edredon( pie, W + 0.07, 0.4, 0.59, 0.24, 0.025, W * 5, false, 2.5 );
		plaid.translate( 0, 0, z + 0.18 );

	}

	// cabecero
	if ( c.p.cabecero_tipo === 'listones' ) {

		const nL = Math.round( ( W + 0.1 ) / 0.07 );
		for ( let i = 0; i < nL; i ++ ) {

			const x = - W / 2 - 0.05 + ( i + 0.5 ) * ( W + 0.1 ) / nL;
			k.caja( cabecero, x - 0.025, 0.08, z0, x + 0.025, altoCab, z0 + cab * 0.6 );

		}

	} else if ( c.p.cabecero_tipo === 'capitone' ) {

		const nP = doble ? 3 : 2;
		for ( let i = 0; i < nP; i ++ ) {

			const w = ( W + 0.12 ) / nP;
			const x0 = - W / 2 - 0.06 + i * w;
			k.blanda( cabecero, x0 + 0.005, 0.08, z0, x0 + w - 0.005, altoCab, z0 + cab, 0.045, 4 );

		}

	} else k.blanda( cabecero, - W / 2 - 0.05, 0.08, z0, W / 2 + 0.05, altoCab, z0 + cab, 0.035 );

};

const cabeceroPanel: Gen = ( k, c ) => {

	const { W, H } = c;
	const tela = s( c, 'tela', 'tela:#c9bfb0' );
	k.blanda( tela, - W / 2, 0, - c.D / 2, W / 2, H, c.D / 2, 0.03 );

};

// ------------------------------------------------------------ iluminación

const lamparaPieArco: Gen = ( k, c ) => {

	const base = s( c, 'base', 'marmol:#e9e5de' ), metal = s( c, 'metal', 'metal:#b8a07a' );
	const alto = c.H;
	// la base va al fondo de la huella y la pantalla cae al frente
	const zb = - c.D / 2 + 0.16, alcance = c.D - 0.16 - 0.21;
	k.blanda( base, - 0.16, 0, zb - 0.16, 0.16, 0.28, zb + 0.16, 0.02 );
	const pts: THREE.Vector3[] = [];
	const A = Math.PI * 0.62;
	for ( let i = 0; i <= 12; i ++ ) {

		const a = ( i / 12 ) * A;
		pts.push( new THREE.Vector3( 0, 0.28 + Math.sin( a ) * ( alto - 0.28 ) * 0.92 + ( 1 - Math.cos( a ) ) * 0.02, zb + ( 1 - Math.cos( a ) ) * alcance / ( 1 - Math.cos( A ) ) ) );

	}

	tubo( k, metal, pts, 0.011, 40 );
	const fin = pts[ pts.length - 1 ];
	torno( k, metal, [ [ 0.01, 0.2 ], [ 0.08, 0.18 ], [ 0.2, 0.02 ], [ 0.21, 0 ] ], 0, fin.y - 0.22, fin.z, 40 );
	k.cilindro( 'emisivo:#ffe7c2:3', 0, fin.y - 0.21, fin.z, 0.19, fin.y - 0.2, 32 );

};

const lamparaColgante: Gen = ( k, c ) => {

	const cable = Math.max( 0.05, c.techo - c.elev - c.H );
	const r = c.W / 2;
	k.cilindro( 'metalNegro', 0, c.H, 0, 0.004, c.H + cable, 6 );
	k.cilindro( 'metalNegro', 0, c.H + cable - 0.02, 0, 0.05, c.H + cable, 20 );
	if ( c.p.forma === 'cesta' ) {

		const mat = s( c, 'pantalla', 'pantalla:#b69468:2' ).replace( /^tela:/, 'pantalla:' );
		torno( k, mat, [ [ 0.03, c.H ], [ r * 0.5, c.H * 0.9 ], [ r, c.H * 0.35 ], [ r * 0.96, 0 ] ], 0, 0, 0, 40 );
		k.cilindro( 'emisivo:#ffe2b8:2.5', 0, 0.02, 0, r * 0.93, 0.025, 32 );
		return;

	}

	esfera( k, s( c, 'pantalla', 'emisivo:#fff1dc:1.6' ), 0, c.H / 2, 0, r, 1, c.H / c.W, 1, 28 );
	k.cilindro( 'metal:#b8a07a', 0, c.H - 0.02, 0, 0.035, c.H + 0.01, 20 );

};

const lamparaMesa: Gen = ( k, c ) => {

	const base = s( c, 'base', 'ceramica:#d9cdb8' ), pantalla = s( c, 'pantalla', 'pantalla:#f1ebe0' ).replace( /^tela:/, 'pantalla:' );
	const H = c.H, r = c.W / 2;
	torno( k, base, [ [ 0, 0 ], [ r * 0.45, 0 ], [ r * 0.6, H * 0.12 ], [ r * 0.62, H * 0.3 ], [ r * 0.35, H * 0.52 ], [ 0.02, H * 0.56 ], [ 0, H * 0.56 ] ], 0, 0, 0, 32 );
	k.cilindro( 'metal:#b8a07a', 0, H * 0.55, 0, 0.008, H * 0.72, 8 );
	const g = new THREE.CylinderGeometry( r * 0.72, r, H * 0.36, 32, 1, true );
	g.translate( 0, H * 0.82, 0 );
	k.add( pantalla, g );
	k.cilindro( 'emisivo:#ffe6c0:1.8', 0, H * 0.66, 0, r * 0.95, H * 0.665, 28 );

};

// ------------------------------------------------------------ textiles y alfombras

const alfombra: Gen = ( k, c ) => {

	const { W, D } = c;
	const mat = s( c, 'material', 'tela:#e4ddd0:0.4' ), borde = s( c, 'borde', '' );
	const e = n( c, 'grosor', 0.012 );
	if ( c.p.forma === 'redonda' ) {

		k.cilindro( mat, 0, 0, 0, W / 2, e, 64 );
		return;

	}

	k.blanda( mat, - W / 2, 0, - D / 2, W / 2, e, D / 2, e / 2 - 0.001, 2 );
	if ( borde ) {

		const b = 0.05;
		k.caja( borde, - W / 2 + b, e, - D / 2 + b, W / 2 - b, e + 0.001, - D / 2 + b + 0.02 );
		k.caja( borde, - W / 2 + b, e, D / 2 - b - 0.02, W / 2 - b, e + 0.001, D / 2 - b );
		k.caja( borde, - W / 2 + b, e, - D / 2 + b, - W / 2 + b + 0.02, e + 0.001, D / 2 - b );
		k.caja( borde, W / 2 - b - 0.02, e, - D / 2 + b, W / 2 - b, e + 0.001, D / 2 - b );

	}

};

const toallas: Gen = ( k, c ) => {

	const cols = lista( s( c, 'colores', 'tela:#f4f1ea:2|tela:#d9cfbf:2' ) );
	const nT = n( c, 'cantidad', 3 );
	const h = c.H / nT;
	for ( let i = 0; i < nT; i ++ ) k.blanda( cols[ i % cols.length ], - c.W / 2 + i * 0.006, i * h, - c.D / 2, c.W / 2 - i * 0.006, ( i + 1 ) * h - 0.002, c.D / 2 - i * 0.01, h / 2 - 0.002, 3 );

};

const toallero: Gen = ( k, c ) => {

	const metal = s( c, 'metal', 'cromo' ), tela = s( c, 'toalla', 'tela:#f4f1ea:2' );
	const { W, H } = c;
	for ( const sx of [ - 1, 1 ] ) k.caja( metal, sx * W / 2 - 0.01, H - 0.03, - c.D / 2, sx * W / 2 + 0.01, H, c.D / 2 );
	barra( k, metal, new THREE.Vector3( - W / 2, H - 0.015, c.D / 2 - 0.012 ), new THREE.Vector3( W / 2, H - 0.015, c.D / 2 - 0.012 ), 0.009 );
	// toalla doblada sobre la barra
	const w = W * 0.7;
	k.blanda( tela, - w / 2, 0, c.D / 2 - 0.03, w / 2, H - 0.005, c.D / 2 - 0.01, 0.008, 2 );
	k.blanda( tela, - w / 2, H * 0.35, c.D / 2 - 0.012, w / 2, H + 0.005, c.D / 2 + 0.008, 0.008, 2 );

};

// ------------------------------------------------------------ plantas

const planta: Gen = ( k, c ) => {

	const rnd = azar( c.semilla );
	const maceta = s( c, 'maceta', 'terracota:#b8704f' ), hoja = s( c, 'hoja', 'hoja:#4d6b3c' );
	const rM = n( c, 'maceta_radio', Math.min( c.W, c.D ) * 0.28 ), hM = n( c, 'maceta_alto', c.H * 0.22 );
	torno( k, maceta, [ [ 0, 0 ], [ rM * 0.8, 0 ], [ rM, hM * 0.9 ], [ rM * 1.04, hM ], [ rM * 0.96, hM ], [ rM * 0.9, hM * 0.92 ], [ 0, hM * 0.92 ] ], 0, 0, 0, 28 );
	k.cilindro( 'terracota:#4a3b2e', 0, hM * 0.88, 0, rM * 0.9, hM * 0.9, 20 );
	const tipo = s( c, 'tipo', 'hojas' );
	if ( tipo === 'arbol' ) {

		// tronco fino con copa de hojas pequeñas (tipo olivo)
		const tronco = s( c, 'tronco', 'madera:#6e5a46' );
		const alto = c.H;
		tubo( k, tronco, [ new THREE.Vector3( 0, hM * 0.9, 0 ), new THREE.Vector3( 0.03, alto * 0.45, 0.01 ), new THREE.Vector3( - 0.02, alto * 0.7, 0 ) ], 0.022, 12 );
		for ( let i = 0; i < 5; i ++ ) {

			const a = rnd() * Math.PI * 2, rr = 0.12 + rnd() * 0.15, y = alto * ( 0.6 + rnd() * 0.3 );
			const p = new THREE.Vector3( Math.cos( a ) * rr, y, Math.sin( a ) * rr );
			tubo( k, tronco, [ new THREE.Vector3( 0, alto * 0.55, 0 ), p.clone().multiplyScalar( 0.6 ).setY( y * 0.92 ), p ], 0.008, 8 );
			for ( let j = 0; j < 22; j ++ ) {

				const q = p.clone().add( new THREE.Vector3( ( rnd() - 0.5 ) * 0.34, ( rnd() - 0.4 ) * 0.28, ( rnd() - 0.5 ) * 0.34 ) );
				const dir = q.clone().sub( p ).normalize().add( new THREE.Vector3( 0, 0.6, 0 ) );
				hojaPlana( k, hoja, q, dir, 0.07 + rnd() * 0.03, 0.012, rnd() * Math.PI );

			}

		}

		return;

	}

	// planta de hoja grande (tipo ficus o monstera)
	const nH = n( c, 'hojas', 26 );
	const alto = c.H - hM;
	for ( let i = 0; i < nH; i ++ ) {

		const a = rnd() * Math.PI * 2, t = rnd();
		const r = ( 0.15 + t * 0.85 ) * ( c.W / 2 - 0.05 );
		const y = hM + alto * ( 0.25 + ( 1 - t ) * 0.7 ) * ( 0.75 + rnd() * 0.25 );
		const tallo = new THREE.Vector3( Math.cos( a ) * r * 0.7, y - 0.05, Math.sin( a ) * r * 0.7 );
		tubo( k, 'hoja:#3f5a30', [ new THREE.Vector3( 0, hM * 0.9, 0 ), new THREE.Vector3( Math.cos( a ) * r * 0.2, ( y + hM ) / 2, Math.sin( a ) * r * 0.2 ), tallo ], 0.005, 8 );
		const dir = new THREE.Vector3( Math.cos( a ), 0.7 + rnd() * 0.6, Math.sin( a ) );
		hojaPlana( k, hoja, tallo, dir, alto * ( 0.22 + rnd() * 0.12 ), alto * ( 0.07 + rnd() * 0.04 ), rnd() * 0.6 - 0.3 );

	}

};

const jarronRamas: Gen = ( k, c ) => {

	const rnd = azar( c.semilla );
	const jarron = s( c, 'jarron', 'ceramica:#d8cbb6' ), hoja = s( c, 'hoja', 'hoja:#6b7a4f' );
	const r = c.W / 2, hJ = c.H * 0.4;
	torno( k, jarron, [ [ 0, 0 ], [ r * 0.6, 0 ], [ r, hJ * 0.45 ], [ r * 0.4, hJ * 0.9 ], [ r * 0.45, hJ ], [ r * 0.35, hJ ], [ 0, hJ * 0.8 ] ], 0, 0, 0, 32 );
	for ( let i = 0; i < 5; i ++ ) {

		const a = rnd() * Math.PI * 2, abre = 0.1 + rnd() * 0.2;
		const fin = new THREE.Vector3( Math.cos( a ) * abre, c.H * ( 0.8 + rnd() * 0.2 ), Math.sin( a ) * abre );
		const medio = fin.clone().multiplyScalar( 0.5 ).setY( ( hJ + fin.y ) / 2 );
		tubo( k, 'madera:#5d4a39', [ new THREE.Vector3( 0, hJ * 0.7, 0 ), medio, fin ], 0.004, 12 );
		for ( let j = 0; j < 9; j ++ ) {

			const t = 0.35 + rnd() * 0.65;
			const p = new THREE.Vector3( 0, hJ * 0.7, 0 ).lerp( fin, t );
			hojaPlana( k, hoja, p, new THREE.Vector3( rnd() - 0.5, 0.8, rnd() - 0.5 ), 0.06, 0.018, rnd() * Math.PI );

		}

	}

};

const jardinera: Gen = ( k, c ) => {

	const rnd = azar( c.semilla );
	const mat = s( c, 'material', 'terracota:#8d8a84' ), hoja = s( c, 'hoja', 'hoja:#55703f' );
	const { W, D } = c, hM = 0.42;
	k.blanda( mat, - W / 2, 0, - D / 2, W / 2, hM, D / 2, 0.015 );
	k.caja( 'terracota:#4a3b2e', - W / 2 + 0.03, hM - 0.03, - D / 2 + 0.03, W / 2 - 0.03, hM - 0.01, D / 2 - 0.03 );
	const nB = Math.max( 2, Math.round( W / 0.3 ) );
	if ( existeModelo( 'follaje_01' ) && ! c.p.bolas ) {

		// follaje real (Poly Haven, CC0), una mata cada ~45 cm, girada y de tamaño algo distinto
		const nF = Math.max( 1, Math.round( W / 0.45 ) );
		for ( let i = 0; i < nF; i ++ ) {

			const x = - W / 2 + ( i + 0.5 ) * W / nF, t = 0.9 + rnd() * 0.25;
			k.modelo( 'follaje_01', x + ( rnd() - 0.5 ) * 0.05, hM - 0.06, ( rnd() - 0.5 ) * 0.04, ( W / nF ) * 1.25 * t, D * 1.3 * t, 0.62 * t, rnd() * Math.PI * 2 );

		}

	} else for ( let i = 0; i < nB; i ++ ) {

		const x = - W / 2 + ( i + 0.5 ) * W / nB;
		const r = 0.14 + rnd() * 0.06;
		esfera( k, hoja, x + ( rnd() - 0.5 ) * 0.06, hM + r * 0.8, ( rnd() - 0.5 ) * 0.05, r, 1.1, 0.9 + rnd() * 0.5, 1, 12 );

	}

	if ( c.p.gramineas ) for ( let i = 0; i < 40; i ++ ) {

		const x = ( rnd() - 0.5 ) * ( W - 0.1 ), z = ( rnd() - 0.5 ) * ( D - 0.1 );
		hojaPlana( k, 'hoja:#8d9a5c', new THREE.Vector3( x, hM, z ), new THREE.Vector3( ( rnd() - 0.5 ) * 0.6, 1, ( rnd() - 0.5 ) * 0.6 ), 0.4 + rnd() * 0.3, 0.012, rnd() * Math.PI );

	}

};

// ------------------------------------------------------------ cuadros y accesorios

const cuadro: Gen = ( k, c ) => {

	const { W, H } = c;
	const marco = s( c, 'marco', 'madera:#c8a987' ), lienzo = s( c, 'lienzo', 'lienzo:#e2d6c4,#b8704f,#3d4a5c' );
	const e = 0.03, fondo = 0.03;
	const pass = n( c, 'paspartu', 0 );
	k.caja( marco, - W / 2, 0, - fondo / 2, - W / 2 + e, H, fondo / 2 );
	k.caja( marco, W / 2 - e, 0, - fondo / 2, W / 2, H, fondo / 2 );
	k.caja( marco, - W / 2 + e, 0, - fondo / 2, W / 2 - e, e, fondo / 2 );
	k.caja( marco, - W / 2 + e, H - e, - fondo / 2, W / 2 - e, H, fondo / 2 );
	if ( pass > 0 ) {

		k.caja( 'lacado', - W / 2 + e, e, - fondo / 2, W / 2 - e, H - e, fondo / 2 - 0.012 );
		k.caja( lienzo, - W / 2 + e + pass, e + pass, - fondo / 2, W / 2 - e - pass, H - e - pass, fondo / 2 - 0.01 );

	} else k.caja( lienzo, - W / 2 + e, e, - fondo / 2, W / 2 - e, H - e, fondo / 2 - 0.006 );

};

const libros: Gen = ( k, c ) => {

	const rnd = azar( c.semilla );
	const cols = lista( s( c, 'colores', 'tela:#b8704f|tela:#e3dccf|tela:#56616b|tela:#c9b58f' ) );
	let y = 0;
	const nL = n( c, 'cantidad', 3 );
	for ( let i = 0; i < nL; i ++ ) {

		const h = 0.025 + rnd() * 0.02, w = c.W * ( 0.8 + rnd() * 0.2 ), d = c.D * ( 0.8 + rnd() * 0.2 );
		const g = k.caja( cols[ i % cols.length ], - w / 2, y, - d / 2, w / 2, y + h, d / 2 );
		g.rotateY( ( rnd() - 0.5 ) * 0.25 );
		y += h;

	}

	if ( c.p.objeto ) esfera( k, String( c.p.objeto ), 0, y + 0.05, 0, 0.05, 1, 1, 1, 20 );

};

const jarron: Gen = ( k, c ) => {

	const r = c.W / 2, H = c.H;
	torno( k, s( c, 'material', 'ceramica:#e6ded0' ), [ [ 0, 0 ], [ r * 0.7, 0 ], [ r, H * 0.3 ], [ r * 0.9, H * 0.7 ], [ r * 0.45, H * 0.92 ], [ r * 0.5, H ], [ r * 0.42, H ], [ 0, H * 0.9 ] ], 0, 0, 0, 32 );

};

const frutero: Gen = ( k, c ) => {

	const r = c.W / 2;
	torno( k, s( c, 'material', 'ceramica:#efe9df' ), [ [ 0, 0 ], [ r * 0.45, 0 ], [ r * 0.5, 0.02 ], [ r, 0.08 ], [ r * 0.97, 0.085 ], [ r * 0.48, 0.03 ], [ 0, 0.028 ] ], 0, 0, 0, 36 );
	const frutas = lista( s( c, 'frutas', 'ceramica:#e39a3b|ceramica:#e39a3b|ceramica:#b9c255|ceramica:#e39a3b|ceramica:#d4b64a' ) );
	const rnd = azar( c.semilla );
	frutas.forEach( ( m, i ) => {

		const a = ( i / frutas.length ) * Math.PI * 2 + rnd() * 0.4, rr = i === 0 ? 0 : r * 0.45;
		esfera( k, m, Math.cos( a ) * rr, 0.07 + ( i === 0 ? 0.05 : 0 ), Math.sin( a ) * rr, 0.038, 1, 0.95, 1, 16 );

	} );

};

const tablaCortar: Gen = ( k, c ) => {

	const { W, H } = c;
	const mat = s( c, 'material', 'madera:#c4a07a' );
	// apoyada contra el frontal, ligeramente inclinada
	const g = k.blanda( mat, - W / 2, 0, - 0.01, W / 2, H, 0.01, 0.008, 2 );
	g.rotateX( - 0.12 );
	const asa = new THREE.TorusGeometry( 0.025, 0.006, 8, 20 );
	asa.translate( 0, H + 0.02, 0 );
	asa.rotateX( - 0.12 );
	k.add( mat, asa );

};

const botes: Gen = ( k, c ) => {

	const cols = lista( s( c, 'material', 'ceramica:#ebe5da' ) );
	const tapa = s( c, 'tapa', 'madera:#b89574' );
	const nB = n( c, 'cantidad', 3 );
	const r = c.W / nB / 2 - 0.005;
	for ( let i = 0; i < nB; i ++ ) {

		const x = - c.W / 2 + r + 0.005 + i * ( 2 * r + 0.01 );
		const h = c.H * ( 1 - i * 0.18 );
		k.cilindro( cols[ i % cols.length ], x, 0, 0, r, h - 0.02, 28 );
		k.cilindro( tapa, x, h - 0.02, 0, r * 1.02, h, 28 );

	}

};

const dispensador: Gen = ( k, c ) => {

	const r = c.W / 2;
	torno( k, s( c, 'material', 'ceramica:#d8cfc1' ), [ [ 0, 0 ], [ r, 0 ], [ r, c.H * 0.7 ], [ r * 0.4, c.H * 0.8 ], [ 0, c.H * 0.8 ] ], 0, 0, 0, 24 );
	k.cilindro( s( c, 'metal', 'cromo' ), 0, c.H * 0.8, 0, 0.008, c.H, 10 );
	k.caja( s( c, 'metal', 'cromo' ), - 0.006, c.H - 0.012, 0, 0.006, c.H, 0.035 );

};

const velas: Gen = ( k, c ) => {

	k.cilindro( s( c, 'material', 'ceramica:#f3efe6' ), - 0.03, 0, 0, 0.035, c.H, 24 );
	k.cilindro( s( c, 'material', 'ceramica:#f3efe6' ), 0.05, 0, 0.02, 0.03, c.H * 0.65, 24 );

};

const cesta: Gen = ( k, c ) => {

	const r = c.W / 2;
	torno( k, s( c, 'material', 'tela:#b69468:2' ), [ [ 0, 0.005 ], [ r * 0.9, 0 ], [ r, c.H ], [ r * 0.96, c.H ], [ r * 0.86, 0.02 ], [ 0, 0.02 ] ], 0, 0, 0, 32 );
	const manta = s( c, 'manta', '' );
	if ( manta ) esfera( k, manta, 0, c.H * 0.9, 0, r * 0.85, 1, 0.45, 1, 18 );

};

const televisor: Gen = ( k, c ) => {

	const { W, H } = c;
	k.caja( 'negro', - W / 2, 0.06, - 0.02, W / 2, H, 0.01 );
	k.caja( 'metalNegro', - 0.12, 0, - 0.08, 0.12, 0.012, 0.06 );
	k.caja( 'metalNegro', - 0.03, 0.012, - 0.03, 0.03, 0.12, 0 );

};

export const GENERADORES: Record<string, Gen> = {
	sofa, sillon, 'sillon-exterior': sillonExterior, silla,
	'mesa-comedor': mesaComedor, 'mesa-centro': mesaCentro, 'mesa-auxiliar': mesaAuxiliar, 'mesa-exterior': mesaExterior,
	'mueble-bajo': muebleBajo, mesilla, cama, 'cabecero-panel': cabeceroPanel,
	'lampara-pie-arco': lamparaPieArco, 'lampara-colgante': lamparaColgante, 'lampara-mesa': lamparaMesa,
	alfombra, toallas, toallero, planta, 'jarron-ramas': jarronRamas, jardinera,
	cuadro, libros, jarron, frutero, 'tabla-cortar': tablaCortar, botes, dispensador, velas, cesta, televisor,
};

/** Parámetros editables de cada generador (para el formulario del Studio). */
export const PARAMETROS_EDITABLES = [ 'tela', 'patas', 'cojines', 'manta', 'tapa', 'pie', 'material', 'base', 'cabecero', 'ropa', 'plaid', 'pantalla', 'hoja', 'maceta', 'marco', 'lienzo', 'forma', 'cabecero_tipo', 'acanalado' ];
