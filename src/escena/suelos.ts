// Suelos, umbrales, techos, sofito del porche, volúmenes de estancias y entorno.

import * as THREE from 'three/webgpu';
import type { Estancia, Hueco, Rect, Vivienda } from '../modelo/tipos';
import { forma, puntoEnPoligono } from '../util/geo';
import * as M from './materiales';
import { alturaEn, alturasEstancia } from '../modelo/alturas';

const MAT_SUELO: Record<string, () => THREE.Material> = {
	'madera': () => M.tarima(),
	'porcelanico': () => M.porcelanico( '#ddd5c8', 0.9 ),
	'porcelanico-cocina': () => M.porcelanico( '#ddd5c8', 0.9 ),
	'porcelanico-bano': () => M.porcelanico( M.P.banos.suelo, 0.6, 0.002, 0.28 ),
	'ceramico': () => M.porcelanico( '#cfcac1', 0.33, 0.003, 0.5 ),
	'exterior': () => M.porcelanico( '#b8b1a6', 0.6, 0.004, 0.72 ),
};

// Materiales compartidos entre reconstrucciones (cambiar de distribución no recompila shaders).
const cache = new Map<string, THREE.Material>();
let matTecho: THREE.MeshStandardNodeMaterial | null = null;
const matVolumen = new Map<string, THREE.Material>();

/** Geometría horizontal (normal arriba o abajo) a partir de un polígono de planta. */
function plano( pol: [ number, number ][], altura: number, haciaAbajo = false ) {

	const g = new THREE.ShapeGeometry( forma( pol ) );
	g.rotateX( - Math.PI / 2 ); // (x, y) de planta -> (x, -z) de mundo, normal hacia arriba
	if ( haciaAbajo ) {

		// invertir el sentido de los triángulos y la normal
		const idx = g.index!.array as Uint16Array | Uint32Array;
		for ( let i = 0; i < idx.length; i += 3 ) [ idx[ i + 1 ], idx[ i + 2 ] ] = [ idx[ i + 2 ], idx[ i + 1 ] ];
		const n = g.attributes.normal;
		for ( let i = 0; i < n.count; i ++ ) n.setY( i, - n.getY( i ) );

	}

	g.translate( 0, altura, 0 );
	return g;

}

/** ¿La estancia toca el hueco por alguna de las caras del muro? */
function estanciaJunto( e: Estancia, h: Hueco, r: Rect ) {

	const c = ( h.desde + h.hasta ) / 2;
	const pts: [ number, number ][] = h.eje === 'x' ? [ [ c, r[ 1 ] - 0.05 ], [ c, r[ 3 ] + 0.05 ] ] : [ [ r[ 0 ] - 0.05, c ], [ r[ 2 ] + 0.05, c ] ];
	return pts.some( ( [ x, y ] ) => puntoEnPoligono( x, y, e.poligono ) );

}

