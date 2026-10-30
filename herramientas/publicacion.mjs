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
//   node herramientas/publicacion.mjs comprobar <promoción>
//   node herramientas/publicacion.mjs preparar  <promoción> --cambios "Texto" [--preparado-por "Nombre"] [--confirmar]
//   node herramientas/publicacion.mjs aprobar   <promoción> --version vN --aprobado-por "Nombre" [--confirmar]
//   node herramientas/publicacion.mjs volver    <promoción> <vN> --motivo "Texto" [--aprobado-por "Nombre"] [--confirmar]
//   node herramientas/publicacion.mjs estado    <promoción>
//
// Flujo (036_publicacion.sql, decisión 60): «preparar» guarda la web construida
// de la versión en Supabase (almacén «versiones») y la apunta «en revisión»;
// «aprobar» la marca «publicada»; «volver» vuelve a publicar una anterior. Lo que
// va a cada web lo envía a Cloudflare herramientas/desplegar.mjs (en GitHub
// Actions: avisar.yml la vista previa y publicar.yml las dos). Nada de ninguna
// promoción se guarda en GitHub.
//
// Sin --confirmar, preparar, publicar y volver solo muestran lo que harían (no cambian nada).
// «aprobar» y «volver» usan la cuenta «ejecutor» (EJECUTOR_CLAVE) o, en MUNE
// Studio, la administradora; «preparar», el robot de Claude.
//
// Reglas que garantiza:
//  - la web pública se construye SIN Studio y se comprueba que no lo contiene;
//  - ningún archivo con forma de secreto llega a la web pública;
//  - cada publicación es una versión numerada (v1, v2…) que fija el commit exacto
//    del código (producto maestro) y guarda en Supabase la copia exacta de sus
//    datos y de su web construida (que no se puede cambiar: solo se publica la revisada);
//  - nunca se borra una versión: volver atrás restaura una anterior y marca la
//    vigente como «retirada»;
//  - preparar exige el taller sin cambios pendientes (lo publicado = lo guardado).
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
//
// Marca: la promotora la pone en MUNE Portal (031: la general o la propia de la
// promoción). «preparar» la lee igual, como el robot de Claude, y la construcción
// la pone en lugar de la de promocion.json (vite.config.ts, variable MARCA). Sin
// marca guardada, o sin esas variables, se usa la de promocion.json.
//
// Datos de la promoción (035_modelo_promocion.sql): viven en Supabase, nunca en
// GitHub. Claude los baja a trabajo/<id>/ (herramientas/promociones.mjs) y los
// sube al terminar. «preparar» exige que trabajo/<id>/ coincida exactamente con lo
// guardado en Supabase y, al confirmar, guarda allí la copia exacta de la versión
// con el commit del código usado (en lugar de la etiqueta de git de antes).
//
// Tipografía: va dentro de cada versión (fuentes/marca.css), para que la web no pida
// nada a Google Fonts al visitarla. «preparar» la descarga de Google Fonts (por su
// nombre) o, si la promotora ha subido la suya, de Supabase con el robot de Claude,
// y deja en fuentes/LICENCIA.txt de dónde sale.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generarPlanos } from './planos.mjs';
import { compararDatos, escribirCambios, leerAhora, leerDeArchivos, leerEnCommit, planosCambiados } from './cambios.mjs';
import { TRABAJO, archivosLocales, cabecerasRobot, diferencias, guardarModelo, leerModelo } from './promociones.mjs';
import { bajarSitio, cabecerasEjecutor, cabecerasRobotVersiones, desempaquetar, empaquetar, llamar, registroDe, sha256, subirSitio } from './versiones.mjs';

const RAIZ = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const SALIDA = join( RAIZ, 'salida' );

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
const CON_VALOR = [ '--aprobado-por', '--preparado-por', '--cambios', '--motivo', '--version' ];
const posicionales = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! CON_VALOR.includes( args[ i - 1 ] ) );

const fallo = ( texto ) => {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

};
const ok = ( texto ) => console.log( `✓ ${ texto }` );
const git = ( cwd, ...a ) => execFileSync( 'git', a, { cwd, encoding: 'utf8' } ).trim();
const hoy = () => new Date().toISOString().slice( 0, 19 ) + 'Z';

