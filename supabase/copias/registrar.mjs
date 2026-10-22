// Apunta en Supabase el resultado de una copia o de un simulacro (receta 18),
// con la cuenta «copias» de MUNE. MUNE Studio lo enseña en Sistema y avisa en
// Inicio si falta la copia de la noche o el simulacro de cada trimestre.
//
// Uso: node supabase/copias/registrar.mjs copia|simulacro bien|mal [archivo con el detalle en JSON]
// Variables: SUPABASE_URL, CLAVE_PUBLICA, COPIAS_CUENTA, COPIAS_CUENTA_CLAVE

import { existsSync, readFileSync } from 'node:fs';
import { falta } from './comun.mjs';

falta( 'SUPABASE_URL', 'CLAVE_PUBLICA', 'COPIAS_CUENTA', 'COPIAS_CUENTA_CLAVE' );
const [ tipo, resultado, archivo ] = process.argv.slice( 2 );
if ( ! [ 'copia', 'simulacro' ].includes( tipo ) || ! [ 'bien', 'mal' ].includes( resultado ) ) {

	console.error( 'Uso: registrar.mjs copia|simulacro bien|mal [detalle.json]' );
	process.exit( 2 );

}
const { SUPABASE_URL, CLAVE_PUBLICA, COPIAS_CUENTA, COPIAS_CUENTA_CLAVE } = process.env;
const detalle = archivo && existsSync( archivo ) ? JSON.parse( readFileSync( archivo, 'utf8' ) ) : {};

async function pedir( ruta, cuerpo, token ) {

	const r = await fetch( SUPABASE_URL + ruta, {
		method: 'POST', body: JSON.stringify( cuerpo ),
		headers: { apikey: CLAVE_PUBLICA, 'Content-Type': 'application/json', ...( token ? { Authorization: `Bearer ${ token }` } : {} ) },
	} );
	if ( ! r.ok ) throw new Error( `${ ruta.split( '?' )[ 0 ] }: ${ r.status } ${ ( await r.text() ).slice( 0, 200 ) }` );
	return r.status === 204 ? null : r.json();

}

const { access_token: token } = await pedir( '/auth/v1/token?grant_type=password', { email: COPIAS_CUENTA, password: COPIAS_CUENTA_CLAVE } );
await pedir( '/rest/v1/rpc/registrar_copia', { p_tipo: tipo, p_correcta: resultado === 'bien', p_detalle: detalle }, token );
console.log( `Apuntado en MUNE Studio: ${ tipo === 'copia' ? 'copia' : 'simulacro' } ${ resultado === 'bien' ? ( tipo === 'copia' ? 'correcta' : 'correcto' ) : 'con problemas' }.` );
