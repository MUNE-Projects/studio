#!/usr/bin/env node
// Los datos de cada promoción, guardados en Supabase (035_modelo_promocion.sql),
// nunca en GitHub. Claude trabaja en una carpeta de su ordenador, trabajo/<id>/,
// que no se sube a GitHub (.gitignore).
//
//   node herramientas/promociones.mjs lista                          (promociones con datos y sus versiones)
//   node herramientas/promociones.mjs bajar <id> [--version vN]      (a trabajo/<id>/; sin versión, la de trabajo)
//   node herramientas/promociones.mjs subir <id> --nota "Texto" [--forzar]
//   node herramientas/promociones.mjs diferencias <id>               (qué ha cambiado en trabajo/<id>/)
//
// «subir» guarda trabajo/<id>/ como la versión de trabajo nueva (una fila más:
// lo anterior se conserva). Se niega si alguien ha guardado otra entretanto
// (desde que se bajó), salvo con --forzar. «publicacion.mjs preparar» guarda,
// además, la copia exacta de cada versión que prepara.
//
// Credenciales: ROBOT_EMAIL y ROBOT_CLAVE (configuración privada del entorno de
// Claude), nunca en el código, en GitHub ni en el chat.

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const RAIZ = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
/** Carpeta de trabajo con los datos de cada promoción (no va a GitHub). */
export const TRABAJO = process.env.TRABAJO ? resolve( process.env.TRABAJO ) : join( RAIZ, 'trabajo' );
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = process.env.SUPABASE_CLAVE_PUBLICA ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
// lo que se bajó (huella e id de la fila), para que «subir» no pise lo que otro haya guardado
const BASE = '.bajado.json';

/** Sesión del robot de Claude (ROBOT_EMAIL y ROBOT_CLAVE). */
export async function cabecerasRobot() {

	const email = process.env.ROBOT_EMAIL;
	const password = process.env.ROBOT_CLAVE;
	if ( ! email || ! password ) throw new Error( 'Faltan ROBOT_EMAIL y ROBOT_CLAVE: sin ellas no se pueden leer ni guardar los datos de las promociones.' );
	const r = await fetch( `${ SUPABASE_URL }/auth/v1/token?grant_type=password`, {
		method: 'POST', headers: { apikey: SUPABASE_CLAVE_PUBLICA, 'Content-Type': 'application/json' }, body: JSON.stringify( { email, password } ),
	} );
	if ( ! r.ok ) throw new Error( `la entrada del robot respondió ${ r.status }` );
	const { access_token: token } = await r.json();
	return { apikey: SUPABASE_CLAVE_PUBLICA, 'Content-Type': 'application/json', Authorization: `Bearer ${ token }` };

}

async function pedir( cabeceras, ruta, opciones = {} ) {

	const r = await fetch( `${ SUPABASE_URL }${ ruta }`, { ...opciones, headers: { ...cabeceras, ...opciones.headers } } );
	const texto = await r.text();
	if ( ! r.ok ) {

		let mensaje = texto;
		try {

			mensaje = JSON.parse( texto ).message ?? texto;

		} catch { /* texto tal cual */ }
		throw new Error( `Supabase (${ r.status }): ${ String( mensaje ).slice( 0, 300 ) }` );

	}
	return texto ? JSON.parse( texto ) : null;

}

/** Fila de los datos de una promoción: la versión de trabajo más reciente, o la de una versión; null si no hay. */
export async function leerModelo( cabeceras, id, version = null ) {

	const filtro = version ? `version=eq.${ encodeURIComponent( version ) }` : 'version=is.null&order=id.desc&limit=1';
	const [ fila ] = await pedir( cabeceras, `/rest/v1/modelo_promocion?promocion_id=eq.${ encodeURIComponent( id ) }&${ filtro }&select=id,version,archivos,huella,codigo,nota,guardado_en` );
	return fila ?? null;

}

/** Archivos de trabajo/<id>/ como { ruta: texto }. */
export function archivosLocales( id ) {

	const carpeta = join( TRABAJO, id );
	if ( ! existsSync( join( carpeta, 'promocion.json' ) ) ) throw new Error( `No hay datos de «${ id }» en ${ relative( RAIZ, carpeta ) }/. Bájalos primero: node herramientas/promociones.mjs bajar ${ id }` );
	const archivos = {};
	const otros = [];
	const recorrer = ( d ) => {

		for ( const e of readdirSync( d, { withFileTypes: true } ) ) {

			const p = join( d, e.name );
			if ( e.name === BASE ) continue;
			if ( e.isDirectory() ) recorrer( p );
			else if ( e.name.endsWith( '.json' ) ) archivos[ relative( carpeta, p ).split( '\\' ).join( '/' ) ] = readFileSync( p, 'utf8' );
			else otros.push( relative( carpeta, p ) );

		}

	};
	recorrer( carpeta );
	if ( otros.length ) throw new Error( `Solo se guardan archivos .json, y en ${ relative( RAIZ, carpeta ) }/ hay otros: ${ otros.slice( 0, 5 ).join( ', ' ) }` );
	for ( const [ ruta, texto ] of Object.entries( archivos ) ) {

		try {

			JSON.parse( texto );

		} catch ( e ) {

			throw new Error( `${ ruta } no es un JSON válido (${ e.message })` );

		}

	}
	return Object.fromEntries( Object.entries( archivos ).sort() );

}

/** Rutas que difieren entre dos juegos de archivos. */
export function diferencias( a, b ) {

	const rutas = [ ...new Set( [ ...Object.keys( a ), ...Object.keys( b ) ] ) ].sort();
	return rutas.filter( ( r ) => a[ r ] !== b[ r ] ).map( ( r ) => `${ r } (${ ! ( r in a ) ? 'solo en Supabase' : ! ( r in b ) ? 'nuevo' : 'cambiado' })` );

}

