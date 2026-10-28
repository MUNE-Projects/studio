// Maqueta exterior de la promoción completa (entorno/conjunto.json), vista desde
// fuera como una infografía: fachadas con sus huecos, carpinterías, terrazas y
// barandillas de cada vivienda (la geometría de su tipología, sin interiores);
// forjados y cubierta de una pieza por planta, con su canto y su peto; núcleos
// de escalera y ascensor; y la parcela con su ambientación (césped, caminos,
// árboles, seto y valla). Las zonas comunes con datos propios (piscina, juegos…)
// llegan con el plano de urbanización.

import * as THREE from 'three/webgpu';
import type { Material } from 'three/webgpu';
import type { Punto, Vivienda } from '../modelo/tipos';
import { girar, type Conjunto, type Edificio, type PlantaEdificio } from '../modelo/conjunto';
import { dePlanta, plantasDe } from '../modelo/plantas';
import { esCerrada } from '../modelo/estancias';
import { contornos, desplazar, type Contorno } from '../util/contorno';
import { puntoEnPoligono } from '../util/geo';
import { azar } from '../biblioteca/generadores';
import { construirMuros } from './muros';
import { construirSuelos } from './suelos';
import { construirCarpinterias } from './carpinterias';
import { Pieza } from './equipamiento';
import { plantar, type Especie, type Plantacion } from './arboles';
import * as M from './materiales';

export interface Maqueta {
	grupo: THREE.Group;
	/** caja de los edificios en mundo (x, y altura, z sur): para encuadrar */
	edificios: THREE.Box3;
	/** caja de todo, parcela incluida: para el sol y la cámara */
	caja: THREE.Box3;
}

type Cargar = ( t: string, espejo: boolean ) => Vivienda;

const rectPol = ( [ x0, y0, x1, y1 ]: number[] ): Punto[] => [ [ x0, y0 ], [ x1, y0 ], [ x1, y1 ], [ x0, y1 ] ];

/** Losa de un contorno (con sus patios) entre dos alturas. */
function losa( c: Contorno, z0: number, z1: number, mat: Material, sombra = true ) {

	const forma = new THREE.Shape( c.exterior.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) );
	for ( const h of c.huecos ) forma.holes.push( new THREE.Path( h.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) ) );
	const g = new THREE.ExtrudeGeometry( forma, { depth: z1 - z0, bevelEnabled: false } );
	// el contorno está en planta (x, y): se tumba para que y apunte a -z
	g.rotateX( - Math.PI / 2 );
	g.translate( 0, z0, 0 );
	const m = new THREE.Mesh( g, mat );
	m.castShadow = sombra;
	m.receiveShadow = true;
	return m;

}

/** Peto de cubierta: un anillo de `grueso` por dentro del contorno. */
function peto( c: Contorno, z0: number, alto: number, grueso: number, mat: Material ) {

	const forma = new THREE.Shape( c.exterior.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) );
	forma.holes.push( new THREE.Path( desplazar( c.exterior, - grueso ).reverse().map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) ) );
	const g = new THREE.ExtrudeGeometry( forma, { depth: alto, bevelEnabled: false } );
	g.rotateX( - Math.PI / 2 );
	g.translate( 0, z0, 0 );
	const m = new THREE.Mesh( g, mat );
	m.castShadow = m.receiveShadow = true;
	return m;

}

/** La vivienda reducida a lo que se ve desde fuera: muros de fachada (con sus huecos) y exteriores. */
function soloFachada( v: Vivienda ): Vivienda {

	const muros = v.muros.filter( ( m ) => m.tipo !== 'tabique' );
	const ids = new Set( muros.map( ( m ) => m.id ) );
	return { ...v, muros, huecos: v.huecos.filter( ( h ) => ids.has( h.muro ) ), equipamiento: [] };

}

/** Huella de una planta de una vivienda (estancias y muros), en coordenadas de las plantas generales. */
function huella( v: Vivienda, c: { pos: Punto; giro?: number }, soloCerradas: boolean ): Punto[][] {

	const r: Punto[][] = [];
	for ( let i = 0; i < plantasDe( v ).length; i ++ ) {

		const pv = dePlanta( v, i );
		for ( const e of pv.estancias ) if ( ! soloCerradas || esCerrada( e ) ) r.push( e.poligono.map( ( p ) => girar( c, p ) ) );
		for ( const m of pv.muros ) if ( m.tipo !== 'tabique' ) r.push( rectPol( m.rect ).map( ( p ) => girar( c, p ) ) );

	}
	return r;

}

/** Grupo con la posición y el giro del edificio en la parcela. */
function enParcela( e: Edificio ) {

	const g = new THREE.Group();
	g.position.set( e.pos?.[ 0 ] ?? 0, 0, - ( e.pos?.[ 1 ] ?? 0 ) );
	g.rotation.y = ( ( e.giro ?? 0 ) * Math.PI ) / 180;
	return g;

}

