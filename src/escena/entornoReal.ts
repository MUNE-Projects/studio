// Entorno real de la promoción en el 3D (decisión 64, etapa 2): lo que rodea a
// la parcela, de fuentes públicas (Catastro, IGN y OpenStreetMap), alrededor de
// la vivienda. Lo genera MUNE Studio (herramientas/entorno.mjs) y «preparar» lo
// mete en cada versión (entorno/entorno.json y entorno/orto.jpg). En el 3D sale
// con la casilla «Entorno real», sin marcar al abrir; solo se descarga al
// marcarla.
//
//  · el suelo es el relieve del IGN con la foto aérea del PNOA encima;
//  · los edificios de alrededor, en maqueta neutra, con su altura aproximada
//    (plantas del Catastro × 3,1 m);
//  · los árboles de OpenStreetMap, en volúmenes sencillos.
//
// Coordenadas del entorno: metros, x hacia el este, y hacia el norte, con el
// origen en el centro de la parcela. La vivienda se coloca con su «situación»
// (promocion.json): dónde cae el origen de su plano en la parcela, cuánto gira
// (grados, antihorario) y a qué altura sobre la calle está su suelo.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface EntornoReal {
	radio: number;
	parcela: number[][];
	edificios: { contorno: number[][]; plantas: number; altura?: number; enParcela?: boolean }[];
	arboles: number[][];
	relieve: { ancho: number; alto: number; paso: number; esquina: [ number, number ]; cota: number; alturas: number[] } | null;
	orto: { archivo: string; recuadro: [ number, number, number, number ] } | null;
	atribucion: string[];
}

/** Dónde va una vivienda en la parcela (promocion.json → situacion[<unidad>]). */
export interface Situacion {
	/** dónde cae el origen (0, 0) del plano de la vivienda, en coordenadas del entorno */
	pos: [ number, number ];
	/** giro del plano en grados, antihorario visto desde arriba (0: el plano mira al norte) */
	giro?: number;
	/** altura del suelo de la vivienda sobre la calle (m): 0 en una planta baja */
	cota?: number;
}

/** Descarga el entorno de la versión (solo al marcar la casilla). */
export async function cargarEntornoReal( base = 'entorno/' ): Promise<{ datos: EntornoReal; foto: THREE.Texture | null }> {

	const r = await fetch( `${ base }entorno.json` );
	if ( ! r.ok ) throw new Error( `entorno ${ r.status }` );
	const datos = await r.json() as EntornoReal;
	let foto: THREE.Texture | null = null;
	if ( datos.orto ) {

		foto = await new THREE.TextureLoader().loadAsync( `${ base }${ datos.orto.archivo }` ).catch( () => null );
		if ( foto ) {

			foto.colorSpace = THREE.SRGBColorSpace;
			foto.anisotropy = 8;

		}

	}

	return { datos, foto };

}

/** Altura del terreno (m, respecto al centro de la parcela) en un punto, interpolada. */
export function alturaEn( e: EntornoReal, x: number, y: number ): number {

	const r = e.relieve;
	if ( ! r ) return 0;
	const i = ( x - r.esquina[ 0 ] ) / r.paso - 0.5, j = ( r.esquina[ 1 ] - y ) / r.paso - 0.5;
	const i0 = THREE.MathUtils.clamp( Math.floor( i ), 0, r.ancho - 2 ), j0 = THREE.MathUtils.clamp( Math.floor( j ), 0, r.alto - 2 );
	const fx = THREE.MathUtils.clamp( i - i0, 0, 1 ), fy = THREE.MathUtils.clamp( j - j0, 0, 1 );
	const h = ( a: number, b: number ) => r.alturas[ b * r.ancho + a ] / 10;
	return ( h( i0, j0 ) * ( 1 - fx ) + h( i0 + 1, j0 ) * fx ) * ( 1 - fy ) + ( h( i0, j0 + 1 ) * ( 1 - fx ) + h( i0 + 1, j0 + 1 ) * fx ) * fy;

}

const NEUTRO = '#ece8e0';

