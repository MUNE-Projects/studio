// Versiones de cada promoción en Supabase (036_publicacion.sql): el registro
// (versiones_promocion) y la web construida de cada versión, en el almacén
// privado «versiones» (<promoción>/<vN>/sitio.tar.gz). Lo usan
// publicacion.mjs (preparar, aprobar, volver, estado) y desplegar.mjs.
//
// Credenciales, en las variables del entorno (nunca en el código ni en el chat):
//  · el robot de Claude (ROBOT_EMAIL, ROBOT_CLAVE): prepara;
//  · la cuenta «ejecutor» de MUNE (EJECUTOR_CLAVE; EJECUTOR_EMAIL, si no es la
//    de siempre): publica, vuelve atrás y despliega, en GitHub Actions.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const SUPABASE_CLAVE_PUBLICA = process.env.SUPABASE_CLAVE_PUBLICA ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const EJECUTOR = 'hello.muneprojects+ejecutor@gmail.com';

async function entrar( email, password, quien ) {

	if ( ! email || ! password ) return null;
	const r = await fetch( `${ SUPABASE_URL }/auth/v1/token?grant_type=password`, {
		method: 'POST', headers: { apikey: SUPABASE_CLAVE_PUBLICA, 'Content-Type': 'application/json' }, body: JSON.stringify( { email, password } ),
	} );
	if ( ! r.ok ) throw new Error( `la entrada de ${ quien } respondió ${ r.status }` );
	const { access_token: token } = await r.json();
	return { apikey: SUPABASE_CLAVE_PUBLICA, Authorization: `Bearer ${ token }` };

}

/** Sesión de la cuenta «ejecutor» (EJECUTOR_CLAVE); null sin ella. */
export const cabecerasEjecutor = () => entrar( process.env.EJECUTOR_EMAIL || EJECUTOR, process.env.EJECUTOR_CLAVE, 'la cuenta ejecutor' );

/** Sesión del robot de Claude (ROBOT_EMAIL, ROBOT_CLAVE); null sin ellas. */
export const cabecerasRobotVersiones = () => entrar( process.env.ROBOT_EMAIL, process.env.ROBOT_CLAVE, 'el robot' );

async function pedir( cabeceras, ruta, opciones = {} ) {

	const r = await fetch( `${ SUPABASE_URL }${ ruta }`, { ...opciones, headers: { ...cabeceras, ...opciones.headers } } );
	if ( ! r.ok ) {

		const texto = await r.text();
		let mensaje = texto;
		try {

			mensaje = JSON.parse( texto ).message ?? texto;

		} catch { /* texto tal cual */ }
		throw new Error( String( mensaje ).slice( 0, 300 ) );

	}
	return r;

}

/** Llama a una función de la base de datos y devuelve su resultado. */
export async function llamar( cabeceras, funcion, cuerpo = {} ) {

	const r = await pedir( cabeceras, `/rest/v1/rpc/${ funcion }`, {
		method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify( cuerpo ),
	} );
	const texto = await r.text();
	return texto ? JSON.parse( texto ) : null;

}

/** Registro de versiones de una promoción, de la más antigua a la más reciente. */
export async function registroDe( cabeceras, id ) {

	const r = await pedir( cabeceras, `/rest/v1/versiones_promocion?promocion_id=eq.${ encodeURIComponent( id ) }&select=*&order=numero` );
	return r.json();

}

const rutaSitio = ( id, version ) => `${ encodeURIComponent( id ) }/${ encodeURIComponent( version ) }/sitio.tar.gz`;

/** Sube la web construida de una versión. No sustituye nunca a otra. */
export async function subirSitio( cabeceras, id, version, paquete ) {

	await pedir( cabeceras, `/storage/v1/object/versiones/${ rutaSitio( id, version ) }`, {
		method: 'POST', body: paquete, headers: { 'Content-Type': 'application/gzip', 'x-upsert': 'false' },
	} );

}

/** Baja la web construida de una versión (y comprueba su huella, si se indica). */
export async function bajarSitio( cabeceras, id, version, huella = null ) {

	const r = await pedir( cabeceras, `/storage/v1/object/authenticated/versiones/${ rutaSitio( id, version ) }` );
	const paquete = Buffer.from( await r.arrayBuffer() );
	if ( huella && sha256( paquete ) !== huella ) throw new Error( `La web guardada de la ${ version } de ${ id } no coincide con su huella` );
	return paquete;

}

export const sha256 = ( datos ) => createHash( 'sha256' ).update( datos ).digest( 'hex' );

/** Empaqueta una carpeta (tar.gz). */
export const empaquetar = ( carpeta ) => execFileSync( 'tar', [ '-czf', '-', '-C', carpeta, '.' ], { maxBuffer: 1 << 30 } );

/** Desempaqueta en una carpeta (que se crea). */
export function desempaquetar( paquete, carpeta ) {

	mkdirSync( carpeta, { recursive: true } );
	execFileSync( 'tar', [ '-xzf', '-', '-C', carpeta ], { input: paquete, maxBuffer: 1 << 30 } );

}
