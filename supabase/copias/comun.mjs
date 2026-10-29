// Utilidades de las copias de seguridad (copiar.mjs y restaurar.mjs).
//
// psql y pg_dump se ejecutan en un contenedor de Docker con PostgreSQL 17,
// para no depender de la versión instalada. La contraseña de la base de datos
// va en variables de entorno, nunca en la línea de órdenes.

import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const IMAGEN = process.env.PG_IMAGEN || 'postgres:17-alpine';
export const PRODUCCION = 'iowtdenlkxjqzlpwizgb';
export const ALMACENES = [ 'documentos', 'entregables', 'referencias', 'versiones' ];
export const TABLAS_AUTH = [ [ 'usuarios', 'auth.users' ], [ 'identidades', 'auth.identities' ], [ 'factores', 'auth.mfa_factors' ] ];

export function falta( ...nombres ) {

	const no = nombres.filter( ( n ) => ! process.env[ n ] );
	if ( no.length ) {

		console.error( `Faltan variables: ${ no.join( ', ' ) }` );
		process.exit( 2 );

	}

}

export function carpetaTemporal() {

	const dir = mkdtempSync( join( tmpdir(), 'copias-' ) );
	process.on( 'exit', () => rmSync( dir, { recursive: true, force: true } ) );
	return dir;

}

// Conexión a partir de una dirección postgresql://usuario:clave@host:puerto/bd
export function conexion( url ) {

	const u = new URL( url );
	return {
		PGHOST: u.hostname,
		PGPORT: u.port || '5432',
		PGUSER: decodeURIComponent( u.username ),
		PGPASSWORD: decodeURIComponent( u.password ),
		PGDATABASE: u.pathname.replace( /^\//, '' ) || 'postgres',
		PGSSLMODE: [ '127.0.0.1', 'localhost' ].includes( u.hostname ) ? 'disable' : 'require',
	};

}

// Ejecuta psql o pg_dump con la carpeta de trabajo montada en /w.
export function pg( programa, args, con, carpeta, entrada ) {

	const env = Object.keys( con );
	const r = spawnSync( 'docker', [ 'run', '--rm', '-i', '--network', 'host', '-v', `${ carpeta }:/w`, '-w', '/w',
		...env.flatMap( ( k ) => [ '-e', k ] ), IMAGEN, programa, ...args ], {
		env: { ...process.env, ...con }, input: entrada, maxBuffer: 1 << 30,
	} );
	if ( r.status !== 0 ) throw new Error( `${ programa }: ${ String( r.stderr ).trim().split( '\n' ).slice( -3 ).join( ' · ' ) }` );
	return String( r.stdout );

}

export const consulta = ( sql, con, carpeta ) => pg( 'psql', [ '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql ], con, carpeta ).trim();

export const sha256 = ( datos ) => createHash( 'sha256' ).update( datos ).digest( 'hex' );

// Cifrado simétrico con gpg (AES-256). La contraseña va en un archivo temporal.
function gpg( args, datos, clave, carpeta ) {

	const archivo = join( carpeta, '.clave' );
	writeFileSync( archivo, clave, { mode: 0o600 } );
	try {

		return execFileSync( 'gpg', [ '--batch', '--yes', '--quiet', '--pinentry-mode', 'loopback', '--passphrase-file', archivo, ...args ], {
			input: datos, maxBuffer: 1 << 30, stdio: [ 'pipe', 'pipe', 'pipe' ],
		} );

	} finally {

		rmSync( archivo, { force: true } );

	}

}

export const cifrar = ( datos, clave, carpeta ) => gpg( [ '--symmetric', '--cipher-algo', 'AES256', '--compress-algo', 'none' ], datos, clave, carpeta );
export function descifrar( datos, clave, carpeta ) {

	try {

		return gpg( [ '--decrypt' ], datos, clave, carpeta );

	} catch {

		throw new Error( 'No se puede descifrar: la contraseña de las copias no es la correcta (o el archivo está dañado)' );

	}

}

// Errores en una línea, sin el detalle interno de Node.
for ( const evento of [ 'uncaughtException', 'unhandledRejection' ] ) {

	process.on( evento, ( e ) => {

		console.error( e?.message ?? e );
		process.exit( 1 );

	} );

}

// Fecha de hoy en España, AAAA-MM-DD (HOY_PRUEBA solo en las pruebas de las copias)
export const hoy = () => process.env.HOY_PRUEBA || new Date().toLocaleDateString( 'sv-SE', { timeZone: 'Europe/Madrid' } );

// Ruta de un archivo de Supabase dentro del almacén de copias, sin salirse de él.
export function rutaSegura( almacen, nombre ) {

	const partes = nombre.split( '/' );
	if ( ! ALMACENES.includes( almacen ) || partes.some( ( p ) => p === '' || p === '.' || p === '..' ) ) throw new Error( `Nombre de archivo no válido: ${ almacen }/${ nombre }` );
	return join( 'archivos', almacen, ...partes ) + '.gpg';

}

export const codificar = ( nombre ) => nombre.split( '/' ).map( encodeURIComponent ).join( '/' );