export function construirSuelos( v: Vivienda, conEntorno = true ) {

	const suelos = new THREE.Group();
	suelos.name = 'suelos';
	const mat = ( k: string ) => {

		if ( ! cache.has( k ) ) cache.set( k, ( MAT_SUELO[ k ] ?? MAT_SUELO.porcelanico )() );
		return cache.get( k )!;

	};

	for ( const e of v.estancias ) {

		const m = new THREE.Mesh( plano( e.poligono, e.uso === 'exterior' ? - 0.02 : 0 ), mat( e.suelo ) );
		m.receiveShadow = true;
		m.name = `suelo-${ e.id }`;
		suelos.add( m );

	}

	// umbrales bajo los huecos (el suelo de las estancias se detiene en la cara del muro)
	for ( const h of v.huecos ) {

		if ( h.tipo === 'ventana' ) continue; // con antepecho: no hay umbral
		const muro = v.muros.find( ( m ) => m.id === h.muro )!;
		const [ x0, y0, x1, y1 ] = muro.rect;
		const r: [ number, number ][] = h.eje === 'x'
			? [ [ h.desde, y0 ], [ h.hasta, y0 ], [ h.hasta, y1 ], [ h.desde, y1 ] ]
			: [ [ x0, h.desde ], [ x1, h.desde ], [ x1, h.hasta ], [ x0, h.hasta ] ];
		// umbral del mismo suelo que la estancia a la que abre la puerta (o gres en balconeras)
		const destino = h.tipo === 'balconera' ? 'porcelanico' : ( v.estancias.find( ( e ) => e.suelo === 'madera' && estanciaJunto( e, h, muro.rect ) )?.suelo ?? 'porcelanico' );
		const m = new THREE.Mesh( plano( r, h.tipo === 'balconera' ? - 0.005 : 0 ), mat( destino ) );
		m.receiveShadow = true;
		suelos.add( m );

	}

	// techos: planos mirando hacia abajo; invisibles desde arriba (vista de maqueta)
	// pero siguen proyectando sombra cuando la cámara está dentro.
	const techos = new THREE.Group();
	techos.name = 'techos';
	if ( ! matTecho ) {

		matTecho = M.pintura( '#f4f3f0' );
		matTecho.shadowSide = THREE.DoubleSide;

	}

	for ( const e of v.estancias ) {

		if ( e.uso === 'exterior' && e.id !== 'porche' ) continue;
		// falso techo o techo inclinado: cada vértice a su altura
		const g = plano( e.poligono, 0, true );
		const pos = g.attributes.position;
		for ( let i = 0; i < pos.count; i ++ ) pos.setY( i, alturaEn( e, v, pos.getX( i ), - pos.getZ( i ) ) );
		if ( e.techo?.inclinado ) g.computeVertexNormals();
		const m = new THREE.Mesh( g, matTecho );
		m.castShadow = true;
		m.receiveShadow = true;
		m.userData.porche = e.id === 'porche';
		techos.add( m );

	}

	// volúmenes por estancia (estado 2)
	const volumenes = new THREE.Group();
	volumenes.name = 'volumenes';
	for ( const e of v.estancias ) {

		const alto = e.uso === 'exterior' ? 0.12 : alturasEstancia( e, v )[ 0 ] * 0.94;
		const g = new THREE.ExtrudeGeometry( forma( e.poligono ), { depth: alto, bevelEnabled: false } );
		g.rotateX( - Math.PI / 2 );
		if ( ! matVolumen.has( e.uso ) ) matVolumen.set( e.uso, M.volumen( e.uso ) );
		const m = new THREE.Mesh( g, matVolumen.get( e.uso )! );
		m.castShadow = true;
		m.receiveShadow = true;
		m.name = `volumen-${ e.id }`;
		volumenes.add( m );

	}

	if ( ! conEntorno ) return { suelos, techos, volumenes, entorno: null };

	// entorno: pavimento de urbanización (zonas comunes) bajo y alrededor de la vivienda
	const centro = new THREE.Vector3( 6.4, 0, - 3.5 );
	const zCesped = - Math.min( ...v.exterior.barandilla.recorrido.map( ( q ) => q[ 1 ] ) ) + 0.12;
	const suelo = new THREE.Mesh( new THREE.CircleGeometry( 60, 96 ), M.suelo_exterior( centro, zCesped ) );
	suelo.rotation.x = - Math.PI / 2;
	suelo.position.set( centro.x, - 0.035, centro.z );
	suelo.receiveShadow = true;
	suelo.name = 'entorno';

	return { suelos, techos, volumenes, entorno: suelo };

}

/**
 * Canto del forjado que cubre el porche (la planta de arriba). Solo se muestra
 * con la cámara a la altura de los ojos; en la vista de maqueta taparía el porche.
 */
export function construirCantoPorche( v: Vivienda ) {

	const H = v.alturas.libre.valor, F = v.alturas.forjado.valor;
	const porche = v.estancias.find( ( e ) => e.id === 'porche' );
	const g = new THREE.Group();
	g.name = 'canto-porche';
	if ( ! porche ) return g;
	const xs = porche.poligono.map( ( p ) => p[ 0 ] ), ys = porche.poligono.map( ( p ) => p[ 1 ] );
	const x0 = Math.min( ...xs ), x1 = Math.max( ...xs ) + 0.05, y0 = Math.min( ...ys ), y1 = 0;
	const forma3 = new THREE.BoxGeometry( x1 - x0, F, y1 - y0 );
	forma3.translate( ( x0 + x1 ) / 2, H + F / 2, - ( y0 + y1 ) / 2 );
	const m = new THREE.Mesh( forma3, M.sate( '#f1efea', false ) );
	m.castShadow = true;
	m.receiveShadow = true;
	g.add( m );
	return g;

}