function construirEdificio( e: Edificio, cargar: Cargar, mat: { muros: Record<string, Material>; losa: Material; cubierta: Material; vidrio: Material }) {

	const g = enParcela( e );
	const forjado = e.forjado ?? 0.3;
	const plantas = [ ...e.plantas ].sort( ( a, b ) => a.cota - b.cota );
	const libre = ( p: PlantaEdificio ) => Math.max( 0, ...p.viviendas.map( ( c ) => {

		const v = cargar( c.tipologia, !! c.espejo );
		const ps = plantasDe( v );
		return ps[ ps.length - 1 ].cota + v.alturas.libre.valor;

	} ) ) || 2.5;
	const nucleos = ( p: PlantaEdificio ) => ( e.nucleos ?? [] ).filter( ( n ) => ! n.plantas || n.plantas.includes( p.nombre ) ).map( ( n ) => rectPol( n.rect ) );
	// huella de cada planta: lo cerrado (para lo que cubre) y todo (terrazas incluidas)
	const cerrado = plantas.map( ( p ) => [ ...p.viviendas.flatMap( ( c ) => huella( cargar( c.tipologia, !! c.espejo ), c, true ) ), ...nucleos( p ) ] );
	const todo = plantas.map( ( p, k ) => [ ...p.viviendas.flatMap( ( c ) => huella( cargar( c.tipologia, !! c.espejo ), c, false ) ), ...cerrado[ k ] ] );

	plantas.forEach( ( p, k ) => {

		const H = libre( p );
		// viviendas: fachada, carpinterías, barandillas y suelos de sus exteriores
		for ( const c of p.viviendas ) {

			const v = soloFachada( cargar( c.tipologia, !! c.espejo ) );
			const gv = new THREE.Group();
			gv.position.set( c.pos[ 0 ], p.cota, - c.pos[ 1 ] );
			gv.rotation.y = ( ( c.giro ?? 0 ) * Math.PI ) / 180;
			for ( const [ i, pl ] of plantasDe( v ).entries() ) {

				const pv = dePlanta( v, i );
				const capa = new THREE.Group();
				capa.position.y = pl.cota;
				const { geos } = construirMuros( pv );
				for ( const kk of Object.keys( geos ) as ( keyof typeof geos )[] ) {

					const m = new THREE.Mesh( geos[ kk ], mat.muros[ kk ] );
					m.castShadow = m.receiveShadow = true;
					capa.add( m );

				}
				capa.add( construirSuelos( { ...pv, estancias: pv.estancias.filter( ( x ) => ! esCerrada( x ) ) }, false ).suelos );
				const kp = construirCarpinterias( pv );
				// vidrio de las ventanas: oscuro y reflectante, como en una infografía
				// (el de las barandillas sigue siendo transparente)
				kp.carpinterias.traverse( ( o ) => {

					const m = o as THREE.Mesh;
					if ( m.isMesh && ( m.material as Material ).transparent ) m.material = mat.vidrio;

				} );
				capa.add( kp.carpinterias, kp.barandilla );
				gv.add( capa );

			}
			g.add( gv );

		}
		// núcleos: escalera, ascensor y pasillos, con fachada
		for ( const n of ( e.nucleos ?? [] ).filter( ( n ) => ! n.plantas || n.plantas.includes( p.nombre ) ) ) {

			const [ x0, y0, x1, y1 ] = n.rect;
			const geo = new THREE.BoxGeometry( x1 - x0, H, y1 - y0 );
			// el material de fachada lee la cota inferior de cada pieza (aquí, el suelo)
			geo.setAttribute( 'base', new THREE.Float32BufferAttribute( new Array( geo.attributes.position.count ).fill( 0 ), 1 ) );
			const caja = new THREE.Mesh( geo, mat.muros.fachada );
			caja.position.set( ( x0 + x1 ) / 2, p.cota + H / 2, - ( y0 + y1 ) / 2 );
			caja.castShadow = caja.receiveShadow = true;
			g.add( caja );

		}
		// forjado de encima: cubre lo cerrado de esta planta y lo de la siguiente
		// (terrazas incluidas: así las de abajo quedan cubiertas). Su grueso es lo que
		// falta hasta la cota de la siguiente planta (forjado, solado y falso techo).
		const sig = plantas[ k + 1 ];
		const z0 = p.cota + H;
		if ( sig ) {

			const z1 = Math.max( z0 + 0.15, sig.cota );
			for ( const c of contornos( [ ...cerrado[ k ], ...todo[ k + 1 ] ] ) ) g.add( losa( { exterior: desplazar( c.exterior, 0.04 ), huecos: c.huecos }, z0, z1, mat.losa ) );

		} else {

			// cubierta: losa, peto de 1 m y acabado de grava
			for ( const c of contornos( cerrado[ k ] ) ) {

				const ext = { exterior: desplazar( c.exterior, 0.04 ), huecos: c.huecos };
				g.add( losa( ext, z0, z0 + forjado, mat.losa ) );
				g.add( peto( ext, z0 + forjado, 0.9, 0.22, mat.losa ) );
				g.add( losa( { exterior: desplazar( c.exterior, - 0.15 ), huecos: c.huecos }, z0 + forjado, z0 + forjado + 0.06, mat.cubierta, false ) );

			}

		}

	} );
	// acera alrededor del edificio (huella de la planta baja)
	const acera = contornos( todo[ 0 ] ?? [], 0.1, 0.4 ).map( ( c ) => ( { exterior: desplazar( c.exterior, 1.6 ), huecos: [] } ) );
	return { g, acera };

}

