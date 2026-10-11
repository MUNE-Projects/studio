// Promoción → Tipologías → Viviendas → Opciones.
//
// La geometría y las cámaras maestras viven en la tipología (una por
// geometría distinta). Cada vivienda aporta sus datos (referencia, planta,
// superficie, orientación, precio, opciones) y, si es simétrica, se carga
// su tipología espejada. No hay un modelo 3D por vivienda.

// Los datos de la promoción se eligen al construir: el alias @promocion apunta a
// promociones/<id>/ (variable PROMOCION; ver vite.config.ts).
import datosPromocion from '@promocion/promocion.json';
import datosCatalogo from '@promocion/catalogo.json';
import type { Configuracion, Promocion, Tipologia, Alternativa, Vivienda, ViviendaPromocion } from '../modelo/tipos';
import { ejeSimetria, espejarAmbientacion, espejarTipologia, espejarAlternativa, espejarVivienda } from './espejo';
import type { Ambientacion } from '../biblioteca/biblioteca';
import { completarVistas } from '../escena/vistas';

export const PROMOCION = datosPromocion as unknown as Promocion;
export const CATALOGO = datosCatalogo as unknown as Configuracion;

// datos de cada tipología (promociones/<id>/tipologias/<tipología>/): una carpeta por geometría
const porTipologia = ( glob: Record<string, unknown>, patron: RegExp ) => {

	const r: Record<string, unknown> = {};
	for ( const [ ruta, valor ] of Object.entries( glob ) ) {

		const m = ruta.match( patron );
		if ( m ) r[ `${ m[ 1 ] }/${ m[ 2 ] }` ] = valor;

	}

	return r;

};
const ficheros = porTipologia( import.meta.glob( '@promocion/tipologias/*/*.json', { eager: true, import: 'default' } ), /tipologias\/([^/]+)\/([^/]+)\.json$/ );
const dato = <T>( id: string, nombre: string ) => {

	const f = ficheros[ `${ id }/${ nombre }` ];
	if ( ! f ) throw new Error( `Falta ${ nombre }.json en la tipología ${ id }` );
	return f as T;

};

export interface Modelo {
	tipologia: Tipologia;
	vivienda: Vivienda;
	alternativas: Alternativa[];
	/** Mobiliario y decoración (opcional: sin él se usan los activos predeterminados). */
	ambientacion: Ambientacion | null;
}

// versiones anteriores de la geometría (tipologias/<id>/versiones/*.json)
const versiones = porTipologia( import.meta.glob( '@promocion/tipologias/*/versiones/*.json', { eager: true, import: 'default' } ), /tipologias\/([^/]+)\/versiones\/([^/]+)\.json$/ ) as Record<string, Vivienda>;

/** Versiones guardadas de la geometría de una tipología (para comparar al actualizar planos). */
export function versionesDe( idTipologia: string ) {

	const pre = `${ idTipologia }/`;
	return Object.entries( versiones ).filter( ( [ k ] ) => k.startsWith( pre ) ).map( ( [ k, v ] ) => ( { nombre: k.slice( pre.length ), vivienda: v } ) ).sort( ( a, b ) => a.nombre.localeCompare( b.nombre ) );

}

/** Geometría, alternativas y cámaras de una tipología, espejadas si hace falta. */
export function cargarModelo( idTipologia: string, espejo = false ): Modelo {

	const tipologia = dato<Tipologia>( idTipologia, 'tipologia' );
	const vivienda = dato<Vivienda>( idTipologia, 'vivienda' );
	const alternativas = dato<Alternativa[]>( idTipologia, 'alternativas' );
	const ambientacion = ( ficheros[ `${ idTipologia }/ambientacion` ] as Ambientacion | undefined ) ?? null;
	if ( ! espejo ) {

		const t = structuredClone( tipologia );
		completarVistas( t, vivienda );
		return { tipologia: t, vivienda, alternativas, ambientacion: ambientacion && structuredClone( ambientacion ) };

	}

	const S = ejeSimetria( vivienda );
	const vEsp = espejarVivienda( vivienda, S );
	const tEsp = espejarTipologia( tipologia, S );
	completarVistas( tEsp, vEsp );
	return {
		tipologia: tEsp,
		vivienda: vEsp,
		alternativas: alternativas.map( ( v ) => espejarAlternativa( v, S ) ),
		ambientacion: ambientacion && espejarAmbientacion( ambientacion, S ),
	};

}

/**
 * Catálogo que puede personalizar una vivienda: el de la promoción, filtrado
 * por lo que admite su tipología y por las restricciones de la vivienda.
 * Una categoría con una sola opción no se muestra (no hay nada que elegir).
 */
export function catalogoPara( v: ViviendaPromocion ): Configuracion {

	const permitidas = PROMOCION.tipologias.find( ( t ) => t.id === v.tipologia )?.opciones ?? {};
	const categorias = CATALOGO.categorias.map( ( c ) => {

		const ids = v.opciones?.[ c.id ] ?? permitidas[ c.id ] ?? [];
		return { ...c, opciones: c.opciones.filter( ( o ) => ids.includes( o.id ) ) };

	} ).filter( ( c ) => c.opciones.length > 1 );
	return { ...CATALOGO, categorias };

}

