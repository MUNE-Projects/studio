#!/usr/bin/env node
// Planos comerciales de una versión, para que la promotora los valide (Etapa 4).
//
//   node herramientas/planos.mjs <promoción> --version vN [--salida <carpeta>]
//
// Abre el producto maestro en un navegador sin ventana (planos.html), genera un
// plano por tipología y variante (o por vivienda en las unifamiliares) y deja en
// <salida>/planos/:
//   <clave>.pdf          el plano A3 que se valida
//   <clave>.png          miniatura para el portal
//   planos.json          lista con título, viviendas y huellas (archivo y datos)
// y en <salida>/experiencia/experiencia.json las unidades de validación de la
// Experiencia 3D: una por tipología y variante (o por vivienda en las
// unifamiliares), con la huella de todo lo que define su 3D y sus vistas
// guiadas; más «Entorno y elementos generales» si existe trabajo/<id>/entorno/.
// Los datos de la promoción se bajan antes de Supabase a trabajo/<id>/
// (herramientas/promociones.mjs).
// Por defecto, <salida> es salida/<promoción>/. «publicacion.mjs preparar» lo
// llama solo, así que los planos viajan con cada versión a la vista previa.
//
// Navegador: Chromium. Si no está en la ruta habitual, indica otra con la
// variable CHROMIUM (ruta del ejecutable).

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRABAJO } from './promociones.mjs';