const leerJSON = ( ruta, defecto ) => ( existsSync( ruta ) ? JSON.parse( readFileSync( ruta, 'utf8' ) ) : defecto );
const escribirJSON = ( ruta, datos ) => {

	mkdirSync( dirname( ruta ), { recursive: true } );
	writeFileSync( ruta, JSON.stringify( datos, null, 2 ) + '\n' );

};

function comprobarId( id ) {

	if ( ! id ) fallo( 'Falta la promoción. Ejemplo: residencial-demo' );
	if ( ! /^[a-z0-9-]+$/.test( id ) ) fallo( `Identificador de promoción no válido: «${ id }»` );

}

/** La promoción, con sus datos bajados de Supabase a trabajo/<id>/. */
function comprobarPromocion( id ) {

	comprobarId( id );
	if ( ! existsSync( join( TRABAJO, id, 'promocion.json' ) ) ) fallo( `No hay datos de «${ id }» en ${ relative( RAIZ, join( TRABAJO, id ) ) }/. Bájalos de Supabase: node herramientas/promociones.mjs bajar ${ id }` );

}

// Superficies: la suma de las estancias de cada tipología (lo que enseñan la
// ficha de la web y el plano comercial) tiene que coincidir con la superficie
// útil oficial del proyecto. Si no, no se prepara: hay que aclarar con la
// promotora qué dato es el bueno (decidido el 26/10/2026). Margen: 0,5 m², para
// los redondeos de cada estancia.
const MARGEN_SUPERFICIE = 0.5;

function comprobarSuperficies( id ) {

	const carpeta = join( TRABAJO, id, 'tipologias' );
	const problemas = [];
	for ( const t of existsSync( carpeta ) ? readdirSync( carpeta ) : [] ) {

		const ruta = join( carpeta, t, 'vivienda.json' );
		if ( ! existsSync( ruta ) ) continue;
		const v = leerJSON( ruta );
		const oficial = v.meta?.superficies_oficiales?.interior;
		if ( typeof oficial !== 'number' ) {

			problemas.push( `tipología «${ t }»: falta la superficie útil oficial (meta.superficies_oficiales.interior)` );
			continue;

		}
		const suma = ( v.estancias ?? [] ).filter( ( e ) => e.uso !== 'exterior' && e.uso !== 'garaje' ).reduce( ( a, e ) => a + e.superficie, 0 );
		if ( Math.abs( suma - oficial ) > MARGEN_SUPERFICIE ) {

			problemas.push( `tipología «${ t }»: las estancias suman ${ suma.toFixed( 2 ) } m² y la superficie útil oficial es ${ oficial } m² (diferencia ${ ( suma - oficial ).toFixed( 2 ) } m²)` );

		}

	}
	if ( problemas.length ) {

		fallo( `Las superficies no cuadran con las oficiales, y saldrían así en la web y en los planos comerciales:\n  · ${ problemas.join( '\n  · ' ) }\n` +
			'  Aclara con la promotora qué dato es el bueno (plano acotado o cuadro de superficies) y corrige los datos antes de preparar la versión.' );

	}
	ok( 'Superficies: cada tipología cuadra con su superficie útil oficial' );

}

/** Registro de versiones de la promoción en Supabase, con la sesión indicada. */
async function registro( cabeceras, id ) {

	if ( ! cabeceras ) fallo( 'Faltan las credenciales: la cuenta «ejecutor» (EJECUTOR_CLAVE) o el robot de Claude (ROBOT_EMAIL y ROBOT_CLAVE).' );
	return registroDe( cabeceras, id ).catch( ( e ) => fallo( `No se ha podido leer el registro de versiones: ${ e.message }` ) );

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
	execFileSync( 'npx', [ 'vite', 'build', '--logLevel', 'warn' ], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, PROMOCION: id, PROMOCIONES: TRABAJO, SALIDA: destino } } );
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

