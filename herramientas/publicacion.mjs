#!/usr/bin/env node
// Publicación de promociones: construir, preparar una versión numerada para
// revisión, aprobarla (publicarla) y volver atrás.
//
// Es la lógica estable que hay debajo de las recetas 9 (preview), 10 (publicar) y
// 11 (volver a una versión anterior). «preparar» la ejecuta Claude; «aprobar» y
// «volver» las ejecuta el brazo ejecutor (GitHub Actions, .github/workflows/
// publicar.yml) cuando la administradora pulsa el botón del Panel. Las garantías
// son las mismas en todos los casos porque las comprueba este script.
//
//   node herramientas/publicacion.mjs construir <promoción>
//   node herramientas/publicacion.mjs preparar  <promoción> --cambios "Texto" [--preparado-por "Nombre"] [--confirmar]
//   node herramientas/publicacion.mjs aprobar   <promoción> --version vN --aprobado-por "Nombre" [--confirmar]
//   node herramientas/publicacion.mjs volver    <promoción> <vN> --motivo "Texto" [--aprobado-por "Nombre"] [--confirmar]
//   node herramientas/publicacion.mjs estado    <promoción>
//
// Flujo: «preparar» deja la versión en la rama «revision» del escaparate (vista
// previa, estado «en_revision»); «aprobar» la copia a «main» (producción, estado
// «publicada»). «volver» restaura en «main» una versión anterior.
//
// Opciones comunes: --escaparate <ruta> (por defecto ../experience, o ../escaparate si aún se llama así).
// Sin --confirmar, publicar y volver solo muestran lo que harían (no cambian nada).
//
// Reglas que garantiza:
//  - la web pública se construye SIN Studio y se comprueba que no lo contiene;
//  - ningún archivo con forma de secreto llega al escaparate;
//  - cada publicación es una versión numerada (v1, v2…) que fija el commit exacto
//    del taller (producto maestro + datos) con una etiqueta inmutable;
//  - nunca se borra una versión: volver atrás restaura una anterior y marca la
//    vigente como «retirada»;
//  - publicar exige el taller sin cambios pendientes (lo publicado = lo guardado);
//  - no se envía nada a GitHub: el envío (push) es un paso aparte y explícito.
//
// Datos privados (paso 5a, 024_datos_privados.sql): el catálogo con precios, los
// packs y las viviendas no van en la web pública. «preparar» los guarda en Supabase
// con el robot de Claude (ROBOT_EMAIL y ROBOT_CLAVE, obligatorias) y el comprador
// los recibe al entrar con su código.
//
// Textos legales: los escribe la promotora en MUNE Portal (promociones.textos_legales
// en Supabase). «preparar» los lee como el robot de Claude (variables ROBOT_EMAIL y
// ROBOT_CLAVE) y la construcción los pone en lugar de los de promocion.json
// (vite.config.ts, variable TEXTOS_LEGALES). Sin esas variables, avisa y sigue
// con los de promocion.json. La web pública no consulta Supabase.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generarPlanos } from './planos.mjs';

const RAIZ = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const SALIDA = join( RAIZ, 'salida' );
// en el escaparate, lo que Cloudflare sirve vive en publico/<promoción>/
const PUBLICO = 'publico';

// límites de Cloudflare (archivos estáticos)
const MAX_ARCHIVO = 25 * 1024 * 1024;
const MAX_ARCHIVOS = 20000;

// rastros del Studio que nunca deben aparecer en la web pública
const MARCAS_STUDIO = [ 'Interiorismo IA', 'st-ayuda', 'abrirStudio' ];

// formas típicas de credenciales (Supabase, GitHub, Cloudflare, AWS, claves privadas…)
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = process.env.SUPABASE_CLAVE_PUBLICA ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';

const SECRETOS = [
	/sb_secret_[A-Za-z0-9_-]{10,}/,
	/service_role/,
	/gh[pousr]_[A-Za-z0-9]{30,}/,
	/github_pat_[A-Za-z0-9_]{30,}/,
	/AKIA[0-9A-Z]{16}/,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----/,
	/SUPABASE_SERVICE/,
];

