// Copia de seguridad de MUNE (receta 18). La lanza cada noche copias.yml.
//
// Guarda en el almacén privado MUNE-Projects/copias, como releases en borrador
// (github.mjs: fuera del historial de git, así que al borrarlas desaparecen
// de verdad), todo cifrado con la contraseña de las copias (COPIAS_CIFRADO):
//  · bd-AAAA-MM-DD-HHMMSS: los datos de MUNE (datos.sql), los usuarios con su
//    contraseña cifrada y su código del móvil (CSV), la lista de archivos y un
//    resumen con cuántas filas tiene cada tabla (datos.tar.gz.gpg), más el
//    índice de archivos con la huella (sha256) de cada uno (indice.json.gpg).
//    Se conservan las de los últimos 31 días;
//  · archivos-AAAA-MM-DD-HHMMSS: cada archivo nuevo, una sola vez (en MUNE no
//    se modifican), en un paquete por noche (archivos.tar.gpg). Si un archivo
//    se borra en Supabase, 31 días después su paquete se rehace sin él (y se
//    borra, si se queda vacío).
// Así, lo que se borra en MUNE desaparece de las copias en 31 días.
//
// Variables:
//   SUPABASE_POOLER       dirección «Session pooler» de Supabase (Connect), tal cual
//   COPIAS_BD_CLAVE       contraseña del usuario «copias» de la base de datos
//   SUPABASE_URL, CLAVE_PUBLICA
//   COPIAS_CUENTA, COPIAS_CUENTA_CLAVE   cuenta «copias» de MUNE (ve archivos)
//   COPIAS_CIFRADO        contraseña con la que se cifra todo
//   COPIAS_REPO, COPIAS_TOKEN   almacén de copias y llave B
//   DETALLE               (opcional) archivo donde dejar el resultado, para registrar.mjs
// Uso: node supabase/copias/copiar.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ALMACENES, TABLAS_AUTH, carpetaTemporal, cifrar, codificar, conexion, consulta, descifrar, falta, hoy, pg, rutaSegura, sha256 } from './comun.mjs';
import { DIAS, almacenCopias, diasEntre, fechaDe } from './github.mjs';

falta( 'SUPABASE_POOLER', 'COPIAS_BD_CLAVE', 'SUPABASE_URL', 'CLAVE_PUBLICA', 'COPIAS_CUENTA', 'COPIAS_CUENTA_CLAVE', 'COPIAS_CIFRADO', 'COPIAS_REPO', 'COPIAS_TOKEN' );
const { SUPABASE_URL, CLAVE_PUBLICA, COPIAS_CUENTA, COPIAS_CUENTA_CLAVE, COPIAS_CIFRADO } = process.env;
if ( COPIAS_CIFRADO.length < 16 ) throw new Error( 'La contraseña de cifrado tiene que tener al menos 16 caracteres' );

// La dirección del pooler trae el usuario «postgres.<proyecto>»: se usa «copias.<proyecto>».
const url = new URL( process.env.SUPABASE_POOLER.trim().replace( '[YOUR-PASSWORD]', 'x' ) );
url.username = decodeURIComponent( url.username ).replace( /^postgres(?=\.|$)/, 'copias' );
url.password = encodeURIComponent( process.env.COPIAS_BD_CLAVE );
const con = conexion( url.href );
const tmp = carpetaTemporal();
const fecha = hoy();
const hora = new Date().toISOString().slice( 11, 19 ).replaceAll( ':', '' );
const detalle = { fecha };
const almacen = almacenCopias( process.env.COPIAS_REPO, process.env.COPIAS_TOKEN );

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
	detalle.filas = Object.values( filas ).reduce( ( a, b ) => a + b, 0 );
	detalle.usuarios = filas[ 'auth:usuarios' ];
	detalle.tamano = paquete.length;
	return { objetos, paquete: cifrar( paquete, COPIAS_CIFRADO, tmp ) };

}

// ─── 2. Archivos ────────────────────────────────────────────────────────────
// El índice dice, de cada archivo, su huella, cuándo se copió, en qué paquete
// está y, si ya no está en Supabase, desde cuándo.

let n = 0;
const tar = ( carpeta ) => execFileSync( 'tar', [ '-cf', '-', '-C', carpeta, '.' ], { maxBuffer: 1 << 30 } );