/** La marca que se usa en la promoción (la propia o la de la promotora); null si no hay o no se puede leer. */
async function marcaDePortal( id ) {

	try {

		const cabeceras = await entrarRobot();
		if ( ! cabeceras ) {

			console.warn( '⚠ Sin ROBOT_EMAIL y ROBOT_CLAVE: no se lee la marca de MUNE Portal. Se usa la de promocion.json.' );
			return null;

		}
		const r = await fetch( `${ SUPABASE_URL }/rest/v1/rpc/marca_de_promocion`, { method: 'POST', headers: cabeceras, body: JSON.stringify( { p_promocion: id } ) } );
		if ( ! r.ok ) throw new Error( `Supabase respondió ${ r.status } al leer la marca` );
		const { efectiva, propia } = await r.json();
		if ( ! efectiva ) return null;
		const { actualizado_en: _a, por: _p, ...marca } = efectiva;
		return { marca, origen: propia ? 'la propia de la promoción' : 'la de la promotora' };

	} catch ( e ) {

		console.warn( `⚠ No se ha podido leer la marca de MUNE Portal (${ e.message }). Se usa la de promocion.json.` );
		return null;

	}

}

/** Descarga la tipografía de la marca dentro de la versión: fuentes/marca.css, sus archivos y LICENCIA.txt. */
async function guardarFuente( destino, tipografia ) {

	const familia = String( tipografia?.familia ?? '' ).trim();
	if ( ! /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/.test( familia ) ) fallo( `El nombre de la tipografía no es válido: «${ familia }»` );
	const carpeta = join( destino, 'fuentes' );
	mkdirSync( carpeta, { recursive: true } );
	let css = '';
	let licencia;
	if ( tipografia.archivos?.length ) {

		// la de la promotora: sus archivos, guardados en Supabase
		const cabeceras = await entrarRobot();
		if ( ! cabeceras ) fallo( 'La tipografía de la marca es propia: hacen falta ROBOT_EMAIL y ROBOT_CLAVE para descargarla' );
		const FORMATO = { woff2: 'woff2', woff: 'woff', ttf: 'truetype', otf: 'opentype' };
		for ( const [ i, a ] of tipografia.archivos.entries() ) {

			const ext = a.ruta.split( '.' ).pop().toLowerCase();
			if ( ! FORMATO[ ext ] ) fallo( `Archivo de tipografía no válido: ${ a.nombre }` );
			const r = await fetch( `${ SUPABASE_URL }/storage/v1/object/documentos/${ a.ruta.split( '/' ).map( encodeURIComponent ).join( '/' ) }`, { headers: { apikey: cabeceras.apikey, Authorization: cabeceras.Authorization } } );
			if ( ! r.ok ) fallo( `No se ha podido descargar la tipografía «${ a.nombre }» (Supabase respondió ${ r.status })` );
			const nombre = `marca-${ i + 1 }.${ ext }`;
			writeFileSync( join( carpeta, nombre ), Buffer.from( await r.arrayBuffer() ) );
			css += `@font-face {\n\tfont-family: "${ familia }";\n\tsrc: url("${ nombre }") format("${ FORMATO[ ext ] }");\n\tfont-weight: ${ Number( a.peso ) || 400 };\n\tfont-style: ${ a.estilo === 'italic' ? 'italic' : 'normal' };\n\tfont-display: swap;\n}\n`;

		}
		licencia = `Tipografía «${ familia }», de la promotora. Confirmó en MUNE Portal tener licencia para usarla en una web${ tipografia.licencia ? ` (${ String( tipografia.licencia ).slice( 0, 10 ) })` : '' }.\n`;

	} else {

		// una de Google Fonts: su hoja de estilos y sus archivos (alfabeto latino), copiados aquí
		const nombre = encodeURIComponent( familia ).replace( /%20/g, '+' );
		let hoja = null;
		for ( const pesos of [ ':wght@400;500;600;700', ':wght@400;700', '' ] ) {

			const r = await fetch( `https://fonts.googleapis.com/css2?family=${ nombre }${ pesos }&display=swap`, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36' } } );
			if ( r.ok ) {

				hoja = await r.text();
				break;

			}

		}
		if ( ! hoja ) fallo( `La tipografía «${ familia }» no está en Google Fonts: revisa su nombre con la promotora (fonts.google.com)` );
		const bloques = [ ...hoja.matchAll( /\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*\{[^}]*\})/g ) ];
		const latinos = bloques.filter( ( b ) => b[ 1 ] === 'latin' || b[ 1 ] === 'latin-ext' ).map( ( b ) => b[ 2 ] );
		const caras = latinos.length ? latinos : [ ...hoja.matchAll( /@font-face\s*\{[^}]*\}/g ) ].map( ( b ) => b[ 0 ] );
		const descargados = new Map();
		for ( let cara of caras ) {

			for ( const [ , url ] of cara.matchAll( /url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g ) ) {

				if ( ! descargados.has( url ) ) {

					const r = await fetch( url );
					if ( ! r.ok ) fallo( `No se ha podido descargar la tipografía «${ familia }» de Google Fonts (${ r.status })` );
					const archivo = `google-${ descargados.size + 1 }.${ url.split( '.' ).pop() }`;
					writeFileSync( join( carpeta, archivo ), Buffer.from( await r.arrayBuffer() ) );
					descargados.set( url, archivo );

				}
				cara = cara.replace( url, descargados.get( url ) );

			}
			css += `${ cara.replace( /font-family:\s*[^;]+;/, `font-family: "${ familia }";` ) }\n`;

		}
		if ( ! descargados.size ) fallo( `Google Fonts no ha dado archivos para «${ familia }»` );
		licencia = `Tipografía «${ familia }», de Google Fonts (https://fonts.google.com). Licencia libre SIL Open Font License o Apache 2.0, que permite usarla y redistribuirla.\n`;

	}
	writeFileSync( join( carpeta, 'marca.css' ), css );
	writeFileSync( join( carpeta, 'LICENCIA.txt' ), licencia );
	return familia;

}

