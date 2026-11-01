#!/usr/bin/env node
// Envía la web pública de las promociones a Cloudflare (Worker «experience»),
// sin pasar por GitHub (036_publicacion.sql, decisión 60).
//
//   node herramientas/desplegar.mjs produccion | vista-previa | ambas [--solo-montar]
//
// Monta salida/despliegue/<destino>/publico/ con las páginas fijas
// (experiencia-publica/) y, de cada promoción, la web de la versión que toca,
// bajada del almacén privado «versiones» de Supabase y comprobada con su huella:
//  · producción (experience.mune-projects.workers.dev): la publicada;
//  · vista previa (revision-experience.mune-projects.workers.dev): la que está en
//    revisión o, si no hay ninguna, la publicada.
// Después la envía con wrangler: «deploy» a producción y «versions upload
// --preview-alias revision» a la vista previa. Con --solo-montar no envía nada.
//
// Lo lanzan avisar.yml (vista previa, al preparar una versión) y publicar.yml
// (las dos, al publicar o volver atrás), en GitHub Actions.
// Credenciales (secretos de GitHub, nunca en el código ni en el chat):
//  · EJECUTOR_CLAVE: la cuenta «ejecutor» de MUNE, que solo puede leer las
//    versiones (sin ella, el robot de Claude, para probar con --solo-montar);
//  · CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID: la llave C de Cloudflare.

import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { RAIZ } from './promociones.mjs';
import { bajarSitio, cabecerasEjecutor, cabecerasRobotVersiones, desempaquetar, llamar } from './versiones.mjs';

const WRANGLER = 'wrangler@4.147.0';
const FIJAS = join( RAIZ, 'experiencia-publica' );
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';

const ok = ( texto ) => console.log( `✓ ${ texto }` );
function fallo( texto ) {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

}

const args = process.argv.slice( 2 );
const destinos = { produccion: [ 'produccion' ], 'vista-previa': [ 'vista-previa' ], ambas: [ 'produccion', 'vista-previa' ] }[ args[ 0 ] ];
if ( ! destinos ) fallo( 'Indica a dónde: produccion, vista-previa o ambas' );
const soloMontar = args.includes( '--solo-montar' );
if ( ! soloMontar && ! process.env.CLOUDFLARE_API_TOKEN ) fallo( 'Falta CLOUDFLARE_API_TOKEN (la llave C de Cloudflare). Para solo montar la web, usa --solo-montar.' );

const cabeceras = await cabecerasEjecutor().catch( ( e ) => fallo( e.message ) ) ?? await cabecerasRobotVersiones().catch( ( e ) => fallo( e.message ) );
if ( ! cabeceras ) fallo( 'Faltan las credenciales: la cuenta «ejecutor» (EJECUTOR_CLAVE) o el robot de Claude (ROBOT_EMAIL y ROBOT_CLAVE).' );

const lista = await llamar( cabeceras, 'versiones_para_desplegar' ).catch( ( e ) => fallo( `No se ha podido leer qué versiones van a la web: ${ e.message }` ) );
const huellas = new Map( ( await ( await fetch( `${ SUPABASE_URL }/rest/v1/versiones_promocion?select=promocion_id,version,huella`, { headers: cabeceras } ) ).json() )
	.map( ( v ) => [ `${ v.promocion_id }/${ v.version }`, v.huella ] ) );

for ( const destino of destinos ) {

	const carpeta = join( RAIZ, 'salida', 'despliegue', destino );
	rmSync( carpeta, { recursive: true, force: true } );
	cpSync( FIJAS, carpeta, { recursive: true } );
	const puestas = [];
	for ( const fila of lista ) {

		const version = destino === 'produccion' ? fila.publicada : fila.vista_previa;
		if ( ! version ) continue;
		const huella = huellas.get( `${ fila.promocion_id }/${ version }` );
		if ( ! huella ) fallo( `La ${ version } de ${ fila.promocion_id } no tiene huella en el registro` );
		const suya = join( carpeta, 'publico', fila.promocion_id );
		const paquete = await bajarSitio( cabeceras, fila.promocion_id, version, huella ).catch( ( e ) => fallo( e.message ) );
		try {

			desempaquetar( paquete, suya );

		} catch {

			fallo( `La web guardada de la ${ version } de ${ fila.promocion_id } no se puede abrir: no se envía nada a Cloudflare` );

		}
		const dice = existsSync( join( suya, 'version.json' ) ) ? JSON.parse( readFileSync( join( suya, 'version.json' ), 'utf8' ) ) : {};
		if ( dice.promocion !== fila.promocion_id || dice.version !== version ) fallo( `La web guardada de la ${ version } de ${ fila.promocion_id } no dice ser esa versión` );
		puestas.push( `${ fila.promocion_id } ${ version }` );

	}
	ok( `${ destino === 'produccion' ? 'Producción' : 'Vista previa' }: ${ puestas.length ? puestas.join( ', ' ) : 'ninguna promoción' } (en ${ relative( RAIZ, carpeta ) }/)` );
	if ( soloMontar ) continue;

	const orden = destino === 'produccion' ? [ 'deploy' ] : [ 'versions', 'upload', '--preview-alias', 'revision' ];
	execFileSync( 'npx', [ '--yes', WRANGLER, ...orden, '--config', join( carpeta, 'wrangler.jsonc' ), '--message', `MUNE: ${ puestas.join( ', ' ) || 'sin promociones' }`.slice( 0, 100 ) ], { cwd: carpeta, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } } );
	ok( destino === 'produccion' ? 'Enviada a https://experience.mune-projects.workers.dev' : 'Enviada a https://revision-experience.mune-projects.workers.dev' );

	// Comprobación de verdad: la dirección sirve ya cada versión enviada. Si no
	// (por ejemplo, la dirección «revision-» sigue unida a otra construcción de
	// Cloudflare), se para en rojo en lugar de dar por buena una vista previa vieja.
	const base = destino === 'produccion' ? 'https://experience.mune-projects.workers.dev' : 'https://revision-experience.mune-projects.workers.dev';
	for ( const puesta of puestas ) {

		const [ id, version ] = puesta.split( ' ' );
		let sirve = null;
		for ( let intento = 0; intento < 12 && sirve !== version; intento ++ ) {

			if ( intento ) await new Promise( ( r ) => setTimeout( r, 10000 ) );
			sirve = await fetch( `${ base }/${ id }/version.json?c=${ Date.now() }`, { cache: 'no-store' } ).then( ( r ) => ( r.ok ? r.json() : null ) ).then( ( d ) => d?.version ?? null ).catch( () => null );

		}
		if ( sirve !== version ) fallo( `${ base }/${ id }/ sigue sirviendo ${ sirve ?? 'otra cosa' } en lugar de la ${ version }. Revisa en Cloudflare que el Worker «experience» no siga unido a un almacén de GitHub (Configuración → Compilaciones → Desconectar).` );
		ok( `Comprobado: ${ base }/${ id }/ sirve la ${ version }` );

	}

}
