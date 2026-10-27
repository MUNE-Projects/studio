// Árboles y setos para la maqueta exterior: copas hechas de cientos de
// «tarjetas» de hojas (una textura con recorte, generada aquí mismo) sobre un
// tronco con sus ramas principales. Se ven con silueta y luz de árbol de verdad,
// no como bolas, y cuestan poco: cada especie es una malla instanciada.

import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { azar } from '../biblioteca/generadores';

export type Especie = 'frondoso' | 'olivo' | 'pino' | 'seto';

interface Forma {
	tronco: number; // altura del tronco hasta la copa (fracción de la altura)
	copa: [ number, number, number ]; // semiejes de la copa (fracción de la altura): ancho, alto, ancho
	tarjetas: number;
	tam: number; // lado de cada tarjeta (m, para un árbol de 6 m)
	hojas: [ string, string ];
	corteza: string;
	ramas: number;
}

const FORMAS: Record<Especie, Forma> = {
	frondoso: { tronco: 0.38, copa: [ 0.36, 0.34, 0.36 ], tarjetas: 420, tam: 0.95, hojas: [ '#4d6b33', '#7f9a4a' ], corteza: '#5f564c', ramas: 5 },
	olivo: { tronco: 0.42, copa: [ 0.42, 0.26, 0.42 ], tarjetas: 300, tam: 0.8, hojas: [ '#6f7d5c', '#a3ad8a' ], corteza: '#7a7064', ramas: 4 },
	pino: { tronco: 0.7, copa: [ 0.38, 0.14, 0.38 ], tarjetas: 320, tam: 0.9, hojas: [ '#3e5634', '#62784a' ], corteza: '#6a5a4c', ramas: 4 },
	seto: { tronco: 0, copa: [ 0.5, 0.5, 0.5 ], tarjetas: 90, tam: 0.5, hojas: [ '#3f5a2e', '#6c8442' ], corteza: '#000000', ramas: 0 },
};

let TEXTURA: THREE.CanvasTexture | null = null;

/** Textura de un ramillete de hojas (blanco, el color va por vértice), con transparencia. */
function texturaHojas() {

	if ( TEXTURA ) return TEXTURA;
	const n = 256;
	const lienzo = document.createElement( 'canvas' );
	lienzo.width = lienzo.height = n;
	const c = lienzo.getContext( '2d' )!;
	const rnd = azar( 'hojas' );
	for ( let i = 0; i < 70; i ++ ) {

		// hojas repartidas en un círculo, más densas en el centro
		const a = rnd() * Math.PI * 2, r = Math.sqrt( rnd() ) * n * 0.42;
		const x = n / 2 + Math.cos( a ) * r, y = n / 2 + Math.sin( a ) * r;
		const g = 175 + Math.floor( rnd() * 80 );
		c.fillStyle = `rgb(${ g },${ g },${ g })`;
		c.save();
		c.translate( x, y );
		c.rotate( rnd() * Math.PI );
		c.beginPath();
		c.ellipse( 0, 0, 5 + rnd() * 6, 13 + rnd() * 9, 0, 0, Math.PI * 2 );
		c.fill();
		c.restore();

	}
	TEXTURA = new THREE.CanvasTexture( lienzo );
	TEXTURA.colorSpace = THREE.SRGBColorSpace;
	TEXTURA.anisotropy = 4;
	return TEXTURA;

}

