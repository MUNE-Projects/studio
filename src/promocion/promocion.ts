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

/** Datos privados que recibe el comprador con su código (024_datos_privados.sql). */
interface DatosComprador {
	catalogo: Configuracion;
	packs: Promocion[ 'packs' ];
	tipologia: { id: string; opciones: Promocion[ 'tipologias' ][ number ][ 'opciones' ] } | null;
	vivienda: ViviendaPromocion;
}

/**
 * La web pública lleva el catálogo sin precios y sin packs (paso 5a). Con el
 * código llegan los de la versión de esta web: se completan aquí, y todo lo
 * que ya usa CATALOGO y PROMOCION los ve igual que antes.
 */
function aplicarDatos( d: DatosComprador ) {

	Object.assign( CATALOGO, d.catalogo );
	PROMOCION.packs = d.packs;
	const t = d.tipologia && PROMOCION.tipologias.find( ( x ) => x.id === d.tipologia!.id );
	if ( t ) t.opciones = d.tipologia!.opciones;
	else if ( d.tipologia ) PROMOCION.tipologias.push( d.tipologia as Promocion[ 'tipologias' ][ number ] );

}

/** Código válido del comprador que ha entrado (para guardar su selección). */
let codigoComprador = '';

// ---------------------------------------------------------------- Experience pública (paso 6b)
// Si está activa (módulo de MUNE Studio) y cómo funciona «Solicitar información»
// (028 y 032): un enlace de la promotora o el código del formulario de su CRM.
// No hace esperar a la visita: se aplica cuando llega la respuesta; si Supabase
// no responde, null y la visita sigue igual.

export type SolicitarInfo = { modo: 'enlace'; enlace: string } | { modo: 'formulario'; codigo: string };
export interface EstadoPublico { activa: boolean; accesoComprador: boolean; solicitarInfo: SolicitarInfo | null }

export async function estadoPublico(): Promise<EstadoPublico | null> {

	try {

		const r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/experiencia_publica`, {
			method: 'POST',
			headers: { apikey: SUPABASE_CLAVE, 'Content-Type': 'application/json' },
			body: JSON.stringify( { p_promocion: PROMOCION.id } ),
		} );
		if ( ! r.ok ) return null;
		const d = await r.json() as { activa: boolean; acceso_comprador: boolean; solicitar_info: string | null; solicitar_modo?: string; solicitar_formulario?: string | null };
		const enlace = d.solicitar_info && /^(https:\/\/|mailto:)/.test( d.solicitar_info ) ? d.solicitar_info : null;
		const solicitarInfo: SolicitarInfo | null = d.solicitar_modo === 'formulario' && d.solicitar_formulario
			? { modo: 'formulario', codigo: d.solicitar_formulario }
			: enlace ? { modo: 'enlace', enlace } : null;
		return { activa: d.activa, accesoComprador: d.acceso_comprador, solicitarInfo };

	} catch {

		return null;

	}

}

// ---------------------------------------------------------------- modo profesional (paso 6a)
// El equipo de la promotora abre esta web desde MUNE Portal con un pase
// (…/#p-<pase>, 027_profesional.sql): ve todas las viviendas con su
// personalización y lo elegido, saca renders y descarga el plano comercial.
// Con la capacidad «personalizacion» también elige en nombre del comprador.

const PASE = /^#p-([0-9a-f]{48})$/;
const clavePase = () => `mune:pase:${ PROMOCION.id }`;
let paseProfesional = '';

/** El pase del enlace (que se quita de la dirección) o el de esta pestaña. */
export function paseInicial(): string {

	const m = location.hash.match( PASE );
	if ( m ) {

		history.replaceState( null, '', location.pathname + location.search );
		try { sessionStorage.setItem( clavePase(), m[ 1 ] ); } catch { /* sin almacenamiento: vale para esta carga */ }
		return m[ 1 ];

	}
	try { return sessionStorage.getItem( clavePase() ) ?? ''; } catch { return ''; }

}

export function salirProfesional() {

	paseProfesional = '';
	try { sessionStorage.removeItem( clavePase() ); } catch { /* nada que olvidar */ }

}

export interface Profesional { puedePersonalizar: boolean }

/** Cambia el pase por los datos de esta versión: todas las viviendas, precios y selecciones. */
export async function resolverProfesional( pase: string ): Promise<Profesional | null | 'sin-conexion'> {

	try {

		const r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/entrar_profesional`, {
			method: 'POST',
			headers: { apikey: SUPABASE_CLAVE, 'Content-Type': 'application/json' },
			body: JSON.stringify( { p_promocion: PROMOCION.id, p_pase: pase, p_version: __VERSION__ } ),
		} );
		if ( ! r.ok ) return 'sin-conexion';
		const d = await r.json() as {
			puede_personalizar: boolean; catalogo: Configuracion | null; packs: Promocion[ 'packs' ];
			tipologias: { id: string; opciones: Promocion[ 'tipologias' ][ number ][ 'opciones' ] }[];
			viviendas: ViviendaPromocion[]; formalizacion: ViviendaPromocion[ 'formalizacion' ];
			selecciones: Record<string, ViviendaPromocion[ 'selecciones' ]>;
		} | null;
		if ( ! d ) {

			salirProfesional();
			return null;

		}
		paseProfesional = pase;
		if ( d.catalogo ) Object.assign( CATALOGO, d.catalogo );
		PROMOCION.packs = d.packs;
		for ( const t of d.tipologias ) {

			const propia = PROMOCION.tipologias.find( ( x ) => x.id === t.id );
			if ( propia ) propia.opciones = t.opciones;

		}
		if ( d.viviendas.length ) PROMOCION.viviendas = d.viviendas.map( ( v ) => ( { ...v, selecciones: d.selecciones[ v.ref ] ?? {}, formalizacion: d.formalizacion ?? {} } ) );
		return { puedePersonalizar: d.puede_personalizar };

	} catch {

		return 'sin-conexion';

	}

}