/** Vivienda que se enseña en la parte pública: la primera, sin espejar. */
export const viviendaPublica = () => PROMOCION.viviendas.find( ( v ) => ! v.espejo ) ?? PROMOCION.viviendas[ 0 ];

const limpio = ( s: string ) => s.toLowerCase().normalize( 'NFD' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' );

/**
 * Unidad de validación de la Experiencia 3D a la que pertenece una vivienda:
 * plurifamiliar, por tipología y variante («a», «a-espejo»); unifamiliar, por
 * vivienda («vivienda-bajo-a»). Las mismas claves que los planos sin alternativa.
 */
export const claveUnidad = ( v: ViviendaPromocion ) => PROMOCION.promocion.tipo === 'unifamiliar'
	? limpio( `vivienda-${ v.ref }` )
	: limpio( `${ v.tipologia }${ v.espejo ? '-espejo' : '' }` );

/** Primera vivienda de una unidad (para revisarla desde MUNE Portal con ?ver=<clave>); null si no existe. */
export const viviendaDeUnidad = ( clave: string | null ) => ( clave && PROMOCION.viviendas.find( ( v ) => claveUnidad( v ) === clave ) ) || null;

async function sha256( texto: string ) {

	const h = await crypto.subtle.digest( 'SHA-256', new TextEncoder().encode( texto ) );
	return [ ...new Uint8Array( h ) ].map( ( b ) => b.toString( 16 ).padStart( 2, '0' ) ).join( '' );

}

/** Normaliza lo que pega el comprador: el código o el enlace completo. */
export function extraerCodigo( entrada: string ) {

	const t = entrada.trim();
	const m = t.match( /c-[a-z0-9]{8,}/i ) ?? t.match( /#?(c-?[0-9a-f -]{12,20})$/i );
	return ( m ? m[ 0 ] : t.replace( /^#/, '' ) ).toLowerCase();

}

/** ¿Es válido el código del Studio de producción? */
export async function accesoStudio( codigo: string ) {

	if ( ! __STUDIO__ || ! codigo || ! crypto?.subtle || ! PROMOCION.studio ) return false;
	return ( await sha256( `${ PROMOCION.id }:studio:${ codigo.trim() }` ) ) === PROMOCION.studio.acceso;

}

export type PerfilProfesional = 'promotora' | 'studio';

/** Perfil profesional que abre un código: Studio (producción) o Promotora (entregables). */
export async function accesoProfesional( codigo: string ): Promise<PerfilProfesional | null> {

	if ( ! codigo || ! crypto?.subtle ) return null;
	if ( __STUDIO__ && await accesoStudio( codigo ) ) return 'studio';
	if ( PROMOCION.promotora && ( await sha256( `${ PROMOCION.id }:promotora:${ codigo.trim() }` ) ) === PROMOCION.promotora.acceso ) return 'promotora';
	return null;

}

// Supabase (solo para el acceso de comprador): dirección y clave «publishable»,
// pensada para ir en el navegador; por sí sola no da acceso a nada.
const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE: string = import.meta.env.VITE_SUPABASE_CLAVE ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';

/** Vivienda del comprador; null si el código no vale; o por qué no se pudo comprobar. */
export type ResultadoAcceso = ViviendaPromocion | null | 'sin-conexion' | 'bloqueado';

/**
 * Comprueba el código en Supabase (entrar_comprador, con límite de intentos) y
 * devuelve su vivienda con lo que el comprador ya tiene formalizado.
 */
export async function resolverAcceso( codigo: string ): Promise<ResultadoAcceso> {

	// «c-» y 12 cifras hexadecimales (se admite con espacios o guiones): si no
	// tiene esa forma, ni se pregunta (no gasta intentos)
	const c = extraerCodigo( codigo ).replace( /[^a-z0-9]/g, '' ).replace( /^c(?=[0-9a-f]{12}$)/, '' );
	if ( ! /^[0-9a-f]{12}$/.test( c ) ) return null;
	try {

		const r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/entrar_comprador`, {
			method: 'POST',
			headers: { apikey: SUPABASE_CLAVE, 'Content-Type': 'application/json' },
			body: JSON.stringify( { p_promocion: PROMOCION.id, p_codigo: c } ),
		} );
		if ( ! r.ok ) return /Demasiados intentos/.test( await r.text() ) ? 'bloqueado' : 'sin-conexion';
		const d = await r.json() as { vivienda: string; selecciones: ViviendaPromocion[ 'selecciones' ]; formalizacion?: ViviendaPromocion[ 'formalizacion' ] } | null;
		const v = d && PROMOCION.viviendas.find( ( x ) => x.ref === d.vivienda );
		return v ? { ...v, selecciones: d.selecciones ?? {}, formalizacion: d.formalizacion ?? {} } : null;

	} catch {

		return 'sin-conexion';

	}

}