// ---------------------------------------------------------------- utilidades

const args = process.argv.slice( 2 );
const opcion = ( nombre ) => {

	const i = args.indexOf( `--${ nombre }` );
	return i >= 0 ? args[ i + 1 ] : undefined;

};
const bandera = ( nombre ) => args.includes( `--${ nombre }` );
const CON_VALOR = [ '--escaparate', '--aprobado-por', '--preparado-por', '--cambios', '--motivo', '--version' ];
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! CON_VALOR.includes( args[ i - 1 ] ) );

const fallo = ( texto ) => {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

};
const ok = ( texto ) => console.log( `✓ ${ texto }` );
const git = ( cwd, ...a ) => execFileSync( 'git', a, { cwd, encoding: 'utf8' } ).trim();
const hoy = () => new Date().toISOString().slice( 0, 19 ) + 'Z';

const leerJSON = ( ruta, defecto ) => ( existsSync( ruta ) ? JSON.parse( readFileSync( ruta, 'utf8' ) ) : defecto );
const escribirJSON = ( ruta, datos ) => writeFileSync( ruta, JSON.stringify( datos, null, 2 ) + '\n' );

function comprobarPromocion( id ) {

	if ( ! id ) fallo( 'Falta la promoción. Ejemplo: residencial-demo' );
	if ( ! /^[a-z0-9-]+$/.test( id ) ) fallo( `Identificador de promoción no válido: «${ id }»` );
	if ( ! existsSync( join( RAIZ, 'promociones', id, 'promocion.json' ) ) ) fallo( `No existe promociones/${ id }/promocion.json` );

}

const rutaRegistro = ( id ) => join( RAIZ, 'promociones', id, 'publicaciones.json' );
const leerRegistro = ( id ) => leerJSON( rutaRegistro( id ), { promocion: id, versiones: [] } );

function rutaEscaparate() {

	// el almacén «experience» (antes «escaparate»), junto al de MUNE Studio
	const ruta = resolve( opcion( 'escaparate' ) ?? [ 'experience', 'escaparate' ].map( ( n ) => join( RAIZ, '..', n ) ).find( ( r ) => existsSync( r ) ) ?? join( RAIZ, '..', 'experience' ) );
	if ( ! existsSync( join( ruta, '.git' ) ) ) fallo( `No encuentro el escaparate en ${ ruta } (usa --escaparate <ruta>)` );
	return ruta;

}

const ramaActual = ( cwd ) => git( cwd, 'rev-parse', '--abbrev-ref', 'HEAD' );

function exigirRama( esc, rama ) {

	const actual = ramaActual( esc );
	if ( actual !== rama ) fallo( `El escaparate debe estar en la rama «${ rama }» (está en «${ actual }»)` );

}

/** Versión de una promoción en una referencia del escaparate (null si no está). */
function versionEn( esc, ref, id ) {

	try {

		return JSON.parse( git( esc, 'show', `${ ref }:${ PUBLICO }/${ id }/version.json` ) ).version;

	} catch {

		return null;

	}

}

/** Commit del escaparate con la versión indicada: su etiqueta o, si no existe, buscándola en el historial. */
function commitDeVersion( esc, id, version ) {

	const etiqueta = `${ id }/${ version }`;
	if ( git( esc, 'tag', '--list', etiqueta ) ) return etiqueta;
	const commits = git( esc, 'log', '--all', '--format=%H', '--', `${ PUBLICO }/${ id }/version.json` ).split( '\n' ).filter( Boolean );
	return commits.find( ( c ) => versionEn( esc, c, id ) === version ) ?? null;

}

function listar( dir ) {

	return readdirSync( dir, { withFileTypes: true } ).flatMap( ( e ) => ( e.isDirectory() ? listar( join( dir, e.name ) ) : [ join( dir, e.name ) ] ) );

}

// ---------------------------------------------------------------- construir

