// Maqueta de la promoción completa (entorno/conjunto.json): cada vivienda en su
// sitio con la geometría de su tipología (muros, suelos, ventanas y barandillas;
// sin mobiliario), los forjados entre plantas, la cubierta y los núcleos de
// escalera y ascensor. Cada planta del edificio va en su propio grupo para que
// la maqueta se pueda «levantar» hasta la planta elegida.

import * as THREE from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Material } from 'three/webgpu';
import type { Punto, Vivienda } from '../modelo/tipos';
import { alturaPlanta, girar, type Conjunto, type Colocacion, type Edificio } from '../modelo/conjunto';
import { dePlanta, plantasDe } from '../modelo/plantas';
import { esCerrada } from '../modelo/estancias';
import { construirMuros } from './muros';
import { construirSuelos } from './suelos';
import { construirCarpinterias } from './carpinterias';
import * as M from './materiales';

export interface PlantaMaqueta {
	nombre: string;
	cota: number;
	/** lo que se ve de la planta (viviendas y núcleos) */
	grupo: THREE.Group;
	/** su techo: el forjado de encima o la cubierta (se quita al mirar esa planta) */
	techo: THREE.Group;
}

export interface Maqueta {
	grupo: THREE.Group;
	/** plantas de todos los edificios, unidas por nombre y ordenadas de abajo arriba */
	plantas: PlantaMaqueta[];
	/** rótulos de las viviendas (referencia o, en la web pública, su tipología) */
	rotulos: CSS2DObject[];
	/** caja del conjunto en mundo (x, y altura, z sur) */
	caja: THREE.Box3;
}

const losa = ( pol: Punto[], z: number, grueso: number, mat: Material ) => {

	const forma = new THREE.Shape( pol.map( ( [ x, y ] ) => new THREE.Vector2( x, y ) ) );
	const g = new THREE.ExtrudeGeometry( forma, { depth: grueso, bevelEnabled: false } );
	// el polígono está en planta (x, y): se tumba para que y apunte a -z
	g.rotateX( - Math.PI / 2 );
	g.translate( 0, z, 0 );
	const m = new THREE.Mesh( g, mat );
	m.castShadow = m.receiveShadow = true;
	return m;

};

/** Una vivienda colocada: su geometría en un grupo girado y desplazado a su sitio. */
function viviendaColocada( v: Vivienda, c: Colocacion, cota: number, matMuros: Record<string, Material>, matLosa: Material, forjado: number ) {

	const g = new THREE.Group();
	const techo = new THREE.Group();
	for ( const [ i, planta ] of plantasDe( v ).entries() ) {

		const pv = dePlanta( v, i );
		const capa = new THREE.Group();
		capa.position.y = planta.cota;
		const { geos } = construirMuros( pv );
		for ( const k of Object.keys( geos ) as ( keyof typeof geos )[] ) {

			const m = new THREE.Mesh( geos[ k ], matMuros[ k ] );
			m.castShadow = m.receiveShadow = true;
			capa.add( m );

		}
		capa.add( construirSuelos( pv, false ).suelos );
		const k = construirCarpinterias( pv );
		capa.add( k.carpinterias, k.barandilla );
		g.add( capa );
		// forjado de encima de cada planta de la vivienda: sobre las estancias cerradas
		const H = pv.alturas.libre.valor;
		const losas = pv.estancias.filter( esCerrada ).map( ( e ) => losa( e.poligono, planta.cota + H, forjado, matLosa ) );
		if ( losas.length ) ( i === plantasDe( v ).length - 1 ? techo : g ).add( ...losas );

	}
	for ( const x of [ g, techo ] ) {

		x.position.set( c.pos[ 0 ], cota, - c.pos[ 1 ] );
		x.rotation.y = ( ( c.giro ?? 0 ) * Math.PI ) / 180;

	}
	return { g, techo };

}

/** Centro en planta de las estancias cerradas de una vivienda colocada (en coordenadas de su edificio). */
function centro( v: Vivienda, c: Colocacion ): Punto {

	const pts = v.estancias.filter( esCerrada ).flatMap( ( e ) => e.poligono ).map( ( p ) => girar( c, p ) );
	const xs = pts.map( ( p ) => p[ 0 ] ), ys = pts.map( ( p ) => p[ 1 ] );
	return [ ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...ys ) + Math.max( ...ys ) ) / 2 ];

}

/** Grupo con la posición y el giro del edificio en la parcela. */
function enParcela( e: Edificio ) {

	const g = new THREE.Group();
	g.position.set( e.pos?.[ 0 ] ?? 0, 0, - ( e.pos?.[ 1 ] ?? 0 ) );
	g.rotation.y = ( ( e.giro ?? 0 ) * Math.PI ) / 180;
	return g;

}