/** Rehace un paquete (cifrado) solo con los archivos que siguen en el índice. Devuelve
 * el paquete nuevo sin cifrar, o null si no queda ninguno. */
function rehacer( contenido, sigue ) {

	const dentro = join( tmp, `rehacer-${ ++ n }` );
	mkdirSync( dentro );
	execFileSync( 'tar', [ '-xf', '-', '-C', dentro ], { input: descifrar( contenido, COPIAS_CIFRADO, tmp ) } );
	const queda = join( tmp, `queda-${ n }` );
	let cuantos = 0;
	const recorrer = ( d ) => {

		for ( const f of readdirSync( d, { withFileTypes: true } ) ) {

			const p = join( d, f.name );
			if ( f.isDirectory() ) {

				recorrer( p );
				continue;

			}
			// archivos/<almacén>/<nombre>.gpg → <almacén>/<nombre>
			const clave = relative( join( dentro, 'archivos' ), p ).replace( /\.gpg$/, '' );
			if ( ! sigue( clave ) ) continue;
			mkdirSync( dirname( join( queda, relative( dentro, p ) ) ), { recursive: true } );
			writeFileSync( join( queda, relative( dentro, p ) ), readFileSync( p ) );
			cuantos ++;

		}

	};
	recorrer( dentro );
	return cuantos ? tar( queda ) : null;

}

async function copiarArchivos( objetos, token, copias ) {

	const nombres = new Set( copias.map( ( c ) => c.name ) );
	const ultima = copias.filter( ( c ) => c.name.startsWith( 'bd-' ) && c.assets.some( ( a ) => a.name === 'indice.json.gpg' ) ).at( -1 );
	const indice = ultima ? JSON.parse( descifrar( await almacen.bajar( ultima, 'indice.json.gpg' ), COPIAS_CIFRADO, tmp ) ) : {};
	const nuevo = `archivos-${ fecha }-${ hora }`;
	const nuevos = join( tmp, 'nuevos' );
	mkdirSync( nuevos );
	const vivos = new Set();
	for ( const o of objetos ) {

		const clave = `${ o.almacen }/${ o.nombre }`;
		vivos.add( clave );
		const ruta = rutaSegura( o.almacen, o.nombre );
		if ( indice[ clave ] && nombres.has( indice[ clave ].paquete ) ) {

			delete indice[ clave ].desaparecido;
			continue;

		}
		const r = await api( `/storage/v1/object/authenticated/${ o.almacen }/${ codificar( o.nombre ) }`, {}, token );
		const contenido = Buffer.from( await r.arrayBuffer() );
		mkdirSync( dirname( join( nuevos, ruta ) ), { recursive: true } );
		writeFileSync( join( nuevos, ruta ), cifrar( contenido, COPIAS_CIFRADO, tmp ) );
		indice[ clave ] = { tamano: contenido.length, sha256: sha256( contenido ), copiado: fecha, paquete: nuevo };

	}
	const recienCopiados = Object.values( indice ).filter( ( e ) => e.paquete === nuevo ).length;

	// Borrados en Supabase: el archivo sigue en su paquete 31 días más (lo que
	// tarda en caducar la última copia de la base de datos que lo tenía); en el
	// índice queda solo una huella del nombre, para no guardarlo. Después, su
	// paquete se rehace sin él.
	const aRehacer = new Set();
	for ( const [ clave, e ] of Object.entries( indice ) ) {

		if ( vivos.has( clave ) ) continue;
		if ( ! clave.startsWith( 'borrado:' ) ) {

			delete indice[ clave ];
			indice[ `borrado:${ sha256( clave ) }` ] = { paquete: e.paquete, desaparecido: fecha };
			continue;

		}
		if ( diasEntre( e.desaparecido, fecha ) >= DIAS ) {

			aRehacer.add( e.paquete );
			delete indice[ clave ];

		}

	}

	// Primero se crea todo lo nuevo; lo antiguo se borra al final, cuando la
	// copia de la base de datos (con el índice nuevo) ya está guardada.
	if ( recienCopiados ) {

		const release = await almacen.crear( nuevo, `Archivos nuevos del ${ fecha } (cifrados).` );
		await almacen.subir( release, 'archivos.tar.gpg', cifrar( tar( nuevos ), COPIAS_CIFRADO, tmp ) );

	}
	for ( const viejo of aRehacer ) {

		const release = copias.find( ( c ) => c.name === viejo );
		// Lo que sigue en ese paquete: los archivos vivos y los borrados hace menos de 31 días.
		const suyos = Object.keys( indice ).filter( ( k ) => indice[ k ].paquete === viejo );
		if ( ! release || ! suyos.length ) continue;
		const sigue = ( clave ) => suyos.includes( clave ) || suyos.includes( `borrado:${ sha256( clave ) }` );
		const paquete = rehacer( await almacen.bajar( release, 'archivos.tar.gpg' ), sigue );
		if ( ! paquete ) continue;
		// mismo día que el paquete original (para saber de cuándo es) y nombre único
		let rehecho = `archivos-${ fechaDe( viejo ) }-${ hora }`;
		for ( let i = 1; nombres.has( rehecho ); i ++ ) rehecho = `archivos-${ fechaDe( viejo ) }-${ String( ( Number( hora ) + i ) % 1e6 ).padStart( 6, '0' ) }`;
		nombres.add( rehecho );
		const destino = await almacen.crear( rehecho, `Archivos del ${ fechaDe( viejo ) } (cifrados), sin los borrados en MUNE hace ${ DIAS } días o más.` );
		await almacen.subir( destino, 'archivos.tar.gpg', cifrar( paquete, COPIAS_CIFRADO, tmp ) );
		for ( const k of suyos ) indice[ k ].paquete = rehecho;

	}

	detalle.archivos_nuevos = recienCopiados;
	detalle.archivos = Object.keys( indice ).filter( ( k ) => ! k.startsWith( 'borrado:' ) ).length;
	return Object.fromEntries( Object.entries( indice ).sort() );

}