function construir( id ) {

	comprobarPromocion( id );
	const destino = join( SALIDA, id );
	rmSync( destino, { recursive: true, force: true } );
	console.log( `Construyendo «${ id }» (web pública, sin Studio)…` );
	execFileSync( 'npx', [ 'tsc', '--noEmit' ], { cwd: RAIZ, stdio: 'inherit' } );
	execFileSync( 'npx', [ 'vite', 'build', '--logLevel', 'warn' ], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, PROMOCION: id, SALIDA: destino } } );
	ok( 'Comprobación de tipos y construcción' );

	const archivos = listar( destino );
	if ( ! existsSync( join( destino, 'index.html' ) ) ) fallo( 'La construcción no ha generado index.html' );
	if ( archivos.length > MAX_ARCHIVOS ) fallo( `Demasiados archivos (${ archivos.length } > ${ MAX_ARCHIVOS })` );
	let total = 0;
	for ( const a of archivos ) {

		const tam = statSync( a ).size;
		total += tam;
		if ( tam > MAX_ARCHIVO ) fallo( `Archivo demasiado grande para Cloudflare: ${ relative( destino, a ) } (${ ( tam / 1048576 ).toFixed( 1 ) } MB)` );
		if ( ! /\.(html|js|css|json|svg|txt)$/.test( a ) ) continue;
		const texto = readFileSync( a, 'utf8' );
		for ( const m of MARCAS_STUDIO ) if ( texto.includes( m ) ) fallo( `La web pública contiene código del Studio («${ m }» en ${ relative( destino, a ) })` );
		for ( const s of SECRETOS ) if ( s.test( texto ) ) fallo( `Posible secreto en ${ relative( destino, a ) } (${ s })` );

	}

	ok( `Sin Studio y sin secretos · ${ archivos.length } archivos · ${ ( total / 1048576 ).toFixed( 1 ) } MB` );

	return { destino, archivos: archivos.length, bytes: total };

}

// ---------------------------------------------------------------- publicar

// El Panel y el portal leen, desde otra dirección, los planos y la Experiencia 3D
// de cada versión: el escaparate tiene que permitirlo (en las dos ramas).
function asegurarCabeceras( esc ) {

	const cabeceras = join( esc, PUBLICO, '_headers' );
	let texto = existsSync( cabeceras ) ? readFileSync( cabeceras, 'utf8' ).trimEnd() : '';
	const reglas = [
		[ '/:promocion/planos/*', 'Planos comerciales de cada versión: el Panel los copia para enviarlos a la promotora.' ],
		[ '/:promocion/experiencia/*', 'Unidades de la Experiencia 3D de cada versión: el Panel y el portal las usan para validarla.' ],
	];
	let cambia = false;
	// Cloudflare solo admite un «*» por regla: las reglas antiguas con dos no se aplicaban.
	for ( const vieja of [ '/*/planos/*', '/*/experiencia/*' ] ) {

		const bloque = new RegExp( `\\n*# [^\\n]*\\n${ vieja.replace( /[*/]/g, '\\$&' ) }\\n(  [^\\n]*\\n?)*`, 'g' );
		if ( bloque.test( texto ) ) { texto = texto.replace( bloque, '\n' ).trimEnd(); cambia = true; }

	}
	for ( const [ ruta, motivo ] of reglas ) {

		if ( texto.includes( `\n${ ruta }\n` ) || texto.startsWith( `${ ruta }\n` ) ) continue;
		texto += `\n\n# ${ motivo }\n${ ruta }\n  Access-Control-Allow-Origin: *\n  Cache-Control: no-cache`;
		cambia = true;

	}
	if ( ! cambia ) return;
	writeFileSync( cabeceras, `${ texto.trimStart() }\n` );
	git( esc, 'add', join( PUBLICO, '_headers' ) );

}

// ---------------------------------------------------------------- textos legales (MUNE Portal)

const LEGALES = [ 'planos', 'renders', 'experiencia', 'personalizacion' ];