/** Ambientación de la parcela: césped, aceras alrededor de los edificios, árboles, seto y valla; y alrededor, acera, calle y campo. */
function construirParcela( conjunto: Conjunto, aceras: { contorno: Contorno; edificio: Edificio }[], radio: number, centro: THREE.Vector3 ) {

	const g = new THREE.Group();
	const rnd = azar( 'parcela' );
	// lejos: campo, velado por la bruma del cielo
	const terreno = new THREE.Mesh( new THREE.CircleGeometry( radio * 25, 128 ), M.liso( '#9aa184', 0.97 ) );
	terreno.rotation.x = - Math.PI / 2;
	terreno.position.set( centro.x, - 0.08, centro.z );
	terreno.receiveShadow = true;
	g.add( terreno );
	const parcela = conjunto.parcela?.poligono;
	if ( ! parcela ) return g;
	const ccw = parcela.reduce( ( s, [ x, y ], i ) => s + x * parcela[ ( i + 1 ) % parcela.length ][ 1 ] - parcela[ ( i + 1 ) % parcela.length ][ 0 ] * y, 0 ) > 0;
	const pol = ccw ? parcela : [ ...parcela ].reverse();
	const anillo = ( dentro: Punto[], fuera: Punto[], z0: number, z1: number, mat: Material ) => losa( { exterior: fuera, huecos: [ [ ...dentro ].reverse() ] }, z0, z1, mat, false );
	// acera y calle alrededor de la parcela (genéricas hasta que el plano de urbanización diga las suyas)
	const acera = desplazar( pol, 2.5 ), calle = desplazar( pol, 10 ), aceraFuera = desplazar( pol, 12.5 );
	g.add( anillo( pol, acera, - 0.07, 0.12, M.liso( '#dcd8d0', 0.9 ) ) );
	g.add( anillo( acera, calle, - 0.07, - 0.02, M.liso( '#5d6062', 0.85 ) ) );
	g.add( anillo( calle, aceraFuera, - 0.07, 0.12, M.liso( '#dcd8d0', 0.9 ) ) );
	g.add( losa( { exterior: pol, huecos: [] }, - 0.05, 0.0, M.cesped(), false ) );
	// aceras de los edificios (en coordenadas de la parcela)
	const aceraMundo: Punto[][] = [];
	for ( const { contorno, edificio } of aceras ) {

		const p = contorno.exterior.map( ( q ) => girar( edificio, q ) );
		aceraMundo.push( p );
		g.add( losa( { exterior: p, huecos: [] }, 0.0, 0.03, M.liso( '#e6e1d8', 0.9 ), false ) );

	}

	// valla de barrotes a lo largo del lindero, con un seto por dentro
	const k = new Pieza();
	const seto: Plantacion[] = [];
	for ( let i = 0; i < pol.length; i ++ ) {

		const a = pol[ i ], b = pol[ ( i + 1 ) % pol.length ];
		const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		const ux = ( b[ 0 ] - a[ 0 ] ) / l, uy = ( b[ 1 ] - a[ 1 ] ) / l;
		for ( let t = 0; t < l; t += 0.12 ) k.cilindro( 'metal:#4f463d', a[ 0 ] + ux * t, 0, - ( a[ 1 ] + uy * t ), 0.012, 1.4, 6 );
		for ( const h of [ 0.1, 1.38 ] ) {

			const pl = new THREE.BoxGeometry( l, 0.04, 0.03 );
			pl.rotateY( Math.atan2( uy, ux ) );
			pl.translate( ( a[ 0 ] + b[ 0 ] ) / 2, h, - ( a[ 1 ] + b[ 1 ] ) / 2 );
			k.add( 'metal:#4f463d', pl );

		}
		// la normal interior de un polígono antihorario va a la izquierda
		for ( let t = 0.5; t < l - 0.5; t += 0.7 ) {

			const x = a[ 0 ] + ux * t - uy * 0.8, y = a[ 1 ] + uy * t + ux * 0.8;
			if ( ! aceraMundo.some( ( p ) => puntoEnPoligono( x, y, p ) ) ) seto.push( { x, z: - y, alto: 1.1 + rnd() * 0.2 } );

		}

	}
	const v = k.malla( 'valla' );
	v.traverse( ( o ) => {

		if ( ( o as THREE.Mesh ).isMesh ) o.castShadow = o.receiveShadow = true;

	} );
	g.add( v, plantar( 'seto', seto ) );

	// árboles: repartidos por el césped, lejos de los edificios y del lindero; y en la acera de la calle
	const xs = pol.map( ( p ) => p[ 0 ] ), ys = pol.map( ( p ) => p[ 1 ] );
	const puestos: Punto[] = [];
	const especies: Record<'frondoso' | 'olivo' | 'pino', Plantacion[]> = { frondoso: [], olivo: [], pino: [] };
	const libreDe = ( x: number, y: number ) => puntoEnPoligono( x, y, pol )
		&& pol.every( ( a, i ) => distSegmento( [ x, y ], a, pol[ ( i + 1 ) % pol.length ] ) > 2.5 )
		&& aceraMundo.every( ( p ) => ! puntoEnPoligono( x, y, desplazar( p, 4.5 ) ) )
		&& puestos.every( ( q ) => Math.hypot( q[ 0 ] - x, q[ 1 ] - y ) > 9 );
	const orden = [ 'frondoso', 'olivo', 'frondoso', 'pino' ] as const;
	for ( let n = 0; n < 1200 && puestos.length < 14; n ++ ) {

		const x = Math.min( ...xs ) + rnd() * ( Math.max( ...xs ) - Math.min( ...xs ) ), y = Math.min( ...ys ) + rnd() * ( Math.max( ...ys ) - Math.min( ...ys ) );
		if ( ! libreDe( x, y ) ) continue;
		puestos.push( [ x, y ] );
		const e = orden[ puestos.length % orden.length ];
		especies[ e ].push( { x, z: - y, alto: e === 'pino' ? 9 + rnd() * 2 : e === 'olivo' ? 4.5 + rnd() : 6.5 + rnd() * 2 } );

	}
	// alineación de la calle, cada 8 m en la acera exterior
	for ( let i = 0; i < aceraFuera.length; i ++ ) {

		const a = desplazar( pol, 11.4 )[ i ], b = desplazar( pol, 11.4 )[ ( i + 1 ) % pol.length ];
		const l = Math.hypot( b[ 0 ] - a[ 0 ], b[ 1 ] - a[ 1 ] );
		for ( let t = 6; t < l - 4; t += 14 ) especies.olivo.push( { x: a[ 0 ] + ( b[ 0 ] - a[ 0 ] ) * t / l, z: - ( a[ 1 ] + ( b[ 1 ] - a[ 1 ] ) * t / l ), alto: 4 + rnd() * 0.6 } );

	}
	for ( const [ e, sitios ] of Object.entries( especies ) ) g.add( plantar( e as Especie, sitios ) );
	return g;

}