/** El suelo: la malla del relieve (o un plano, si no lo hay) con la foto aérea. */
function terreno( e: EntornoReal, foto: THREE.Texture | null ): THREE.Mesh {

	const r = e.relieve;
	const lado = e.radio;
	const nx = r ? r.ancho : 2, ny = r ? r.alto : 2;
	const x0 = r ? r.esquina[ 0 ] + r.paso / 2 : - lado, y0 = r ? r.esquina[ 1 ] - r.paso / 2 : lado;
	const paso = r ? r.paso : 2 * lado;
	const pos = new Float32Array( nx * ny * 3 ), uv = new Float32Array( nx * ny * 2 );
	const [ ux0, uy0, ux1, uy1 ] = e.orto?.recuadro ?? [ - lado, - lado, lado, lado ];
	for ( let j = 0; j < ny; j ++ ) {

		for ( let i = 0; i < nx; i ++ ) {

			const k = j * nx + i, x = x0 + i * paso, y = y0 - j * paso;
			pos.set( [ x, r ? r.alturas[ k ] / 10 : 0, - y ], k * 3 );
			uv.set( [ ( x - ux0 ) / ( ux1 - ux0 ), ( y - uy0 ) / ( uy1 - uy0 ) ], k * 2 );

		}

	}

	const indices: number[] = [];
	for ( let j = 0; j < ny - 1; j ++ ) {

		for ( let i = 0; i < nx - 1; i ++ ) {

			const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
			indices.push( a, c, b, b, c, d );

		}

	}

	const g = new THREE.BufferGeometry();
	g.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
	g.setAttribute( 'uv', new THREE.BufferAttribute( uv, 2 ) );
	g.setIndex( indices );
	g.computeVertexNormals();
	const m = new THREE.MeshStandardMaterial( { color: foto ? '#ffffff' : '#cfc8b6', map: foto, roughness: 1, metalness: 0 } );
	const malla = new THREE.Mesh( g, m );
	malla.name = 'entorno-terreno';
	malla.receiveShadow = true;
	return malla;

}

const dentroDe = ( x: number, y: number, poli: number[][] ) => {

	let d = false;
	for ( let i = 0, j = poli.length - 1; i < poli.length; j = i ++ ) {

		const [ xi, yi ] = poli[ i ], [ xj, yj ] = poli[ j ];
		if ( ( yi > y ) !== ( yj > y ) && x < ( ( xj - xi ) * ( y - yi ) ) / ( yj - yi ) + xi ) d = ! d;

	}
	return d;

};
const distanciaAlBorde = ( x: number, y: number, poli: number[][] ) => Math.min( ...poli.map( ( a, i ) => {

	const b = poli[ ( i + 1 ) % poli.length ];
	const dx = b[ 0 ] - a[ 0 ], dy = b[ 1 ] - a[ 1 ];
	const t = THREE.MathUtils.clamp( ( ( x - a[ 0 ] ) * dx + ( y - a[ 1 ] ) * dy ) / ( dx * dx + dy * dy || 1 ), 0, 1 );
	return Math.hypot( x - a[ 0 ] - t * dx, y - a[ 1 ] - t * dy );

} ) );

/**
 * ¿Está el edificio dentro de la parcela? Los que hay hoy en ella no se dibujan
 * (la promoción los sustituye); un vecino que comparte medianera no cuenta.
 */
function enLaParcela( c: number[][], parcela: number[][] ) {

	if ( parcela.length < 3 ) return false;
	const cx = c.reduce( ( s, p ) => s + p[ 0 ], 0 ) / c.length, cy = c.reduce( ( s, p ) => s + p[ 1 ], 0 ) / c.length;
	return dentroDe( cx, cy, parcela ) || c.some( ( [ x, y ] ) => dentroDe( x, y, parcela ) && distanciaAlBorde( x, y, parcela ) > 1 );

}

/** Los edificios de alrededor: volúmenes neutros, todos en una sola malla. */
function edificios( e: EntornoReal ): THREE.Mesh | null {

	const partes: THREE.BufferGeometry[] = [];
	for ( const b of e.edificios ) {

		const c = b.contorno;
		if ( c.length < 3 || b.enParcela || enLaParcela( c, e.parcela ) ) continue;
		const forma = new THREE.Shape( c.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) );
		const suelo = Math.min( ...c.map( ( [ x, y ] ) => alturaEn( e, x, y ) ) ) - 0.3;
		const cx = c.reduce( ( s, p ) => s + p[ 0 ], 0 ) / c.length, cy = c.reduce( ( s, p ) => s + p[ 1 ], 0 ) / c.length;
		const alto = ( b.altura || b.plantas * 3.1 ) + ( alturaEn( e, cx, cy ) - suelo );
		const g = new THREE.ExtrudeGeometry( forma, { depth: alto, bevelEnabled: false } );
		// (x, y, alto) → (x, alto, −y): el plano del entorno sobre el suelo del 3D
		g.rotateX( - Math.PI / 2 );
		g.translate( 0, suelo, 0 );
		g.deleteAttribute( 'uv' );
		partes.push( g );

	}

	if ( ! partes.length ) return null;
	const g = mergeGeometries( partes );
	partes.forEach( ( p ) => p.dispose() );
	g.computeVertexNormals();
	const malla = new THREE.Mesh( g, new THREE.MeshStandardMaterial( { color: NEUTRO, roughness: 0.92, metalness: 0 } ) );
	malla.name = 'entorno-edificios';
	malla.castShadow = true;
	malla.receiveShadow = true;
	return malla;

}

