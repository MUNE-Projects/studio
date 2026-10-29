#!/usr/bin/env node
// Documentación de las promotoras, vista por el robot de Claude (recetas 2 y 13).
//
//   node herramientas/documentos.mjs novedades [--desde AAAA-MM-DD]   (receta 13: qué ha pasado; por defecto, últimos 7 días)
//   node herramientas/documentos.mjs pendientes [promoción]           (documentos por revisar)
//   node herramientas/documentos.mjs bajar <id>                       (descarga a salida/documentos/ y comprueba la huella)
//   node herramientas/documentos.mjs estado <id> vigente|rechazado [--nota "Texto"]
//   node herramientas/documentos.mjs comentarios <promoción>          (comentarios visuales abiertos, 038)
//
// Receta 2 («revisa lo nuevo de X»): pendientes → bajar cada uno → leerlo y
// comprobarlo → proponer a la administradora qué marcar como vigente y qué
// rechazar (con la nota para la promotora) → con su OK, estado.
//
// Credenciales: variables de entorno ROBOT_EMAIL y ROBOT_CLAVE (configuración
// privada del entorno de Claude). Nunca en el código, en GitHub ni en el chat.
// Permisos del robot (005_portal.sql): leer requisitos, documentos y
// entregables, y cambiar solo el estado y la nota de un documento. Cada cambio
// de estado queda en el registro de actividad automáticamente.

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SALIDA = resolve( dirname( fileURLToPath( import.meta.url ) ), '..', 'salida', 'documentos' );
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = process.env.SUPABASE_CLAVE_PUBLICA ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';

const args = process.argv.slice( 2 );
const opcion = ( nombre ) => {

	const i = args.indexOf( `--${ nombre }` );
	return i >= 0 ? args[ i + 1 ] : undefined;

};
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--nota', '--desde' ].includes( args[ i - 1 ] ) );

function fallo( texto ) {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

}