const RAIZ = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const CHROMIUM = [ process.env.CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome' ].find( ( r ) => r && existsSync( r ) );

/** Huella del entorno (trabajo/<id>/entorno/): rutas y contenido de todos sus archivos; null si no hay. */
function huellaEntorno( id ) {

	const raiz = join( TRABAJO, id, 'entorno' );
	if ( ! existsSync( raiz ) ) return null;
	const listar = ( d ) => readdirSync( d, { withFileTypes: true } ).flatMap( ( e ) => ( e.isDirectory() ? listar( join( d, e.name ) ) : [ join( d, e.name ) ] ) );
	const h = createHash( 'sha256' );
	for ( const a of listar( raiz ).map( ( a ) => relative( raiz, a ).split( '\\' ).join( '/' ) ).sort() ) {

		h.update( `${ a }\n` );
		h.update( `${ createHash( 'sha256' ).update( readFileSync( join( raiz, a ) ) ).digest( 'hex' ) }\n` );

	}
	return h.digest( 'hex' );

}

export async function generarPlanos( id, version, salida = join( RAIZ, 'salida', id ) ) {

	if ( ! /^[a-z0-9-]{1,60}$/.test( id ) || ! existsSync( join( TRABAJO, id, 'promocion.json' ) ) ) throw new Error( `No hay datos de la promoción «${ id }» en trabajo/${ id }/ (node herramientas/promociones.mjs bajar ${ id })` );
	if ( ! /^v[0-9]{1,5}$/.test( version ?? '' ) ) throw new Error( 'Indica la versión: --version v3' );
	const { createServer } = await import( 'vite' );
	const { chromium } = await import( 'playwright-core' );

	process.env.PROMOCION = id;
	process.env.PROMOCIONES = TRABAJO;
	// modo «planos»: con todas las viviendas y distribuciones (vite.config.ts)
	const servidor = await createServer( { root: RAIZ, mode: 'planos', logLevel: 'error', server: { port: 0, host: '127.0.0.1' } } );
	await servidor.listen();
	const navegador = await chromium.launch( CHROMIUM ? { executablePath: CHROMIUM } : {} );
	try {

		const pagina = await navegador.newPage();
		pagina.on( 'console', ( m ) => m.text().startsWith( 'Plano ' ) && console.log( `  · ${ m.text() }` ) );
		await pagina.goto( `${ servidor.resolvedUrls.local[ 0 ] }planos.html` );
		await pagina.waitForFunction( () => typeof window.generarLote === 'function', null, { timeout: 120000 } );
		// acabados de la memoria escritos de forma que no se entiende: se corrigen antes de seguir
		const malos = await pagina.evaluate( () => window.erroresAcabados() );
		if ( malos.length ) throw new Error( `Los acabados de promocion.json tienen datos que no se entienden:\n${ malos.map( ( x ) => `  · ${ x }` ).join( '\n' ) }` );
		// muebles que se pisan, atraviesan un muro o chocan con una puerta: saldrían así en el 3D y en los planos
		const choques = await pagina.evaluate( () => window.erroresDistribucion() );
		if ( choques.length ) throw new Error( `La distribución tiene choques, y saldrían así en la Experiencia 3D, los renders y los planos:\n${ choques.map( ( x ) => `  · ${ x }` ).join( '\n' ) }\n  Revisa el plano acotado y corrige los datos antes de preparar la versión.` );
		const lote = await pagina.evaluate( () => window.generarLote( ( t ) => console.log( t ) ) );

		const carpeta = join( salida, 'planos' );
		rmSync( carpeta, { recursive: true, force: true } );
		mkdirSync( carpeta, { recursive: true } );
		const planos = lote.map( ( p ) => {

			const pdf = Buffer.from( p.pdf, 'base64' );
			writeFileSync( join( carpeta, `${ p.clave }.pdf` ), pdf );
			writeFileSync( join( carpeta, `${ p.clave }.png` ), Buffer.from( p.png, 'base64' ) );
			return {
				clave: p.clave, titulo: p.titulo, detalle: p.detalle, viviendas: p.viviendas, orden: p.orden,
				pdf: `${ p.clave }.pdf`, miniatura: `${ p.clave }.png`,
				huella: createHash( 'sha256' ).update( pdf ).digest( 'hex' ), huellaDatos: p.huellaDatos,
			};

		} );
		const generados = new Date().toISOString();
		writeFileSync( join( carpeta, 'planos.json' ), JSON.stringify( { promocion: id, version, generados, planos }, null, '\t' ) + '\n' );

		// unidades de validación de la Experiencia 3D
		const unidades = await pagina.evaluate( () => window.generarUnidadesExperiencia() );
		const entorno = huellaEntorno( id );
		if ( entorno ) unidades.push( { clave: 'entorno', titulo: 'Entorno y elementos generales', detalle: 'Parcela, urbanización y zonas comunes de la promoción', viviendas: '', orden: unidades.length, huella: entorno, vistas: [] } );
		const carpetaExp = join( salida, 'experiencia' );
		rmSync( carpetaExp, { recursive: true, force: true } );
		mkdirSync( carpetaExp, { recursive: true } );
		// acabados que la memoria no indica: la promotora los ve al validar, con lo que se pondrá por defecto
		const supuestos = await pagina.evaluate( () => window.supuestosAcabados() );
		writeFileSync( join( carpetaExp, 'experiencia.json' ), JSON.stringify( { promocion: id, version, generados, unidades, supuestos }, null, '\t' ) + '\n' );
		planos.supuestos = supuestos;
		planos.experiencia = unidades;
		return planos;

	} finally {

		await navegador.close();
		await servidor.close();

	}

}

if ( process.argv[ 1 ] === fileURLToPath( import.meta.url ) ) {

	const args = process.argv.slice( 2 );
	const opcion = ( n ) => ( args.indexOf( `--${ n }` ) >= 0 ? args[ args.indexOf( `--${ n }` ) + 1 ] : undefined );
	try {

		const planos = await generarPlanos( args[ 0 ], opcion( 'version' ), opcion( 'salida' ) && resolve( opcion( 'salida' ) ) );
		console.log( `\n✓ ${ planos.length } plano(s) en ${ opcion( 'salida' ) ?? `salida/${ args[ 0 ] }` }/planos/` );
		console.log( `✓ ${ planos.experiencia.length } unidad(es) de la Experiencia 3D en ${ opcion( 'salida' ) ?? `salida/${ args[ 0 ] }` }/experiencia/` );
		if ( planos.supuestos.length ) {

			console.log( `\n⚠ La memoria de calidades no indica ${ planos.supuestos.length } dato(s); se pondrá lo de por defecto y la promotora lo verá al validar:` );
			for ( const x of planos.supuestos ) console.log( `  · ${ x.apartado } (${ x.dato }): ${ x.porDefecto }` );

		}

	} catch ( e ) {

		console.error( `\n✗ ${ e.message }\n` );
		process.exit( 1 );

	}

}
