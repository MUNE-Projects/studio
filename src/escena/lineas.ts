// Grafismo de planta (estado 1): giros de puerta, carpinterías, mobiliario
// y la proyección del porche, como líneas finas sobre el suelo.

import * as THREE from 'three/webgpu';
import { float, uniform } from 'three/tsl';
import { color } from './materiales';
import type { Rect, Vivienda } from '../modelo/tipos';
import { simbolosHueco } from '../modelo/simbolos';

export const uLineas = uniform( 1 );
const Y = 0.02; // por encima del poché aplastado (1 cm) con margen para la precisión de profundidad

export function construirLineas( v: Vivienda, extras: { piscina?: Rect } = {} ) {

	const seg: number[] = [];
	const suaves: number[] = [];
	const add = ( dst: number[], ax: number, ay: number, bx: number, by: number ) => dst.push( ax, Y, - ay, bx, Y, - by );
	const rect = ( dst: number[], [ x0, y0, x1, y1 ]: number[] ) => {

		add( dst, x0, y0, x1, y0 ); add( dst, x1, y0, x1, y1 ); add( dst, x1, y1, x0, y1 ); add( dst, x0, y1, x0, y0 );

	};

	// huecos: el mismo símbolo que el plano comercial (simbolos.ts)
	for ( const h of v.huecos ) {

		for ( const t of simbolosHueco( h, v ) ) {

			const dst = t.estilo === 'giro' || t.estilo === 'fino' ? suaves : seg;
			for ( let i = 0; i < t.puntos.length - 1; i ++ ) add( dst, t.puntos[ i ][ 0 ], t.puntos[ i ][ 1 ], t.puntos[ i + 1 ][ 0 ], t.puntos[ i + 1 ][ 1 ] );

		}

	}

	for ( const e of v.equipamiento ) rect( e.fijo ? seg : suaves, e.rect );

	// piscina opcional: contorno exterior del vaso e interior (lámina de agua)
	if ( extras.piscina ) {

		const [ x0, y0, x1, y1 ] = extras.piscina;
		rect( seg, [ x0, y0, x1, y1 ] );
		rect( suaves, [ x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12 ] );

	}

	// borde de terraza
	const rec = v.exterior.barandilla.recorrido;
	for ( let i = 0; i < rec.length - 1; i ++ ) add( seg, rec[ i ][ 0 ], rec[ i ][ 1 ], rec[ i + 1 ][ 0 ], rec[ i + 1 ][ 1 ] );

	const grupo = new THREE.Group();
	grupo.name = 'lineas';
	const linea = ( datos: number[], tono: string, opacidad: number ) => {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( datos, 3 ) );
		const m = new THREE.LineBasicNodeMaterial( { transparent: true, depthWrite: false } );
		m.colorNode = color( tono );
		m.opacityNode = uLineas.mul( float( opacidad ) );
		const l = new THREE.LineSegments( g, m );
		l.renderOrder = 3;
		return l;

	};

	grupo.add( linea( seg, '#2a2a2a', 0.85 ), linea( suaves, '#6b6b6b', 0.7 ) );

	// proyección del porche (discontinua)
	const porche = v.estancias.find( ( e ) => e.id === 'porche' );
	if ( porche ) {

		const xs = porche.poligono.map( ( p ) => p[ 0 ] ), ys = porche.poligono.map( ( p ) => p[ 1 ] );
		const x0 = Math.min( ...xs ), x1 = Math.max( ...xs ), y0 = Math.min( ...ys );
		const pts = [ new THREE.Vector3( x0, Y, 0 ), new THREE.Vector3( x0, Y, - y0 ), new THREE.Vector3( x1, Y, - y0 ) ];
		const g = new THREE.BufferGeometry().setFromPoints( pts );
		const m = new THREE.LineDashedNodeMaterial( { dashSize: 0.12, gapSize: 0.1, transparent: true, depthWrite: false } );
		m.colorNode = color( '#555555' );
		m.opacityNode = uLineas.mul( 0.8 );
		const l = new THREE.Line( g, m );
		l.computeLineDistances();
		l.renderOrder = 3;
		grupo.add( l );

	}

	return grupo;

}