// ---------------------------------------------------------------- qué cambia respecto a la publicada

/**
 * Compara la versión que se prepara con la publicada (cambios.mjs): deja en la
 * versión cambios/cambios.json (en sencillo) y, de cada plano que cambia, el de
 * antes y otro con las diferencias en rojo. MUNE Studio y MUNE Portal lo enseñan
 * al revisar y validar la versión. Lo privado (catálogo, precios y compradores
 * afectados) lo compara Supabase (comparar_version, 034).
 */
async function compararConPublicada( id, version, destino, robot, versiones ) {

	const publicada = versiones.find( ( v ) => v.estado === 'publicada' );
	const anterior = publicada?.version;
	const taller = publicada?.taller;
	if ( ! anterior ) return escribirCambios( destino, { promocion: id, version, anterior: null, grupos: [] } );
	let grupos;
	try {

		// los datos de la publicada: su copia en Supabase (decisión 59) o, en las
		// versiones de antes, el historial del taller
		const guardada = await leerModelo( robot, id, anterior );
		if ( ! guardada && ! taller ) return escribirCambios( destino, { promocion: id, version, anterior: null, grupos: [] } );
		grupos = compararDatos( guardada ? leerDeArchivos( guardada.archivos ) : leerEnCommit( id, taller ), leerAhora( id ) );

	} catch ( e ) {

		console.warn( `⚠ No se ha podido comparar con la ${ anterior } (${ e.message }).` );
		return escribirCambios( destino, { promocion: id, version, anterior, grupos: [], sinComparar: true } );

	}
	// los planos de la publicada, de su web guardada en Supabase
	const planosAntes = {};
	try {

		const carpeta = join( SALIDA, 'publicada', id );
		rmSync( carpeta, { recursive: true, force: true } );
		desempaquetar( await bajarSitio( robot, id, anterior, publicada.huella ), carpeta );
		const lista = JSON.parse( readFileSync( join( carpeta, 'planos', 'planos.json' ), 'utf8' ) ).planos ?? [];
		for ( const p of lista ) planosAntes[ p.clave ] = { huellaDatos: p.huellaDatos, png: readFileSync( join( carpeta, 'planos', p.miniatura ) ) };

	} catch { /* la publicada no tenía planos */ }
	const planos = Object.keys( planosAntes ).length ? await planosCambiados( destino, planosAntes ) : [];
	return escribirCambios( destino, { promocion: id, version, anterior, grupos, planos } );

}

// ---------------------------------------------------------------- datos privados (paso 5a, 024)

/**
 * Lo que no va en la web pública: catálogo con precios, packs, lo que admite
 * cada tipología y los datos de cada vivienda. Se guarda en Supabase con cada
 * versión; el comprador recibe lo suyo al entrar con su código.
 */
