// Maqueta de la promoción completa (entorno/conjunto.json): cada vivienda en su
// sitio con la geometría de su tipología (muros, suelos, ventanas y barandillas;
// sin mobiliario), los forjados entre plantas, la cubierta y los núcleos de
// escalera y ascensor. Cada planta del edificio va en su propio grupo para que
// la maqueta se pueda «levantar» hasta la planta elegida.

import * as THREE from 'three/webgpu';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import type { Material } from 'three/webgpu';
import type { Punto, Vivienda } from '../modelo/tipos';
import { alturaPlanta, aConjunto, type Conjunto, type Colocacion } from '../modelo/conjunto';
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

/** Centro en planta de las estancias cerradas de una vivienda colocada. */
function centro( v: Vivienda, c: Colocacion ): Punto {

	const pts = v.estancias.filter( esCerrada ).flatMap( ( e ) => e.poligono ).map( ( p ) => aConjunto( c, p ) );
	const xs = pts.map( ( p ) => p[ 0 ] ), ys = pts.map( ( p ) => p[ 1 ] );
	return [ ( Math.min( ...xs ) + Math.max( ...xs ) ) / 2, ( Math.min( ...ys ) + Math.max( ...ys ) ) / 2 ];

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
			for ( const c of p.viviendas ) {

				const v = cargar( c.tipologia, !! c.espejo );
				const { g, techo } = viviendaColocada( v, c, p.cota, matMuros, matLosa, forjado );
				pm.grupo.add( g );
				pm.techo.add( techo );
				const div = document.createElement( 'div' );
				div.className = 'rotulo-vivienda';
				div.textContent = c.ref || nombreTipologia( c.tipologia );
				const r = new CSS2DObject( div );
				const [ x, y ] = centro( v, c );
				r.position.set( x, p.cota + altura + 0.4, - y );
				r.userData.planta = p.nombre;
				rotulos.push( r );
				pm.grupo.add( r );

			}
			// núcleos (escalera, ascensor, portal): un volumen con su techo por planta
			for ( const n of e.nucleos ?? [] ) {

				const [ x0, y0, x1, y1 ] = n.rect;
				const caja = new THREE.Mesh( new THREE.BoxGeometry( x1 - x0, altura - forjado, y1 - y0 ), matNucleo );
				caja.position.set( ( x0 + x1 ) / 2, p.cota + ( altura - forjado ) / 2, - ( y0 + y1 ) / 2 );
				caja.castShadow = caja.receiveShadow = true;
				pm.grupo.add( caja );
				pm.techo.add( losa( [ [ x0, y0 ], [ x1, y0 ], [ x1, y1 ], [ x0, y1 ] ], p.cota + altura - forjado, forjado, matLosa ) );

			}

		}

	}

	const plantas = [ ...porNombre.values() ].sort( ( a, b ) => a.cota - b.cota );
	grupo.updateMatrixWorld( true );
	const caja = new THREE.Box3();
	for ( const p of plantas ) caja.expandByObject( p.grupo ).expandByObject( p.techo );
	return { grupo, plantas, rotulos, caja };

}
