// La promoción completa (promociones/<id>/entorno/conjunto.json): los edificios
// (o las casas, en las unifamiliares) con sus plantas generales y, en cada
// planta, qué vivienda va en cada sitio. Sale del plano de urbanización y de las
// plantas generales (receta 1, apartado B). Cada vivienda se coloca con la
// geometría de su tipología (y su variante espejo): no hay un 3D aparte del
// conjunto, así que un cambio en una tipología cambia también la maqueta.
//
// Coordenadas del conjunto: metros, x hacia el este, y hacia el norte, con el
// origen donde diga `meta.sistema` (normalmente, una esquina de la parcela).

import type { Punto, Rect, Vivienda, ViviendaPromocion } from './tipos';
import { esUtil } from './estancias';
import { plantasDe, dePlanta } from './plantas';
import { puntoEnPoligono } from '../util/geo';

/** Una vivienda en su sitio: dónde cae el origen de su tipología y cuánto gira. */
export interface Colocacion {
	/** referencia de la tabla de viviendas («Bajo A», «1º B», «Parcela 12»…); no sale en la web pública */
	ref: string;
	tipologia: string;
	espejo?: boolean;
	/** dónde cae el origen (0, 0) de la tipología, en coordenadas del conjunto */
	pos: Punto;
	/** giro en grados, en sentido antihorario visto desde arriba (cualquier ángulo: los edificios no siempre siguen el norte) */
	giro?: number;
	origen: string;
}

export interface PlantaEdificio {
	/** como en la tabla de viviendas («Baja», «1ª», «Ático», «Sótano»…) */
	nombre: string;
	/** cota del suelo respecto a la calle (la planta baja suele tener 0; un sótano, negativa) */
	cota: number;
	viviendas: Colocacion[];
}

/** Escaleras, ascensores, portales y zonas comunes del edificio: un volumen por planta. */
export interface Nucleo {
	id: string;
	nombre: string;
	rect: Rect;
	/** plantas en las que está (por defecto, en todas) */
	plantas?: string[];
	origen: string;
}

export interface Edificio {
	id: string;
	/** «Bloque 1», «Portal 3», «Parcela 12»… */
	nombre: string;
	/** portal de la tabla de viviendas, si lo hay */
	portal?: string;
	plantas: PlantaEdificio[];
	nucleos?: Nucleo[];
	/**
	 * Dónde va el edificio en la parcela (plano de urbanización): el origen de sus
	 * plantas generales cae en `pos` y el edificio gira `giro` grados (antihorario).
	 * Las viviendas y los núcleos se describen en coordenadas de sus plantas generales.
	 */
	pos?: Punto;
	giro?: number;
	/** grueso del forjado entre plantas (m); por defecto, 0,30 */
	forjado?: number;
	origen: string;
}

export interface Conjunto {
	meta: { fuente: string; sistema: string; nota?: string };
	parcela?: { poligono: Punto[]; origen: string };
	edificios: Edificio[];
}

/** Gira (antihorario) y desplaza un punto. */
export function girar( t: { pos?: Punto; giro?: number }, [ x, y ]: Punto ): Punto {

	const g = ( ( t.giro ?? 0 ) * Math.PI ) / 180;
	const cs = Math.cos( g ), sn = Math.sin( g ), [ px, py ] = t.pos ?? [ 0, 0 ];
	return [ px + x * cs - y * sn, py + x * sn + y * cs ];

}

/** Un punto de la tipología, en el conjunto: primero a su sitio en el edificio y después el edificio a la parcela. */
export const aConjunto = ( e: Pick<Edificio, 'pos' | 'giro'>, c: Pick<Colocacion, 'pos' | 'giro'>, p: Punto ): Punto => girar( e, girar( c, p ) );

/** Altura de una planta del edificio: la de la planta más alta de sus viviendas, con su forjado. */
export function alturaPlanta( p: PlantaEdificio, cargar: ( t: string, espejo: boolean ) => Vivienda, forjado = 0.3 ) {

	let h = 0;
	for ( const c of p.viviendas ) {

		const v = cargar( c.tipologia, !! c.espejo );
		const ps = plantasDe( v );
		h = Math.max( h, ps[ ps.length - 1 ].cota + v.alturas.libre.valor + ( v.alturas.forjado?.valor ?? forjado ) );

	}
	return h || 2.8 + forjado;

}

/** Todas las colocaciones, con su edificio y su planta. */
export const colocaciones = ( c: Conjunto ) => c.edificios.flatMap( ( e ) => e.plantas.flatMap( ( p ) => p.viviendas.map( ( v ) => ( { edificio: e, planta: p, colocacion: v } ) ) ) );

const normal = ( s: string | undefined ) => ( s ?? '' ).normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).replace( /[º°ª.]/g, '' ).replace( /\s+/g, ' ' ).trim().toLowerCase();

