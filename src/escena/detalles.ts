// Detalles constructivos que dan escala y acabado a los interiores:
// rodapiés lacados y downlights empotrados en techo. Se generan a partir de
// los datos de la vivienda (estancias, muros y huecos): no hay que dibujarlos.

import * as THREE from 'three/webgpu';
import type { Estancia, Vivienda } from '../modelo/tipos';
import { puntoEnPoligono, puntoEnRect, unir } from '../util/geo';
import * as M from './materiales';
import { esCarpinteriaExterior } from '../modelo/huecos';

const ALTO_RODAPIE = 0.07, GRUESO_RODAPIE = 0.012;
/** Estancias sin rodapié (alicatadas o exteriores). */
const SIN_RODAPIE = ( e: Estancia ) => e.uso === 'exterior' || e.uso === 'humedo';

let matRodapie: THREE.Material | null = null;
let matAro: THREE.Material | null = null;
let matLuz: THREE.Material | null = null;

/** ¿Hay muro macizo (sin hueco) en el punto de planta? */
function muroMacizo( v: Vivienda, x: number, y: number ) {

	const m = v.muros.find( ( w ) => puntoEnRect( x, y, w.rect ) );
	if ( ! m ) return false;
	return ! v.huecos.some( ( h ) => h.muro === m.id && ( h.eje === 'x' ? x : y ) > h.desde - 0.02 && ( h.eje === 'x' ? x : y ) < h.hasta + 0.02 );

}

export function construirRodapies( v: Vivienda ) {

	matRodapie ??= M.lacado( '#f3f1ec', 0.45 );
	const gs: THREE.BufferGeometry[] = [];
	const paso = 0.04;
	for ( const e of v.estancias ) {

		if ( SIN_RODAPIE( e ) ) continue;
		const p = e.poligono;
		for ( let i = 0; i < p.length; i ++ ) {

			const [ ax, ay ] = p[ i ], [ bx, by ] = p[ ( i + 1 ) % p.length ];
			const L = Math.hypot( bx - ax, by - ay );
			if ( L < 0.05 ) continue;
			const ux = ( bx - ax ) / L, uy = ( by - ay ) / L;
			// normal hacia dentro de la estancia
			let nx = - uy, ny = ux;
			const mx = ( ax + bx ) / 2, my = ( ay + by ) / 2;
			if ( ! puntoEnPoligono( mx + nx * 0.05, my + ny * 0.05, p ) ) {

				nx = - nx; ny = - ny;

			}

			// tramos con muro macizo detrás
			let inicio: number | null = null;
			const cerrar = ( t: number ) => {

				if ( inicio === null ) return;
				const t0 = inicio, t1 = Math.min( t, L );
				inicio = null;
				if ( t1 - t0 < 0.05 ) return;
				const g = new THREE.BoxGeometry( t1 - t0, ALTO_RODAPIE, GRUESO_RODAPIE );
				const cx = ax + ux * ( t0 + t1 ) / 2 + nx * GRUESO_RODAPIE / 2, cy = ay + uy * ( t0 + t1 ) / 2 + ny * GRUESO_RODAPIE / 2;
				g.rotateY( Math.atan2( uy, ux ) ); // x local a lo largo del tramo (y de planta = -z de mundo)
				g.translate( cx, ALTO_RODAPIE / 2, - cy );
				gs.push( g );

			};

			for ( let t = 0; t <= L + 1e-6; t += paso ) {

				const x = ax + ux * t - nx * 0.03, y = ay + uy * t - ny * 0.03;
				if ( muroMacizo( v, x, y ) ) inicio ??= t;
				else cerrar( t );

			}

			cerrar( L );

		}

	}

	const g = new THREE.Group();
	g.name = 'rodapies';
	const geo = unir( gs );
	if ( geo ) {

		const m = new THREE.Mesh( geo, matRodapie );
		m.receiveShadow = true;
		g.add( m );

	}

	return g;

}

