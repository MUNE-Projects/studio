// Copia de seguridad de MUNE (receta 18). La lanza cada noche copias.yml.
//
// Guarda en la carpeta del almacén privado MUNE-Projects/copias, todo cifrado
// con la contraseña de las copias (COPIAS_CIFRADO):
//  · base-de-datos/AAAA-MM-DD.tar.gz.gpg: los datos de MUNE (datos.sql), los
//    usuarios con su contraseña cifrada y su código del móvil (CSV), la lista de
//    archivos y un resumen con cuántas filas tiene cada tabla. Se conservan las
//    de los últimos 31 días y la del día 1 de cada mes durante un año;
//  · archivos/<almacén>/<nombre>.gpg: cada archivo nuevo, una sola vez (en
//    MUNE no se modifican). Si un archivo se borra en Supabase, su copia se
//    borra 30 días después. archivos/indice.json lleva su huella (sha256).
//
// Variables:
//   SUPABASE_POOLER       dirección «Session pooler» de Supabase (Connect), tal cual
//   COPIAS_BD_CLAVE       contraseña del usuario «copias» de la base de datos
//   SUPABASE_URL, CLAVE_PUBLICA
//   COPIAS_CUENTA, COPIAS_CUENTA_CLAVE   cuenta «copias» de MUNE (ve archivos)
//   COPIAS_CIFRADO        contraseña con la que se cifra todo
//   DESTINO               carpeta del almacén de copias
//   DETALLE               (opcional) archivo donde dejar el resultado, para registrar.mjs
// Uso: node supabase/copias/copiar.mjs

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ALMACENES, TABLAS_AUTH, carpetaTemporal, cifrar, codificar, conexion, consulta, falta, hoy, pg, rutaSegura, sha256 } from './comun.mjs';

falta( 'SUPABASE_POOLER', 'COPIAS_BD_CLAVE', 'SUPABASE_URL', 'CLAVE_PUBLICA', 'COPIAS_CUENTA', 'COPIAS_CUENTA_CLAVE', 'COPIAS_CIFRADO', 'DESTINO' );
const { SUPABASE_URL, CLAVE_PUBLICA, COPIAS_CUENTA, COPIAS_CUENTA_CLAVE, COPIAS_CIFRADO, DESTINO } = process.env;
if ( COPIAS_CIFRADO.length < 16 ) throw new Error( 'La contraseña de cifrado tiene que tener al menos 16 caracteres' );

// La dirección del pooler trae el usuario «postgres.<proyecto>»: se usa «copias.<proyecto>».
const url = new URL( process.env.SUPABASE_POOLER.trim().replace( '[YOUR-PASSWORD]', 'x' ) );
url.username = decodeURIComponent( url.username ).replace( /^postgres(?=\.|$)/, 'copias' );
url.password = encodeURIComponent( process.env.COPIAS_BD_CLAVE );
const con = conexion( url.href );
const tmp = carpetaTemporal();
const fecha = hoy();
const detalle = { fecha };

async function api( ruta, opciones = {}, token ) {

	const r = await fetch( SUPABASE_URL + ruta, {
		...opciones,
		headers: { apikey: CLAVE_PUBLICA, ...( token ? { Authorization: `Bearer ${ token }` } : {} ), ...opciones.headers },
	} );
	if ( ! r.ok ) throw new Error( `${ ruta.split( '?' )[ 0 ] }: ${ r.status } ${ ( await r.text() ).slice( 0, 200 ) }` );
	return r;

}

async function entrar() {

	const r = await api( '/auth/v1/token?grant_type=password', {
		method: 'POST', headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify( { email: COPIAS_CUENTA, password: COPIAS_CUENTA_CLAVE } ),
	} );
	return ( await r.json() ).access_token;

}

// ─── 1. Base de datos ───────────────────────────────────────────────────────

