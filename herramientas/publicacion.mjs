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
//    del código (producto maestro) y guarda la copia exacta de sus datos en Supabase;
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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generarPlanos } from './planos.mjs';
import { TRABAJO, archivosLocales, cabecerasRobot, diferencias, guardarModelo, leerModelo } from './promociones.mjs';

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

// ---------------------------------------------------------------- publicar

// El Panel y el portal leen, desde otra dirección, los planos y la Experiencia 3D
// de cada versión: el escaparate tiene que permitirlo (en las dos ramas).
function asegurarCabeceras( esc ) {

	const cabeceras = join( esc, PUBLICO, '_headers' );
	let texto = existsSync( cabeceras ) ? readFileSync( cabeceras, 'utf8' ).trimEnd() : '';
	const reglas = [
		[ '/:promocion/planos/*', 'Planos comerciales de cada versión: el Panel los copia para enviarlos a la promotora.' ],
		[ '/:promocion/experiencia/*', 'Unidades de la Experiencia 3D de cada versión: el Panel y el portal las usan para validarla.' ],
		[ '/:promocion/fuentes/*', 'Tipografía de la marca: también la usa el formulario de «Solicitar información», que va aislado.' ],
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
	const esc = rutaEscaparate();
	exigirRama( esc, 'revision' );
	const preparadoPor = opcion( 'preparado-por' ) ?? 'Claude';
	const cambios = opcion( 'cambios' );
	if ( ! cambios ) fallo( 'Falta --cambios: cada versión debe explicar qué cambia' );
	if ( git( RAIZ, 'status', '--porcelain' ) ) fallo( 'El taller tiene cambios sin guardar. Lo publicado debe ser exactamente lo guardado (haz commit primero).' );
	if ( git( esc, 'status', '--porcelain' ) ) fallo( 'El escaparate tiene cambios sin guardar.' );
	// los datos: exactamente los guardados en Supabase
	const robot = await cabecerasRobot().catch( ( e ) => fallo( e.message ) );
	const guardada = await leerModelo( robot, id );
	if ( ! guardada ) fallo( `No hay datos de «${ id }» en Supabase. Súbelos primero: node herramientas/promociones.mjs subir ${ id } --nota "…"` );
	const archivos = archivosLocales( id );
	const distintos = diferencias( archivos, guardada.archivos );
	if ( distintos.length ) fallo( `Los datos de trabajo/${ id }/ no son los guardados en Supabase. Lo publicado debe ser exactamente lo guardado:\n  · ${ distintos.join( '\n  · ' ) }\n  Súbelos (node herramientas/promociones.mjs subir ${ id } --nota "…") o vuelve a bajarlos.` );
	ok( `Datos de la promoción: los guardados en Supabase el ${ guardada.guardado_en.slice( 0, 16 ).replace( 'T', ' ' ) } (huella ${ guardada.huella.slice( 0, 12 ) })` );
	comprobarSuperficies( id );

	// número siguiente: el mayor entre el registro, la vista previa y producción
	const registro = leerRegistro( id );
	const preparadas = ( await fetch( `${ SUPABASE_URL }/rest/v1/modelo_promocion?promocion_id=eq.${ encodeURIComponent( id ) }&version=not.is.null&select=version`, { headers: robot } ).then( ( r ) => r.json() ) ).map( ( f ) => f.version );
	const numeros = [ ...registro.versiones.map( ( v ) => v.version ), ...preparadas, versionEn( esc, 'HEAD', id ), versionEn( esc, 'origin/main', id ) ]
		.filter( Boolean ).map( ( v ) => Number( v.slice( 1 ) ) );
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
	if ( ! bandera( 'confirmar' ) ) {

		console.log( '\nSimulación: no se ha preparado nada. Repite con --confirmar.\n' );
		return;

	}

	// datos privados de la versión (catálogo, packs y viviendas), antes de tocar el escaparate
	await guardarDatosPrivados( id, version );
	// la copia exacta de los datos de esta versión, con el commit del código: no se
	// puede cambiar nunca, así que va después de lo que sí se puede repetir
	try {

		const huella = await guardarModelo( robot, id, archivos, { version, codigo: motor, nota: cambios.slice( 0, 500 ) } );
		ok( `Datos de ${ version } guardados en Supabase (huella ${ String( huella ).slice( 0, 12 ) }, código ${ motor.slice( 0, 10 ) })` );

	} catch ( e ) {

		fallo( `No se han podido guardar los datos de ${ version } en Supabase: ${ e.message }` );

	}

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
	console.log( '\nFalta enviar a GitHub (push) la rama «revision» del escaparate. Se publica al aprobarla en el Panel.\n' );

}

// ---------------------------------------------------------------- aprobar (publicar)

function aprobar( id ) {

	comprobarId( id );
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

	comprobarId( id );
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

// ---------------------------------------------------------------- comprobar

// Las mismas comprobaciones de «preparar» (superficies, acabados, choques y lo
// que la visita aún no sabe representar), sin versión ni escaparate: para la
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

function estado( id ) {

	comprobarId( id );
	const r = leerRegistro( id );
	if ( ! r.versiones.length ) return console.log( `${ id }: sin versiones publicadas` );
	console.log( `${ id }:` );
	for ( const v of r.versiones ) console.log( `  ${ v.version.padEnd( 4 ) } ${ v.estado.padEnd( 11 ) } ${ v.fecha }  ${ v.aprobadoPor ?? v.preparadaPor ?? '' } · ${ v.cambios }` );

}

// ---------------------------------------------------------------- órdenes

const [ orden, id, extra ] = posicionales;
switch ( orden ) {

	case 'construir': construir( id ); break;
	case 'comprobar': await comprobar( id ); break;
	case 'preparar': await preparar( id ); break;
	case 'aprobar': aprobar( id ); break;
	case 'volver': volver( id, extra ); break;
	case 'estado': estado( id ); break;
	default: fallo( 'Orden desconocida. Usa: construir | comprobar | preparar | aprobar | volver | estado' );

}