async function pedir( ruta, { metodo = 'GET', token, cuerpo, prefer, crudo = false } = {} ) {

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
	if ( crudo ) {

		if ( ! r.ok ) fallo( `Supabase respondió ${ r.status } en ${ ruta.split( '?' )[ 0 ] }` );
		return Buffer.from( await r.arrayBuffer() );

	}
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

const anotar = ( token, accion, detalle ) => pedir( '/rest/v1/registro', { metodo: 'POST', token, cuerpo: { accion, detalle }, prefer: 'return=minimal' } );
const fecha = ( iso ) => iso.slice( 0, 16 ).replace( 'T', ' ' );
const tamano = ( b ) => b >= 1048576 ? `${ ( b / 1048576 ).toFixed( 1 ) } MB` : `${ Math.max( 1, Math.round( b / 1024 ) ) } KB`;
const CAMPOS = 'id,promocion_id,version,nombre,tamano,estado,nota,subido_en,revisado_en,huella,ruta,requisitos!documentos_requisito_id_fkey(bloque,elemento),documento_cubre(requisitos(elemento))';
// (documento_cubre, 022: los otros documentos de la lista que incluye el mismo archivo)
const incluye = ( d ) => ( d.documento_cubre ?? [] ).map( ( c ) => c.requisitos?.elemento ).filter( Boolean );

async function pendientes( token, promocion ) {

	if ( promocion && ! /^[a-z0-9-]{1,60}$/.test( promocion ) ) fallo( 'Identificador de promoción no válido' );
	const filtro = promocion ? `&promocion_id=eq.${ promocion }` : '';
	const docs = await pedir( `/rest/v1/documentos?select=${ CAMPOS }&estado=eq.pendiente&order=promocion_id,subido_en${ filtro }`, { token } );
	if ( ! docs.length ) return console.log( promocion ? `No hay documentos por revisar en ${ promocion }.` : 'No hay documentos por revisar.' );
	let actual = '';
	for ( const d of docs ) {

		if ( d.promocion_id !== actual ) console.log( `\n■ ${ ( actual = d.promocion_id ) }` );
		console.log( `  #${ d.id } · ${ d.requisitos?.bloque } › ${ d.requisitos?.elemento } · v${ d.version } · ${ d.nombre } (${ tamano( d.tamano ) }) · ${ fecha( d.subido_en ) }` );
		if ( incluye( d ).length ) console.log( `      también incluye: ${ incluye( d ).join( ', ' ) }` );

	}
	console.log( `\nPara descargar uno: node herramientas/documentos.mjs bajar <id>` );

}

async function bajar( token, id ) {

	if ( ! /^\d+$/.test( id ?? '' ) ) fallo( 'Indica el número del documento, por ejemplo: 12' );
	const [ d ] = await pedir( `/rest/v1/documentos?select=${ CAMPOS }&id=eq.${ id }`, { token } );
	if ( ! d ) fallo( `No existe el documento #${ id } (o el robot no tiene permiso)` );
	const contenido = await pedir( `/storage/v1/object/authenticated/documentos/${ d.ruta.split( '/' ).map( encodeURIComponent ).join( '/' ) }`, { token, crudo: true } );
	const huella = createHash( 'sha256' ).update( contenido ).digest( 'hex' );
	const carpeta = join( SALIDA, d.promocion_id );
	mkdirSync( carpeta, { recursive: true } );
	const destino = join( carpeta, `${ d.id }-v${ d.version }-${ d.nombre.replace( /[^\w.\- ]+/g, '_' ) }` );
	writeFileSync( destino, contenido );
	console.log( `✓ ${ destino.slice( destino.indexOf( 'salida' ) ) }` );
	console.log( `  ${ d.requisitos?.bloque } › ${ d.requisitos?.elemento } · v${ d.version } · ${ tamano( contenido.length ) }` );
	if ( incluye( d ).length ) console.log( `  También incluye: ${ incluye( d ).join( ', ' ) }` );
	console.log( huella === d.huella ? '  ✓ La huella coincide: es exactamente el archivo que subió la promotora.'
		: `  ✗ ¡La huella NO coincide! (registrada ${ d.huella.slice( 0, 12 ) }…, descargada ${ huella.slice( 0, 12 ) }…). Avisa a la administradora.` );
	await anotar( token, 'robot descarga un documento', { promocion: d.promocion_id, documento: d.id } );

}

async function cambiarEstado( token, id, estado ) {

	if ( ! /^\d+$/.test( id ?? '' ) ) fallo( 'Indica el número del documento, por ejemplo: 12' );
	if ( ! [ 'vigente', 'rechazado', 'pendiente' ].includes( estado ) ) fallo( 'Estado no válido. Usa: vigente | rechazado | pendiente' );
	const nota = opcion( 'nota' )?.trim();
	if ( estado === 'rechazado' && ( ! nota || nota.length < 5 ) ) fallo( 'Para rechazar hace falta --nota "…" explicando qué tiene que corregir la promotora.' );
	const filas = await pedir( `/rest/v1/documentos?id=eq.${ id }`, {
		metodo: 'PATCH', token, prefer: 'return=representation',
		cuerpo: { estado, nota: estado === 'vigente' ? null : nota ?? null },
	} );
	if ( ! filas?.length ) fallo( `No existe el documento #${ id } (o el robot no tiene permiso)` );
	console.log( `✓ Documento #${ id } → ${ estado }${ nota ? ` (nota: ${ nota })` : '' }` );
	if ( estado === 'rechazado' ) {

		// aviso por email al equipo de la promotora (función «avisar-promotora»)
		const r = await fetch( `${ SUPABASE_URL }/functions/v1/avisar-promotora`, {
			method: 'POST',
			headers: { apikey: SUPABASE_CLAVE_PUBLICA, Authorization: `Bearer ${ token }`, 'Content-Type': 'application/json' },
			body: JSON.stringify( { tipo: 'rechazado', documento_id: Number( id ) } ),
		} ).catch( () => null );
		const datos = r ? await r.json().catch( () => ( {} ) ) : {};
		console.log( r?.ok && datos.enviado ? `✓ Avisado por email a ${ datos.destinatarios } persona(s) de la promotora.`
			: `! Sin aviso por email: ${ datos.motivo ?? datos.error ?? 'no se ha podido contactar con Supabase' }.` );

	}

}

async function novedades( token ) {

	const desde = opcion( 'desde' ) ?? new Date( Date.now() - 7 * 86400000 ).toISOString().slice( 0, 10 );
	if ( ! /^\d{4}-\d{2}-\d{2}$/.test( desde ) ) fallo( 'La fecha va así: --desde 2026-10-01' );
	const [ subidos, revisados, validaciones, peticiones ] = await Promise.all( [
		pedir( `/rest/v1/documentos?select=${ CAMPOS }&subido_en=gte.${ desde }&order=subido_en`, { token } ),
		pedir( `/rest/v1/documentos?select=${ CAMPOS }&revisado_en=gte.${ desde }&order=revisado_en`, { token } ),
		pedir( `/rest/v1/validaciones?select=promocion_id,version,decision,comentario,momento,entregables(nombre,tipologia)&momento=gte.${ desde }&order=momento`, { token } ),
		pedir( `/rest/v1/peticiones?select=id,promocion_id,estado,texto,creada_en&estado=in.(pendiente,en_curso)&order=creada_en`, { token } ),
	] );
	console.log( `Novedades desde el ${ desde }\n` );
	console.log( `Documentos subidos: ${ subidos.length }` );
	for ( const d of subidos ) console.log( `  · ${ d.promocion_id } · ${ d.requisitos?.elemento } v${ d.version } (${ d.estado }) · ${ fecha( d.subido_en ) }` );
	console.log( `\nDocumentos revisados: ${ revisados.length }` );
	for ( const d of revisados ) console.log( `  · ${ d.promocion_id } · ${ d.requisitos?.elemento } v${ d.version } → ${ d.estado }${ d.nota ? ` («${ d.nota }»)` : '' }` );
	console.log( `\nPlanos validados por las promotoras: ${ validaciones.length }` );
	for ( const v of validaciones ) console.log( `  · ${ v.promocion_id } ${ v.version } · ${ v.entregables?.nombre } → ${ v.decision }${ v.comentario ? ` («${ v.comentario }»)` : '' }` );
	console.log( `\nPeticiones de cambios abiertas: ${ peticiones.length }` );
	for ( const p of peticiones ) console.log( `  · #${ p.id } ${ p.promocion_id } (${ p.estado }): ${ p.texto.slice( 0, 80 ) }` );
	const pend = await pedir( '/rest/v1/documentos?select=id&estado=eq.pendiente', { token } );
	console.log( `\nPor revisar ahora mismo: ${ pend.length } documento(s).` );

}

// Comentarios visuales abiertos de una promoción (038_comentarios.sql): lo que
// pide la promotora en los planos, en el 3D o en la versión, para tenerlo en
// cuenta al preparar la siguiente. El robot solo los lee: responde y resuelve
// la administradora en MUNE Studio.
async function comentarios( token, promocion ) {

	if ( ! /^[a-z0-9-]{1,60}$/.test( promocion ?? '' ) ) fallo( 'Indica la promoción, por ejemplo: residencial-demo' );
	const hilos = await pedir( '/rest/v1/rpc/comentarios_de', { metodo: 'POST', token, cuerpo: { p_promocion: promocion } } );
	const abiertos = hilos.filter( ( h ) => ! h.resuelto_en ).sort( ( x, y ) => x.creado_en.localeCompare( y.creado_en ) );
	if ( ! abiertos.length ) return console.log( `No hay comentarios abiertos en ${ promocion }.` );
	const lugar = ( h ) => h.tipo === 'version' ? 'toda la versión' : `${ h.tipo === 'plano' ? 'plano' : '3D' } ${ h.clave }`;
	const punto = ( h ) => ! h.punto ? 'general' : h.tipo === 'plano'
		? `punto (${ Math.round( h.punto.x * 100 ) } %, ${ Math.round( h.punto.y * 100 ) } %) de la imagen`
		: `punto [${ h.punto.p.join( ', ' ) }]${ h.punto.vista ? ` · vista ${ h.punto.vista }` : '' }${ h.punto.planta ? ` · planta ${ h.punto.planta }` : '' }`;
	for ( const h of abiertos ) {

		console.log( `\n#${ h.id } · ${ lugar( h ) } · ${ punto( h ) } · ${ h.version } · ${ h.autor } · ${ fecha( h.creado_en ) }\n  «${ h.texto }»` );
		for ( const r of h.respuestas ) console.log( `    ↳ ${ r.de_mune ? 'Equipo de MUNE' : r.autor }: «${ r.texto }»` );

	}
	console.log( `\n${ abiertos.length } abierto(s). Se responden y resuelven en MUNE Studio → Resumen y versiones.` );

}

const [ orden, a, b ] = posicionales;
const token = await entrar();
switch ( orden ) {

	case 'novedades': await novedades( token ); break;
	case 'pendientes': await pendientes( token, a ); break;
	case 'bajar': await bajar( token, a ); break;
	case 'estado': await cambiarEstado( token, a, b ); break;
	case 'comentarios': await comentarios( token, a ); break;
	default: fallo( 'Orden desconocida. Usa: novedades | pendientes | bajar | estado | comentarios' );

}