/** Geometría de un árbol de 1 m de alto (se escala en cada instancia): copa y madera por separado. */
function modelo( especie: Especie ) {

	const f = FORMAS[ especie ];
	const rnd = azar( `arbol-${ especie }` );
	const hojas: THREE.BufferGeometry[] = [];
	const madera: THREE.BufferGeometry[] = [];
	const [ ax, ay, az ] = f.copa;
	const cy = f.tronco + ay * 0.85;
	const c1 = new THREE.Color( f.hojas[ 0 ] ), c2 = new THREE.Color( f.hojas[ 1 ] );
	const tam = f.tam / 6;
	for ( let i = 0; i < f.tarjetas; i ++ ) {

		// punto en el elipsoide de la copa, más en la superficie (las hojas están fuera)
		const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = 0.55 + 0.45 * Math.cbrt( rnd() );
		const s = Math.sqrt( 1 - u * u );
		const p = new THREE.Vector3( Math.cos( a ) * s * ax * r, u * ay * r, Math.sin( a ) * s * az * r );
		const q = new THREE.PlaneGeometry( tam * ( 0.8 + rnd() * 0.5 ), tam * ( 0.8 + rnd() * 0.5 ) );
		q.rotateX( ( rnd() - 0.5 ) * Math.PI );
		q.rotateY( rnd() * Math.PI * 2 );
		q.rotateZ( ( rnd() - 0.5 ) * Math.PI );
		q.translate( p.x, cy + p.y, p.z );
		// normales hacia fuera de la copa: se ilumina como un volumen suave
		const n = q.attributes.normal, pos = q.attributes.position;
		const col: number[] = [];
		// más claro arriba y por fuera, más oscuro abajo y dentro
		const luz = THREE.MathUtils.clamp( 0.5 + u * 0.35 + ( r - 0.75 ) * 0.8 + ( rnd() - 0.5 ) * 0.3, 0, 1 );
		const cc = c1.clone().lerp( c2, luz );
		for ( let k = 0; k < pos.count; k ++ ) {

			const v = new THREE.Vector3( pos.getX( k ), pos.getY( k ) - cy, pos.getZ( k ) ).normalize();
			n.setXYZ( k, v.x, v.y, v.z );
			col.push( cc.r, cc.g, cc.b );

		}
		q.setAttribute( 'color', new THREE.Float32BufferAttribute( col, 3 ) );
		hojas.push( q );

	}
	if ( f.tronco > 0 ) {

		// tronco y ramas principales hacia la copa
		const base = new THREE.Vector3( 0, 0, 0 ), alto = new THREE.Vector3( ( rnd() - 0.5 ) * 0.04, f.tronco, ( rnd() - 0.5 ) * 0.04 );
		madera.push( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( [ base, new THREE.Vector3( 0, f.tronco * 0.5, 0 ), alto ] ), 6, 0.022, 7 ) );
		for ( let i = 0; i < f.ramas; i ++ ) {

			const a = ( i / f.ramas ) * Math.PI * 2 + rnd() * 0.6;
			const fin = new THREE.Vector3( Math.cos( a ) * ax * 0.6, cy + ( rnd() - 0.3 ) * ay * 0.6, Math.sin( a ) * az * 0.6 );
			const medio = alto.clone().lerp( fin, 0.5 ).add( new THREE.Vector3( 0, 0.04, 0 ) );
			madera.push( new THREE.TubeGeometry( new THREE.CatmullRomCurve3( [ alto, medio, fin ] ), 6, 0.011, 5 ) );

		}

	}
	return { hojas: mergeGeometries( hojas ), madera: madera.length ? mergeGeometries( madera ) : null };

}

export interface Plantacion { x: number; z: number; alto: number; giro?: number }

/** Una especie plantada en varios sitios (x, z de mundo; alto en metros). */
export function plantar( especie: Especie, sitios: Plantacion[] ) {

	const g = new THREE.Group();
	if ( ! sitios.length ) return g;
	const f = FORMAS[ especie ];
	const { hojas, madera } = modelo( especie );
	const matHojas = new THREE.MeshStandardNodeMaterial( { map: texturaHojas(), vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 } );
	const matMadera = new THREE.MeshStandardNodeMaterial( { color: f.corteza, roughness: 0.9 } );
	const rnd = azar( `plantar-${ especie }` );
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Vector3( 0, 1, 0 );
	const malla = ( geo: THREE.BufferGeometry, mat: THREE.Material ) => {

		const im = new THREE.InstancedMesh( geo, mat, sitios.length );
		sitios.forEach( ( s, i ) => {

			q.setFromAxisAngle( e, s.giro ?? rnd() * Math.PI * 2 );
			const k = s.alto * ( 0.92 + rnd() * 0.16 );
			m.compose( new THREE.Vector3( s.x, 0, s.z ), q, new THREE.Vector3( k, s.alto, k ) );
			im.setMatrixAt( i, m );

		} );
		im.castShadow = im.receiveShadow = true;
		im.computeBoundingSphere();
		return im;

	};
	g.add( malla( hojas, matHojas ) );
	if ( madera ) g.add( malla( madera, matMadera ) );
	return g;

}
