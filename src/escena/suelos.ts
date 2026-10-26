// Suelos, umbrales, techos, sofito del porche, volúmenes de estancias y entorno.

import * as THREE from 'three/webgpu';
import type { Estancia, Hueco, Rect, Vivienda } from '../modelo/tipos';
import { forma, puntoEnPoligono } from '../util/geo';
import * as M from './materiales';
import { alturaEn, alturasEstancia } from '../modelo/alturas';
import { alturaSueloEn, esCubierta, marcoEntorno } from '../modelo/exteriores';
import { dePlanta, plantaCalle, plantasDe } from '../modelo/plantas';

const MAT_SUELO: Record<string, () => THREE.Material> = {
	'madera': () => M.tarima(),
	'porcelanico': () => M.porcelanico( '#ddd5c8', 0.9 ),
	'porcelanico-cocina': () => M.porcelanico( '#ddd5c8', 0.9 ),
	'porcelanico-bano': () => M.porcelanico( M.P.banos.suelo, 0.6, 0.002, 0.28 ),
	'ceramico': () => M.porcelanico( '#cfcac1', 0.33, 0.003, 0.5 ),
	'exterior': () => M.porcelanico( '#b8b1a6', 0.6, 0.004, 0.72 ),
	'cesped': () => M.cesped(),
	// garaje: solera de hormigón pulido (juntas de retracción cada 3 m)
	'hormigon': () => M.porcelanico( '#a8a49d', 3, 0.004, 0.62 ),
};

// Materiales compartidos entre reconstrucciones (cambiar de distribución no recompila shaders).
const cache = new Map<string, THREE.Material>();
let matTecho: THREE.MeshStandardNodeMaterial | null = null;
const matVolumen = new Map<string, THREE.Material>();
let matLosa: THREE.Material | null = null;

/** Geometría horizontal (normal arriba o abajo) a partir de un polígono de planta. */
function plano( pol: [ number, number ][], altura: number, haciaAbajo = false, huecos: Rect[] = [] ) {

	const f = forma( pol );
	// huecos (escaleras que suben a la planta de arriba): el techo se abre
	for ( const [ x0, y0, x1, y1 ] of huecos ) f.holes.push( new THREE.Path( [ new THREE.Vector2( x0, y0 ), new THREE.Vector2( x0, y1 ), new THREE.Vector2( x1, y1 ), new THREE.Vector2( x1, y0 ) ] ) );
	const g = new THREE.ShapeGeometry( f );
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

		const g = plano( e.poligono, e.uso === 'exterior' ? - 0.02 : 0 );
		if ( e.rampa ) {

			// rampa: cada vértice a su altura
			const pos = g.attributes.position;
			for ( let i = 0; i < pos.count; i ++ ) pos.setY( i, alturaSueloEn( e, pos.getX( i ), - pos.getZ( i ) ) - 0.02 );
			g.computeVertexNormals();

		}
		const m = new THREE.Mesh( g, mat( e.suelo ) );
		m.receiveShadow = true;
		m.name = `suelo-${ e.id }`;
		suelos.add( m );
		// terrazas y balcones en alto: se ve el canto y la cara de abajo del forjado
		if ( e.uso === 'exterior' && ! e.rampa && ( v.cotaPlanta ?? 0 ) > 0 ) {

			const F = v.alturas.forjado.valor;
			const losa = new THREE.ExtrudeGeometry( forma( e.poligono ), { depth: F, bevelEnabled: false } );
			losa.rotateX( - Math.PI / 2 );
			losa.translate( 0, - 0.02 - F, 0 );
			matLosa ??= M.sate( '#f1efea', false );
			const ml = new THREE.Mesh( losa, matLosa );
			ml.castShadow = ml.receiveShadow = true;
			suelos.add( ml );

		}

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
		const destino = h.tipo === 'garaje' ? 'hormigon' : h.tipo === 'balconera' ? 'porcelanico' : ( v.estancias.find( ( e ) => e.suelo === 'madera' && estanciaJunto( e, h, muro.rect ) )?.suelo ?? 'porcelanico' );
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

		if ( e.uso === 'exterior' && ! esCubierta( e ) ) continue;
		// falso techo o techo inclinado: cada vértice a su altura
		const escaleras = v.equipamiento.filter( ( q ) => q.tipo === 'escalera' && puntoEnPoligono( ( q.rect[ 0 ] + q.rect[ 2 ] ) / 2, ( q.rect[ 1 ] + q.rect[ 3 ] ) / 2, e.poligono ) );
		const g = plano( e.poligono, 0, true, escaleras.map( ( q ) => q.rect ) );
		const pos = g.attributes.position;
		for ( let i = 0; i < pos.count; i ++ ) pos.setY( i, alturaEn( e, v, pos.getX( i ), - pos.getZ( i ) ) );
		if ( e.techo?.inclinado ) g.computeVertexNormals();
		const m = new THREE.Mesh( g, matTecho );
		m.castShadow = true;
		m.receiveShadow = true;
		m.userData.porche = esCubierta( e );
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

	// entorno: pavimento de urbanización (zonas comunes) bajo y alrededor de la
	// vivienda, con césped hacia el lado de sus exteriores (terraza, jardín)
	const mc = marcoEntorno( dePlanta( v, plantaCalle( v ) ) );
	// huecos en el terreno: rampas y patios de las plantas bajo rasante
	const ps = plantasDe( v );
	const bajoRasante = v.estancias.filter( ( e ) => e.uso === 'exterior' && ( ps[ e.planta ?? 0 ]?.cota ?? 0 ) < 0 );
	let terreno: THREE.BufferGeometry = new THREE.CircleGeometry( 60, 96 );
	if ( bajoRasante.length ) {

		const f = new THREE.Shape().absarc( 0, 0, 60, 0, Math.PI * 2, false );
		for ( const e of bajoRasante ) f.holes.push( new THREE.Path( e.poligono.map( ( [ x, y ] ) => new THREE.Vector2( x - mc.cx, y + mc.cz ) ) ) );
		terreno = new THREE.ShapeGeometry( f, 96 );

	}
	const suelo = new THREE.Mesh( terreno, M.suelo_exterior( mc.cx, mc.cz, mc.frente + 0.12, mc.angulo ) );
	suelo.rotation.x = - Math.PI / 2;
	suelo.position.set( mc.cx, - 0.035, mc.cz );
	suelo.receiveShadow = true;
	suelo.name = 'entorno';

	return { suelos, techos, volumenes, entorno: suelo };

}

/**
 * Canto del forjado que cubre porches y exteriores cubiertos (la planta de
 * arriba o la cubierta). Solo se muestra con la cámara a la altura de los ojos;
 * en la vista de maqueta taparía el porche.
 */
export function construirCantoPorche( v: Vivienda ) {

	const H = v.alturas.libre.valor, F = v.alturas.forjado.valor;
	const g = new THREE.Group();
	g.name = 'canto-porche';
	plantasDe( v ).forEach( ( p, i ) => {

		for ( const e of dePlanta( v, i ).estancias.filter( esCubierta ) ) {

			const losa = new THREE.ExtrudeGeometry( forma( e.poligono ), { depth: F, bevelEnabled: false } );
			losa.rotateX( - Math.PI / 2 );
			losa.translate( 0, p.cota + H, 0 );
			const m = new THREE.Mesh( losa, M.sate( '#f1efea', false ) );
			m.castShadow = true;
			m.receiveShadow = true;
			g.add( m );

		}

	} );
	return g;

}
