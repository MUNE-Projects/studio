#!/usr/bin/env node
// Documentación de las promotoras, vista por el robot de Claude (recetas 2 y 13).
//
//   node herramientas/documentos.mjs novedades [--desde AAAA-MM-DD]   (receta 13: qué ha pasado; por defecto, últimos 7 días)
//   node herramientas/documentos.mjs pendientes [promoción]           (documentos por revisar)
//   node herramientas/documentos.mjs bajar <id>                       (descarga a salida/documentos/, sin metadatos, y comprueba la huella)
//   node herramientas/documentos.mjs opciones                         (opciones pedidas por las promotoras; baja sus adjuntos a salida/opciones/)
//   node herramientas/documentos.mjs estado <id> vigente|rechazado [--nota "Texto"]
//   node herramientas/documentos.mjs comentarios <promoción> [resolver <ids> --version vN]   (comentarios visuales enviados, 038)
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
// Los archivos no se descargan directamente: los entrega la función de Supabase
// «archivo-robot» sin metadatos (GPS, autor, programa, XMP…), antes de que
// salgan hacia Claude (042_archivos_robot.sql, decisión 67). Lo que se ve en el
// documento (un cajetín con nombres, una firma) llega igual.

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
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! [ '--nota', '--desde', '--version' ].includes( args[ i - 1 ] ) );

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