function datosPrivados( id ) {

	const leer = ( f ) => JSON.parse( readFileSync( join( TRABAJO, id, f ), 'utf8' ) );
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
	const preparadoPor = opcion( 'preparado-por' ) ?? 'Claude';
	const cambios = opcion( 'cambios' );
	if ( ! cambios ) fallo( 'Falta --cambios: cada versión debe explicar qué cambia' );
	if ( git( RAIZ, 'status', '--porcelain' ) ) fallo( 'El taller tiene cambios sin guardar. Lo publicado debe ser exactamente lo guardado (haz commit primero).' );
	// los datos: exactamente los guardados en Supabase
	const robot = await cabecerasRobot().catch( ( e ) => fallo( e.message ) );
	const guardada = await leerModelo( robot, id );
	if ( ! guardada ) fallo( `No hay datos de «${ id }» en Supabase. Súbelos primero: node herramientas/promociones.mjs subir ${ id } --nota "…"` );
	const archivos = archivosLocales( id );
	const distintos = diferencias( archivos, guardada.archivos );
	if ( distintos.length ) fallo( `Los datos de trabajo/${ id }/ no son los guardados en Supabase. Lo publicado debe ser exactamente lo guardado:\n  · ${ distintos.join( '\n  · ' ) }\n  Súbelos (node herramientas/promociones.mjs subir ${ id } --nota "…") o vuelve a bajarlos.` );
	ok( `Datos de la promoción: los guardados en Supabase el ${ guardada.guardado_en.slice( 0, 16 ).replace( 'T', ' ' ) } (huella ${ guardada.huella.slice( 0, 12 ) })` );
	comprobarSuperficies( id );

	// número siguiente: el mayor del registro de versiones y de las copias del modelo
	const versiones = await registro( robot, id );
	const preparadas = ( await fetch( `${ SUPABASE_URL }/rest/v1/modelo_promocion?promocion_id=eq.${ encodeURIComponent( id ) }&version=not.is.null&select=version`, { headers: robot } ).then( ( r ) => r.json() ) ).map( ( f ) => f.version );
	const numeros = [ ...versiones.map( ( v ) => v.version ), ...preparadas ].map( ( v ) => Number( v.slice( 1 ) ) );
	const numero = Math.max( 0, ...numeros ) + 1;
	const version = `v${ numero }`;
	const motor = git( RAIZ, 'rev-parse', 'HEAD' );

	console.log( `\nPreparación de «${ id }» ${ version } (vista previa, pendiente de aprobación)` );
	console.log( `  commit del taller: ${ motor.slice( 0, 10 ) }` );
	console.log( `  preparada por:     ${ preparadoPor }` );
	console.log( `  cambios:           ${ cambios }\n` );

	const textos = await textosLegales( id );
	if ( textos ) ok( `Textos legales de MUNE Portal: ${ Object.keys( textos ).join( ', ' ) || 'ninguno escrito (se usan los de promocion.json)' }` );
	// la construcción y los planos (mismo proceso) usan los textos de MUNE Portal
	process.env.TEXTOS_LEGALES = textos ? JSON.stringify( textos ) : '';
	const marca = await marcaDePortal( id );
	ok( marca ? `Marca de MUNE Portal: ${ marca.origen } («${ marca.marca.promotora }»)` : 'Marca: la de promocion.json (no hay ninguna guardada en MUNE Portal)' );
	process.env.MARCA = marca ? JSON.stringify( marca.marca ) : '';
	// la tipografía va dentro de la versión (fuentes/), nunca desde Google al visitarla
	process.env.FUENTE_LOCAL = '1';
	// la web sabe su versión: con ella pide al entrar el comprador los datos privados de esa versión
	process.env.VERSION_PUBLICA = version;
	const { destino } = construir( id );
	const tipografia = marca?.marca.tipografia ?? JSON.parse( readFileSync( join( TRABAJO, id, 'promocion.json' ), 'utf8' ) ).marca?.tipografia;
	ok( `Tipografía dentro de la versión: ${ await guardarFuente( destino, tipografia ) }${ tipografia?.archivos?.length ? ' (propia)' : ' (Google Fonts)' }` );
	// planos comerciales de esta versión, para que la promotora los valide (Etapa 4)
	console.log( 'Generando los planos comerciales…' );
	const planos = await generarPlanos( id, version, destino );
	ok( `Planos para validar: ${ planos.length } (${ planos.map( ( p ) => p.titulo ).join( ', ' ) })` );
	ok( `Experiencia 3D para validar: ${ planos.experiencia.length } unidad(es) (${ planos.experiencia.map( ( u ) => u.titulo ).join( ', ' ) })` );
	const comparacion = await compararConPublicada( id, version, destino, robot, versiones );
	ok( comparacion.anterior
		? `Cambios respecto a la ${ comparacion.anterior }: ${ comparacion.grupos.reduce( ( n, g ) => n + g.cambios.length, 0 ) } en los datos, ${ comparacion.planos.length } plano(s)`
		: 'Cambios: no hay versión publicada con la que comparar' );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha preparado nada. Repite con --confirmar.\n' );
		return;

	}

	// datos privados de la versión (catálogo, packs y viviendas), antes de guardar la web
	await guardarDatosPrivados( id, version );
	// la copia exacta de los datos de esta versión, con el commit del código: no se
	// puede cambiar nunca, así que va después de lo que sí se puede repetir
	try {

		const huella = await guardarModelo( robot, id, archivos, { version, codigo: motor, nota: cambios.slice( 0, 500 ) } );
		ok( `Datos de ${ version } guardados en Supabase (huella ${ String( huella ).slice( 0, 12 ) }, código ${ motor.slice( 0, 10 ) })` );

	} catch ( e ) {

		fallo( `No se han podido guardar los datos de ${ version } en Supabase: ${ e.message }` );

	}

	// la web construida, con su versión, en el almacén «versiones» (no se puede cambiar)
	escribirJSON( join( destino, 'version.json' ), { promocion: id, version, fecha: hoy(), taller: motor } );
	const paquete = empaquetar( destino );
	const huella = sha256( paquete );
	try {

		await subirSitio( robot, id, version, paquete );
		await llamar( robot, 'preparar_version', { p_promocion: id, p_version: version, p_cambios: cambios, p_preparada_por: preparadoPor, p_taller: motor, p_huella: huella } );

	} catch ( e ) {

		fallo( `No se ha podido guardar la web de la ${ version } en Supabase: ${ e.message }` );

	}
	ok( `Web de la ${ version } guardada en Supabase y en revisión (${ ( paquete.length / 1048576 ).toFixed( 1 ) } MB, huella ${ huella.slice( 0, 12 ) })` );
	console.log( `\nFalta lanzar avisar.yml (promoción, versión y cambios): envía la vista previa a Cloudflare y te avisa por email. Se publica al aprobarla en MUNE Studio.\n` );

}

