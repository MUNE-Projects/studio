#!/usr/bin/env node
// Peticiones de cambios del Panel, vistas por el robot de Claude.
//
//   node herramientas/peticiones.mjs listar [--todas]
//   node herramientas/peticiones.mjs fotos  <id>   (descarga las fotos de referencia, sin metadatos, a salida/referencias/<id>/)
//   node herramientas/peticiones.mjs estado <id> <pendiente|en_curso|lista|descartada> [--nota "Texto"] [--enlace https://…]
//
// Credenciales: variables de entorno ROBOT_EMAIL y ROBOT_CLAVE, guardadas en la
// configuración privada del entorno de Claude. Nunca en el código, en GitHub ni
// en el chat, y este script nunca las imprime.
//
// El robot es un usuario normal de Supabase (sin clave maestra). Sus permisos
// los fijan las reglas de supabase/003_peticiones.sql: leer peticiones y
// promociones, cambiar estado/nota/enlace de una petición y anotar en el
// registro. No puede borrar, crear peticiones, publicar ni cambiar reglas.
// Las fotos no las descarga directamente: se las entrega la función de Supabase
// «archivo-robot» sin metadatos (GPS, autor, dispositivo…), antes de que salgan
// hacia Claude (041_archivos_robot.sql, decisión 66).

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SALIDA = resolve( dirname( fileURLToPath( import.meta.url ) ), '..', 'salida', 'referencias' );
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = process.env.SUPABASE_CLAVE_PUBLICA ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const ARCHIVO_ROBOT = process.env.ARCHIVO_ROBOT_URL ?? `${ SUPABASE_URL }/functions/v1/archivo-robot`;
const ESTADOS = [ 'pendiente', 'en_curso', 'lista', 'descartada' ];

const args = process.argv.slice( 2 );
const opcion = ( nombre ) => {

	const i = args.indexOf( `--${ nombre }` );
	return i >= 0 ? args[ i + 1 ] : undefined;

};
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--nota', '--enlace' ].includes( args[ i - 1 ] ) );

function fallo( texto ) {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

}

async function pedir( ruta, { metodo = 'GET', token, cuerpo, prefer } = {} ) {

	const r = await fetch( `${ SUPABASE_URL }${ ruta }`, {
		method: metodo,
		headers: {
			apikey: SUPABASE_CLAVE_PUBLICA,
			'Content-Type': 'application/json',
			...( token ? { Authorization: `Bearer ${ token }` } : {} ),
			...( prefer ? { Prefer: prefer } : {} ),
		},
		body: cuerpo ? JSON.stringify( cuerpo ) : undefined,
	} );
	const texto = await r.text();
	if ( ! r.ok ) fallo( `Supabase respondió ${ r.status } en ${ ruta.split( '?' )[ 0 ] }: ${ texto.slice( 0, 300 ) }` );
	return texto ? JSON.parse( texto ) : null;

}

async function entrar() {

	const email = process.env.ROBOT_EMAIL;
	const password = process.env.ROBOT_CLAVE;
	if ( ! email || ! password ) fallo( 'Faltan ROBOT_EMAIL y ROBOT_CLAVE en las variables del entorno de Claude.' );
	const sesion = await pedir( '/auth/v1/token?grant_type=password', { metodo: 'POST', cuerpo: { email, password } } );
	return sesion.access_token;

}

// función «archivo-robot»: la lista de fotos o una foto sin metadatos
const archivoRobot = ( token, orden ) => fetch( ARCHIVO_ROBOT, {
	method: 'POST',
	headers: { apikey: SUPABASE_CLAVE_PUBLICA, Authorization: `Bearer ${ token }`, 'Content-Type': 'application/json' },
	body: JSON.stringify( orden ),
} );

async function listarFotos( token, id ) {

	const r = await archivoRobot( token, { accion: 'fotos', peticion: String( id ) } );
	if ( ! r.ok ) fallo( `No se ha podido leer la lista de fotos (${ r.status })` );
	return ( await r.json() ).fotos;

}

