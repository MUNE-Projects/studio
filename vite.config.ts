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

	return {
		base: './',
		resolve: { alias: { '@promocion': carpeta } },
		define: { __STUDIO__: JSON.stringify( studio ) },
		plugins: [ conTextosLegales( textosLegales() ), ...( studio ? [] : [ sinDatosDeStudio() ] ) ],
		build: { target: 'es2022', chunkSizeWarningLimit: 2000, outDir: process.env.SALIDA || 'dist' },
	};

} );