// ---------------------------------------------------------------- aprobar (publicar)

async function aprobar( id ) {

	comprobarId( id );
	const aprobadoPor = opcion( 'aprobado-por' );
	if ( ! aprobadoPor ) fallo( 'Falta --aprobado-por: ninguna publicación sin aprobación explícita' );
	// solo se publica exactamente la versión que la administradora ha revisado
	const revisada = opcion( 'version' );
	if ( ! revisada ) fallo( 'Falta --version: la versión que se ha revisado en la vista previa' );
	const cabeceras = await cabecerasEjecutor().catch( ( e ) => fallo( e.message ) );
	if ( ! cabeceras ) fallo( 'Falta EJECUTOR_CLAVE: solo la cuenta «ejecutor» publica desde aquí.' );
	const versiones = await registro( cabeceras, id );
	const enRevision = versiones.find( ( v ) => v.estado === 'en_revision' );
	const publicada = versiones.find( ( v ) => v.estado === 'publicada' );
	if ( ! enRevision ) fallo( `No hay ninguna versión de ${ id } en la vista previa` );
	if ( revisada !== enRevision.version ) fallo( `La vista previa ha cambiado: ahora contiene ${ enRevision.version }, no ${ revisada }. Revísala antes de publicar.` );

	console.log( `\nAprobar «${ id }» ${ enRevision.version } (sustituye a ${ publicada?.version ?? '—' })\n  aprobado por: ${ aprobadoPor }\n  cambios: ${ enRevision.cambios || '—' }` );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha publicado nada. Repite con --confirmar.\n' );
		return;

	}
	await llamar( cabeceras, 'aprobar_version', { p_promocion: id, p_version: revisada, p_por: aprobadoPor } ).catch( ( e ) => fallo( e.message ) );
	ok( `Registro: ${ id } ${ revisada } publicada. Falta enviarla a Cloudflare (desplegar.mjs ambas).` );

}

