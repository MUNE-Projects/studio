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
//   MARCA=<json>        marca de la promotora (o la propia de la promoción) guardada en
//                       MUNE Portal (031): nombre, logo, colores, tipografía y contacto;
//                       la pone «preparar» y sustituye a la de promocion.json
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

// Lo mismo que comprueba Supabase (svg_seguro, 031): un logo SVG sin código.
const svgSeguro = ( s: string ) => s.length <= 200000
	&& /^\s*(<\?xml[^>]*\?>\s*)?<svg[\s>]/i.test( s ) && /<\/svg>\s*$/i.test( s )
	&& ! /<\s*(script|foreignobject|iframe|embed|object|audio|video|a|animate|set|handler|listener)[\s>/]/i.test( s )
	&& ! /<!(doctype|entity)/i.test( s ) && ! /\son[a-z]+\s*=/i.test( s ) && ! /(javascript|vbscript)\s*:/i.test( s ) && ! /@import/i.test( s )
	&& ! /href\s*=\s*["'](?!#|data:image\/(png|jpeg|webp|gif);base64,)/i.test( s ) && ! /url\(\s*["']?(?!#)/i.test( s );

const COLOR = /^#[0-9a-f]{6}$/i;
/** Sin logo: el nombre, escrito con el color principal. */
const logoDeTexto = ( nombre: string, color: string ) => {

	const t = nombre.replace( /[<>&"']/g, '' ).slice( 0, 80 );
	const ancho = Math.max( 40, Math.round( t.length * 9.5 ) );
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${ ancho }" height="32" viewBox="0 0 ${ ancho } 32"><text x="0" y="22" font-family="Helvetica, Arial, sans-serif" font-size="17" font-weight="600" fill="${ color }">${ t }</text></svg>`;

};

function marcaDePortal(): Record<string, unknown> | null {

	if ( ! process.env.MARCA ) return null;
	try {

		const m = JSON.parse( process.env.MARCA ) as Record<string, any>;
		if ( typeof m?.promotora !== 'string' || ! m.promotora.trim() || ! COLOR.test( m.colorPrincipal ) || ! COLOR.test( m.colorSecundario )
			|| typeof m.tipografia?.familia !== 'string' || ! /^[A-Za-z0-9 ]{1,40}$/.test( m.tipografia.familia ) ) throw new Error( 'incompleta' );
		if ( m.logoSvg && ! svgSeguro( m.logoSvg ) ) throw new Error( 'el logo no es un SVG sin código' );
		const contacto: Record<string, string> = {};
		for ( const k of [ 'telefono', 'email', 'web', 'direccion' ] ) if ( typeof m.contacto?.[ k ] === 'string' && m.contacto[ k ].trim() ) contacto[ k ] = m.contacto[ k ].trim().slice( 0, 200 );
		const familia = m.tipografia.familia.trim();
		return {
			promotora: m.promotora.trim().slice( 0, 80 ),
			logoSvg: m.logoSvg || logoDeTexto( m.promotora.trim(), m.colorPrincipal ),
			colorPrincipal: m.colorPrincipal, colorSecundario: m.colorSecundario,
			tipografia: { familia, googleFonts: `${ familia.replace( / /g, '+' ) }:wght@400;500;600;700` },
			contacto,
		};

	} catch ( e ) {

		console.warn( `MARCA no es válida (${ ( e as Error ).message }): se usa la marca de promocion.json` );
		return null;

	}

}

const conMarca = ( marca: Record<string, unknown> | null ): Plugin => ( {
	name: 'marca',
	enforce: 'pre',
	transform( codigo, id ) {

		if ( ! marca || ! /promociones[\\/][^\\/]+[\\/]promocion\.json$/.test( id ) ) return null;
		const datos = JSON.parse( codigo );
		datos.marca = { ...datos.marca, ...marca, contacto: { ...datos.marca?.contacto, ...( marca.contacto as object ) } };
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
		plugins: [ conMarca( marcaDePortal() ), conTextosLegales( textosLegales() ), ...( completo ? [] : [ sinDatosDeStudio(), catalogoSinPrecios() ] ) ],
		build: { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: process.env.SALIDA || 'dist' },
	};

} );