/** Sesión del robot de Claude en Supabase (ROBOT_EMAIL y ROBOT_CLAVE); null sin esas variables. */
async function entrarRobot() {

	const email = process.env.ROBOT_EMAIL;
	const password = process.env.ROBOT_CLAVE;
	if ( ! email || ! password ) return null;
	const r = await fetch( `${ SUPABASE_URL }/auth/v1/token?grant_type=password`, {
		method: 'POST', headers: { apikey: SUPABASE_CLAVE_PUBLICA, 'Content-Type': 'application/json' }, body: JSON.stringify( { email, password } ),
	} );
	if ( ! r.ok ) throw new Error( `la entrada del robot respondió ${ r.status }` );
	const { access_token: token } = await r.json();
	return { apikey: SUPABASE_CLAVE_PUBLICA, 'Content-Type': 'application/json', Authorization: `Bearer ${ token }` };

}

/** Textos legales que la promotora ha escrito en MUNE Portal; null si no se pueden leer. */
async function textosLegales( id ) {

	try {

		const cabeceras = await entrarRobot();
		if ( ! cabeceras ) {

			console.warn( '⚠ Sin ROBOT_EMAIL y ROBOT_CLAVE: no se leen los textos legales de MUNE Portal. Se usan los de promocion.json.' );
			return null;

		}
		const p = await fetch( `${ SUPABASE_URL }/rest/v1/promociones?id=eq.${ encodeURIComponent( id ) }&select=textos_legales`, { headers: cabeceras } );
		if ( ! p.ok ) throw new Error( `Supabase respondió ${ p.status } al leer la promoción` );
		const [ fila ] = await p.json();
		if ( ! fila ) throw new Error( 'la promoción no está en Supabase' );
		const textos = {};
		for ( const k of LEGALES ) {

			const t = fila.textos_legales?.[ k ];
			if ( typeof t === 'string' && t.trim() ) textos[ k ] = t.trim().slice( 0, 1000 );

		}
		return textos;

	} catch ( e ) {

		console.warn( `⚠ No se han podido leer los textos legales de MUNE Portal (${ e.message }). Se usan los de promocion.json.` );
		return null;

	}

}

// ---------------------------------------------------------------- datos privados (paso 5a, 024)

/**
 * Lo que no va en la web pública: catálogo con precios, packs, lo que admite
 * cada tipología y los datos de cada vivienda. Se guarda en Supabase con cada
 * versión; el comprador recibe lo suyo al entrar con su código.
 */
function datosPrivados( id ) {

	const leer = ( f ) => JSON.parse( readFileSync( join( RAIZ, 'promociones', id, f ), 'utf8' ) );
	const promocion = leer( 'promocion.json' );
	return {
		catalogo: leer( 'catalogo.json' ),
		packs: promocion.packs ?? [],
		tipologias: ( promocion.tipologias ?? [] ).map( ( t ) => ( { id: t.id, opciones: t.opciones ?? {} } ) ),
		// los códigos, lo seleccionado y el precio de venta nunca salen del taller
		viviendas: ( promocion.viviendas ?? [] ).map( ( { acceso, selecciones, precioBase, ...v } ) => v ),
	};

}