export function construirMaqueta( conjunto: Conjunto, cargar: ( t: string, espejo: boolean ) => Vivienda, matMuros: Record<string, Material>, nombreTipologia: ( t: string ) => string ): Maqueta {

	const grupo = new THREE.Group();
	grupo.name = 'maqueta-promocion';
	const matLosa = M.liso( '#e4e0d8', 0.85 );
	const matNucleo = matMuros.fachada;
	const porNombre = new Map<string, PlantaMaqueta>();
	const rotulos: CSS2DObject[] = [];

	for ( const e of conjunto.edificios ) {

		const forjado = e.forjado ?? 0.3;
		for ( const p of e.plantas ) {

			let pm = porNombre.get( p.nombre );
			if ( ! pm ) {

				pm = { nombre: p.nombre, cota: p.cota, grupo: new THREE.Group(), techo: new THREE.Group() };
				pm.grupo.name = `planta-${ p.nombre }`;
				porNombre.set( p.nombre, pm );
				grupo.add( pm.grupo, pm.techo );

			}
			const altura = alturaPlanta( p, cargar, forjado );
			// lo de este edificio en esta planta, colocado y girado en la parcela
			const [ eg, et ] = [ enParcela( e ), enParcela( e ) ];
			pm.grupo.add( eg );
			pm.techo.add( et );
			for ( const c of p.viviendas ) {

				const v = cargar( c.tipologia, !! c.espejo );
				const { g, techo } = viviendaColocada( v, c, p.cota, matMuros, matLosa, forjado );
				eg.add( g );
				et.add( techo );
				const div = document.createElement( 'div' );
				div.className = 'rotulo-vivienda';
				div.textContent = c.ref || nombreTipologia( c.tipologia );
				const r = new CSS2DObject( div );
				const [ x, y ] = centro( v, c );
				r.position.set( x, p.cota + altura + 0.4, - y );
				r.userData.planta = p.nombre;
				rotulos.push( r );
				eg.add( r );

			}
			// núcleos (escalera, ascensor, portal): un volumen con su techo por planta
			for ( const n of ( e.nucleos ?? [] ).filter( ( n ) => ! n.plantas || n.plantas.includes( p.nombre ) ) ) {

				const [ x0, y0, x1, y1 ] = n.rect;
				const caja = new THREE.Mesh( new THREE.BoxGeometry( x1 - x0, altura - forjado, y1 - y0 ), matNucleo );
				caja.position.set( ( x0 + x1 ) / 2, p.cota + ( altura - forjado ) / 2, - ( y0 + y1 ) / 2 );
				caja.castShadow = caja.receiveShadow = true;
				// el volumen va con el techo: al mirar esa planta se ve su suelo, como el resto
				const pol: Punto[] = [ [ x0, y0 ], [ x1, y0 ], [ x1, y1 ], [ x0, y1 ] ];
				et.add( caja, losa( pol, p.cota + altura - forjado, forjado, matLosa ) );
				eg.add( losa( pol, p.cota, 0.02, matLosa ) );

			}

		}

	}

	const plantas = [ ...porNombre.values() ].sort( ( a, b ) => a.cota - b.cota );
	grupo.updateMatrixWorld( true );
	const caja = new THREE.Box3();
	for ( const p of plantas ) caja.expandByObject( p.grupo ).expandByObject( p.techo );
	if ( conjunto.parcela ) for ( const [ x, y ] of conjunto.parcela.poligono ) caja.expandByPoint( new THREE.Vector3( x, 0, - y ) );

	// terreno: la parcela con césped sobre un pavimento neutro alrededor (la
	// urbanización con sus zonas comunes llega en el siguiente paso)
	const radio = caja.getBoundingSphere( new THREE.Sphere() ).radius;
	const medio = caja.getCenter( new THREE.Vector3() );
	const terreno = new THREE.Mesh( new THREE.CircleGeometry( radio * 4, 96 ), M.liso( '#d8d3c9', 0.95 ) );
	terreno.rotation.x = - Math.PI / 2;
	terreno.position.set( medio.x, - 0.04, medio.z );
	terreno.receiveShadow = true;
	grupo.add( terreno );
	if ( conjunto.parcela ) {

		const p = losa( conjunto.parcela.poligono, - 0.03, 0.02, M.cesped() );
		p.castShadow = false;
		grupo.add( p );

	}
	return { grupo, plantas, rotulos, caja };

}