// ─── 3. Guardar y retirar lo caducado ───────────────────────────────────────

async function guardar( paqueteBd, indice, copias ) {

	const release = await almacen.crear( `bd-${ fecha }-${ hora }`, `Base de datos y usuarios de MUNE del ${ fecha } (cifrados).` );
	await almacen.subir( release, 'datos.tar.gz.gpg', paqueteBd );
	await almacen.subir( release, 'indice.json.gpg', cifrar( Buffer.from( JSON.stringify( indice, null, '\t' ) ), COPIAS_CIFRADO, tmp ) );

	// Se borran: las copias de la base de datos de hace más de 31 días (y las
	// anteriores de hoy, si se ha lanzado otra vez) y los paquetes de archivos
	// que ya no usa ningún archivo del índice.
	const enUso = new Set( Object.values( indice ).map( ( e ) => e.paquete ) );
	let retiradas = 0;
	for ( const c of copias ) {

		const dia = fechaDe( c.name );
		if ( ! dia ) continue;
		const caduca = c.name.startsWith( 'bd-' ) ? diasEntre( dia, fecha ) > DIAS || dia === fecha : ! enUso.has( c.name );
		if ( caduca ) {

			await almacen.borrar( c );
			retiradas ++;

		}

	}
	detalle.retiradas = retiradas;
	detalle.almacen = ( await almacen.lista() ).flatMap( ( c ) => c.assets ).reduce( ( t, a ) => t + a.size, 0 );

}

// ─── Todo ───────────────────────────────────────────────────────────────────
// El resultado queda en DETALLE (si se indica) para registrar.mjs, que lo
// apunta en Supabase cuando la copia ya está guardada en GitHub.

try {

	const token = await entrar();
	const copias = await almacen.lista();
	const { objetos, paquete } = copiarBaseDeDatos();
	const indice = await copiarArchivos( objetos, token, copias );
	await guardar( paquete, indice, copias );
	console.log( `Copia del ${ fecha } hecha: ${ detalle.filas } filas, ${ detalle.usuarios } usuarios, ${ detalle.archivos } archivos (${ detalle.archivos_nuevos } nuevos).` );

} catch ( e ) {

	detalle.error = String( e.message ).slice( 0, 300 );
	console.error( `La copia ha fallado: ${ detalle.error }` );
	process.exitCode = 1;

} finally {

	if ( process.env.DETALLE ) writeFileSync( process.env.DETALLE, JSON.stringify( detalle ) );

}