/** Puntos de muestra (cada 25 cm) dentro de las estancias útiles de una vivienda colocada, en el conjunto. */
function muestras( v: Vivienda, e: Edificio, c: Colocacion ): Punto[] {

	const pts: Punto[] = [];
	for ( let i = 0; i < plantasDe( v ).length; i ++ ) {

		for ( const es of dePlanta( v, i ).estancias.filter( esUtil ) ) {

			const xs = es.poligono.map( ( p ) => p[ 0 ] ), ys = es.poligono.map( ( p ) => p[ 1 ] );
			for ( let x = Math.min( ...xs ) + 0.125; x < Math.max( ...xs ); x += 0.25 ) {

				for ( let y = Math.min( ...ys ) + 0.125; y < Math.max( ...ys ); y += 0.25 ) {

					if ( puntoEnPoligono( x, y, es.poligono ) ) pts.push( aConjunto( e, c, [ x, y ] ) );

				}

			}

		}

	}
	return pts;

}

/**
 * Lo que no cuadra entre las plantas generales y la tabla de viviendas, o entre
 * las viviendas colocadas: «comprobar» y «preparar» se detienen si hay algo.
 */
export function erroresConjunto( conjunto: Conjunto, viviendas: ViviendaPromocion[], tipologias: string[], cargar: ( t: string, espejo: boolean ) => Vivienda, unifamiliar = false ): string[] {

	const errores: string[] = [];
	if ( ! Array.isArray( conjunto?.edificios ) || ! conjunto.edificios.length ) return [ 'conjunto.json no tiene edificios (cada edificio o casa, con sus plantas)' ];
	const tabla = new Map( viviendas.map( ( v ) => [ normal( v.ref ), v ] ) );
	const vistas = new Map<string, string>();
	for ( const e of conjunto.edificios ) {

		const cotas = e.plantas.map( ( p ) => p.cota );
		if ( cotas.some( ( c, i ) => i && c <= cotas[ i - 1 ] ) ) errores.push( `${ e.nombre }: las plantas tienen que ir de abajo arriba (cotas ${ cotas.join( ', ' ) })` );
		for ( const p of e.plantas ) {

			for ( const c of p.viviendas ) {

				const donde = `${ e.nombre } · planta ${ p.nombre } · «${ c.ref }»`;
				if ( ! tipologias.includes( c.tipologia ) ) {

					errores.push( `${ donde }: la tipología «${ c.tipologia }» no existe` );
					continue;

				}
				if ( ! Number.isFinite( c.giro ?? 0 ) || ! Array.isArray( c.pos ) || c.pos.length !== 2 ) errores.push( `${ donde }: falta su posición (pos: [x, y]) o el giro no es un número de grados` );
				const clave = normal( c.ref );
				if ( vistas.has( clave ) ) errores.push( `${ donde }: está dos veces (también en ${ vistas.get( clave ) })` );
				vistas.set( clave, `${ e.nombre } · planta ${ p.nombre }` );
				const t = tabla.get( clave );
				if ( ! t ) {

					errores.push( `${ donde }: no está en la tabla de viviendas` );
					continue;

				}
				if ( t.tipologia !== c.tipologia ) errores.push( `${ donde }: en las plantas generales es de la tipología «${ c.tipologia }» y en la tabla de viviendas, de la «${ t.tipologia }»` );
				if ( !! t.espejo !== !! c.espejo ) errores.push( `${ donde }: en las plantas generales ${ c.espejo ? 'es' : 'no es' } simétrica y en la tabla de viviendas ${ t.espejo ? 'sí' : 'no' }` );
				// en las unifamiliares cada casa es su propio «edificio»: la planta de la tabla no se compara
				if ( ! unifamiliar && normal( t.planta ) !== normal( p.nombre ) ) errores.push( `${ donde }: en la tabla de viviendas está en la planta «${ t.planta }»` );
				if ( e.portal && t.portal && normal( e.portal ) !== normal( t.portal ) ) errores.push( `${ donde }: en la tabla de viviendas es del portal «${ t.portal }» y aquí, del ${ e.portal }` );

			}

			// dos viviendas de la misma planta no pueden pisarse (se comparan sus estancias útiles)
			const geos = p.viviendas.filter( ( c ) => tipologias.includes( c.tipologia ) ).map( ( c ) => ( { c, v: cargar( c.tipologia, !! c.espejo ) } ) );
			for ( let i = 0; i < geos.length; i ++ ) {

				const pts = muestras( geos[ i ].v, e, geos[ i ].c );
				for ( let j = i + 1; j < geos.length; j ++ ) {

					const otra = geos[ j ];
					const pols: Punto[][] = [];
					for ( let k = 0; k < plantasDe( otra.v ).length; k ++ ) for ( const es of dePlanta( otra.v, k ).estancias.filter( esUtil ) ) pols.push( es.poligono.map( ( q ) => aConjunto( e, otra.c, q ) ) );
					const solapes = pts.filter( ( q ) => pols.some( ( pol ) => puntoEnPoligono( q[ 0 ], q[ 1 ], pol ) ) ).length;
					// cada muestra son 0,0625 m²; se tolera menos de medio metro cuadrado
					if ( solapes * 0.0625 >= 0.5 ) errores.push( `${ e.nombre } · planta ${ p.nombre }: «${ geos[ i ].c.ref }» y «${ otra.c.ref }» se pisan (unos ${ ( solapes * 0.0625 ).toFixed( 1 ) } m²); revisa su posición y su giro` );

				}

			}

		}

	}
	for ( const v of viviendas ) if ( ! vistas.has( normal( v.ref ) ) ) errores.push( `«${ v.ref }» está en la tabla de viviendas y no aparece en ninguna planta general` );
	return errores;

}
