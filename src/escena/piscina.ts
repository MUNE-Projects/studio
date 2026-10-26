// Piscina opcional: vaso elevado sobre el forjado de la terraza.
// Se construye una vez y se muestra u oculta sin reconstruir nada más.

import * as THREE from 'three/webgpu';
import { bumpMap, float, mx_noise_float, positionWorld, time, vec3 } from 'three/tsl';
import type { Piscina, Vivienda } from '../modelo/tipos';
import { esCubierta } from '../modelo/exteriores';
import { puntoEnPoligono } from '../util/geo';
import { caja, unir } from '../util/geo';
import * as M from './materiales';

/** Comprueba que la piscina cabe donde se ha previsto; devuelve los incumplimientos. */
export function validarPiscina( c: Piscina, v: Vivienda ): string[] {

	const [ x0, y0, x1, y1 ] = c.rect;
	const esquinas: [ number, number ][] = [ [ x0, y0 ], [ x1, y0 ], [ x1, y1 ], [ x0, y1 ] ];
	const descubiertas = v.estancias.filter( ( e ) => e.uso === 'exterior' && ! esCubierta( e ) );
	const cubiertas = v.estancias.filter( esCubierta );
	const fallos: string[] = [];
	if ( ! descubiertas.some( ( t ) => esquinas.every( ( [ x, y ] ) => puntoEnPoligono( x, y, t.poligono ) ) ) ) fallos.push( 'no queda dentro de un exterior descubierto' );
	if ( cubiertas.some( ( p ) => esquinas.some( ( [ x, y ] ) => puntoEnPoligono( x, y, p.poligono ) ) ) ) fallos.push( 'invade un exterior cubierto' );
	// paso libre hasta la fachada más cercana
	const paso = Math.min( ...v.muros.map( ( m ) => Math.hypot( Math.max( 0, m.rect[ 0 ] - x1, x0 - m.rect[ 2 ] ), Math.max( 0, m.rect[ 1 ] - y1, y0 - m.rect[ 3 ] ) ) ) );
	if ( paso < c.pasoMinimoFachada ) fallos.push( `deja menos de ${ c.pasoMinimoFachada } m de paso frente a la fachada` );
	return fallos;

}

export function construirPiscina( c: Piscina ) {

	const [ x0, y0, x1, y1 ] = c.rect;
	const e = c.espesor, h = c.alturaVaso, a = c.albardilla;
	const g = new THREE.Group();
	g.name = 'piscina';

	// vaso: muros perimetrales con revestimiento exterior de fachada
	const vaso = unir( [
		caja( x0, y0, x1, y0 + e, 0, h ),
		caja( x0, y1 - e, x1, y1, 0, h ),
		caja( x0, y0 + e, x0 + e, y1 - e, 0, h ),
		caja( x1 - e, y0 + e, x1, y1 - e, 0, h ),
	] )!;
	const mVaso = new THREE.Mesh( vaso, M.sate( '#f1efea', false ) );

	// albardilla de piedra clara, volada 3 cm a cada lado
	const v = 0.03;
	const albardilla = unir( [
		caja( x0 - v, y0 - v, x1 + v, y0 + e + v, h, h + a ),
		caja( x0 - v, y1 - e - v, x1 + v, y1 + v, h, h + a ),
		caja( x0 - v, y0 + e + v, x0 + e + v, y1 - e - v, h, h + a ),
		caja( x1 - e - v, y0 + e + v, x1 + v, y1 - e - v, h, h + a ),
	] )!;
	const mAlb = new THREE.Mesh( albardilla, M.porcelanico( '#e7e2d8', 0.5, 0.002, 0.6 ) );

	// interior en gresite claro
	const interior = new THREE.Mesh( caja( x0 + e, y0 + e, x1 - e, y1 - e, 0, 0.02 ), M.porcelanico( '#a9d1d8', 0.05, 0.0012, 0.25 ) );
	const paredes = unir( [
		caja( x0 + e, y0 + e, x1 - e, y0 + e + 0.005, 0.02, h ),
		caja( x0 + e, y1 - e - 0.005, x1 - e, y1 - e, 0.02, h ),
		caja( x0 + e, y0 + e, x0 + e + 0.005, y1 - e, 0.02, h ),
		caja( x1 - e - 0.005, y0 + e, x1 - e, y1 - e, 0.02, h ),
	] )!;
	const mParedes = new THREE.Mesh( paredes, M.alicatado( '#a9d1d8' ) );

	// lámina de agua con oleaje suave animado
	const agua = new THREE.MeshPhysicalNodeMaterial( { transparent: true, depthWrite: false } );
	const p = positionWorld;
	const ola = mx_noise_float( vec3( p.x.mul( 3 ).add( time.mul( 0.25 ) ), p.z.mul( 3 ), time.mul( 0.2 ) ) )
		.add( mx_noise_float( vec3( p.x.mul( 7 ), p.z.mul( 7 ).sub( time.mul( 0.35 ) ), 1.3 ) ).mul( 0.5 ) );
	agua.colorNode = M.color( '#5fa9bb' );
	agua.opacityNode = float( 0.55 );
	agua.roughnessNode = float( 0.04 );
	agua.normalNode = bumpMap( ola, float( 0.08 ) );
	const lamina = new THREE.Mesh( caja( x0 + e, y0 + e, x1 - e, y1 - e, c.alturaAgua - 0.001, c.alturaAgua ), agua );
	lamina.renderOrder = 2;

	for ( const m of [ mVaso, mAlb, interior, mParedes ] ) m.castShadow = m.receiveShadow = true;
	g.add( mVaso, mAlb, interior, mParedes, lamina );
	return g;

}