async function guardarDatosPrivados( id, version ) {

	const cabeceras = await entrarRobot();
	if ( ! cabeceras ) fallo( 'Faltan ROBOT_EMAIL y ROBOT_CLAVE: sin ellas no se pueden guardar los datos privados de la versión (catálogo, packs y viviendas).' );
	const r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/guardar_datos_privados`, {
		method: 'POST', headers: cabeceras, body: JSON.stringify( { p_promocion: id, p_version: version, p_contenido: datosPrivados( id ) } ),
	} );
	if ( ! r.ok ) fallo( `No se han podido guardar los datos privados en Supabase (${ r.status }): ${ ( await r.text() ).slice( 0, 200 ) }` );
	ok( `Datos privados de ${ version } en Supabase (catálogo, packs y viviendas; huella ${ String( await r.json() ).slice( 0, 12 ) })` );

}

async function preparar( id ) {

	comprobarPromocion( id );
	const esc = rutaEscaparate();
	exigirRama( esc, 'revision' );
	const preparadoPor = opcion( 'preparado-por' ) ?? 'Claude';
	const cambios = opcion( 'cambios' );
	if ( ! cambios ) fallo( 'Falta --cambios: cada versión debe explicar qué cambia' );
	if ( git( RAIZ, 'status', '--porcelain' ) ) fallo( 'El taller tiene cambios sin guardar. Lo publicado debe ser exactamente lo guardado (haz commit primero).' );
	if ( git( esc, 'status', '--porcelain' ) ) fallo( 'El escaparate tiene cambios sin guardar.' );

	// número siguiente: el mayor entre el registro, la vista previa y producción
	const registro = leerRegistro( id );
	const numeros = [ ...registro.versiones.map( ( v ) => v.version ), versionEn( esc, 'HEAD', id ), versionEn( esc, 'origin/main', id ) ]
		.filter( Boolean ).map( ( v ) => Number( v.slice( 1 ) ) );
	const numero = Math.max( 0, ...numeros ) + 1;
	const version = `v${ numero }`;
	const motor = git( RAIZ, 'rev-parse', 'HEAD' );
	const etiqueta = `${ id }/${ version }`;
	if ( git( RAIZ, 'tag', '--list', etiqueta ) ) fallo( `La etiqueta ${ etiqueta } ya existe en el taller` );

	console.log( `\nPreparación de «${ id }» ${ version } (vista previa, pendiente de aprobación)` );
	console.log( `  commit del taller: ${ motor.slice( 0, 10 ) }` );
	console.log( `  preparada por:     ${ preparadoPor }` );
	console.log( `  cambios:           ${ cambios }\n` );

	const textos = await textosLegales( id );
	if ( textos ) ok( `Textos legales de MUNE Portal: ${ Object.keys( textos ).join( ', ' ) || 'ninguno escrito (se usan los de promocion.json)' }` );
	// la construcción y los planos (mismo proceso) usan los textos de MUNE Portal
	process.env.TEXTOS_LEGALES = textos ? JSON.stringify( textos ) : '';
	// la web sabe su versión: con ella pide al entrar el comprador los datos privados de esa versión
	process.env.VERSION_PUBLICA = version;
	const { destino } = construir( id );
	// planos comerciales de esta versión, para que la promotora los valide (Etapa 4)
	console.log( 'Generando los planos comerciales…' );
	const planos = await generarPlanos( id, version, destino );
	ok( `Planos para validar: ${ planos.length } (${ planos.map( ( p ) => p.titulo ).join( ', ' ) })` );
	ok( `Experiencia 3D para validar: ${ planos.experiencia.length } unidad(es) (${ planos.experiencia.map( ( u ) => u.titulo ).join( ', ' ) })` );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha preparado nada. Repite con --confirmar.\n' );
		return;

	}

	// datos privados de la versión (catálogo, packs y viviendas), antes de tocar el escaparate
	await guardarDatosPrivados( id, version );

	// escaparate: sustituye la carpeta de la promoción por la nueva versión
	const carpeta = join( esc, PUBLICO, id );
	rmSync( carpeta, { recursive: true, force: true } );
	mkdirSync( carpeta, { recursive: true } );
	cpSync( destino, carpeta, { recursive: true } );
	const fecha = hoy();
	escribirJSON( join( carpeta, 'version.json' ), { promocion: id, version, fecha, taller: motor } );
	git( esc, 'add', '-A', join( PUBLICO, id ) );
	asegurarCabeceras( esc );
	// los cambios viajan en el mensaje (privado): el registro lo escribe «aprobar»
	git( esc, 'commit', '-q', '-m', `Prepara ${ id } ${ version }\n\nCambios: ${ cambios }\nPreparada por: ${ preparadoPor }\nTaller: ${ motor }` );
	ok( `Escaparate (rama revision): ${ PUBLICO }/${ id }/ en ${ version }` );
	git( RAIZ, 'tag', '-a', etiqueta, motor, '-m', `${ id } ${ version } · ${ fecha }` );
	ok( `Taller: etiqueta ${ etiqueta } en el commit usado` );
	console.log( '\nFalta enviar a GitHub (push) la rama «revision» del escaparate. Se publica al aprobarla en el Panel.\n' );

}

// ---------------------------------------------------------------- aprobar (publicar)

function aprobar( id ) {

	comprobarPromocion( id );
	const esc = rutaEscaparate();
	exigirRama( esc, 'main' );
	const aprobadoPor = opcion( 'aprobado-por' );
	if ( ! aprobadoPor ) fallo( 'Falta --aprobado-por: ninguna publicación sin aprobación explícita' );
	if ( git( esc, 'status', '--porcelain' ) ) fallo( 'El escaparate tiene cambios sin guardar.' );

	const enRevision = versionEn( esc, 'origin/revision', id );
	const publicada = versionEn( esc, 'HEAD', id );
	if ( ! enRevision ) fallo( `No hay ninguna versión de ${ id } en la vista previa (rama revision)` );
	if ( enRevision === publicada ) fallo( `${ enRevision } ya es la versión publicada: no hay nada pendiente` );
	// solo se publica exactamente la versión que la administradora ha revisado
	const revisada = opcion( 'version' );
	if ( ! revisada ) fallo( 'Falta --version: la versión que se ha revisado en la vista previa' );
	if ( revisada !== enRevision ) fallo( `La vista previa ha cambiado: ahora contiene ${ enRevision }, no ${ revisada }. Revísala antes de publicar.` );

	// datos de la preparación: version.json y el mensaje del commit en «revision»
	const datosV = JSON.parse( git( esc, 'show', `origin/revision:${ PUBLICO }/${ id }/version.json` ) );
	const mensaje = git( esc, 'log', '-1', '--format=%B', 'origin/revision', '--', `${ PUBLICO }/${ id }/version.json` );
	const campo = ( nombre ) => mensaje.match( new RegExp( `^${ nombre }: (.*)$`, 'm' ) )?.[ 1 ]?.trim() ?? null;

	console.log( `\nAprobar «${ id }» ${ enRevision } (sustituye a ${ publicada ?? '—' })\n  aprobado por: ${ aprobadoPor }\n  cambios: ${ campo( 'Cambios' ) ?? '—' }` );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha publicado nada. Repite con --confirmar.\n' );
		return;

	}

	const fecha = hoy();
	git( esc, 'rm', '-r', '-q', '--ignore-unmatch', join( PUBLICO, id ) );
	git( esc, 'checkout', 'origin/revision', '--', join( PUBLICO, id ) );
	asegurarCabeceras( esc );
	git( esc, 'commit', '-q', '-m', `Publica ${ id } ${ enRevision }\n\nAprobada en el Panel por: ${ aprobadoPor }` );
	const etiqueta = `${ id }/${ enRevision }`;
	if ( ! git( esc, 'tag', '--list', etiqueta ) ) git( esc, 'tag', '-a', etiqueta, '-m', `${ id } ${ enRevision } · ${ fecha }` );
	ok( `Escaparate: ${ PUBLICO }/${ id }/ publicado en ${ enRevision }` );

	// el registro del taller solo lo escribe el ejecutor (aprobar y volver), en main
	const registro = leerRegistro( id );
	for ( const x of registro.versiones ) if ( x.estado === 'publicada' ) x.estado = 'sustituida';
	const entrada = {
		version: enRevision, fecha: datosV.fecha, estado: 'publicada', taller: datosV.taller,
		preparadaPor: campo( 'Preparada por' ), cambios: campo( 'Cambios' ), aprobadoPor, publicadaEl: fecha,
	};
	const previa = registro.versiones.findIndex( ( x ) => x.version === enRevision );
	if ( previa >= 0 ) registro.versiones[ previa ] = { ...registro.versiones[ previa ], ...entrada };
	else registro.versiones.push( entrada );
	registro.historial = [ ...( registro.historial ?? [] ), { fecha, accion: 'aprobar', version: enRevision, por: aprobadoPor } ];
	escribirJSON( rutaRegistro( id ), registro );
	git( RAIZ, 'add', rutaRegistro( id ) );
	git( RAIZ, 'commit', '-q', '-m', `Registro: ${ id } ${ enRevision } publicada (aprobada por ${ aprobadoPor })` );
	ok( 'Taller: registro de versiones actualizado' );

}

// ---------------------------------------------------------------- volver a una versión anterior

function volver( id, version ) {

	comprobarPromocion( id );
	const esc = rutaEscaparate();
	const motivo = opcion( 'motivo' );
	if ( ! /^v\d+$/.test( version ?? '' ) ) fallo( 'Indica la versión, por ejemplo: v2' );
	if ( ! motivo ) fallo( 'Falta --motivo' );
	if ( git( RAIZ, 'status', '--porcelain' ) || git( esc, 'status', '--porcelain' ) ) fallo( 'Hay cambios sin guardar en el taller o el escaparate.' );
	exigirRama( esc, 'main' );

	const registro = leerRegistro( id );
	const destinoV = registro.versiones.find( ( v ) => v.version === version );
	const vigente = registro.versiones.find( ( v ) => v.estado === 'publicada' );
	if ( ! destinoV ) fallo( `No existe la versión ${ version } de ${ id }` );
	if ( versionEn( esc, 'HEAD', id ) === version ) fallo( `${ version } ya es la versión publicada` );
	const origen = commitDeVersion( esc, id, version );
	if ( ! origen ) fallo( `No encuentro ${ version } de ${ id } en el historial del escaparate` );
	const aprobadoPor = opcion( 'aprobado-por' ) ?? 'sin indicar';

	console.log( `\nVolver «${ id }» de ${ vigente?.version ?? '—' } a ${ version }\n  motivo: ${ motivo }` );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha cambiado nada. Repite con --confirmar.\n' );
		return;

	}

	const fecha = hoy();
	git( esc, 'rm', '-r', '-q', '--ignore-unmatch', join( PUBLICO, id ) );
	git( esc, 'checkout', origen, '--', join( PUBLICO, id ) );
	git( esc, 'commit', '-q', '-m', `Vuelve ${ id } a ${ version }\n\nMotivo: ${ motivo }\nAprobado por: ${ aprobadoPor }` );
	ok( `Escaparate: ${ PUBLICO }/${ id }/ restaurado a ${ version }` );

	if ( vigente ) vigente.estado = 'retirada';
	destinoV.estado = 'publicada';
	registro.historial = [ ...( registro.historial ?? [] ), { fecha, accion: 'volver', desde: vigente?.version ?? null, a: version, motivo, por: aprobadoPor } ];
	escribirJSON( rutaRegistro( id ), registro );
	git( RAIZ, 'add', rutaRegistro( id ) );
	git( RAIZ, 'commit', '-q', '-m', `Registro: ${ id } vuelve a ${ version }` );
	ok( 'Registro de versiones actualizado (la versión retirada se conserva)' );
	console.log( '\nFalta enviar a GitHub (push) el taller y el escaparate.\n' );

}

// ---------------------------------------------------------------- estado

function estado( id ) {

	comprobarPromocion( id );
	const r = leerRegistro( id );
	if ( ! r.versiones.length ) return console.log( `${ id }: sin versiones publicadas` );
	console.log( `${ id }:` );
	for ( const v of r.versiones ) console.log( `  ${ v.version.padEnd( 4 ) } ${ v.estado.padEnd( 11 ) } ${ v.fecha }  ${ v.aprobadoPor ?? v.preparadaPor ?? '' } · ${ v.cambios }` );

}

// ---------------------------------------------------------------- órdenes

const [ orden, id, extra ] = posicionales;
switch ( orden ) {

	case 'construir': construir( id ); break;
	case 'preparar': await preparar( id ); break;
	case 'aprobar': aprobar( id ); break;
	case 'volver': volver( id, extra ); break;
	case 'estado': estado( id ); break;
	default: fallo( 'Orden desconocida. Usa: construir | preparar | aprobar | volver | estado' );

}
