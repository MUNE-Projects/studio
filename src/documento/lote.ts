// Lote de planos comerciales de una promoción, para que la promotora los valide
// (Etapa 4). Lo usa herramientas/planos.mjs a través de planos.html (solo en
// producción, nunca en la web pública).
//
// Un plano por cada geometría distinta que se vende:
//  - plurifamiliar: por tipología y variante (espejo), y por cada distribución
//    alternativa que se ofrece;
//  - unifamiliar (promocion.tipo = «unifamiliar»): por vivienda.
//
// Cada plano lleva dos huellas: la del archivo (lo que se aprueba) y la de sus
// datos (geometría, superficies, marca…). Si en una versión nueva los datos no
// cambian, el plano es el mismo dibujo y su aprobación anterior sigue valiendo.
//
// También lista las unidades de validación de la Experiencia 3D
// (generarUnidadesExperiencia → experiencia.json): una por tipología y variante
// (o por vivienda en las unifamiliares). Las distribuciones alternativas son
// elecciones del comprador y van dentro de la unidad de su tipología.

import { CATALOGO, PROMOCION, cargarModelo, claveUnidad } from '../promocion/promocion';
import { activoPara, BIBLIOTECA } from '../biblioteca/biblioteca';
import { aplicarAlternativa } from '../configurador/alternativas';
import { planoPDF, planoPNG, type DatosPlano } from './plano';
import type { Alternativa, ViviendaPromocion } from '../modelo/tipos';

export interface PlanoLote {
	clave: string;
	titulo: string;
	detalle: string;
	viviendas: string;
	orden: number;
	huellaDatos: string;
	pdf: string; // base64
	png: string; // base64 (miniatura)
}

const base64 = async ( b: Blob ) => {

	const bytes = new Uint8Array( await b.arrayBuffer() );
	let s = '';
	for ( let i = 0; i < bytes.length; i += 0x8000 ) s += String.fromCharCode( ...bytes.subarray( i, i + 0x8000 ) );
	return btoa( s );

};

const sha256 = async ( texto: string ) => [ ...new Uint8Array( await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( texto ) ) ) ]
	.map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

