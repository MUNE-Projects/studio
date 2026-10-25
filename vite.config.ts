import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Un solo producto maestro, una carpeta de datos por promoción.
//
//   PROMOCION=<id>      promoción que se construye (promociones/<id>/); por defecto la demo
//   --mode studio       incluye el Studio (herramienta interna de producción)
//   TEXTOS_LEGALES=<json>  textos legales escritos por la promotora en MUNE Portal
//                       ({ planos, renders, experiencia, personalizacion }); los pone
//                       «publicacion.mjs preparar» y sustituyen a los de promocion.json
//
// La web pública se construye SIN Studio: ni su código ni su acceso llegan al
// navegador del visitante.

const PROMOCION_POR_DEFECTO = 'residencial-demo';

/** Quita de promocion.json lo que solo usa el Studio y lo privado de cada comprador (no debe publicarse). */
const sinDatosDeStudio = (): Plugin => ( {
	name: 'sin-datos-de-studio',
	enforce: 'pre',
	transform( codigo, id ) {

		if ( ! /promociones[\\/][^\\/]+[\\/]promocion\.json$/.test( id ) ) return null;
		const datos = JSON.parse( codigo );
		delete datos.studio;
		// el equipo de la promotora entra desde MUNE Portal (paso 6a): sin código en la web
		delete datos.promotora;
		// contacto y datos de pago de la formalización: solo con código (Supabase)
		delete datos.pagos;
		if ( datos.marca ) delete datos.marca.comercial;
		// los códigos y lo formalizado por cada comprador viven en Supabase, nunca en la web;
		// el precio de venta no está en la plataforma (si quedara en datos antiguos, no sale)
		for ( const v of datos.viviendas ?? [] ) {

			delete v.acceso;
			delete v.selecciones;
			delete v.precioBase;

		}
		// datos privados (paso 5a): packs, lo que admite cada tipología y la lista de
		// viviendas se guardan en Supabase con cada versión; el comprador recibe lo
		// suyo con su código. Aquí queda una vivienda de muestra por unidad (tipología
		// y variante, o cada vivienda en una unifamiliar), sin sus opciones.
		delete datos.packs;
		for ( const t of datos.tipologias ?? [] ) delete t.opciones;
		const unidades = new Set<string>();
		datos.viviendas = ( datos.viviendas ?? [] ).filter( ( v: { ref: string; tipologia: string; espejo?: boolean } ) => {

			const clave = datos.promocion?.tipo === 'unifamiliar' ? v.ref : `${ v.tipologia }${ v.espejo ? '-espejo' : '' }`;
			if ( unidades.has( clave ) ) return false;
			unidades.add( clave );
			return true;

		} ).map( ( { opciones, nota, ...v }: Record<string, unknown> ) => v );
		return { code: JSON.stringify( datos ), map: null };

	},
} );

/**
 * Catálogo en la web pública (paso 5a): solo la opción incluida de cada categoría
 * (la que se ve sin personalizar), sin precios. El catálogo completo llega al
 * comprador con su código (Supabase, datos privados de la versión).
 */
const catalogoSinPrecios = (): Plugin => ( {
	name: 'catalogo-sin-precios',
	enforce: 'pre',
	transform( codigo, id ) {

		if ( ! /promociones[\\/][^\\/]+[\\/]catalogo\.json$/.test( id ) ) return null;
		const datos = JSON.parse( codigo );
		delete datos.nota;
		for ( const c of datos.categorias ?? [] ) c.opciones = ( c.opciones ?? [] ).slice( 0, 1 ).map( ( o: Record<string, unknown> ) => ( { ...o, precio: 0 } ) );
		return { code: JSON.stringify( datos ), map: null };

	},
} );

/** marca.legal de promocion.json ← textos de MUNE Portal (los vacíos no cambian nada). */
const LEGAL: Record<string, string> = { planos: 'plano', renders: 'imagenes', experiencia: 'experiencia', personalizacion: 'precios' };
function textosLegales(): Record<string, string> {

	if ( ! process.env.TEXTOS_LEGALES ) return {};
	try {

		const t = JSON.parse( process.env.TEXTOS_LEGALES ) as Record<string, unknown>;
		const r: Record<string, string> = {};
		for ( const [ origen, destino ] of Object.entries( LEGAL ) ) {

			const v = t?.[ origen ];
			if ( typeof v === 'string' && v.trim() ) r[ destino ] = v.trim().slice( 0, 1000 );

		}
		return r;

	} catch {

		console.warn( 'TEXTOS_LEGALES no es un JSON válido: se usan los textos de promocion.json' );
		return {};

	}

}

const conTextosLegales = ( textos: Record<string, string> ): Plugin => ( {
	name: 'textos-legales',
	enforce: 'pre',
	transform( codigo, id ) {

		if ( ! Object.keys( textos ).length || ! /promociones[\\/][^\\/]+[\\/]promocion\.json$/.test( id ) ) return null;
		const datos = JSON.parse( codigo );
		if ( datos.marca ) datos.marca.legal = { ...datos.marca.legal, ...textos };
		return { code: JSON.stringify( datos ), map: null };

	},
} );

export default defineConfig( ( { mode } ) => {

	const promocion = process.env.PROMOCION || PROMOCION_POR_DEFECTO;
	const carpeta = resolve( import.meta.dirname, 'promociones', promocion );
	if ( ! existsSync( resolve( carpeta, 'promocion.json' ) ) ) throw new Error( `No existe la promoción «${ promocion }» (promociones/${ promocion }/promocion.json)` );
	const studio = mode === 'studio';
	// «planos»: los planos comerciales de cada versión (herramientas/planos.mjs) se
	// generan con todos los datos (todas las viviendas y distribuciones), sin Studio;
	// son PDF e imágenes, no la web pública
	const completo = studio || mode === 'planos';

	return {
		base: './',
		resolve: { alias: { '@promocion': carpeta } },
		// versión de la web (la pone «publicacion.mjs preparar»): con ella pide el comprador sus datos
		define: { __STUDIO__: JSON.stringify( studio ), __VERSION__: JSON.stringify( process.env.VERSION_PUBLICA ?? null ) },
		plugins: [ conTextosLegales( textosLegales() ), ...( completo ? [] : [ sinDatosDeStudio(), catalogoSinPrecios() ] ) ],
		build: { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: process.env.SALIDA || 'dist' },
	};

} );