/** Downlights empotrados: rejilla regular dentro de cada estancia interior. */
export function construirDownlights( v: Vivienda ) {

	matAro ??= M.liso( '#e9e8e4', 0.35 );
	matLuz ??= M.emisivo( '#fff3e0', 1.4 );
	const H = v.alturas.libre.valor;
	const aros: THREE.BufferGeometry[] = [], luces: THREE.BufferGeometry[] = [];
	for ( const e of v.estancias ) {

		if ( e.uso === 'exterior' ) continue;
		const xs = e.poligono.map( ( q ) => q[ 0 ] ), ys = e.poligono.map( ( q ) => q[ 1 ] );
		const x0 = Math.min( ...xs ), x1 = Math.max( ...xs ), y0 = Math.min( ...ys ), y1 = Math.max( ...ys );
		const sep = e.uso === 'dia' ? 1.6 : e.uso === 'noche' ? 1.9 : 1.4;
		const nx = Math.max( 1, Math.round( ( x1 - x0 ) / sep ) ), ny = Math.max( 1, Math.round( ( y1 - y0 ) / sep ) );
		for ( let i = 0; i < nx; i ++ ) for ( let j = 0; j < ny; j ++ ) {

			const x = x0 + ( i + 0.5 ) * ( x1 - x0 ) / nx, y = y0 + ( j + 0.5 ) * ( y1 - y0 ) / ny;
			if ( ! puntoEnPoligono( x, y, e.poligono ) ) continue;
			// alejado de los muros
			if ( v.muros.some( ( m ) => puntoEnRect( x, y, m.rect, 0.25 ) ) ) continue;
			const aro = new THREE.RingGeometry( 0.045, 0.058, 24 );
			aro.rotateX( Math.PI / 2 );
			aro.translate( x, H - 0.001, - y );
			aros.push( aro );
			const luz = new THREE.CircleGeometry( 0.045, 24 );
			luz.rotateX( Math.PI / 2 );
			luz.translate( x, H - 0.003, - y );
			luces.push( luz );

		}

	}

	const g = new THREE.Group();
	g.name = 'downlights';
	const ga = unir( aros ), gl = unir( luces );
	if ( ga ) g.add( new THREE.Mesh( ga, matAro ) );
	if ( gl ) g.add( new THREE.Mesh( gl, matLuz ) );
	return g;

}

let matMecanismo: THREE.Material | null = null;
let matTecla: THREE.Material | null = null;

/** Interruptores junto a las puertas, en la cara hacia la que abre la hoja (lado libre). */
export function construirMecanismos( v: Vivienda ) {

	matMecanismo ??= M.lacado( '#f6f5f2', 0.35 );
	matTecla ??= M.liso( '#e4e2dd', 0.4 );
	const placas: THREE.BufferGeometry[] = [], teclas: THREE.BufferGeometry[] = [];
	for ( const h of v.huecos.filter( ( x ) => ! esCarpinteriaExterior( x ) && x.tipo !== 'paso' ) ) {

		const [ x0, y0, x1, y1 ] = v.muros.find( ( m ) => m.id === h.muro )!.rect;
		const enX = h.eje === 'x';
		const pos = h.abre === 'n' || h.abre === 'e';
		const cara = enX ? ( pos ? y1 : y0 ) : ( pos ? x1 : x0 );
		const u = h.bisagra === 'inicio' ? h.hasta + 0.16 : h.desde - 0.16;
		const w = cara + ( pos ? 0.005 : - 0.005 );
		// debe haber muro macizo detrás
		const [ px, py ] = enX ? [ u, cara + ( pos ? - 0.03 : 0.03 ) ] : [ cara + ( pos ? - 0.03 : 0.03 ), u ];
		if ( ! muroMacizo( v, px, py ) ) continue;
		const g = new THREE.BoxGeometry( 0.082, 0.082, 0.01 );
		const t = new THREE.BoxGeometry( 0.05, 0.05, 0.004 );
		if ( ! enX ) {

			g.rotateY( Math.PI / 2 );
			t.rotateY( Math.PI / 2 );

		}

		const c = enX ? new THREE.Vector3( u, 1.05, - w ) : new THREE.Vector3( w, 1.05, - u );
		g.translate( c.x, c.y, c.z );
		const dt = ( pos ? 1 : - 1 ) * 0.007;
		t.translate( c.x + ( enX ? 0 : dt ), c.y, c.z - ( enX ? dt : 0 ) );
		placas.push( g );
		teclas.push( t );

	}

	const grupo = new THREE.Group();
	grupo.name = 'mecanismos';
	const gp = unir( placas ), gt = unir( teclas );
	if ( gp ) grupo.add( new THREE.Mesh( gp, matMecanismo ) );
	if ( gt ) grupo.add( new THREE.Mesh( gt, matTecla ) );
	return grupo;

}