/** Guarda unos datos en Supabase: la versión de trabajo, o la copia de una versión. Devuelve la huella. */
export async function guardarModelo( cabeceras, id, archivos, { version = null, codigo = null, nota = '' } = {} ) {

	return pedir( cabeceras, '/rest/v1/rpc/guardar_modelo_promocion', {
		method: 'POST', body: JSON.stringify( { p_promocion: id, p_archivos: archivos, p_version: version, p_codigo: codigo, p_nota: nota } ),
	} );

}

function escribir( id, fila ) {

	const carpeta = join( TRABAJO, id );
	rmSync( carpeta, { recursive: true, force: true } );
	for ( const [ ruta, texto ] of Object.entries( fila.archivos ) ) {

		const destino = join( carpeta, ruta );
		if ( relative( carpeta, destino ).startsWith( '..' ) ) throw new Error( `Ruta no válida: ${ ruta }` );
		mkdirSync( dirname( destino ), { recursive: true } );
		writeFileSync( destino, texto );

	}
	writeFileSync( join( carpeta, BASE ), JSON.stringify( { id: fila.id, version: fila.version, huella: fila.huella } ) + '\n' );
	return carpeta;

}

// ---------------------------------------------------------------- órdenes

const ok = ( texto ) => console.log( `✓ ${ texto }` );
function fallo( texto ) {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

}

async function principal() {

	const args = process.argv.slice( 2 );
	const opcion = ( n ) => {

		const i = args.indexOf( `--${ n }` );
		return i >= 0 ? args[ i + 1 ] : undefined;

	};
	const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--version', '--nota' ].includes( args[ i - 1 ] ) );
	const [ orden, id ] = posicionales;
	if ( orden !== 'lista' && ! /^[a-z0-9-]{1,60}$/.test( id ?? '' ) ) fallo( 'Indica la promoción. Ejemplo: node herramientas/promociones.mjs bajar residencial-demo' );
	const cabeceras = await cabecerasRobot();

	switch ( orden ) {

		case 'lista': {

			const filas = await pedir( cabeceras, '/rest/v1/modelo_promocion?select=promocion_id,version,guardado_en&order=promocion_id,id' );
			const por = {};
			for ( const f of filas ) {

				const d = ( por[ f.promocion_id ] ??= { trabajo: null, versiones: [] } );
				if ( f.version ) d.versiones.push( f.version );
				else d.trabajo = f.guardado_en;

			}
			if ( ! filas.length ) return console.log( 'Todavía no hay datos de ninguna promoción en Supabase.' );
			for ( const [ p, d ] of Object.entries( por ) ) console.log( `${ p.padEnd( 30 ) } trabajo: ${ d.trabajo?.slice( 0, 16 ) ?? '—' }   versiones: ${ d.versiones.join( ', ' ) || '—' }` );
			break;

		}
		case 'bajar': {

			const version = opcion( 'version' );
			if ( version && ! /^v\d{1,5}$/.test( version ) ) fallo( 'Versión no válida (por ejemplo, v3)' );
			const fila = await leerModelo( cabeceras, id, version );
			if ( ! fila ) fallo( version ? `No hay datos de la ${ version } de «${ id }»` : `Todavía no hay datos de «${ id }» en Supabase` );
			const carpeta = escribir( id, fila );
			ok( `${ Object.keys( fila.archivos ).length } archivos de «${ id }»${ version ? ` (${ version })` : ' (versión de trabajo)' } en ${ relative( RAIZ, carpeta ) }/` );
			if ( version ) console.log( '  Ojo: es la copia de una versión preparada. Si la subes, pasa a ser la versión de trabajo.' );
			break;

		}
		case 'diferencias': {

			const remota = await leerModelo( cabeceras, id );
			const cambios = diferencias( archivosLocales( id ), remota?.archivos ?? {} );
			console.log( cambios.length ? `Cambios respecto a lo guardado en Supabase:\n  · ${ cambios.join( '\n  · ' ) }` : 'Sin cambios: trabajo/ coincide con lo guardado en Supabase.' );
			break;

		}
		case 'subir': {

			const nota = opcion( 'nota' );
			if ( ! nota ) fallo( 'Falta --nota: qué has cambiado' );
			const archivos = archivosLocales( id );
			const remota = await leerModelo( cabeceras, id );
			const base = existsSync( join( TRABAJO, id, BASE ) ) ? JSON.parse( readFileSync( join( TRABAJO, id, BASE ), 'utf8' ) ) : null;
			if ( remota && base?.id !== remota.id && ! args.includes( '--forzar' ) ) {

				fallo( `Alguien ha guardado otros datos de «${ id }» (${ remota.guardado_en.slice( 0, 16 ) }: ${ remota.nota || 'sin nota' }) después de que los bajaras.\n  Bájalos otra vez y repite tus cambios, o usa --forzar para sustituirlos (lo anterior se conserva en Supabase).` );

			}
			if ( remota && ! diferencias( archivos, remota.archivos ).length ) return ok( 'Nada que subir: coincide con lo guardado en Supabase.' );
			const huella = await guardarModelo( cabeceras, id, archivos, { nota } );
			const nueva = await leerModelo( cabeceras, id );
			writeFileSync( join( TRABAJO, id, BASE ), JSON.stringify( { id: nueva.id, version: null, huella: nueva.huella } ) + '\n' );
			ok( `Datos de «${ id }» guardados en Supabase (${ Object.keys( archivos ).length } archivos, huella ${ String( huella ).slice( 0, 12 ) })` );
			break;

		}
		default: fallo( 'Orden desconocida. Usa: lista | bajar | subir | diferencias' );

	}

}

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	principal().catch( ( e ) => fallo( e.message ) );

}
