// Recuperar una copia de seguridad de MUNE (receta 18).
//
// La usa cada tres meses el simulacro (simulacro.yml) contra un Supabase de
// prueba dentro de GitHub. En un desastre real, la misma herramienta recupera
// la copia en un proyecto de Supabase nuevo. Nunca escribe en el proyecto
// real actual: si la dirección es la suya, se niega.
//
// Antes hay que aplicar al destino los archivos supabase/0NN_*.sql (la
// estructura sale de este almacén; la copia solo trae los datos), con
// copias/estructura.sh o a mano en el SQL Editor.
//
// Uso:
//   node supabase/copias/restaurar.mjs --bd <dirección de la base de datos> [--copia <archivo>] [--archivos] [--comprobar] [--forzar]
// Variables:
//   COPIAS_CIFRADO   contraseña de las copias
//   COPIAS           carpeta del almacén de copias (MUNE-Projects/copias)
//   SUPABASE_URL, SUPABASE_SERVICE_KEY   solo con --archivos: el destino y su clave secreta
//   RESULTADO        (opcional) archivo donde dejar el resultado en JSON
//
// --archivos  sube los archivos (comprobando la huella de cada uno)
// --comprobar compara lo recuperado con el resumen guardado en la copia
// --forzar    sustituye a los usuarios provisionales que deja estructura.sh (como mucho 2)

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCCION, TABLAS_AUTH, carpetaTemporal, codificar, conexion, consulta, descifrar, falta, pg, rutaSegura, sha256 } from './comun.mjs';