// ---------------------------------------------------------------- volver a una versión anterior

async function volver( id, version ) {

	comprobarId( id );
	const motivo = opcion( 'motivo' );
	if ( ! /^v\d+$/.test( version ?? '' ) ) fallo( 'Indica la versión, por ejemplo: v2' );
	if ( ! motivo ) fallo( 'Falta --motivo' );
	const aprobadoPor = opcion( 'aprobado-por' ) ?? 'sin indicar';
	const cabeceras = await cabecerasEjecutor().catch( ( e ) => fallo( e.message ) );
	if ( ! cabeceras ) fallo( 'Falta EJECUTOR_CLAVE: solo la cuenta «ejecutor» vuelve atrás desde aquí.' );
	const versiones = await registro( cabeceras, id );
	const destinoV = versiones.find( ( v ) => v.version === version );
	const vigente = versiones.find( ( v ) => v.estado === 'publicada' );
	if ( ! destinoV ) fallo( `No existe la versión ${ version } de ${ id }` );
	if ( vigente?.version === version ) fallo( `${ version } ya es la versión publicada` );

	console.log( `\nVolver «${ id }» de ${ vigente?.version ?? '—' } a ${ version }\n  motivo: ${ motivo }` );
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha cambiado nada. Repite con --confirmar.\n' );
		return;

	}
	await llamar( cabeceras, 'volver_version', { p_promocion: id, p_version: version, p_motivo: motivo, p_por: aprobadoPor } ).catch( ( e ) => fallo( e.message ) );
	ok( `Registro: ${ id } vuelve a ${ version } (la ${ vigente?.version ?? 'anterior' } se conserva). Falta enviarla a Cloudflare (desplegar.mjs ambas).` );

}

// ---------------------------------------------------------------- comprobar

// Las mismas comprobaciones de «preparar» (superficies, acabados, choques y lo
// que la visita aún no sabe representar), sin versión ni web guardada: para la
// receta 1, mientras se pasan a datos los planos y la memoria. Los planos de
// prueba quedan en salida/comprobar/<promoción>/ para mirarlos.
async function comprobar( id ) {

	comprobarPromocion( id );
	comprobarSuperficies( id );
	const destino = join( RAIZ, 'salida', 'comprobar', id );
	rmSync( destino, { recursive: true, force: true } );
	const planos = await generarPlanos( id, 'v0', destino );
	ok( `Planos de prueba: ${ planos.length } (${ planos.map( ( p ) => p.titulo ).join( ', ' ) }), en ${ relative( RAIZ, join( destino, 'planos' ) ) }/` );
	console.log( '\nTodo cuadra: ya se puede preparar una versión con estos datos.\n' );

}

// ---------------------------------------------------------------- estado

async function estado( id ) {

	comprobarId( id );
	const cabeceras = await cabecerasEjecutor().catch( () => null ) ?? await cabecerasRobotVersiones().catch( ( e ) => fallo( e.message ) );
	const versiones = await registro( cabeceras, id );
	if ( ! versiones.length ) return console.log( `${ id }: sin versiones` );
	console.log( `${ id }:` );
	for ( const v of versiones ) console.log( `  ${ v.version.padEnd( 4 ) } ${ v.estado.padEnd( 11 ) } ${ v.preparada_en.slice( 0, 10 ) }  ${ v.aprobado_por ?? v.preparada_por ?? '' } · ${ v.cambios }` );

}

// ---------------------------------------------------------------- órdenes

const [ orden, id, extra ] = posicionales;
switch ( orden ) {

	case 'construir': construir( id ); break;
	case 'comprobar': await comprobar( id ); break;
	case 'preparar': await preparar( id ); break;
	case 'aprobar': await aprobar( id ); break;
	case 'volver': await volver( id, extra ); break;
	case 'estado': await estado( id ); break;
	default: fallo( 'Orden desconocida. Usa: construir | comprobar | preparar | aprobar | volver | estado' );

}