/** Un archivo de la documentación o de una opción, sin metadatos (función «archivo-robot»). */
async function archivoLimpio( token, almacen, ruta ) {

	const r = await fetch( process.env.ARCHIVO_ROBOT_URL ?? `${ SUPABASE_URL }/functions/v1/archivo-robot`, {
		method: 'POST',
		headers: { apikey: SUPABASE_CLAVE_PUBLICA, Authorization: `Bearer ${ token }`, 'Content-Type': 'application/json' },
		body: JSON.stringify( { accion: 'archivo', almacen, ruta } ),
	} );
	if ( ! r.ok ) {

		const texto = await r.text();
		let mensaje = texto;
		try {

			mensaje = JSON.parse( texto ).error ?? texto;

		} catch { /* texto tal cual */ }
		return { error: `${ r.status }: ${ String( mensaje ).slice( 0, 300 ) }` };

	}
	return {
		contenido: Buffer.from( await r.arrayBuffer() ),
		huellaOriginal: r.headers.get( 'x-huella-original' ),
		quitado: JSON.parse( decodeURIComponent( r.headers.get( 'x-limpieza' ) ?? '%5B%5D' ) ),
	};

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
	const archivo = await archivoLimpio( token, 'documentos', d.ruta );
	if ( archivo.error ) fallo( `No se ha podido bajar el documento #${ id } (${ archivo.error })` );
	const { contenido, huellaOriginal: huella, quitado } = archivo;
	const carpeta = join( SALIDA, d.promocion_id );
	mkdirSync( carpeta, { recursive: true } );
	const destino = join( carpeta, `${ d.id }-v${ d.version }-${ d.nombre.replace( /[^\w.\- ]+/g, '_' ) }` );
	writeFileSync( destino, contenido );
	console.log( `✓ ${ destino.slice( destino.indexOf( 'salida' ) ) }` );
	console.log( `  ${ d.requisitos?.bloque } › ${ d.requisitos?.elemento } · v${ d.version } · ${ tamano( contenido.length ) }` );
	if ( incluye( d ).length ) console.log( `  También incluye: ${ incluye( d ).join( ', ' ) }` );
	console.log( huella === d.huella ? '  ✓ La huella coincide: es el archivo que subió la promotora (sin metadatos).'
		: `  ✗ ¡La huella NO coincide! (registrada ${ d.huella.slice( 0, 12 ) }…, en el almacén ${ String( huella ).slice( 0, 12 ) }…). Avisa a la administradora.` );
	console.log( quitado.length ? `  Metadatos quitados: ${ quitado.join( '; ' ) }.` : '  No llevaba metadatos.' );
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

// Comentarios visuales de una promoción (038_comentarios.sql). Claude solo
// trabaja con lo ENVIADO: lo que la promotora ha mandado con «Pedir cambios» y
// las notas que la administradora ha devuelto a Claude. Lo pendiente de enviar
// (la promotora aún lo está escribiendo) se cuenta, pero no se toca.
//   comentarios <promoción>                                 lo enviado y sin resolver
//   comentarios <promoción> resolver <id,id,…> --version vN  al preparar vN, marca lo que arregla
// Solo marca resueltos en una versión que aún no se ha enviado a validar.
async function comentarios( token, promocion, accion ) {

	if ( ! /^[a-z0-9-]{1,60}$/.test( promocion ?? '' ) ) fallo( 'Indica la promoción, por ejemplo: residencial-demo' );
	if ( accion === 'resolver' ) {

		const ids = ( posicionales[ 3 ] ?? '' ).split( ',' ).map( Number ).filter( ( n ) => Number.isInteger( n ) && n > 0 );
		const version = opcion( 'version' );
		if ( ! ids.length || ! /^v\d+$/.test( version ?? '' ) ) fallo( 'Uso: comentarios <promoción> resolver 12,15 --version v18' );
		const n = await pedir( '/rest/v1/rpc/resolver_comentarios', { metodo: 'POST', token, cuerpo: { p_promocion: promocion, p_version: version, p_comentarios: ids } } );
		return console.log( `✓ ${ n } comentario(s) marcados como resueltos en la ${ version }.` );

	}
	const hilos = await pedir( '/rest/v1/rpc/comentarios_de', { metodo: 'POST', token, cuerpo: { p_promocion: promocion } } );
	const abiertos = hilos.filter( ( h ) => ! h.resuelto_en ).sort( ( x, y ) => x.creado_en.localeCompare( y.creado_en ) );
	const enviados = abiertos.filter( ( h ) => h.enviado_en );
	const sinEnviar = abiertos.filter( ( h ) => ! h.enviado_en && ! h.interno ).length;
	const lugar = ( h ) => h.tipo === 'version' ? 'toda la versión' : h.tipo === 'personalizacion' ? `personalización${ h.clave ? ` ${ h.clave }` : '' }`
		: `${ h.tipo === 'plano' ? 'plano' : '3D' } ${ h.clave }`;
	const punto = ( h ) => ! h.punto ? 'general' : h.tipo === 'plano'
		? `punto (${ Math.round( h.punto.x * 100 ) } %, ${ Math.round( h.punto.y * 100 ) } %) de la imagen`
		: `punto [${ h.punto.p.join( ', ' ) }]${ h.punto.vista ? ` · vista ${ h.punto.vista }` : '' }${ h.punto.planta ? ` · planta ${ h.punto.planta }` : '' }`;
	if ( ! enviados.length ) console.log( `No hay comentarios enviados sin resolver en ${ promocion }.` );
	for ( const [ titulo, grupo ] of [ [ 'Notas de MUNE para Claude', enviados.filter( ( h ) => h.interno ) ], [ 'Cambios pedidos por la promotora', enviados.filter( ( h ) => ! h.interno ) ] ] ) {

		if ( ! grupo.length ) continue;
		console.log( `\n■ ${ titulo }` );
		for ( const h of grupo ) {

			console.log( `\n#${ h.id } · ${ lugar( h ) } · ${ punto( h ) } · ${ h.version } · ${ h.autor } · ${ fecha( h.creado_en ) }\n  «${ h.texto }»` );
			for ( const r of h.respuestas ) console.log( `    ↳ ${ r.de_mune ? 'Equipo de MUNE' : r.autor }: «${ r.texto }»` );

		}

	}
	if ( sinEnviar ) console.log( `\n(${ sinEnviar } comentario(s) de la promotora todavía sin enviar: no se tocan hasta que pida cambios.)` );
	if ( enviados.length ) console.log( `\nAl preparar la versión nueva: node herramientas/documentos.mjs comentarios ${ promocion } resolver <ids> --version vN` );

}

/** Opciones que han pedido las promotoras (029), con sus adjuntos sin metadatos en salida/opciones/. */
async function opciones( token ) {

	const lista = await pedir( '/rest/v1/rpc/opciones_pedidas_pendientes', { metodo: 'POST', token, cuerpo: {} } );
	if ( ! lista.length ) return console.log( 'No hay opciones pedidas por preparar.' );
	for ( const op of lista ) {

		console.log( `\n#${ op.id } · ${ op.promocion_id } · ${ op.categoria_nombre } › ${ op.nombre }${ op.precio != null ? ` · ${ op.precio } €` : '' }` );
		if ( op.descripcion ) console.log( `  «${ op.descripcion }»` );
		for ( const a of op.archivos ?? [] ) {

			const archivo = await archivoLimpio( token, 'documentos', a.ruta );
			if ( archivo.error ) {

				console.log( `  ✗ ${ a.nombre }: ${ archivo.error }` );
				continue;

			}
			const carpeta = join( SALIDA, '..', 'opciones', String( op.id ) );
			mkdirSync( carpeta, { recursive: true } );
			const destino = join( carpeta, ( a.nombre || a.ruta.split( '/' ).pop() ).replace( /[^\w.\- ]+/g, '_' ) );
			writeFileSync( destino, archivo.contenido );
			console.log( `  ✓ ${ destino.slice( destino.indexOf( 'salida' ) ) }${ archivo.quitado.length ? ` (sin: ${ archivo.quitado.join( '; ' ) })` : '' }` );

		}

	}

}

const [ orden, a, b ] = posicionales;
const token = await entrar();
switch ( orden ) {

	case 'novedades': await novedades( token ); break;
	case 'pendientes': await pendientes( token, a ); break;
	case 'bajar': await bajar( token, a ); break;
	case 'estado': await cambiarEstado( token, a, b ); break;
	case 'comentarios': await comentarios( token, a, b ); break;
	case 'opciones': await opciones( token ); break;
	default: fallo( 'Orden desconocida. Usa: novedades | pendientes | bajar | estado | comentarios | opciones' );

}