const { values: op } = parseArgs( { options: {
	bd: { type: 'string' }, copia: { type: 'string' }, archivos: { type: 'boolean' }, comprobar: { type: 'boolean' }, forzar: { type: 'boolean' },
} } );
falta( 'COPIAS_CIFRADO', 'COPIAS' );
if ( ! op.bd ) {

	console.error( 'Falta --bd <dirección de la base de datos de destino>' );
	process.exit( 2 );

}
if ( op.archivos ) falta( 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY' );
if ( [ op.bd, process.env.SUPABASE_URL ?? '' ].some( ( u ) => u.includes( PRODUCCION ) ) ) {

	console.error( 'Esa es la base de datos real de MUNE: aquí no se recupera nada. Usa un proyecto nuevo o de prueba.' );
	process.exit( 2 );

}

const { COPIAS, COPIAS_CIFRADO } = process.env;
const con = conexion( op.bd );
const tmp = carpetaTemporal();
const datos = join( tmp, 'datos' );
mkdirSync( datos );

// ─── 1. Abrir la copia ──────────────────────────────────────────────────────

const carpeta = join( COPIAS, 'base-de-datos' );
const copia = op.copia ?? join( carpeta, readdirSync( carpeta ).filter( ( f ) => f.endsWith( '.tar.gz.gpg' ) ).sort().at( -1 ) ?? '' );
if ( ! existsSync( copia ) ) throw new Error( 'No hay ninguna copia de la base de datos' );
execFileSync( 'tar', [ '-xzf', '-', '-C', datos ], { input: descifrar( readFileSync( copia ), COPIAS_CIFRADO, tmp ) } );
const resumen = JSON.parse( readFileSync( join( datos, 'resumen.json' ), 'utf8' ) );
const objetos = JSON.parse( readFileSync( join( datos, 'objetos.json' ), 'utf8' ) );
console.log( `Copia del ${ resumen.fecha }: ${ Object.keys( resumen.filas ).length } tablas, ${ resumen.archivos } archivos.` );

// ─── 2. Base de datos ───────────────────────────────────────────────────────

if ( consulta( `select to_regclass('public.promociones') is not null`, con, datos ) !== 't' ) {

	throw new Error( 'El destino no tiene la estructura de MUNE: aplica antes los archivos supabase/0NN_*.sql' );

}
const usuarios = Number( consulta( 'select count(*) from auth.users', con, datos ) );
if ( usuarios > 2 || ( usuarios && ! op.forzar ) ) {

	throw new Error( `El destino ya tiene ${ usuarios } usuarios: solo se recupera en un proyecto nuevo (con --forzar, si son los provisionales de estructura.sh)` );

}

const ident = ( c ) => `"${ c.replaceAll( '"', '""' ) }"`;
let sql = `\\set ON_ERROR_STOP 1
begin;
-- Se vacía lo que dejan los archivos SQL (listas estándar, llaves y usuarios
-- provisionales): lo trae la copia.
do $$ declare t text; begin
	for t in select format('%I.%I', schemaname, tablename) from pg_tables where schemaname = 'public' loop
		execute 'truncate ' || t || ' restart identity cascade';
	end loop;
end $$;
delete from auth.users;
set local session_replication_role = replica;
`;
for ( const [ archivo, tabla ] of TABLAS_AUTH ) {

	const cabecera = readFileSync( join( datos, `${ archivo }.csv` ), 'utf8' ).split( '\n' )[ 0 ].split( ',' ).map( ( c ) => c.replace( /^"|"$/g, '' ) );
	const destino = Object.fromEntries( consulta( `select attname || '|' || format_type(atttypid, atttypmod) from pg_attribute
		where attrelid = '${ tabla }'::regclass and attnum > 0 and not attisdropped and attgenerated = ''`, con, datos )
		.split( '\n' ).map( ( l ) => l.split( '|' ) ) );
	const comunes = cabecera.filter( ( c ) => destino[ c ] );
	sql += `create temp table _${ archivo } (${ cabecera.map( ( c ) => `${ ident( c ) } text` ).join( ', ' ) });
\\copy _${ archivo } from '/w/${ archivo }.csv' csv header
insert into ${ tabla } (${ comunes.map( ident ).join( ', ' ) })
	select ${ comunes.map( ( c ) => `${ ident( c ) }::${ destino[ c ] }` ).join( ', ' ) } from _${ archivo };
`;

}
sql += `\\i /w/datos.sql
commit;
`;
writeFileSync( join( datos, 'restaurar.sql' ), sql );
pg( 'psql', [ '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/w/restaurar.sql' ], con, datos );
console.log( 'Base de datos recuperada.' );

// ─── 3. Archivos ────────────────────────────────────────────────────────────

const problemas = [];
if ( op.archivos ) {

	const indice = JSON.parse( readFileSync( join( COPIAS, 'archivos', 'indice.json' ), 'utf8' ) );
	const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
	let subidos = 0;
	for ( const o of objetos ) {

		const clave = `${ o.almacen }/${ o.nombre }`;
		const ruta = join( COPIAS, rutaSegura( o.almacen, o.nombre ) );
		if ( ! existsSync( ruta ) || ! indice[ clave ] ) {

			problemas.push( `Falta la copia del archivo ${ clave }` );
			continue;

		}
		const contenido = descifrar( readFileSync( ruta ), COPIAS_CIFRADO, tmp );
		if ( sha256( contenido ) !== indice[ clave ].sha256 ) {

			problemas.push( `El archivo ${ clave } no coincide con su huella` );
			continue;

		}
		const r = await fetch( `${ SUPABASE_URL }/storage/v1/object/${ o.almacen }/${ codificar( o.nombre ) }`, {
			method: 'POST', body: contenido,
			headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${ SUPABASE_SERVICE_KEY }`, 'x-upsert': 'true', 'Content-Type': o.tipo || 'application/octet-stream' },
		} );
		if ( ! r.ok ) problemas.push( `No se ha podido subir ${ clave }: ${ r.status }` );
		else subidos ++;

	}
	console.log( `Archivos recuperados: ${ subidos } de ${ objetos.length }.` );

}

// ─── 4. Comprobación ────────────────────────────────────────────────────────

if ( op.comprobar ) {

	for ( const [ tabla, n ] of Object.entries( resumen.filas ) ) {

		const real = tabla.startsWith( 'auth:' )
			? consulta( `select count(*) from ${ TABLAS_AUTH.find( ( [ a ] ) => `auth:${ a }` === tabla )[ 1 ] }`, con, datos )
			: consulta( `select count(*) from public.${ ident( tabla ) }`, con, datos );
		if ( Number( real ) !== n ) problemas.push( `${ tabla }: la copia tiene ${ n } filas y se han recuperado ${ real }` );

	}
	if ( op.archivos ) {

		const real = Number( consulta( `select count(*) from storage.objects where bucket_id in ('documentos', 'entregables', 'referencias')`, con, datos ) );
		if ( real !== objetos.length ) problemas.push( `Archivos: la copia tiene ${ objetos.length } y hay ${ real }` );

	}

}

if ( process.env.RESULTADO ) writeFileSync( process.env.RESULTADO, JSON.stringify( {
	copia: resumen.fecha, tablas: Object.keys( resumen.filas ).length,
	filas: Object.values( resumen.filas ).reduce( ( a, b ) => a + b, 0 ), archivos: objetos.length, problemas: problemas.slice( 0, 10 ),
} ) );
if ( problemas.length ) {

	console.error( `Hay ${ problemas.length } problemas:\n · ${ problemas.join( '\n · ' ) }` );
	process.exit( 1 );

}
console.log( op.comprobar ? 'Comprobado: todo lo de la copia está recuperado.' : 'Hecho.' );