function copiarBaseDeDatos() {

	const datos = join( tmp, 'datos' );
	mkdirSync( datos );
	pg( 'pg_dump', [ '--data-only', '--no-owner', '--no-privileges', '--table=public.*', '--file=/w/datos.sql' ], con, datos );
	for ( const [ archivo ] of TABLAS_AUTH ) {

		pg( 'psql', [ '-X', '-v', 'ON_ERROR_STOP=1', '-c', `\\copy (select * from copias.${ archivo }) to '/w/${ archivo }.csv' csv header` ], con, datos );

	}

	const objetos = JSON.parse( consulta( `select coalesce(json_agg(json_build_object('almacen', bucket_id, 'nombre', name,
		'tamano', (metadata->>'size')::bigint, 'tipo', metadata->>'mimetype') order by bucket_id, name), '[]')
		from storage.objects where bucket_id in (${ ALMACENES.map( ( a ) => `'${ a }'` ).join( ',' ) })`, con, datos ) );
	writeFileSync( join( datos, 'objetos.json' ), JSON.stringify( objetos, null, '\t' ) );

	const filas = JSON.parse( consulta( `select coalesce(json_object_agg(t.table_name,
		(xpath('/row/n/text()', query_to_xml(format('select count(*) as n from public.%I', t.table_name), false, true, '')))[1]::text::bigint
		order by t.table_name), '{}') from information_schema.tables t
		where t.table_schema = 'public' and t.table_type = 'BASE TABLE'`, con, datos ) );
	for ( const [ archivo ] of TABLAS_AUTH ) filas[ `auth:${ archivo }` ] = Number( consulta( `select count(*) from copias.${ archivo }`, con, datos ) );
	const resumen = { fecha, creada: new Date().toISOString(), filas, archivos: objetos.length };
	writeFileSync( join( datos, 'resumen.json' ), JSON.stringify( resumen, null, '\t' ) );

	const paquete = execFileSync( 'tar', [ '-czf', '-', '-C', datos, '.' ], { maxBuffer: 1 << 30 } );
	const carpeta = join( DESTINO, 'base-de-datos' );
	mkdirSync( carpeta, { recursive: true } );
	writeFileSync( join( carpeta, `${ fecha }.tar.gz.gpg` ), cifrar( paquete, COPIAS_CIFRADO, tmp ) );

	// Se conservan las de los últimos 31 días y la del día 1 de cada mes durante un año.
	const ahora = Date.parse( `${ fecha }T00:00:00Z` );
	for ( const f of readdirSync( carpeta ) ) {

		const m = /^(\d{4}-\d{2}-(\d{2}))\.tar\.gz\.gpg$/.exec( f );
		if ( ! m ) continue;
		const dias = ( ahora - Date.parse( `${ m[ 1 ] }T00:00:00Z` ) ) / 86_400_000;
		if ( dias > 31 && ! ( m[ 2 ] === '01' && dias <= 366 ) ) rmSync( join( carpeta, f ) );

	}

	detalle.filas = Object.values( filas ).reduce( ( a, b ) => a + b, 0 );
	detalle.usuarios = filas[ 'auth:usuarios' ];
	detalle.tamano = paquete.length;
	return objetos;

}

// ─── 2. Archivos ────────────────────────────────────────────────────────────

async function copiarArchivos( objetos, token ) {

	const rutaIndice = join( DESTINO, 'archivos', 'indice.json' );
	const indice = existsSync( rutaIndice ) ? JSON.parse( readFileSync( rutaIndice, 'utf8' ) ) : {};
	const vivos = new Set();
	let nuevos = 0;
	for ( const o of objetos ) {

		const clave = `${ o.almacen }/${ o.nombre }`;
		vivos.add( clave );
		const ruta = rutaSegura( o.almacen, o.nombre );
		if ( indice[ clave ] && existsSync( join( DESTINO, ruta ) ) ) {

			delete indice[ clave ].desaparecido;
			continue;

		}
		const r = await api( `/storage/v1/object/authenticated/${ o.almacen }/${ codificar( o.nombre ) }`, {}, token );
		const contenido = Buffer.from( await r.arrayBuffer() );
		mkdirSync( dirname( join( DESTINO, ruta ) ), { recursive: true } );
		writeFileSync( join( DESTINO, ruta ), cifrar( contenido, COPIAS_CIFRADO, tmp ) );
		indice[ clave ] = { tamano: contenido.length, sha256: sha256( contenido ), copiado: fecha };
		nuevos ++;

	}

	// Borrados en Supabase: se conservan 30 días más.
	const ahora = Date.parse( `${ fecha }T00:00:00Z` );
	for ( const [ clave, e ] of Object.entries( indice ) ) {

		if ( vivos.has( clave ) ) continue;
		e.desaparecido ??= fecha;
		if ( ( ahora - Date.parse( `${ e.desaparecido }T00:00:00Z` ) ) / 86_400_000 > 30 ) {

			const [ almacen, ...resto ] = clave.split( '/' );
			rmSync( join( DESTINO, rutaSegura( almacen, resto.join( '/' ) ) ), { force: true } );
			delete indice[ clave ];

		}

	}

	mkdirSync( dirname( rutaIndice ), { recursive: true } );
	writeFileSync( rutaIndice, JSON.stringify( Object.fromEntries( Object.entries( indice ).sort() ), null, '\t' ) + '\n' );
	detalle.archivos_nuevos = nuevos;
	detalle.archivos = Object.keys( indice ).length;

}

function tamanoAlmacen() {

	let total = 0;
	const recorrer = ( d ) => {

		for ( const f of readdirSync( d ) ) {

			if ( f === '.git' ) continue;
			const p = join( d, f );
			const s = statSync( p );
			if ( s.isDirectory() ) recorrer( p );
			else total += s.size;

		}

	};
	recorrer( DESTINO );
	return total;

}

// ─── Todo ───────────────────────────────────────────────────────────────────
// El resultado queda en DETALLE (si se indica) para registrar.mjs, que lo
// apunta en Supabase cuando la copia ya está guardada en GitHub.

try {

	const token = await entrar();
	const objetos = copiarBaseDeDatos();
	await copiarArchivos( objetos, token );
	detalle.almacen = tamanoAlmacen();
	console.log( `Copia del ${ fecha } hecha: ${ detalle.filas } filas, ${ detalle.usuarios } usuarios, ${ detalle.archivos } archivos (${ detalle.archivos_nuevos } nuevos).` );

} catch ( e ) {

	detalle.error = String( e.message ).slice( 0, 300 );
	console.error( `La copia ha fallado: ${ detalle.error }` );
	process.exitCode = 1;

} finally {

	if ( process.env.DETALLE ) writeFileSync( process.env.DETALLE, JSON.stringify( detalle ) );

}