function distSegmento( [ px, py ]: Punto, [ ax, ay ]: Punto, [ bx, by ]: Punto ) {

	const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
	const t = Math.max( 0, Math.min( 1, ( ( px - ax ) * dx + ( py - ay ) * dy ) / l2 ) );
	return Math.hypot( px - ax - t * dx, py - ay - t * dy );

}

export function construirMaqueta( conjunto: Conjunto, cargar: Cargar, matMuros: Record<string, Material> ): Maqueta {

	const grupo = new THREE.Group();
	grupo.name = 'maqueta-promocion';
	const vidrio = new THREE.MeshStandardNodeMaterial( { color: '#7f8e97', roughness: 0.06, metalness: 0.7 } );
	const mat = { muros: matMuros, losa: M.liso( '#f1efea', 0.8 ), cubierta: M.liso( '#bdb8ae', 0.95 ), vidrio };
	const aceras: { contorno: Contorno; edificio: Edificio }[] = [];
	for ( const e of conjunto.edificios ) {

		const { g, acera } = construirEdificio( e, cargar, mat );
		grupo.add( g );
		for ( const c of acera ) aceras.push( { contorno: c, edificio: e } );

	}
	grupo.updateMatrixWorld( true );
	const edificios = new THREE.Box3().setFromObject( grupo );
	const caja = edificios.clone();
	for ( const [ x, y ] of conjunto.parcela?.poligono ?? [] ) caja.expandByPoint( new THREE.Vector3( x, 0, - y ) );
	const radio = caja.getBoundingSphere( new THREE.Sphere() ).radius;
	grupo.add( construirParcela( conjunto, aceras, radio, caja.getCenter( new THREE.Vector3() ) ) );
	return { grupo, edificios, caja };

}