async function descargarFotos( token, id ) {

	if ( ! /^\d+$/.test( id ?? '' ) ) fallo( 'Indica el número de la petición, por ejemplo: 3' );
	const archivos = await listarFotos( token, id );
	if ( ! archivos.length ) return console.log( `La petición #${ id } no tiene fotos de referencia.` );
	const carpeta = join( SALIDA, String( id ) );
	mkdirSync( carpeta, { recursive: true } );
	for ( const a of archivos ) {

		const r = await archivoRobot( token, { accion: 'archivo', almacen: 'referencias', ruta: a.ruta } );
		if ( ! r.ok ) fallo( `No se pudo descargar ${ a.nombre } (${ r.status })` );
		const quitado = JSON.parse( decodeURIComponent( r.headers.get( 'x-limpieza' ) ?? '%5B%5D' ) );
		writeFileSync( join( carpeta, a.nombre ), Buffer.from( await r.arrayBuffer() ) );
		console.log( `✓ ${ join( 'salida', 'referencias', String( id ), a.nombre ) }${ quitado.length ? ` (sin: ${ quitado.join( '; ' ) })` : '' }` );

	}
	await anotar( token, 'robot descarga fotos de referencia', { peticion: Number( id ) } );

}

const anotar = ( token, accion, detalle ) => pedir( '/rest/v1/registro', { metodo: 'POST', token, cuerpo: { accion, detalle }, prefer: 'return=minimal' } );

async function listar( token ) {

	const filtro = args.includes( '--todas' ) ? '' : '&estado=in.(pendiente,en_curso)';
	const lista = await pedir( `/rest/v1/peticiones?select=id,promocion_id,version,texto,estado,nota,enlace,creada_en&order=creada_en.asc${ filtro }`, { token } );
	if ( ! lista.length ) return console.log( 'No hay peticiones pendientes.' );
	for ( const p of lista ) {

		console.log( `\n#${ p.id } · ${ p.promocion_id }${ p.version ? ` (${ p.version })` : '' } · ${ p.estado } · ${ p.creada_en.slice( 0, 16 ).replace( 'T', ' ' ) }` );
		console.log( `  ${ p.texto.replace( /\n/g, '\n  ' ) }` );
		if ( p.nota ) console.log( `  nota: ${ p.nota }` );
		if ( p.enlace ) console.log( `  enlace: ${ p.enlace }` );
		const fotos = ( await listarFotos( token, p.id ) ).filter( ( a ) => a.name && a.id );
		if ( fotos.length ) console.log( `  fotos de referencia: ${ fotos.length } (node herramientas/peticiones.mjs fotos ${ p.id })` );

	}

}

async function cambiarEstado( token, id, estado ) {

	if ( ! /^\d+$/.test( id ?? '' ) ) fallo( 'Indica el número de la petición, por ejemplo: 3' );
	if ( ! ESTADOS.includes( estado ) ) fallo( `Estado no válido. Usa: ${ ESTADOS.join( ' | ' ) }` );
	const enlace = opcion( 'enlace' );
	if ( enlace && ! /^https:\/\/\S{1,500}$/.test( enlace ) ) fallo( 'El enlace debe empezar por https://' );
	const cambios = { estado, ...( opcion( 'nota' ) ? { nota: opcion( 'nota' ) } : {} ), ...( enlace ? { enlace } : {} ) };
	const filas = await pedir( `/rest/v1/peticiones?id=eq.${ id }`, { metodo: 'PATCH', token, cuerpo: cambios, prefer: 'return=representation' } );
	if ( ! filas?.length ) fallo( `No existe la petición #${ id } (o el robot no tiene permiso)` );
	await anotar( token, 'robot actualiza una petición', { peticion: Number( id ), estado } );
	console.log( `✓ Petición #${ id } → ${ estado }` );

}

const [ orden, id, estado ] = posicionales;
const token = await entrar();
switch ( orden ) {

	case 'listar': await listar( token ); break;
	case 'estado': await cambiarEstado( token, id, estado ); break;
	case 'fotos': await descargarFotos( token, id ); break;
	default: fallo( 'Orden desconocida. Usa: listar | fotos | estado' );

}