const m2 = ( n: number ) => `${ n.toLocaleString( 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) } m²`;
const limpio = ( s: string ) => s.toLowerCase().normalize( 'NFD' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

interface Encargo { clave: string; titulo: string; viviendas: ViviendaPromocion[]; tipologia: string; espejo: boolean; alternativa: Alternativa | null; ficha: ViviendaPromocion | null }

function encargos(): Encargo[] {

	const unifamiliar = PROMOCION.promocion.tipo === 'unifamiliar';
	const lista: Encargo[] = [];
	const alternativasDe = ( t: string ) => {

		const ofrece = PROMOCION.tipologias.find( ( x ) => x.id === t )?.opciones.distribucion?.some( ( d ) => d !== 'base' );
		return ofrece ? cargarModelo( t ).alternativas : [];

	};

	if ( unifamiliar ) {

		for ( const v of PROMOCION.viviendas ) {

			for ( const alt of [ null, ...alternativasDe( v.tipologia ) ] ) {

				lista.push( { clave: limpio( `vivienda-${ v.ref }${ alt ? `-${ alt.id }` : '' }` ), titulo: `Vivienda ${ v.ref }${ alt ? ` · ${ alt.nombre }` : '' }`,
					viviendas: [ v ], tipologia: v.tipologia, espejo: v.espejo, alternativa: alt, ficha: v } );

			}

		}
		return lista;

	}

	// plurifamiliar: viviendas agrupadas por tipología y variante, en el orden de la promoción
	const grupos = new Map<string, ViviendaPromocion[]>();
	for ( const v of PROMOCION.viviendas ) {

		const k = `${ v.tipologia }|${ v.espejo ? 'espejo' : '' }`;
		grupos.set( k, [ ...( grupos.get( k ) ?? [] ), v ] );

	}
	for ( const [ k, vs ] of grupos ) {

		const [ t, variante ] = k.split( '|' );
		const nombre = cargarModelo( t ).tipologia.nombre;
		for ( const alt of [ null, ...alternativasDe( t ) ] ) {

			lista.push( {
				clave: limpio( `${ t }${ variante ? `-${ variante }` : '' }${ alt ? `-${ alt.id }` : '' }` ),
				titulo: `${ nombre }${ variante ? ` · ${ variante }` : '' }${ alt ? ` · ${ alt.nombre }` : '' }`,
				viviendas: vs, tipologia: t, espejo: variante === 'espejo', alternativa: alt, ficha: null,
			} );

		}

	}
	return lista;

}

/** Genera todos los planos (PDF A3 y miniatura PNG) con sus huellas de datos. */
export async function generarLote( avisar: ( t: string ) => void = () => {} ): Promise<PlanoLote[]> {

	const salida: PlanoLote[] = [];
	for ( const [ orden, e ] of encargos().entries() ) {

		avisar( `Plano ${ orden + 1}: ${ e.titulo }` );
		const modelo = cargarModelo( e.tipologia, e.espejo );
		// la alternativa, en su versión espejada si la vivienda lo es
		const alternativa = e.alternativa && ( modelo.alternativas.find( ( a ) => a.id === e.alternativa!.id ) ?? null );
		const { vivienda } = aplicarAlternativa( modelo.vivienda, alternativa );
		const datos: DatosPlano = {
			promocion: PROMOCION, tipologia: modelo.tipologia, vivienda, ficha: e.ficha,
			distribucion: e.alternativa ? e.alternativa.nombre : 'base',
		};
		// la misma superficie útil que figura en el plano
		const util = vivienda.estancias.filter( ( x ) => x.uso !== 'exterior' ).reduce( ( t, x ) => t + x.superficie, 0 );
		const t = modelo.tipologia;
		salida.push( {
			clave: e.clave,
			titulo: e.titulo,
			detalle: `${ t.dormitorios } dormitorio${ t.dormitorios === 1 ? '' : 's' } · ${ t.banos } baño${ t.banos === 1 ? '' : 's' } · ${ m2( util ) } útiles`,
			viviendas: e.viviendas.map( ( v ) => v.ref ).join( ', ' ),
			orden,
			huellaDatos: await sha256( JSON.stringify( { t, vivienda, ficha: e.ficha, distribucion: datos.distribucion, marca: PROMOCION.marca, promocion: PROMOCION.promocion } ) ),
			pdf: await base64( await planoPDF( datos ) ),
			png: await base64( await planoPNG( datos, 60 ) ),
		} );

	}
	return salida;

}

// ---------------------------------------------------------------- Experiencia 3D

export interface UnidadExperiencia {
	clave: string;
	titulo: string;
	detalle: string;
	viviendas: string;
	orden: number;
	/** sha256 de todo lo que define el 3D de la unidad (si no cambia, su validación sigue valiendo). */
	huella: string;
	/** Vistas guiadas de la tipología (selector opcional «Vista / zona» al pedir cambios). */
	vistas: { id: string; nombre: string }[];
}

/** JSON con las claves ordenadas: el mismo texto para los mismos datos, en cualquier ejecución. */
const canonico = ( x: unknown ): string => {

	if ( Array.isArray( x ) ) return `[${ x.map( canonico ).join( ',' ) }]`;
	if ( x && typeof x === 'object' ) {

		return `{${ Object.keys( x ).filter( ( k ) => ( x as Record<string, unknown> )[ k ] !== undefined ).sort()
			.map( ( k ) => `${ JSON.stringify( k ) }:${ canonico( ( x as Record<string, unknown> )[ k ] ) }` ).join( ',' ) }}`;

	}
	return JSON.stringify( x ) ?? 'null';

};

/** Unidades de validación de la Experiencia 3D, en el orden de la promoción. */
export async function generarUnidadesExperiencia(): Promise<UnidadExperiencia[]> {

	const unifamiliar = PROMOCION.promocion.tipo === 'unifamiliar';
	const grupos = new Map<string, ViviendaPromocion[]>();
	for ( const v of PROMOCION.viviendas ) grupos.set( claveUnidad( v ), [ ...( grupos.get( claveUnidad( v ) ) ?? [] ), v ] );

	const salida: UnidadExperiencia[] = [];
	for ( const [ clave, vs ] of grupos ) {

		const v0 = vs[ 0 ];
		const modelo = cargarModelo( v0.tipologia, v0.espejo );
		const t = modelo.tipologia;
		const permitidas = PROMOCION.tipologias.find( ( x ) => x.id === v0.tipologia )?.opciones ?? {};
		const alternativas = permitidas.distribucion?.some( ( d ) => d !== 'base' ) ? modelo.alternativas : [];

		// catálogo que admite la tipología (con los parámetros de cada opción; sin
		// precios, que no cambian el 3D) y las restricciones de cada vivienda
		const catalogo = CATALOGO.categorias.map( ( c ) => ( {
			...c, opciones: c.opciones.filter( ( o ) => ( permitidas[ c.id ] ?? [] ).includes( o.id ) ).map( ( { precio: _precio, ...o } ) => o ),
		} ) ).filter( ( c ) => c.opciones.length );
		const restricciones = Object.fromEntries( vs.filter( ( v ) => v.opciones ).map( ( v ) => [ v.ref, v.opciones ] ) );

		// activos de la biblioteca que aparecen: mobiliario del plano (también el de
		// las alternativas) y decoración de la ambientación
		const equipos = [ ...modelo.vivienda.equipamiento, ...alternativas.flatMap( ( a ) => a.equipamiento.anadir ) ];
		const ids = new Set( [
			...equipos.map( ( e ) => activoPara( e.id, e.tipo, modelo.ambientacion )?.id ),
			...( modelo.ambientacion?.decoracion ?? [] ).map( ( d ) => d.activo ),
		].filter( ( x ): x is string => !! x ) );
		const activos = BIBLIOTECA.activos.filter( ( a ) => ids.has( a.id ) );

		const huella = await sha256( canonico( {
			tipologia: t, vivienda: modelo.vivienda, alternativas, ambientacion: modelo.ambientacion,
			catalogo, restricciones, activos, ficha: unifamiliar ? v0 : null,
		} ) );
		const dormitorios = `${ t.dormitorios } dormitorio${ t.dormitorios === 1 ? '' : 's' } · ${ t.banos } baño${ t.banos === 1 ? '' : 's' }`;
		salida.push( {
			clave,
			titulo: unifamiliar ? `Vivienda ${ v0.ref }` : `${ t.nombre }${ v0.espejo ? ' · espejo' : '' }`,
			detalle: `${ dormitorios }${ alternativas.length ? ` · con ${ alternativas.length === 1 ? 'la distribución alternativa' : 'las distribuciones alternativas' } ${ alternativas.map( ( a ) => `«${ a.nombre }»` ).join( ', ' ) }` : '' }`,
			viviendas: vs.map( ( v ) => v.ref ).join( ', ' ),
			orden: salida.length,
			huella,
			vistas: t.guiadas.filter( ( k ) => t.vistas[ k ] ).map( ( k ) => ( { id: k, nombre: t.vistas[ k ].nombre } ) ),
		} );

	}
	return salida;

}

Object.assign( window as unknown as Record<string, unknown>, { generarLote, generarUnidadesExperiencia } );