/**
 * Llama a una función de Supabase con el pase profesional (comentarios visuales,
 * 038_comentarios.sql). Si falla, lanza un Error con un texto para personas.
 */
export async function conPase<T>( rpc: string, cuerpo: Record<string, unknown> ): Promise<T> {

	if ( ! paseProfesional ) throw new Error( 'Abre el 3D desde MUNE Portal para comentar.' );
	let r: Response;
	try {

		r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/${ rpc }`, {
			method: 'POST',
			headers: { apikey: SUPABASE_CLAVE, 'Content-Type': 'application/json' },
			body: JSON.stringify( { p_promocion: PROMOCION.id, p_pase: paseProfesional, ...cuerpo } ),
		} );

	} catch {

		throw new Error( 'No se ha podido conectar. Revisa tu conexión y vuelve a probar.' );

	}
	if ( ! r.ok ) {

		const t = await r.text();
		console.error( rpc, t );
		throw new Error( /caducado/.test( t ) ? 'Tu acceso al 3D ha caducado. Vuelve a abrirlo desde MUNE Portal.'
			: /No tienes acceso/.test( t ) ? 'Desde aquí no puedes comentar. Los comentarios los escribe el equipo de la promotora.'
			: /Demasiados/.test( t ) ? 'Demasiados comentarios seguidos. Espera un poco y vuelve a probar.'
				: 'No se ha podido guardar ahora mismo. Vuelve a probar en unos minutos.' );

	}
	return await r.json() as T;

}

/** Lo que queda guardado de un pack; o un texto con el motivo si no se ha podido guardar. */
export type SeleccionGuardada = { estado: 'seleccionada' | 'cerrada'; importe: number; fecha: string; opciones: Record<string, string>; hasta: string | null };

/**
 * Guarda en Supabase la selección de un pack como «Seleccionada» (paso 5b,
 * 025_selecciones.sql). Supabase comprueba el código, que el pack esté abierto
 * y las opciones, y calcula el importe con los precios de esta versión.
 */
export async function guardarSeleccion( pack: string, opciones: Record<string, string>, vivienda: string ): Promise<SeleccionGuardada | string> {

	if ( ! codigoComprador && ! paseProfesional ) return 'Entra con tu código para guardar tu selección.';
	try {

		// en modo profesional, en nombre del comprador de esa vivienda (027_profesional.sql)
		const [ rpc, cuerpo ] = paseProfesional
			? [ 'guardar_seleccion_profesional', { p_promocion: PROMOCION.id, p_pase: paseProfesional, p_version: __VERSION__, p_vivienda: vivienda, p_pack: pack, p_opciones: opciones } ]
			: [ 'guardar_seleccion', { p_promocion: PROMOCION.id, p_codigo: codigoComprador, p_version: __VERSION__, p_pack: pack, p_opciones: opciones } ];
		const r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/${ rpc }`, {
			method: 'POST',
			headers: { apikey: SUPABASE_CLAVE, 'Content-Type': 'application/json' },
			body: JSON.stringify( cuerpo ),
		} );
		if ( ! r.ok ) {

			const t = await r.text();
			console.error( 'guardar_seleccion', t );
			return /caducado/.test( t ) ? 'Tu acceso al 3D ha caducado. Vuelve a abrirlo desde MUNE Portal.'
				: /Solo el comprador o el equipo/.test( t ) ? 'Es una vista previa: para guardar la selección en nombre del comprador necesitas «Gestionar personalizaciones».'
				: /periodo/.test( t ) ? 'El periodo de selección de este pack no está abierto.'
				: /cerrada/.test( t ) ? 'Tu selección de este pack ya está cerrada.'
					: 'No se ha podido guardar tu selección ahora mismo. Inténtalo de nuevo en unos minutos.';

		}
		const d = await r.json() as SeleccionGuardada | null;
		return d ?? 'Tu código ya no es válido. Vuelve a entrar con el código que te dio la promotora.';

	} catch {

		return 'No se ha podido guardar tu selección ahora mismo. Revisa tu conexión y vuelve a intentarlo.';

	}

}

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
			body: JSON.stringify( { p_promocion: PROMOCION.id, p_codigo: c, p_version: __VERSION__ } ),
		} );
		if ( ! r.ok ) return /Demasiados intentos/.test( await r.text() ) ? 'bloqueado' : 'sin-conexion';
		const d = await r.json() as { vivienda: string; selecciones: ViviendaPromocion[ 'selecciones' ]; formalizacion?: ViviendaPromocion[ 'formalizacion' ]; datos?: DatosComprador | null } | null;
		if ( ! d ) return null;
		codigoComprador = c;
		// la web pública solo lleva una vivienda de muestra por unidad: la del comprador llega con su código
		if ( d.datos ) aplicarDatos( d.datos );
		const v = d.datos?.vivienda ?? PROMOCION.viviendas.find( ( x ) => x.ref === d.vivienda );
		return v ? { ...v, selecciones: d.selecciones ?? {}, formalizacion: d.formalizacion ?? {} } : null;

	} catch {

		return 'sin-conexion';

	}

}