/** Los árboles: tronco y copa sencillos, repetidos. */
function arboles( e: EntornoReal ): THREE.Group {

	const grupo = new THREE.Group();
	grupo.name = 'entorno-arboles';
	const n = e.arboles.length;
	if ( ! n ) return grupo;
	const tronco = new THREE.InstancedMesh( new THREE.CylinderGeometry( 0.12, 0.18, 3, 6 ).translate( 0, 1.5, 0 ), new THREE.MeshStandardMaterial( { color: '#6e5a46', roughness: 1 } ), n );
	const copa = new THREE.InstancedMesh( new THREE.IcosahedronGeometry( 2.1, 1 ).scale( 1, 0.85, 1 ).translate( 0, 4.4, 0 ), new THREE.MeshStandardMaterial( { color: '#6d8556', roughness: 1, flatShading: true } ), n );
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
	e.arboles.forEach( ( [ x, y ], i ) => {

		// tamaños algo distintos, siempre los mismos para el mismo árbol
		const f = 0.8 + ( ( Math.abs( Math.sin( x * 12.9898 + y * 78.233 ) ) * 43758.5453 ) % 1 ) * 0.5;
		m.compose( p.set( x, alturaEn( e, x, y ) - 0.1, - y ), q, s.set( f, f, f ) );
		tronco.setMatrixAt( i, m );
		copa.setMatrixAt( i, m );

	} );
	copa.castShadow = true;
	grupo.add( tronco, copa );
	return grupo;

}

/** Un volumen neutro bajo una vivienda que no está en planta baja: el resto del edificio hasta el suelo. */
function zocalo( caja: [ number, number, number, number ], cota: number ): THREE.Mesh | null {

	if ( cota < 0.5 ) return null;
	const [ x0, y0, x1, y1 ] = caja;
	const g = new THREE.BoxGeometry( x1 - x0, cota, y1 - y0 ).translate( ( x0 + x1 ) / 2, - cota / 2 - 0.3, - ( y0 + y1 ) / 2 );
	const malla = new THREE.Mesh( g, new THREE.MeshStandardMaterial( { color: NEUTRO, roughness: 0.92 } ) );
	malla.name = 'entorno-zocalo';
	malla.receiveShadow = true;
	return malla;

}

/**
 * El entorno colocado alrededor de la vivienda: un grupo en coordenadas del 3D
 * de la vivienda (x del plano, y hacia arriba, z = −y del plano).
 * `caja` es la planta de la vivienda en coordenadas de su plano [x0, y0, x1, y1].
 */
export function construirEntornoReal( e: EntornoReal, foto: THREE.Texture | null, s: Situacion, caja: [ number, number, number, number ] ): THREE.Group {

	const cota = s.cota ?? 0;
	// el entorno, en sus coordenadas, con el suelo bajo la vivienda justo por debajo del suyo
	const dentro = new THREE.Group();
	dentro.add( terreno( e, foto ), arboles( e ) );
	const b = edificios( e );
	if ( b ) dentro.add( b );
	// fuera de la foto aérea, un suelo liso hasta el horizonte
	const lejos = new THREE.Mesh( new THREE.CircleGeometry( 4000, 48 ).rotateX( - Math.PI / 2 ), new THREE.MeshStandardMaterial( { color: '#c9c2b2', roughness: 1 } ) );
	lejos.position.y = Math.min( 0, ...( e.relieve?.alturas ?? [ 0 ] ).map( ( a ) => a / 10 ) ) - 0.6;
	lejos.name = 'entorno-horizonte';
	dentro.add( lejos );
	dentro.position.set( - s.pos[ 0 ], - ( alturaEn( e, s.pos[ 0 ], s.pos[ 1 ] ) + cota + 0.05 ), s.pos[ 1 ] );
	// después, el giro del plano de la vivienda
	const girado = new THREE.Group();
	girado.rotation.y = - THREE.MathUtils.degToRad( s.giro ?? 0 );
	girado.add( dentro );

	const todo = new THREE.Group();
	todo.name = 'entorno-real';
	todo.add( girado );
	const z = zocalo( caja, cota );
	if ( z ) todo.add( z );
	return todo;

}

/** Libera la memoria del entorno al quitarlo. */
export function liberarEntornoReal( g: THREE.Object3D ) {

	g.traverse( ( o ) => {

		const m = o as THREE.Mesh;
		m.geometry?.dispose();
		( Array.isArray( m.material ) ? m.material : [ m.material ] ).forEach( ( x ) => {

			if ( ! x ) return;
			( x as THREE.MeshStandardMaterial ).map?.dispose();
			x.dispose();

		} );

	} );

}
