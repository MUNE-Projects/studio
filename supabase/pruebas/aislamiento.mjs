// Prueba automática de aislamiento entre promotoras.
//
// Levanta una base de datos de Supabase local y vacía (con `supabase start`,
// nunca la real), le aplica los archivos de supabase en orden, como
// se hace en el SQL Editor, crea dos promotoras inventadas (A y B) y
// comprueba, con la misma clave pública que usan las páginas, que:
//  · todos los intentos de saltarse las reglas FALLAN;
//  · el uso normal SIGUE FUNCIONANDO.
//
// Uso (desde supabase/, con el Supabase local en marcha en supabase/pruebas):
//   node pruebas/aislamiento.mjs
// Variables: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DB_URL
// (las imprime `supabase status -o env`). Por seguridad, solo acepta
// direcciones locales.

import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { createHash, createHmac } from 'node:crypto';
import { appendFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY, DB_URL } = process.env;
if ( ! SUPABASE_URL || ! SUPABASE_ANON_KEY || ! SUPABASE_SERVICE_KEY || ! DB_URL ) {

	console.error( 'Faltan SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY o DB_URL' );
	process.exit( 2 );

}
const local = ( u ) => /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/.test( u );
if ( ! local( SUPABASE_URL ) || ! local( DB_URL ) ) {

	console.error( 'Esta prueba solo se ejecuta contra un Supabase local, nunca contra el real.' );
	process.exit( 2 );

}

const SQL = join( dirname( fileURLToPath( import.meta.url ) ), '..' );
const CLAVE = 'prueba-aislamiento-123';
const opciones = { auth: { persistSession: false, autoRefreshToken: false } };
const servicio = createClient( SUPABASE_URL, SUPABASE_SERVICE_KEY, opciones );
const nuevo = () => createClient( SUPABASE_URL, SUPABASE_ANON_KEY, opciones );

// ─── Utilidades ─────────────────────────────────────────────────────────────

function aplicar( archivo ) {

	execFileSync( 'psql', [ DB_URL, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join( SQL, archivo ) ], { stdio: [ 'ignore', 'ignore', 'inherit' ], env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } } );

}

async function crearUsuario( email ) {

	const { data, error } = await servicio.auth.admin.createUser( { email, password: CLAVE, email_confirm: true } );
	if ( error ) throw new Error( `crear ${ email }: ${ error.message }` );
	return data.user.id;

}

// Solo con la contraseña (nivel «aal1»).
async function entrarSoloClave( email ) {

	const sb = nuevo();
	const { error } = await sb.auth.signInWithPassword( { email, password: CLAVE } );
	if ( error ) throw new Error( `entrar ${ email }: ${ error.message }` );
	return sb;

}

// Las personas de las promotoras entran con contraseña + código del móvil
// (032_movil_promotoras.sql): la primera vez lo vinculan y después lo usan.
// Las cuentas internas (administradora, robot y copias) entran solo con la
// contraseña; la administradora vincula su móvil aparte, como en MUNE Studio.
const INTERNAS = [ 'admin@prueba.local', 'robot@prueba.local', 'hello.muneprojects+copias@gmail.com' ];
const secretoMovil = {};
async function entrar( email ) {

	const sb = await entrarSoloClave( email );
	if ( INTERNAS.includes( email ) ) return sb;
	const { data: { totp } } = await sb.auth.mfa.listFactors();
	let factor = totp.find( ( f ) => f.status === 'verified' );
	if ( ! factor || ! secretoMovil[ email ] ) {

		const alta = await exigir( sb.auth.mfa.enroll( { factorType: 'totp', friendlyName: `Móvil ${ Date.now() }` } ), `vincular el móvil de ${ email }` );
		secretoMovil[ email ] = alta.totp.secret;
		factor = alta;

	}
	let { error } = await sb.auth.mfa.challengeAndVerify( { factorId: factor.id, code: codigoTotp( secretoMovil[ email ] ) } );
	if ( error ) {

		// un código ya usado en estos 30 segundos: se espera al siguiente
		await new Promise( ( ok ) => setTimeout( ok, 30_000 - ( Date.now() % 30_000 ) + 500 ) );
		( { error } = await sb.auth.mfa.challengeAndVerify( { factorId: factor.id, code: codigoTotp( secretoMovil[ email ] ) } ) );

	}
	if ( error ) throw new Error( `código del móvil de ${ email }: ${ error.message }` );
	return sb;

}

// Código del móvil (TOTP, RFC 6238) a partir del secreto en base 32.
function codigoTotp( secreto ) {

	const alfabeto = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
	let bits = '';
	for ( const c of secreto.replace( /=+$/, '' ).toUpperCase() ) bits += alfabeto.indexOf( c ).toString( 2 ).padStart( 5, '0' );
	const clave = Buffer.from( bits.match( /.{8}/g ).map( ( b ) => parseInt( b, 2 ) ) );
	const contador = Buffer.alloc( 8 );
	contador.writeBigUInt64BE( BigInt( Math.floor( Date.now() / 30000 ) ) );
	const h = createHmac( 'sha1', clave ).update( contador ).digest();
	const o = h[ h.length - 1 ] & 0xf;
	return String( ( h.readUInt32BE( o ) & 0x7fffffff ) % 1e6 ).padStart( 6, '0' );

}

const huella = ( buf ) => createHash( 'sha256' ).update( buf ).digest( 'hex' );
const pdf = ( texto ) => Buffer.from( `%PDF-1.4\n% ${ texto }\n%%EOF\n` );

async function exigir( promesa, que ) {

	const { data, error } = await promesa;
	if ( error ) throw new Error( `${ que }: ${ error.message }` );
	return data;

}

// ─── Preparación ────────────────────────────────────────────────────────────

console.log( 'Preparando la base de datos de prueba…' );

// Mismo orden que en el SQL Editor (001 y 003 exigen que existan ya la
// administradora y el robot).
await crearUsuario( 'admin@prueba.local' );
aplicar( '001_panel.sql' );
aplicar( '002_promociones.sql' );
const robotId = await crearUsuario( 'robot@prueba.local' );
aplicar( '003_peticiones.sql' );
for ( const f of readdirSync( SQL ).filter( ( f ) => /^\d{3}_.*\.sql$/.test( f ) && f > '003' ).sort() ) aplicar( f );

// Administradora con contraseña + código del móvil.
const admin = await entrar( 'admin@prueba.local' );
const factor = await exigir( admin.auth.mfa.enroll( { factorType: 'totp' } ), 'alta del código del móvil' );
await exigir( admin.auth.mfa.challengeAndVerify( { factorId: factor.id, code: codigoTotp( factor.totp.secret ) } ), 'código del móvil' );
const adminSinMovil = await entrar( 'admin@prueba.local' );

// Dos promotoras con una promoción cada una, dadas de alta por la administradora.
const [ pA ] = await exigir( admin.from( 'promotoras' ).insert( { nombre: 'Promotora A (prueba)' } ).select( 'id' ), 'alta promotora A' );
const [ pB ] = await exigir( admin.from( 'promotoras' ).insert( { nombre: 'Promotora B (prueba)' } ).select( 'id' ), 'alta promotora B' );
await exigir( admin.from( 'promociones' ).insert( [
	{ id: 'prueba-a', promotora_id: pA.id, nombre: 'Residencial A' },
	{ id: 'prueba-a2', promotora_id: pA.id, nombre: 'Residencial A2 (otro equipo)' },
	{ id: 'prueba-a-baja', promotora_id: pA.id, nombre: 'Residencial A (se desactiva)' },
	{ id: 'prueba-b', promotora_id: pB.id, nombre: 'Residencial B' },
] ), 'alta promociones' );
const reqs = await exigir( admin.from( 'requisitos' ).insert( [
	{ promocion_id: 'prueba-a', bloque: 'Planos', elemento: 'Planta tipo' },
	{ promocion_id: 'prueba-a2', bloque: 'Planos', elemento: 'Planta tipo' },
	{ promocion_id: 'prueba-a-baja', bloque: 'Planos', elemento: 'Planta tipo' },
	{ promocion_id: 'prueba-b', bloque: 'Planos', elemento: 'Planta tipo' },
] ).select( 'id, promocion_id' ), 'alta requisitos' );
const req = Object.fromEntries( reqs.map( ( r ) => [ r.promocion_id, r.id ] ) );

// Personas: en A, un gestor y una aprobadora; en B, una aprobadora.
// Personas (acceso por promoción, sin roles): en A, un comercial solo de
// «prueba-a» y una directora con acceso a todas; en B, una técnica de «prueba-b».
const personas = [
	[ 'gestor.a@prueba.local', pA.id, 'prueba-a', 'Comercial' ],
	[ 'aprobadora.a@prueba.local', pA.id, null, 'Directora' ],
	[ 'aprobadora.b@prueba.local', pB.id, 'prueba-b', 'Técnica' ],
];
// (quien tiene acceso a todas administra la promotora: 020_equipos_y_validaciones.sql)
const idDe = {};
for ( const [ email, promotora, promocion, cargo ] of personas ) {

	const id = idDe[ email ] = await crearUsuario( email );
	await exigir( admin.from( 'miembros' ).insert( { user_id: id, promotora_id: promotora, promocion_id: promocion, nombre: email, email, cargo, administra: promocion === null } ), `acceso ${ email }` );

}
const gestorAId = idDe[ 'gestor.a@prueba.local' ];
const aprobAId = idDe[ 'aprobadora.a@prueba.local' ];
const gestorA = await entrar( 'gestor.a@prueba.local' );
const aprobA = await entrar( 'aprobadora.a@prueba.local' );
const aprobB = await entrar( 'aprobadora.b@prueba.local' );
const robot = await entrar( 'robot@prueba.local' );
const anonimo = nuevo();

// Cada promotora sube y registra un documento suyo.
async function subirDocumento( sb, promotora, promocion, texto ) {

	const contenido = pdf( texto );
	const ruta = `${ promotora }/${ promocion }/${ req[ promocion ] }/${ Date.now() }-planta.pdf`;
	const subida = await sb.storage.from( 'documentos' ).upload( ruta, contenido, { contentType: 'application/pdf' } );
	if ( subida.error ) return { error: subida.error, ruta };
	const { data, error } = await sb.from( 'documentos' ).insert( {
		promocion_id: promocion, requisito_id: req[ promocion ], nombre: 'planta.pdf', ruta,
		tipo: 'application/pdf', tamano: contenido.length, huella: huella( contenido ),
	} ).select( 'id, estado, version, subido_por' ).single();
	return { data, error, ruta };

}
const docB = await subirDocumento( aprobB, pB.id, 'prueba-b', 'documento de B' );
if ( docB.error ) throw new Error( `B no puede subir su documento: ${ docB.error.message }` );

// La administradora deja un plano de cada promoción pendiente de validación.
async function entregable( promocion, texto ) {

	const contenido = pdf( texto );
	const ruta = `${ promocion }/v1/plano-tipo-a.pdf`;
	await exigir( admin.storage.from( 'entregables' ).upload( ruta, contenido, { contentType: 'application/pdf' } ), `subir plano ${ promocion }` );
	return exigir( admin.from( 'entregables' ).insert( {
		promocion_id: promocion, version: 'v1', tipo: 'plano', tipologia: 'A', nombre: 'Plano tipo A', ruta, huella: huella( contenido ),
	} ).select( 'id, ruta, huella' ).single(), `registrar plano ${ promocion }` );

}
const planoA = await entregable( 'prueba-a', 'plano de A' );
const planoB = await entregable( 'prueba-b', 'plano de B' );
const planoBaja = await entregable( 'prueba-a-baja', 'plano de A (baja)' );
const planoA2 = await entregable( 'prueba-a2', 'plano de A2' );

// ─── Comprobaciones ─────────────────────────────────────────────────────────

const resultados = [];
async function caso( grupo, texto, prueba ) {

	let ok = false, detalle = '';
	try {

		ok = await prueba();

	} catch ( e ) {

		detalle = e.message;

	}
	resultados.push( { grupo, texto, ok, detalle } );
	console.log( `${ ok ? '✔' : '✘' } ${ texto }${ detalle ? ` (${ detalle })` : '' }` );

}

const vacio = ( r ) => ! r.error && Array.isArray( r.data ) && r.data.length === 0;
const falla = ( r ) => !! r.error;
const filaDe = async ( tabla, id ) => ( await servicio.from( tabla ).select( '*' ).eq( 'id', id ).single() ).data;

const DEBE_FALLAR = 'Intentos que deben fallar';
const DEBE_FUNCIONAR = 'Uso normal que debe funcionar';

// Los 13 intentos del apartado 8 de la arquitectura.
await caso( DEBE_FALLAR, '1. A intenta ver las promociones de B', async () =>
	vacio( await gestorA.from( 'promociones' ).select( 'id' ).eq( 'promotora_id', pB.id ) )
	&& vacio( await gestorA.from( 'promotoras' ).select( 'id' ).eq( 'id', pB.id ) ) );

await caso( DEBE_FALLAR, '2. A intenta leer las fichas de documentos de B', async () =>
	vacio( await gestorA.from( 'documentos' ).select( 'id' ).eq( 'promocion_id', 'prueba-b' ) )
	&& vacio( await gestorA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-b' ) )
	&& vacio( await gestorA.from( 'entregables' ).select( 'id' ).eq( 'promocion_id', 'prueba-b' ) ) );

await caso( DEBE_FALLAR, '3. A intenta listar los archivos de B', async () => {

	const docs = await gestorA.storage.from( 'documentos' ).list( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }` );
	const entr = await gestorA.storage.from( 'entregables' ).list( 'prueba-b/v1' );
	return ( falla( docs ) || vacio( docs ) ) && ( falla( entr ) || vacio( entr ) );

} );

await caso( DEBE_FALLAR, '4. A intenta descargar un archivo de B conociendo su ruta exacta', async () =>
	falla( await gestorA.storage.from( 'documentos' ).download( docB.ruta ) )
	&& falla( await gestorA.storage.from( 'documentos' ).createSignedUrl( docB.ruta, 60 ) )
	&& falla( await gestorA.storage.from( 'entregables' ).download( planoB.ruta ) ) );

await caso( DEBE_FALLAR, '5. A intenta subir un archivo a la carpeta de B', async () =>
	falla( await gestorA.storage.from( 'documentos' ).upload( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }/intruso.pdf`, pdf( 'intruso' ) ) )
	// …ni disfrazando la ruta con su promotora y la promoción de B
	&& falla( await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-b/${ req[ 'prueba-b' ] }/intruso.pdf`, pdf( 'intruso' ) ) )
	// …ni con su promoción y un requisito de B
	&& falla( await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a/${ req[ 'prueba-b' ] }/intruso.pdf`, pdf( 'intruso' ) ) ) );

await caso( DEBE_FALLAR, '6. A intenta registrar un documento con la promoción de B', async () => {

	const contenido = pdf( 'de A' );
	const r1 = await gestorA.from( 'documentos' ).insert( {
		promocion_id: 'prueba-b', requisito_id: req[ 'prueba-b' ], nombre: 'x.pdf', ruta: docB.ruta + '-copia', huella: huella( contenido ),
	} );
	// …ni apuntando a un archivo de B desde su propia promoción
	const r2 = await gestorA.from( 'documentos' ).insert( {
		promocion_id: 'prueba-a', requisito_id: req[ 'prueba-a' ], nombre: 'x.pdf', ruta: docB.ruta, huella: huella( contenido ),
	} );
	return falla( r1 ) && falla( r2 );

} );

await caso( DEBE_FALLAR, '7. A intenta cambiar el estado de su propia promoción', async () => {

	await gestorA.from( 'promociones' ).update( { estado: 'publicada' } ).eq( 'id', 'prueba-a' );
	await gestorA.from( 'promociones' ).update( { activa: true, nombre: 'cambiado' } ).eq( 'id', 'prueba-a' );
	const p = await filaDe( 'promociones', 'prueba-a' );
	return p.estado === 'documentacion' && p.nombre === 'Residencial A';

} );

await caso( DEBE_FALLAR, '8. A intenta crear una promoción nueva', async () =>
	falla( await gestorA.from( 'promociones' ).insert( { id: 'prueba-intrusa', promotora_id: pA.id, nombre: 'Intrusa' } ) )
	&& falla( await gestorA.from( 'promotoras' ).insert( { nombre: 'Intrusa' } ) )
	&& falla( await gestorA.from( 'requisitos' ).insert( { promocion_id: 'prueba-a', bloque: 'x', elemento: 'x' } ) ) );

// Documento propio de A, para los casos 9 y 10.
const docA = await subirDocumento( gestorA, pA.id, 'prueba-a', 'documento de A' );

await caso( DEBE_FALLAR, '9. A intenta marcar su documento como «vigente»', async () => {

	const r = await gestorA.from( 'documentos' ).update( { estado: 'vigente' } ).eq( 'id', docA.data.id );
	// …ni colándolo ya como vigente al subirlo
	const otro = pdf( 'otro de A' );
	const ruta = `${ pA.id }/prueba-a/${ req[ 'prueba-a' ] }/vigente.pdf`;
	await gestorA.storage.from( 'documentos' ).upload( ruta, otro );
	const r2 = await gestorA.from( 'documentos' ).insert( {
		promocion_id: 'prueba-a', requisito_id: req[ 'prueba-a' ], nombre: 'v.pdf', ruta, huella: huella( otro ), estado: 'vigente',
	} );
	return ( falla( r ) || ( await filaDe( 'documentos', docA.data.id ) ).estado === 'pendiente' ) && falla( r2 );

} );

await caso( DEBE_FALLAR, '10. A intenta borrar su propio documento', async () => {

	await gestorA.from( 'documentos' ).delete().eq( 'id', docA.data.id );
	await gestorA.storage.from( 'documentos' ).remove( [ docA.ruta ] );
	// …ni sobrescribirlo
	await gestorA.storage.from( 'documentos' ).upload( docA.ruta, pdf( 'cambiado' ), { upsert: true } );
	const fila = await filaDe( 'documentos', docA.data.id );
	const archivo = await servicio.storage.from( 'documentos' ).download( docA.ruta );
	return !! fila && ! archivo.error && huella( Buffer.from( await archivo.data.arrayBuffer() ) ) === fila.huella;

} );

await caso( DEBE_FALLAR, '11. Una persona del equipo de una promoción intenta ver o tocar otra promoción de su misma promotora', async () =>
	vacio( await gestorA.from( 'promociones' ).select( 'id' ).eq( 'id', 'prueba-a2' ) )
	&& vacio( await gestorA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a2' ) )
	&& vacio( await gestorA.from( 'entregables' ).select( 'id' ).eq( 'promocion_id', 'prueba-a2' ) )
	&& falla( await gestorA.storage.from( 'entregables' ).download( planoA2.ruta ) )
	&& falla( await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a2/${ req[ 'prueba-a2' ] }/x.pdf`, pdf( 'x' ) ) )
	&& falla( await gestorA.from( 'validaciones' ).insert( { entregable_id: planoA2.id, decision: 'aprobado', confirmado: true } ) )
	&& falla( await gestorA.rpc( 'guardar_datos_promocion', { p_promocion: 'prueba-a2', p_razon_social: 'x', p_cif: 'x', p_domicilio_fiscal: 'x' } ) ) );

await caso( DEBE_FALLAR, '12. A intenta ver su promoción después de ser desactivada', async () => {

	await exigir( admin.from( 'promociones' ).update( { activa: false } ).eq( 'id', 'prueba-a-baja' ), 'desactivar' );
	// (la directora tiene acceso a todas las promociones de A)
	return vacio( await aprobA.from( 'promociones' ).select( 'id' ).eq( 'id', 'prueba-a-baja' ) )
		&& vacio( await aprobA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a-baja' ) )
		&& falla( await aprobA.storage.from( 'entregables' ).download( planoBaja.ruta ) )
		&& falla( await aprobA.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a-baja/${ req[ 'prueba-a-baja' ] }/x.pdf`, pdf( 'x' ) ) );

} );

await caso( DEBE_FALLAR, '13. Alguien sin sesión intenta leer cualquier cosa', async () => {

	for ( const t of [ 'promotoras', 'promociones', 'miembros', 'requisitos', 'documentos', 'entregables', 'validaciones', 'registro', 'peticiones', 'administradores' ] ) {

		const r = await anonimo.from( t ).select( '*' ).limit( 1 );
		if ( ! falla( r ) && ! vacio( r ) ) throw new Error( `ve ${ t }` );

	}
	return falla( await anonimo.storage.from( 'documentos' ).download( docB.ruta ) )
		&& falla( await anonimo.storage.from( 'entregables' ).download( planoB.ruta ) )
		&& falla( await anonimo.storage.from( 'documentos' ).upload( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }/anonimo.pdf`, pdf( 'x' ) ) );

} );

// Comprobaciones añadidas.
await caso( DEBE_FALLAR, '14. A intenta ver las personas con acceso de B, el registro o las peticiones', async () =>
	vacio( await gestorA.from( 'miembros' ).select( 'user_id' ).eq( 'promotora_id', pB.id ) )
	&& vacio( await gestorA.from( 'registro' ).select( 'id' ) )
	&& vacio( await gestorA.from( 'peticiones' ).select( 'id' ) )
	&& vacio( await gestorA.from( 'administradores' ).select( 'user_id' ) ) );

await caso( DEBE_FALLAR, '15. Una persona intenta ampliarse el acceso (a otra promoción o a todas)', async () => {

	const { data: { user } } = await gestorA.auth.getUser();
	await gestorA.from( 'miembros' ).update( { promocion_id: null } ).eq( 'user_id', user.id );
	const r1 = await gestorA.from( 'miembros' ).insert( { user_id: user.id, promotora_id: pA.id, promocion_id: null, nombre: 'x', email: 'x@x' } );
	const r2 = await gestorA.from( 'miembros' ).insert( { user_id: user.id, promotora_id: pA.id, promocion_id: 'prueba-a2', nombre: 'x', email: 'x@x' } );
	const filas = ( await servicio.from( 'miembros' ).select( 'promocion_id' ).eq( 'user_id', user.id ) ).data;
	return falla( r1 ) && falla( r2 ) && filas.length === 1 && filas[ 0 ].promocion_id === 'prueba-a';

} );

await caso( DEBE_FALLAR, '16. Una aprobadora de B intenta aprobar un plano de A', async () =>
	falla( await aprobB.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'aprobado', confirmado: true } ) ) );

await caso( DEBE_FALLAR, '17. El robot intenta borrar, subir documentos o validar planos', async () => {

	await robot.from( 'documentos' ).delete().eq( 'id', docB.data.id );
	await robot.storage.from( 'documentos' ).remove( [ docB.ruta ] );
	await robot.from( 'promociones' ).update( { activa: false } ).eq( 'id', 'prueba-b' );
	const archivo = await servicio.storage.from( 'documentos' ).download( docB.ruta );
	return !! ( await filaDe( 'documentos', docB.data.id ) ) && ! archivo.error
		&& ( await filaDe( 'promociones', 'prueba-b' ) ).activa === true
		&& falla( await robot.storage.from( 'documentos' ).upload( `${ pB.id }/prueba-b/${ req[ 'prueba-b' ] }/robot.pdf`, pdf( 'x' ) ) )
		&& falla( await robot.from( 'documentos' ).insert( {
			promocion_id: 'prueba-b', requisito_id: req[ 'prueba-b' ], nombre: 'r.pdf', ruta: docB.ruta + '-r', huella: huella( pdf( 'r' ) ),
		} ) )
		&& falla( await robot.from( 'validaciones' ).insert( { entregable_id: planoB.id, decision: 'aprobado', confirmado: true } ) );

} );

await caso( DEBE_FALLAR, '18. La administradora sin el código del móvil no ve nada', async () =>
	vacio( await adminSinMovil.from( 'promociones' ).select( 'id' ) )
	&& vacio( await adminSinMovil.from( 'documentos' ).select( 'id' ) )
	&& falla( await adminSinMovil.from( 'promotoras' ).insert( { nombre: 'x' } ) ) );

await caso( DEBE_FALLAR, '19. Rechazar un plano sin comentario, o aprobarlo sin la casilla de confirmación', async () =>
	falla( await aprobA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'rechazado', comentario: '' } ) )
	&& falla( await aprobA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'aprobado', confirmado: false } ) ) );

await caso( DEBE_FALLAR, '20. Una persona con el acceso retirado intenta seguir entrando', async () => {

	const id = await crearUsuario( 'baja.a@prueba.local' );
	await exigir( admin.from( 'miembros' ).insert( { user_id: id, promotora_id: pA.id, promocion_id: 'prueba-a', nombre: 'Baja', email: 'baja.a@prueba.local' } ), 'acceso' );
	const baja = await entrar( 'baja.a@prueba.local' );
	const antes = await baja.from( 'promociones' ).select( 'id' ).eq( 'id', 'prueba-a' );
	await exigir( admin.from( 'miembros' ).update( { activo: false } ).eq( 'user_id', id ), 'retirar acceso' );
	// Misma sesión abierta: el efecto es inmediato.
	return antes.data?.length === 1 && vacio( await baja.from( 'promociones' ).select( 'id' ) )
		&& falla( await baja.storage.from( 'entregables' ).download( planoA.ruta ) );

} );

await caso( DEBE_FALLAR, '44. Una persona de una promotora con solo la contraseña (sin el código del móvil) no ve ni cambia nada', async () => {

	const sinMovil = await entrarSoloClave( 'aprobadora.a@prueba.local' );
	const subida = await subirDocumento( sinMovil, pA.id, 'prueba-a', 'sin el código del móvil' );
	return vacio( await sinMovil.from( 'promociones' ).select( 'id' ) )
		&& vacio( await sinMovil.from( 'miembros' ).select( 'id' ) )
		&& vacio( await sinMovil.from( 'requisitos' ).select( 'id' ) )
		&& vacio( await sinMovil.from( 'documentos' ).select( 'id' ) )
		&& vacio( await sinMovil.from( 'entregables' ).select( 'id' ) )
		&& falla( await sinMovil.storage.from( 'entregables' ).download( planoA.ruta ) )
		&& falla( await sinMovil.rpc( 'equipo_de_promotora', { p_promotora: pA.id } ) )
		&& !! subida.error
		&& falla( await sinMovil.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'aprobado', confirmado: true } ) );

} );

// Uso normal.
await caso( DEBE_FUNCIONAR, 'A ve sus promociones (y solo las activas)', async () => {

	const { data } = await gestorA.from( 'promociones' ).select( 'id' ).order( 'id' );
	return JSON.stringify( data.map( ( p ) => p.id ) ) === '["prueba-a"]';

} );

await caso( DEBE_FUNCIONAR, 'Quien tiene acceso a todas ve todas las promociones activas de su promotora', async () => {

	const { data } = await aprobA.from( 'promociones' ).select( 'id' ).order( 'id' );
	return JSON.stringify( data.map( ( p ) => p.id ) ) === '["prueba-a","prueba-a2"]';

} );

await caso( DEBE_FUNCIONAR, 'El equipo rellena los datos fiscales de su promoción; los de la promotora, solo quien la administra (y nada más)', async () => {

	await exigir( gestorA.rpc( 'guardar_datos_promocion', { p_promocion: 'prueba-a', p_razon_social: 'Las Eras Promociones S.L.', p_cif: 'b11111111', p_domicilio_fiscal: 'Calle Mayor 1' } ), 'datos promoción' );
	const sinAdministrar = await gestorA.rpc( 'guardar_datos_promotora', { p_promotora: pA.id, p_razon_social: 'x', p_cif: 'x', p_domicilio_fiscal: 'x', p_contacto: 'x' } );
	await exigir( aprobA.rpc( 'guardar_datos_promotora', { p_promotora: pA.id, p_razon_social: 'Grupo A S.A.', p_cif: 'a22222222', p_domicilio_fiscal: 'Calle Real 2', p_contacto: 'info@a.local' } ), 'datos promotora' );
	const p = await filaDe( 'promociones', 'prueba-a' );
	const po = ( await servicio.from( 'promotoras' ).select( 'cif' ).eq( 'id', pA.id ).single() ).data;
	const ajena = await aprobA.rpc( 'guardar_datos_promotora', { p_promotora: pB.id, p_razon_social: 'x', p_cif: 'x', p_domicilio_fiscal: 'x', p_contacto: 'x' } );
	const directa = await gestorA.from( 'promociones' ).update( { cif: 'X' } ).eq( 'id', 'prueba-a' );
	return p.cif === 'B11111111' && p.estado === 'documentacion' && po.cif === 'A22222222' && falla( ajena ) && falla( directa ) && falla( sinAdministrar );

} );

await caso( DEBE_FUNCIONAR, 'El equipo rellena la ficha de su promoción (dirección, tipo, viviendas…); no la de otra', async () => {

	const ficha = ( p ) => ( {
		p_promocion: p, p_direccion: 'Calle de las Eras 3', p_codigo_postal: '19208', p_municipio: 'Alovera', p_provincia: 'Guadalajara',
		p_referencia_catastral: '1234567 VK7913S', p_tipo: 'plurifamiliar', p_num_viviendas: 48, p_num_portales: 2, p_num_plantas: 5, p_fecha_entrega: '2028-06-30',
	} );
	await exigir( gestorA.rpc( 'guardar_ficha_promocion', ficha( 'prueba-a' ) ), 'ficha' );
	const p = await filaDe( 'promociones', 'prueba-a' );
	const ajena = await gestorA.rpc( 'guardar_ficha_promocion', ficha( 'prueba-a2' ) );
	const mala = await gestorA.rpc( 'guardar_ficha_promocion', { ...ficha( 'prueba-a' ), p_tipo: 'chalet' } );
	return p.num_viviendas === 48 && p.referencia_catastral === '1234567VK7913S' && p.tipo === 'plurifamiliar'
		&& falla( ajena ) && falla( mala ) && ( await filaDe( 'promociones', 'prueba-a2' ) ).num_viviendas === null;

} );

await caso( DEBE_FUNCIONAR, 'Lista estándar de documentos: solo la administradora la aplica, y lo quitado deja de verse', async () => {

	await exigir( admin.from( 'promociones' ).insert( { id: 'prueba-a3', promotora_id: pA.id, nombre: 'Residencial A3 (lista estándar)' } ), 'promoción nueva' );
	const intruso = await aprobA.rpc( 'aplicar_lista_estandar', { p_promocion: 'prueba-a3' } );
	const n = await exigir( admin.rpc( 'aplicar_lista_estandar', { p_promocion: 'prueba-a3' } ), 'lista estándar' );
	const repetida = await admin.rpc( 'aplicar_lista_estandar', { p_promocion: 'prueba-a3' } );
	const { data: lista } = await admin.from( 'requisitos' ).select( 'id, plantilla' ).eq( 'promocion_id', 'prueba-a3' ).eq( 'activo', true ).order( 'orden' );
	await exigir( admin.from( 'requisitos' ).update( { activo: false } ).eq( 'id', lista.at( -1 ).id ), 'quitar' );
	const quitarIntruso = await aprobA.from( 'requisitos' ).update( { activo: false } ).eq( 'id', lista[ 0 ].id ).select();
	const vista = ( await aprobA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a3' ) ).data;
	return falla( intruso ) && falla( repetida ) && n === 10 && lista.every( ( r ) => r.plantilla === null )
		&& ( falla( quitarIntruso ) || vacio( quitarIntruso ) ) && vista.length === lista.length - 1;

} );

await caso( DEBE_FUNCIONAR, 'A ve su lista de documentos por entregar', async () =>
	( await gestorA.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ) ).data?.length === 1 );

await caso( DEBE_FUNCIONAR, 'A sube un documento a su lista: entra como «pendiente», versión 1, a su nombre', async () => {

	const { data: { user } } = await gestorA.auth.getUser();
	return ! docA.error && docA.data.estado === 'pendiente' && docA.data.version === 1 && docA.data.subido_por === user.id;

} );

await caso( DEBE_FUNCIONAR, 'A sube una versión nueva: queda como versión 2 y remite a la anterior', async () => {

	const v2 = await subirDocumento( gestorA, pA.id, 'prueba-a', 'documento de A, v2' );
	const fila = await filaDe( 'documentos', v2.data.id );
	return fila.version === 2 && fila.reemplaza_a === docA.data.id;

} );

await caso( DEBE_FUNCIONAR, 'A descarga su documento y sus entregables', async () =>
	! falla( await gestorA.storage.from( 'documentos' ).download( docA.ruta ) )
	&& ! falla( await gestorA.storage.from( 'entregables' ).download( planoA.ruta ) )
	&& ! falla( await gestorA.storage.from( 'entregables' ).createSignedUrl( planoA.ruta, 60 ) ) );

// Quien administra la promoción elige quién valida los planos comerciales.
await exigir( aprobA.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'planos', p_personas: [ aprobAId ] } ), 'aprobadores prueba-a' );

await caso( DEBE_FUNCIONAR, 'La aprobadora de A aprueba su plano: queda la huella del archivo exacto', async () => {

	const v = await exigir( aprobA.from( 'validaciones' ).insert( {
		entregable_id: planoA.id, decision: 'aprobado', confirmado: true, comentario: 'Revisado',
	} ).select( 'huella, version, promocion_id' ).single(), 'aprobar' );
	return v.huella === planoA.huella && v.version === 'v1' && v.promocion_id === 'prueba-a';

} );

await caso( DEBE_FALLAR, '21. Cambiar o repetir una validación ya registrada', async () => {

	await aprobA.from( 'validaciones' ).update( { decision: 'rechazado' } ).eq( 'entregable_id', planoA.id );
	await aprobA.from( 'validaciones' ).delete().eq( 'entregable_id', planoA.id );
	const r = await aprobA.from( 'validaciones' ).insert( { entregable_id: planoA.id, decision: 'rechazado', comentario: 'Otra vez' } );
	const fila = ( await servicio.from( 'validaciones' ).select( 'decision' ).eq( 'entregable_id', planoA.id ) ).data;
	return falla( r ) && fila.length === 1 && fila[ 0 ].decision === 'aprobado';

} );

await caso( DEBE_FUNCIONAR, 'El robot lee los documentos y marca uno como vigente, con nota', async () => {

	const docs = await robot.from( 'documentos' ).select( 'id' );
	const archivo = await robot.storage.from( 'documentos' ).download( docB.ruta );
	await exigir( robot.from( 'documentos' ).update( { estado: 'vigente', nota: 'Correcto' } ).eq( 'id', docB.data.id ), 'marcar vigente' );
	const fila = await filaDe( 'documentos', docB.data.id );
	return docs.data.length >= 3 && ! archivo.error && fila.estado === 'vigente' && fila.revisado_por === robotId;

} );

await caso( DEBE_FUNCIONAR, 'La administradora ve todo y el registro anota subidas, revisiones y validaciones', async () => {

	const { data } = await admin.from( 'registro' ).select( 'accion' );
	const acciones = new Set( data.map( ( r ) => r.accion ) );
	const todas = ( await admin.from( 'promociones' ).select( 'id' ) ).data.length;
	return [ 'documento_subido', 'documento_vigente', 'plano_aprobado', 'acceso_dado', 'acceso_cambiado' ].every( ( a ) => acciones.has( a ) ) && todas >= 4;

} );

// ─── Aviso de subida (Etapa 3) ──────────────────────────────────────────────

await caso( DEBE_FALLAR, '26. Pedir el aviso de un documento ajeno, o repetir el aviso de uno propio', async () => {

	const v2 = await subirDocumento( gestorA, pA.id, 'prueba-a', 'para el aviso' );
	const ajeno = await aprobB.rpc( 'marcar_aviso_subida', { p_documento: v2.data.id } );
	const intruso = await anonimo.rpc( 'marcar_aviso_subida', { p_documento: v2.data.id } );
	const primero = await gestorA.rpc( 'marcar_aviso_subida', { p_documento: v2.data.id } );
	const segundo = await gestorA.rpc( 'marcar_aviso_subida', { p_documento: v2.data.id } );
	const fila = await filaDe( 'documentos', v2.data.id );
	return ajeno.data === false && ( falla( intruso ) || intruso.data === false )
		&& primero.data === true && segundo.data === false && fila.avisado === true && fila.revisado_por === null;

} );

// ─── Borrar una promoción o una promotora (010_borrar.sql) ──────────────────

// Una promoción de A con de todo: documento, plano validado, acceso, petición con foto.
await exigir( admin.from( 'promociones' ).insert( { id: 'prueba-borrar', promotora_id: pA.id, nombre: 'Residencial que se borra' } ), 'alta prueba-borrar' );
const [ reqBorrar ] = await exigir( admin.from( 'requisitos' ).insert( { promocion_id: 'prueba-borrar', bloque: 'Planos', elemento: 'Planta tipo' } ).select( 'id' ), 'requisito prueba-borrar' );
req[ 'prueba-borrar' ] = reqBorrar.id;
const docBorrar = await subirDocumento( aprobA, pA.id, 'prueba-borrar', 'documento que se borra' );
const planoBorrar = await entregable( 'prueba-borrar', 'plano que se borra' );
await exigir( admin.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-borrar', p_tipo: 'planos', p_personas: [ aprobAId ] } ), 'aprobadores prueba-borrar' );
await exigir( aprobA.from( 'validaciones' ).insert( { entregable_id: planoBorrar.id, decision: 'aprobado', confirmado: true } ), 'validar plano prueba-borrar' );
const idEquipoBorrar = await crearUsuario( 'equipo.borrar@prueba.local' );
await exigir( admin.from( 'miembros' ).insert( { user_id: idEquipoBorrar, promotora_id: pA.id, promocion_id: 'prueba-borrar', nombre: 'Equipo', email: 'equipo.borrar@prueba.local' } ), 'acceso prueba-borrar' );
const peticionBorrar = await exigir( admin.from( 'peticiones' ).insert( { promocion_id: 'prueba-borrar', texto: 'Cambiar el suelo' } ).select( 'id' ).single(), 'petición prueba-borrar' );
const fotoBorrar = `${ peticionBorrar.id }/foto.png`;
await exigir( admin.storage.from( 'referencias' ).upload( fotoBorrar, Buffer.from( 'png' ), { contentType: 'image/png' } ), 'foto prueba-borrar' );
const existe = async ( almacen, ruta ) => ! ( await servicio.storage.from( almacen ).download( ruta ) ).error;

await caso( DEBE_FALLAR, '27. Borrar una promoción: alguien que no es la administradora, una promoción activa, o con el nombre mal escrito', async () => {

	const intentos = [
		await aprobA.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial que se borra' } ),
		await robot.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial que se borra' } ),
		await anonimo.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial que se borra' } ),
		await adminSinMovil.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial que se borra' } ),
		await admin.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial que se borra' } ), // aún activa
		await aprobA.rpc( 'archivos_de_promocion', { p_id: 'prueba-borrar' } ),
	];
	// Ni la administradora puede borrar archivos de una promoción activa.
	await admin.storage.from( 'documentos' ).remove( [ docBorrar.ruta, docA.ruta ] );
	await exigir( admin.from( 'promociones' ).update( { activa: false } ).eq( 'id', 'prueba-borrar' ), 'desactivar prueba-borrar' );
	// Desactivada: sigue sin poder la promotora, ni la administradora con el nombre mal.
	await aprobA.storage.from( 'documentos' ).remove( [ docBorrar.ruta ] );
	const malNombre = await admin.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial' } );
	// …ni borrar mientras queden archivos.
	const conArchivos = await admin.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: 'Residencial que se borra' } );
	return intentos.every( falla ) && falla( malNombre ) && falla( conArchivos )
		&& await existe( 'documentos', docBorrar.ruta ) && await existe( 'documentos', docA.ruta )
		&& !! ( await filaDe( 'promociones', 'prueba-borrar' ) );

} );

await caso( DEBE_FUNCIONAR, 'La administradora borra una promoción desactivada: desaparece todo lo suyo y nada de las demás', async () => {

	const lista = await exigir( admin.rpc( 'archivos_de_promocion', { p_id: 'prueba-borrar' } ), 'lista de archivos' );
	if ( lista.length !== 3 ) throw new Error( `esperaba 3 archivos y hay ${ lista.length }` );
	for ( const almacen of [ 'documentos', 'entregables', 'referencias' ] ) {

		await exigir( admin.storage.from( almacen ).remove( lista.filter( ( a ) => a.bucket === almacen ).map( ( a ) => a.nombre ) ), `borrar ${ almacen }` );

	}
	await exigir( admin.rpc( 'borrar_promocion', { p_id: 'prueba-borrar', p_nombre: ' Residencial que se borra ' } ), 'borrar promoción' );
	const quedan = await Promise.all( [ 'requisitos', 'documentos', 'entregables', 'validaciones', 'miembros', 'peticiones' ].map( async ( t ) =>
		( await servicio.from( t ).select( '*', { count: 'exact', head: true } ).eq( 'promocion_id', 'prueba-borrar' ) ).count ) );
	const { data: anotado } = await admin.from( 'registro' ).select( 'detalle' ).eq( 'accion', 'borra una promoción' );
	return ! ( await filaDe( 'promociones', 'prueba-borrar' ) ) && quedan.every( ( n ) => n === 0 )
		&& ! await existe( 'documentos', docBorrar.ruta ) && ! await existe( 'entregables', planoBorrar.ruta ) && ! await existe( 'referencias', fotoBorrar )
		&& await existe( 'documentos', docA.ruta ) && await existe( 'documentos', docB.ruta ) && await existe( 'entregables', planoA.ruta )
		&& !! ( await filaDe( 'promociones', 'prueba-a' ) ) && anotado?.[ 0 ]?.detalle?.documentos === 1;

} );

// Una promotora C con una promoción activa, un documento y un acceso a todas.
const [ pC ] = await exigir( admin.from( 'promotoras' ).insert( { nombre: 'Promotora C (se borra)' } ).select( 'id' ), 'alta promotora C' );
await exigir( admin.from( 'promociones' ).insert( { id: 'prueba-c', promotora_id: pC.id, nombre: 'Residencial C' } ), 'alta prueba-c' );
const [ reqC ] = await exigir( admin.from( 'requisitos' ).insert( { promocion_id: 'prueba-c', bloque: 'Planos', elemento: 'Planta tipo' } ).select( 'id' ), 'requisito prueba-c' );
req[ 'prueba-c' ] = reqC.id;
const idEquipoC = await crearUsuario( 'equipo.c@prueba.local' );
await exigir( admin.from( 'miembros' ).insert( { user_id: idEquipoC, promotora_id: pC.id, promocion_id: null, nombre: 'Equipo C', email: 'equipo.c@prueba.local' } ), 'acceso C' );
const equipoC = await entrar( 'equipo.c@prueba.local' );
const docC = await subirDocumento( equipoC, pC.id, 'prueba-c', 'documento de C' );

await caso( DEBE_FALLAR, '28. Borrar una promotora: alguien que no es la administradora, una promotora activa, o con el nombre mal escrito', async () => {

	const intentos = [
		await equipoC.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C (se borra)' } ),
		await robot.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C (se borra)' } ),
		await adminSinMovil.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C (se borra)' } ),
		await admin.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C (se borra)' } ), // aún activa
		await equipoC.rpc( 'archivos_de_promotora', { p_id: pC.id } ),
	];
	await admin.storage.from( 'documentos' ).remove( [ docC.ruta ] ); // promotora y promoción activas
	await exigir( admin.from( 'promotoras' ).update( { activa: false } ).eq( 'id', pC.id ), 'desactivar C' );
	await equipoC.storage.from( 'documentos' ).remove( [ docC.ruta ] );
	const malNombre = await admin.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C' } );
	const conArchivos = await admin.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C (se borra)' } );
	return intentos.every( falla ) && falla( malNombre ) && falla( conArchivos )
		&& await existe( 'documentos', docC.ruta ) && !! ( await filaDe( 'promotoras', pC.id ) );

} );

await caso( DEBE_FUNCIONAR, 'La administradora borra una promotora desactivada con sus promociones (aunque sigan activas), sin tocar las demás', async () => {

	const lista = await exigir( admin.rpc( 'archivos_de_promotora', { p_id: pC.id } ), 'lista de archivos de C' );
	if ( lista.length !== 1 ) throw new Error( `esperaba 1 archivo y hay ${ lista.length }` );
	await exigir( admin.storage.from( 'documentos' ).remove( lista.map( ( a ) => a.nombre ) ), 'borrar archivos de C' );
	await exigir( admin.rpc( 'borrar_promotora', { p_id: pC.id, p_nombre: 'Promotora C (se borra)' } ), 'borrar promotora C' );
	const { count: miembrosC } = await servicio.from( 'miembros' ).select( '*', { count: 'exact', head: true } ).eq( 'promotora_id', pC.id );
	const { count: docsC } = await servicio.from( 'documentos' ).select( '*', { count: 'exact', head: true } ).eq( 'promocion_id', 'prueba-c' );
	const { data: anotado } = await admin.from( 'registro' ).select( 'detalle' ).eq( 'accion', 'borra una promotora' );
	return ! ( await filaDe( 'promotoras', pC.id ) ) && ! ( await filaDe( 'promociones', 'prueba-c' ) ) && miembrosC === 0 && docsC === 0
		&& ! await existe( 'documentos', docC.ruta ) && !! ( await filaDe( 'promotoras', pA.id ) ) && await existe( 'documentos', docA.ruta )
		&& vacio( await equipoC.from( 'promociones' ).select( 'id' ) )
		&& anotado?.[ 0 ]?.detalle?.promociones === 1 && anotado[ 0 ].detalle.documentos === 1;

} );

// ─── Validación de planos (011_planos.sql) ──────────────────────────────────

const h = ( t ) => huella( Buffer.from( t ) );
// La administradora envía los planos de una versión (sin archivo: aquí solo cuentan las fichas).
const enviarPlanos = ( version, planos ) => admin.from( 'entregables' ).insert( planos.map( ( [ clave, datos ], orden ) => ( {
	promocion_id: 'prueba-a', version, tipo: 'plano', tipologia: clave, nombre: `${ clave }.pdf`, ruta: `prueba-a/${ version }/${ clave }.pdf`,
	huella: h( `${ version }-${ clave }` ), clave, titulo: `Tipología ${ clave.toUpperCase() }`, orden, huella_datos: h( datos ),
} ) ) ).select( 'id, clave' );
const v2 = await exigir( enviarPlanos( 'v2', [ [ 'a', 'geometria-a' ], [ 'b', 'geometria-b' ] ] ), 'planos v2' );
const plano = ( lista, clave ) => lista.find( ( x ) => x.clave === clave ).id;

await caso( DEBE_FALLAR, '29. Planos: una promotora intenta crear planos, ver los de otra, validar dos veces o validar una versión anterior', async () => {

	const crear = await aprobA.from( 'entregables' ).insert( { promocion_id: 'prueba-a', version: 'v9', tipo: 'plano', nombre: 'x.pdf', ruta: 'prueba-a/v9/x.pdf', huella: h( 'x' ) } );
	const ajenos = await aprobB.rpc( 'planos_de_version', { p_promocion: 'prueba-a', p_version: 'v2' } );
	const sinSesion = await anonimo.rpc( 'planos_listos', { p_promocion: 'prueba-a', p_version: 'v2' } );
	await exigir( aprobA.from( 'validaciones' ).insert( { entregable_id: plano( v2, 'a' ), decision: 'aprobado', confirmado: true } ), 'aprobar a v2' );
	const otraVez = await gestorA.from( 'validaciones' ).insert( { entregable_id: plano( v2, 'a' ), decision: 'rechazado', comentario: 'no me gusta' } );
	const aB = await aprobB.from( 'validaciones' ).insert( { entregable_id: plano( v2, 'b' ), decision: 'aprobado', confirmado: true } );
	// un plano de la v1 (versión anterior) ya no se puede validar
	const [ viejo ] = await exigir( admin.from( 'entregables' ).insert( { promocion_id: 'prueba-a', version: 'v1', tipo: 'plano', clave: 'z', nombre: 'z.pdf', ruta: 'prueba-a/v1/z.pdf', huella: h( 'z' ) } ).select( 'id' ), 'plano v1' );
	const anterior = await aprobA.from( 'validaciones' ).insert( { entregable_id: viejo.id, decision: 'aprobado', confirmado: true } );
	const r = { crear, ajenos, sinSesion, otraVez, aB, anterior };
	const noFallan = Object.keys( r ).filter( ( k ) => ! falla( r[ k ] ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Planos: la promotora valida, se publica solo con todo aprobado y lo que no cambia conserva su aprobación', async () => {

	const listos = async ( v ) => ( await exigir( admin.rpc( 'planos_listos', { p_promocion: 'prueba-a', p_version: v } ), 'planos_listos' ) );
	const antes = await listos( 'v2' ); // a aprobado, b pendiente
	// dos aprobadores desde ahora: «a» ya estaba validado y lo sigue estando
	await exigir( aprobA.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'planos', p_personas: [ aprobAId, gestorAId ] } ), 'dos aprobadores' );
	const { data: rech } = await exigir( gestorA.from( 'validaciones' ).insert( { entregable_id: plano( v2, 'b' ), decision: 'rechazado', comentario: 'La terraza mide 24 m²' } ).select( 'id' ), 'pedir cambios b' ).then( ( d ) => ( { data: d } ) );
	const cambios = await listos( 'v2' );
	const deVersion = async ( v, clave ) => ( await exigir( gestorA.rpc( 'validacion_de_version', { p_promocion: 'prueba-a', p_version: v, p_tipo: 'planos' } ), 'validación' ) ).find( ( x ) => x.clave === clave );
	// aviso por email: solo quien validó, y una vez
	const ajeno = await aprobA.rpc( 'marcar_aviso_validacion', { p_validacion: rech[ 0 ].id } );
	const primero = await gestorA.rpc( 'marcar_aviso_validacion', { p_validacion: rech[ 0 ].id } );
	const segundo = await gestorA.rpc( 'marcar_aviso_validacion', { p_validacion: rech[ 0 ].id } );
	// v3: «a» no cambia (misma huella de datos) y «b» corregido
	const v3 = await exigir( enviarPlanos( 'v3', [ [ 'a', 'geometria-a' ], [ 'b', 'geometria-b-corregida' ] ] ), 'planos v3' );
	const enV3 = await exigir( gestorA.rpc( 'planos_de_version', { p_promocion: 'prueba-a', p_version: 'v3' } ), 'planos v3 del equipo' );
	const pendiente = await listos( 'v3' );
	await exigir( gestorA.from( 'validaciones' ).insert( { entregable_id: plano( v3, 'b' ), decision: 'aprobado', confirmado: true } ), 'aprobar b v3' );
	const parcial = await deVersion( 'v3', 'b' );
	const aMitad = await listos( 'v3' );
	await exigir( aprobA.from( 'validaciones' ).insert( { entregable_id: plano( v3, 'b' ), decision: 'aprobado', confirmado: true } ), 'aprobar b v3 (2)' );
	const final = await listos( 'v3' );
	const completo = await deVersion( 'v3', 'b' );
	const a3 = enV3.find( ( x ) => x.clave === 'a' );
	return antes === 'pendientes' && cambios === 'cambios' && ajeno.data === false && primero.data === true && segundo.data === false
		&& a3.decision === 'aprobado' && a3.heredada_de === 'v2' && pendiente === 'pendientes' && final === 'listos'
		&& parcial.estado === 'parcial' && parcial.aprobados === 1 && parcial.requeridos === 2 && aMitad === 'pendientes'
		&& completo.estado === 'aprobado' && completo.personas.length === 2
		&& ( await listos( 'v7' ) ) === 'sin_enviar';

} );

// ─── Avisos por email a la promotora (función «avisar-promotora», 012) ──────

const avisar = ( sb, cuerpo ) => sb.functions.invoke( 'avisar-promotora', { body: cuerpo } );
const codigo = ( r ) => r.error ? r.error.context?.status : 200;

await caso( DEBE_FALLAR, '30. Una promotora o alguien sin sesión intenta enviar avisos; el robot, avisos que no son de documentos rechazados', async () => {

	const r = {
		promotora: codigo( await avisar( aprobA, { tipo: 'planos', promocion: 'prueba-a', version: 'v3' } ) ),
		anonimo: codigo( await avisar( anonimo, { tipo: 'planos', promocion: 'prueba-a', version: 'v3' } ) ),
		robotPlanos: codigo( await avisar( robot, { tipo: 'planos', promocion: 'prueba-a', version: 'v3' } ) ),
		robotPublicada: codigo( await avisar( robot, { tipo: 'publicada', promocion: 'prueba-a', version: 'v3' } ) ),
	};
	if ( r.promotora !== 403 || ! [ 401, 403 ].includes( r.anonimo ) || r.robotPlanos !== 403 || r.robotPublicada !== 403 ) throw new Error( JSON.stringify( r ) );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Avisos a la promotora: se comprueba lo que se avisa y, si no se puede enviar, se puede reintentar', async () => {

	// un documento que no está rechazado no se avisa (ni siquiera el robot)
	const noRechazado = codigo( await avisar( robot, { tipo: 'rechazado', documento_id: docB.data.id } ) );
	// versión sin planos enviados
	const sinPlanos = codigo( await avisar( admin, { tipo: 'planos', promocion: 'prueba-a', version: 'v8' } ) );
	// un documento rechazado sí se avisa: llega hasta el envío (sin llave en las pruebas → 502)
	await exigir( admin.from( 'documentos' ).update( { estado: 'rechazado', nota: 'Faltan las cotas' } ).eq( 'id', docB.data.id ), 'rechazar docB' );
	const avisoRechazado = await avisar( admin, { tipo: 'rechazado', documento_id: docB.data.id } );
	const detalleRechazado = await avisoRechazado.error?.context?.json?.().catch( () => ( {} ) );
	if ( codigo( avisoRechazado ) !== 502 ) throw new Error( `rechazado: ${ codigo( avisoRechazado ) } ${ JSON.stringify( detalleRechazado ) }` );
	// en las pruebas no hay llave de GitHub: falla el envío y no queda apuntado (se podrá reintentar)
	const sinLlave = await avisar( admin, { tipo: 'planos', promocion: 'prueba-a', version: 'v3' } );
	const { count } = await servicio.from( 'avisos_enviados' ).select( '*', { count: 'exact', head: true } );
	// promoción desactivada: no se avisa a nadie
	const { data: baja } = await avisar( admin, { tipo: 'publicada', promocion: 'prueba-a-baja', version: 'v1' } );
	// la tabla de avisos solo la ve la administradora
	const ajena = await aprobA.from( 'avisos_enviados' ).select( 'id' );
	const detalle = await sinLlave.error?.context?.json?.().catch( () => ( {} ) );
	if ( noRechazado !== 409 || sinPlanos !== 409 || codigo( sinLlave ) !== 502 ) throw new Error( JSON.stringify( { noRechazado, sinPlanos, sinLlave: codigo( sinLlave ), detalle } ) );
	return count === 0 && baja?.enviado === false && /desactivada/.test( baja?.motivo ?? '' ) && vacio( ajena );

} );

// ─── Códigos de comprador (014_codigos_comprador.sql) ───────────────────────

const entrarComprador = ( codigo, promocion = 'prueba-a' ) => anonimo.rpc( 'entrar_comprador', { p_promocion: promocion, p_codigo: codigo } );
const generar = ( sb, vivienda, nuevo = false, promocion = 'prueba-a' ) => sb.rpc( 'generar_codigo_comprador', { p_promocion: promocion, p_vivienda: vivienda, p_nuevo_comprador: nuevo } );

await caso( DEBE_FALLAR, '31. Códigos de comprador: otra promotora, el robot o alguien sin sesión intentan generarlos o verlos', async () => {

	const r = {
		otraPromotora: await generar( aprobB, 'Bajo A' ),
		robot: await generar( robot, 'Bajo A' ),
		anonimo: await generar( anonimo, 'Bajo A' ),
		verOtra: await aprobB.rpc( 'codigos_de_promocion', { p_promocion: 'prueba-a' } ),
		tablaCodigos: await gestorA.from( 'codigos_comprador' ).select( '*' ),
		tablaIntentos: await anonimo.from( 'intentos_comprador' ).select( '*' ),
		seleccionesAnonimo: await anonimo.from( 'selecciones_comprador' ).select( '*' ),
		seleccionesOtra: await aprobB.from( 'selecciones_comprador' ).insert( { promocion_id: 'prueba-a', vivienda_ref: 'Bajo A', pack: 'x', fecha: '2026-10-10' } ),
		todosOtra: await aprobB.rpc( 'generar_codigos_pendientes', { p_promocion: 'prueba-a', p_viviendas: [ 'Bajo Z' ] } ),
		todosAnonimo: await anonimo.rpc( 'generar_codigos_pendientes', { p_promocion: 'prueba-a', p_viviendas: [ 'Bajo Z' ] } ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! falla( r[ k ] ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Códigos de comprador: la promotora genera y cambia el código; el comprador entra solo con el vigente y ve solo lo suyo', async () => {

	const c1 = await exigir( generar( gestorA, 'Bajo A' ), 'generar' );
	if ( ! /^c-[0-9a-f]{12}$/.test( c1 ) ) throw new Error( `código raro: ${ c1 }` );
	// lo cerrado por el primer comprador (desde 025 nadie escribe en la tabla: se pone directamente en la base de datos de prueba)
	execFileSync( 'psql', [ DB_URL, '-q', '-c', "insert into public.selecciones_comprador (promocion_id, vivienda_ref, comprador, pack, opciones, fecha) values ('prueba-a', 'Bajo A', 1, 'cocinas', '{\"cocina\": \"nogal\"}', '2026-10-01')" ] );
	const bien = ( await entrarComprador( c1 ) ).data;
	const escrito = ( await entrarComprador( ` ${ c1.toUpperCase().replace( 'C-', 'c ' ).replace( /(.{6})/, '$1-' ) } ` ) ).data; // con espacios, guiones y mayúsculas
	const mal = await entrarComprador( 'c-000000000000' );
	const otraPromocion = ( await entrarComprador( c1, 'prueba-b' ) ).data;
	// mismo comprador: el código anterior deja de valer y conserva lo suyo
	const { data: c2 } = await generar( aprobA, 'Bajo A' );
	const viejo = ( await entrarComprador( c1 ) ).data;
	const mismo = ( await entrarComprador( c2 ) ).data;
	// comprador nuevo: empieza de cero
	const { data: c3 } = await generar( admin, 'Bajo A', true );
	const nuevo = ( await entrarComprador( c3 ) ).data;
	const lista = await exigir( gestorA.rpc( 'codigos_de_promocion', { p_promocion: 'prueba-a' } ), 'lista' );
	const fila = lista.find( ( x ) => x.vivienda_ref === 'Bajo A' );
	return bien?.vivienda === 'Bajo A' && bien.selecciones?.cocinas?.opciones?.cocina === 'nogal' && escrito?.vivienda === 'Bajo A'
		&& ! mal.error && mal.data === null && otraPromocion === null
		&& viejo === null && mismo?.selecciones?.cocinas && nuevo?.vivienda === 'Bajo A' && Object.keys( nuevo.selecciones ).length === 0
		&& fila.comprador === 2 && fila.accesos === 1 && ! ( 'huella' in fila );

} );

const formalizar = ( sb, promocion, email, iban = 'ES91 2100 0418 4502 0005 1332' ) => sb.rpc( 'guardar_formalizacion', {
	p_promocion: promocion, p_contacto_nombre: 'Comercial', p_contacto_email: email, p_contacto_telefono: '600 000 000',
	p_titular: 'Promotora A S.L.', p_banco: 'Banco', p_iban: iban, p_bic: '', p_concepto: '{ref} · {pack}', p_plazo_dias: 10, p_instrucciones: '',
} );

await caso( DEBE_FALLAR, '33. Formalización: otra promotora, el robot o alguien sin sesión intentan cambiar el contacto o los datos de pago; nadie sin código los lee', async () => {

	const r = await Promise.all( [ formalizar( aprobB, 'prueba-a', 'x@b.es' ), formalizar( robot, 'prueba-a', 'x@b.es' ), formalizar( anonimo, 'prueba-a', 'x@b.es' ) ] );
	const leeAnonimo = await anonimo.from( 'promociones' ).select( 'formalizacion' ).eq( 'id', 'prueba-a' );
	const leeB = await aprobB.from( 'promociones' ).select( 'formalizacion' ).eq( 'id', 'prueba-a' );
	const ibanMal = await formalizar( gestorA, 'prueba-a', 'ventas@a.es', 'ES12' );
	return r.every( falla ) && ( falla( leeAnonimo ) || vacio( leeAnonimo ) ) && vacio( leeB ) && falla( ibanMal );

} );

await caso( DEBE_FUNCIONAR, 'Formalización: la promotora guarda contacto y datos de pago, y el comprador los recibe solo al entrar con su código', async () => {

	await exigir( formalizar( gestorA, 'prueba-a', 'Ventas@A.es' ), 'guardar' );
	const codigo = await exigir( generar( gestorA, 'Ático Z' ), 'código' );
	const dentro = ( await entrarComprador( codigo ) ).data;
	const f = dentro?.formalizacion;
	return f?.contacto?.email === 'ventas@a.es' && f?.pago?.iban === 'ES91 2100 0418 4502 0005 1332' && f?.pago?.plazoDias === 10;

} );

await caso( DEBE_FUNCIONAR, 'Códigos de comprador: la promotora genera de golpe los de las viviendas que no tienen (para el Excel), y valen', async () => {

	const nuevos = await exigir( gestorA.rpc( 'generar_codigos_pendientes', { p_promocion: 'prueba-a', p_viviendas: [ 'Bajo A', 'Bajo B', 'Bajo B', ' 1ºC ' ] } ), 'todos' );
	const refs = nuevos.map( ( x ) => x.vivienda_ref ).sort();
	const entraB = ( await entrarComprador( nuevos.find( ( x ) => x.vivienda_ref === 'Bajo B' ).codigo ) ).data;
	const otraVez = await exigir( gestorA.rpc( 'generar_codigos_pendientes', { p_promocion: 'prueba-a', p_viviendas: [ 'Bajo B' ] } ), 'otra vez' );
	return JSON.stringify( refs ) === JSON.stringify( [ '1ºC', 'Bajo B' ] ) && entraB?.vivienda === 'Bajo B' && otraVez.length === 0;

} );

await caso( DEBE_FALLAR, '32. Probar códigos al azar: tras 10 fallos se bloquea un rato (aunque luego se acierte)', async () => {

	const { data: bueno } = await generar( admin, 'Bajo A2', false, 'prueba-a2' );
	for ( let i = 0; i < 10; i ++ ) await entrarComprador( `c-00000000000${ i }`, 'prueba-a2' );
	const bloqueado = await entrarComprador( bueno, 'prueba-a2' );
	return falla( bloqueado ) && /Demasiados intentos/.test( bloqueado.error.message );

} );

// ─── Accesos e invitaciones (función «invitar», receta 14) ──────────────────

const invitar = ( sb, cuerpo ) => sb.functions.invoke( 'invitar', { body: cuerpo } );
// Código HTTP de la respuesta de la función (200 si fue bien).
const estadoHttp = ( r ) => r.error ? r.error.context?.status : 200;
const BUZON = process.env.BUZON_URL;

// Último email recibido en el buzón de pruebas para esa dirección.
async function ultimoEmail( para ) {

	for ( let i = 0; i < 20; i ++ ) {

		const r = await fetch( `${ BUZON }/api/v1/search?query=${ encodeURIComponent( `to:${ para }` ) }` );
		const { messages } = await r.json();
		if ( messages?.length ) return ( await fetch( `${ BUZON }/api/v1/message/${ messages[ 0 ].ID }` ) ).json();
		await new Promise( ( ok ) => setTimeout( ok, 500 ) );

	}
	throw new Error( `no llega ningún email a ${ para }` );

}

await caso( DEBE_FALLAR, '22. Una promotora intenta dar acceso a alguien (o llamar sin sesión)', async () => {

	const r1 = await invitar( gestorA, { accion: 'invitar', promotora_id: pA.id, nombre: 'Intrusa', email: 'intrusa@prueba.local', cargo: 'x' } );
	const r2 = await invitar( anonimo, { accion: 'invitar', promotora_id: pA.id, promocion_id: 'prueba-a', nombre: 'Intrusa', email: 'intrusa@prueba.local' } );
	const cuenta = await servicio.rpc( 'cuenta_por_email', { p_email: 'intrusa@prueba.local' } );
	if ( estadoHttp( r1 ) !== 403 || ! [ 401, 403 ].includes( estadoHttp( r2 ) ) ) throw new Error( `respuestas ${ estadoHttp( r1 ) } y ${ estadoHttp( r2 ) }` );
	return cuenta.data.length === 0;

} );

await caso( DEBE_FALLAR, '23. Una promotora intenta averiguar cuentas por su correo o ver la lista de accesos', async () =>
	falla( await aprobA.rpc( 'cuenta_por_email', { p_email: 'aprobadora.b@prueba.local' } ) )
	&& falla( await anonimo.rpc( 'cuenta_por_email', { p_email: 'aprobadora.b@prueba.local' } ) )
	&& falla( await robot.rpc( 'cuenta_por_email', { p_email: 'aprobadora.b@prueba.local' } ) )
	&& falla( await aprobA.rpc( 'accesos', { p_promotora: pA.id } ) )
	&& falla( await robot.rpc( 'accesos', { p_promotora: pB.id } ) ) );

await caso( DEBE_FALLAR, '24. Dar acceso de promotora a una cuenta interna (administradora o robot)', async () =>
	estadoHttp( await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: null, nombre: 'Robot', email: 'robot@prueba.local' } ) ) === 409
	&& estadoHttp( await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: null, nombre: 'Admin', email: 'ADMIN@prueba.local' } ) ) === 409 );

await caso( DEBE_FALLAR, '25. Dar acceso en una promotora a alguien que ya está en otra, o a una promoción ajena', async () => {

	const r1 = estadoHttp( await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: 'prueba-a', nombre: 'Bea', email: 'aprobadora.b@prueba.local' } ) );
	const r2 = estadoHttp( await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: 'prueba-b', nombre: 'Otra', email: 'otra@prueba.local' } ) );
	if ( r1 !== 409 || r2 !== 404 ) throw new Error( `respuestas ${ r1 } y ${ r2 }` );
	return true;

} );

let nuevaInvitada = false;
await caso( DEBE_FUNCIONAR, 'La administradora invita a una persona: recibe el email, elige su contraseña y entra', async () => {

	const email = 'nueva.a@prueba.local';
	const r = await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: 'prueba-a2', nombre: 'Nueva de A', email, cargo: 'Técnica' } );
	if ( r.error ) throw new Error( `invitar: ${ await r.error.context?.text?.() ?? r.error.message }` );
	const mensaje = await ultimoEmail( email );
	const enlace = mensaje.Text.match( /https?:\/\/\S+verify\S+/ )?.[ 0 ];
	if ( ! enlace ) throw new Error( 'el email no trae el enlace' );
	// El enlace lleva al portal con la sesión de la invitación (como al pulsarlo).
	const destino = ( await fetch( enlace.replace( /&amp;/g, '&' ), { redirect: 'manual' } ) ).headers.get( 'location' ) ?? '';
	const datos = new URLSearchParams( destino.split( '#' )[ 1 ] ?? '' );
	if ( ! destino.startsWith( 'http://127.0.0.1:5174/' ) || datos.get( 'type' ) !== 'invite' ) throw new Error( `destino inesperado: ${ destino.slice( 0, 80 ) }` );
	const sb = nuevo();
	await exigir( sb.auth.setSession( { access_token: datos.get( 'access_token' ), refresh_token: datos.get( 'refresh_token' ) } ), 'sesión de invitación' );
	await exigir( sb.auth.updateUser( { password: CLAVE } ), 'elegir contraseña' );
	const nueva = await entrar( email );
	const { data } = await nueva.from( 'promociones' ).select( 'id' );
	const accesos = await exigir( admin.rpc( 'accesos', { p_promotora: pA.id } ), 'accesos' );
	nuevaInvitada = true;
	return data.length === 1 && data[ 0 ].id === 'prueba-a2' && accesos.some( ( a ) => a.email === email && a.aceptada && a.cargo === 'Técnica' && a.promocion_id === 'prueba-a2' );

} );

// ─── Código del móvil de las promotoras (032_movil_promotoras.sql) ──────────

const idMovilA = await crearUsuario( 'movil.a@prueba.local' );
await exigir( admin.from( 'miembros' ).insert( { user_id: idMovilA, promotora_id: pA.id, promocion_id: 'prueba-a', nombre: 'Móvil A', email: 'movil.a@prueba.local' } ), 'acceso movil.a' );
await entrar( 'movil.a@prueba.local' );
const factoresDe = async ( userId ) => ( await servicio.auth.admin.mfa.listFactors( { userId } ) ).data?.factors ?? [];

await caso( DEBE_FALLAR, '45. Quitar el código del móvil: otra promotora, quien no administra, a sí misma o sin el código del móvil', async () => {

	const quitar = ( sb, userId ) => invitar( sb, { accion: 'quitar-movil', promotora_id: pA.id, user_id: userId } );
	const r1 = estadoHttp( await quitar( aprobB, idMovilA ) );
	const r2 = estadoHttp( await quitar( gestorA, idMovilA ) );
	const r3 = estadoHttp( await quitar( aprobA, aprobAId ) );
	const r4 = estadoHttp( await quitar( await entrarSoloClave( 'aprobadora.a@prueba.local' ), idMovilA ) );
	const r5 = estadoHttp( await quitar( anonimo, idMovilA ) );
	if ( r1 !== 403 || r2 !== 403 || r3 !== 409 || r4 !== 403 || ! [ 401, 403 ].includes( r5 ) ) throw new Error( `respuestas ${ r1 }, ${ r2 }, ${ r3 }, ${ r4 } y ${ r5 }` );
	return ( await factoresDe( idMovilA ) ).length === 1 && ( await factoresDe( aprobAId ) ).length === 1;

} );

await caso( DEBE_FUNCIONAR, 'Quitar el código del móvil: quien administra la promotora (o MUNE Studio) se lo quita a alguien de su equipo, que al entrar lo vincula de nuevo; queda en el registro', async () => {

	const r1 = await invitar( aprobA, { accion: 'quitar-movil', promotora_id: pA.id, user_id: idMovilA } );
	if ( r1.error ) throw new Error( `quitar desde el Portal: ${ estadoHttp( r1 ) }` );
	const sinFactor = ( await factoresDe( idMovilA ) ).length === 0;
	const otraVez = await entrar( 'movil.a@prueba.local' );
	const { data } = await otraVez.from( 'promociones' ).select( 'id' );
	const r2 = await invitar( admin, { accion: 'quitar-movil', promotora_id: pA.id, user_id: idMovilA } );
	if ( r2.error ) throw new Error( `quitar desde MUNE Studio: ${ estadoHttp( r2 ) }` );
	const apuntes = await exigir( admin.from( 'registro' ).select( 'user_id' ).eq( 'accion', 'quita el código del móvil' ), 'registro' );
	return sinFactor && data?.length === 1 && data[ 0 ].id === 'prueba-a'
		&& ( await factoresDe( idMovilA ) ).length === 0
		&& apuntes.some( ( a ) => a.user_id === aprobAId ) && apuntes.length === 2;

} );

await caso( DEBE_FUNCIONAR, 'Volver a invitar a la misma promoción no duplica; a otra promoción, sí suma acceso; «Reenviar» envía otro email', async () => {

	if ( ! nuevaInvitada ) throw new Error( 'depende del caso anterior' );
	const r = await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: 'prueba-a2', nombre: 'Otra vez', email: 'nueva.a@prueba.local' } );
	// …pero sí se le puede dar acceso a otra promoción de la misma promotora, sin otro email
	const otra = await invitar( admin, { accion: 'invitar', promotora_id: pA.id, promocion_id: 'prueba-a', nombre: 'Nueva de A', email: 'nueva.a@prueba.local' } );
	const { data: [ cuenta ] } = await servicio.rpc( 'cuenta_por_email', { p_email: 'nueva.a@prueba.local' } );
	const antes = ( await ( await fetch( `${ BUZON }/api/v1/search?query=${ encodeURIComponent( 'to:nueva.a@prueba.local' ) }` ) ).json() ).messages.length;
	const re = await invitar( admin, { accion: 'reenviar', promotora_id: pA.id, user_id: cuenta.user_id } );
	await new Promise( ( ok ) => setTimeout( ok, 1500 ) );
	const despues = ( await ( await fetch( `${ BUZON }/api/v1/search?query=${ encodeURIComponent( 'to:nueva.a@prueba.local' ) }` ) ).json() ).messages.length;
	return estadoHttp( r ) === 409 && ! otra.error && ! re.error && despues === antes + 1;

} );

// ─── Avisos del sistema (Etapa 6, 015_sistema.sql) ──────────────────────────

await caso( DEBE_FALLAR, 'Nadie más que la administradora (con el código del móvil) ve los avisos, el estado del sistema o las llaves, ni cambia una llave', async () => {

	for ( const sb of [ anonimo, gestorA, robot, adminSinMovil ] ) {

		if ( ! falla( await sb.rpc( 'avisos_sistema' ) ) || ! falla( await sb.rpc( 'estado_sistema' ) ) ) return false;
		if ( ! falla( await sb.rpc( 'renovar_llave', { p_id: 'llave-a', p_caduca: '2027-12-01' } ) ) ) return false;
		const l = await sb.from( 'llaves' ).select( 'id' );
		if ( ! l.error && l.data.length ) return false;
		const t = await sb.from( 'latido' ).select( '*' );
		if ( ! t.error && t.data.length ) return false;

	}
	return true;

} );

await caso( DEBE_FUNCIONAR, 'La vigilancia da señales sin sesión (solo recibe los días que faltan) y la administradora ve avisos, estado y renueva una llave', async () => {

	const { data: dias, error } = await anonimo.rpc( 'latido' );
	if ( error || typeof dias !== 'number' ) throw new Error( `latido: ${ error?.message ?? dias }` );
	const estado = await exigir( admin.rpc( 'estado_sistema' ), 'estado' );
	if ( ! estado.latido || estado.llaves.length !== 2 || ! ( estado.datos > 0 ) ) throw new Error( 'estado incompleto' );
	// a 20 días, la llave A sale como urgente
	execFileSync( 'psql', [ DB_URL, '-q', '-c', "update public.llaves set caduca = current_date + 20 where id = 'llave-a'" ] );
	const avisos = await exigir( admin.rpc( 'avisos_sistema' ), 'avisos' );
	const a = avisos.find( ( x ) => x.clave === 'llave:llave-a' );
	if ( ! a || a.nivel !== 'alerta' || ! /20 días/.test( a.titulo ) ) throw new Error( `aviso de llave: ${ JSON.stringify( avisos ) }` );
	if ( ( await anonimo.rpc( 'latido' ) ).data !== 20 ) throw new Error( 'latido no ve la caducidad' );
	const nueva = new Date( Date.now() + 300 * 86_400_000 ).toISOString().slice( 0, 10 );
	await exigir( admin.rpc( 'renovar_llave', { p_id: 'llave-a', p_caduca: nueva } ), 'renovar' );
	const despues = await exigir( admin.rpc( 'avisos_sistema' ), 'avisos después' );
	const pasada = await admin.rpc( 'renovar_llave', { p_id: 'llave-a', p_caduca: '2020-01-01' } );
	return ! despues.some( ( x ) => x.clave === 'llave:llave-a' ) && falla( pasada );

} );

// ─── Equipos, administración y validaciones (020) ───────────────────────────

// Personas de A con capacidades parciales y un administrador de promoción.
const altaEquipo = async ( email, promocion, capacidades, administra = false ) => {

	const id = await crearUsuario( email );
	await exigir( admin.from( 'miembros' ).insert( { user_id: id, promotora_id: pA.id, promocion_id: promocion, nombre: email, email, capacidades, administra } ), `acceso ${ email }` );
	return { id, sb: await entrar( email ) };

};
const soloCompradores = await altaEquipo( 'compradores.a@prueba.local', 'prueba-a', [ 'compradores' ] );
const soloPersonalizacion = await altaEquipo( 'personalizacion.a@prueba.local', 'prueba-a', [ 'personalizacion' ] );
const adminPromA = await altaEquipo( 'admin.promocion.a@prueba.local', 'prueba-a', [], true );
const nuevaPersona = await crearUsuario( 'equipo.nuevo.a@prueba.local' );

await caso( DEBE_FALLAR, '34. Capacidades: sin la capacidad no se ve ni se cambia esa parte (documentación, selecciones, ficha, formalización, códigos)', async () => {

	const c = soloCompradores.sb;
	const r = {
		requisitos: ( await c.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ) ).data?.length === 0,
		documentos: ( await c.from( 'documentos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ) ).data?.length === 0,
		subir: falla( await subirDocumento( c, pA.id, 'prueba-a', 'sin capacidad' ) ),
		selecciones: ( await c.from( 'selecciones_comprador' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ) ).data?.length === 0,
		ficha: falla( await c.rpc( 'guardar_datos_promocion', { p_promocion: 'prueba-a', p_razon_social: 'x', p_cif: 'x', p_domicilio_fiscal: 'x' } ) ),
		formalizacion: falla( await c.rpc( 'guardar_formalizacion', { p_promocion: 'prueba-a', p_contacto_nombre: '', p_contacto_email: 'a@b.es', p_contacto_telefono: '', p_titular: '', p_banco: '', p_iban: '', p_bic: '', p_concepto: '', p_plazo_dias: null, p_instrucciones: '' } ) ),
		legales: falla( await c.rpc( 'guardar_textos_legales', { p_promocion: 'prueba-a', p_planos: 'x', p_renders: '', p_experiencia: '', p_personalizacion: '' } ) ),
		codigosDePersonalizacion: falla( await soloPersonalizacion.sb.rpc( 'codigos_de_promocion', { p_promocion: 'prueba-a' } ) ),
		fase: falla( await c.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'basico' } ) ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! r[ k ] );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Capacidades: con «compradores» se gestionan los códigos; con «personalizacion», las selecciones y los textos de formalización', async () => {

	const codigos = await soloCompradores.sb.rpc( 'codigos_de_promocion', { p_promocion: 'prueba-a' } );
	const selecciones = await soloPersonalizacion.sb.from( 'selecciones_comprador' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' );
	const formalizacion = await soloPersonalizacion.sb.rpc( 'guardar_formalizacion', { p_promocion: 'prueba-a', p_contacto_nombre: '', p_contacto_email: 'ventas@a.local', p_contacto_telefono: '', p_titular: '', p_banco: '', p_iban: '', p_bic: '', p_concepto: '', p_plazo_dias: null, p_instrucciones: '' } );
	return ! codigos.error && ! selecciones.error && ! formalizacion.error;

} );

await caso( DEBE_FALLAR, '35. Equipo: quien no administra da accesos; otra promotora ve el equipo; quien administra una promoción se sale de ella, nombra administradores o toca a quien administra la promotora; nadie se cambia a sí mismo ni deja la promotora sin administrar', async () => {

	const filaAprobA = ( await servicio.from( 'miembros' ).select( 'id' ).eq( 'user_id', aprobAId ).single() ).data;
	const filaAdminProm = ( await servicio.from( 'miembros' ).select( 'id' ).eq( 'user_id', adminPromA.id ).single() ).data;
	const dar = ( sb, promocion, administra = false ) => sb.rpc( 'dar_acceso', { p_user: nuevaPersona, p_promotora: pA.id, p_promocion: promocion, p_nombre: 'Nueva', p_cargo: '', p_administra: administra, p_capacidades: [ 'documentacion' ] } );
	const r = {
		gestorDa: dar( gestorA, 'prueba-a' ),
		otraPromotoraVe: aprobB.rpc( 'equipo_de_promotora', { p_promotora: pA.id } ),
		otraPromotoraDa: dar( aprobB, 'prueba-a' ),
		adminPromFuera: dar( adminPromA.sb, 'prueba-a2' ),
		adminPromATodas: dar( adminPromA.sb, null ),
		adminPromNombraAdmin: dar( adminPromA.sb, 'prueba-a', true ),
		adminPromTocaDirectora: adminPromA.sb.rpc( 'cambiar_acceso', { p_id: filaAprobA.id, p_activo: false, p_administra: null, p_capacidades: null } ),
		seCambiaASiMismo: adminPromA.sb.rpc( 'cambiar_acceso', { p_id: filaAdminProm.id, p_activo: null, p_administra: null, p_capacidades: [ 'documentacion' ] } ),
		ultimaAdministradora: admin.rpc( 'cambiar_acceso', { p_id: filaAprobA.id, p_activo: false, p_administra: null, p_capacidades: null } ),
		cuentaInterna: aprobA.rpc( 'dar_acceso', { p_user: robotId, p_promotora: pA.id, p_promocion: 'prueba-a', p_nombre: 'Robot', p_cargo: '', p_administra: false, p_capacidades: [] } ),
		capacidadInventada: dar( aprobA, 'prueba-a' ).then( () => aprobA.rpc( 'dar_acceso', { p_user: nuevaPersona, p_promotora: pA.id, p_promocion: 'prueba-a', p_nombre: 'Nueva', p_cargo: '', p_administra: false, p_capacidades: [ 'todo' ] } ) ),
	};
	for ( const k of Object.keys( r ) ) r[ k ] = await r[ k ];
	const noFallan = Object.keys( r ).filter( ( k ) => ! falla( r[ k ] ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Equipo: quien administra la promotora da accesos con capacidades y ve a todo su equipo; quien administra una promoción gestiona a las personas de esa promoción; el resto del equipo lo ve sin poder cambiarlo', async () => {

	const idA2 = await exigir( aprobA.rpc( 'dar_acceso', { p_user: nuevaPersona, p_promotora: pA.id, p_promocion: 'prueba-a2', p_nombre: 'Nueva', p_cargo: 'Técnica', p_administra: false, p_capacidades: [ 'planos' ] } ), 'dar acceso a2' );
	const equipo = await exigir( aprobA.rpc( 'equipo_de_promotora', { p_promotora: pA.id } ), 'equipo' );
	const filaNueva = equipo.find( ( m ) => m.id === idA2 );
	// el administrador de prueba-a ve su promoción (y quién tiene acceso a todas), no prueba-a2
	const suEquipo = await exigir( adminPromA.sb.rpc( 'equipo_de_promotora', { p_promotora: pA.id } ), 'equipo de la promoción' );
	const idGestor = ( await servicio.from( 'miembros' ).select( 'id' ).eq( 'user_id', gestorAId ).single() ).data.id;
	await exigir( adminPromA.sb.rpc( 'cambiar_acceso', { p_id: idGestor, p_activo: null, p_administra: null, p_capacidades: [ 'documentacion', 'planos', 'compradores', 'personalizacion', 'materiales', 'datos' ], p_cargo: 'Comercial' } ), 'cambiar capacidades' );
	const registro = ( await admin.from( 'registro' ).select( 'detalle' ).eq( 'accion', 'acceso_cambiado' ) ).data;
	// quien no administra ve a su equipo de prueba-a, sin cambios ni datos de entrada, y no ve prueba-a2
	const loVeGestor = await exigir( gestorA.rpc( 'equipo_de_promotora', { p_promotora: pA.id } ), 'equipo visto por el gestor' );
	return loVeGestor.length > 1 && loVeGestor.every( ( m ) => m.activo && ! m.editable && m.aceptada === null && m.ultima_entrada === null
		&& ( m.promocion_id === null || m.promocion_id === 'prueba-a' ) )
		&& loVeGestor.some( ( m ) => m.user_id === aprobAId )
		&& filaNueva?.promocion_id === 'prueba-a2' && filaNueva.capacidades.join() === 'planos' && filaNueva.editable
		&& suEquipo.every( ( m ) => m.promocion_id === null || m.promocion_id === 'prueba-a' )
		&& suEquipo.some( ( m ) => m.user_id === gestorAId && m.editable ) && suEquipo.some( ( m ) => m.user_id === aprobAId && ! m.editable )
		&& registro.some( ( r ) => r.detalle.capacidades );

} );

await caso( DEBE_FALLAR, '36. Aprobadores: quien no administra los cambia, o se nombra a alguien sin acceso o sin la capacidad de planos', async () => {

	const r = {
		gestor: await gestorA.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'planos', p_personas: [ gestorAId ] } ),
		otraPromotora: await aprobB.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'planos', p_personas: [] } ),
		sinPlanos: await aprobA.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'planos', p_personas: [ soloCompradores.id ] } ),
		sinAcceso: await aprobA.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'experiencia', p_personas: [ idDe[ 'aprobadora.b@prueba.local' ] ] } ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! falla( r[ k ] ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

// Experiencia 3D: una unidad por tipología o variante (sin archivo).
const enviarExperiencia = ( version, unidades ) => admin.from( 'entregables' ).insert( unidades.map( ( [ clave, datos ], orden ) => ( {
	promocion_id: 'prueba-a', version, tipo: 'experiencia', tipologia: clave, nombre: `Experiencia 3D · ${ clave }`,
	ruta: `prueba-a/${ version }/experiencia/${ clave }`, huella: h( datos ), huella_datos: h( datos ), clave,
	titulo: `Tipología ${ clave.toUpperCase() }`, orden, vistas: [ { id: 'cocina', nombre: 'Cocina' } ],
} ) ) ).select( 'id, clave' );

await caso( DEBE_FUNCIONAR, 'Experiencia 3D: sin aprobadores no se valida; con ellos, se aprueba por tipología, se piden cambios por zona y lo que no cambia conserva su aprobación', async () => {

	const e5 = await exigir( enviarExperiencia( 'v5', [ [ 'a', '3d-a' ], [ 'b', '3d-b' ] ] ), 'experiencia v5' );
	const sinAprobadores = await gestorA.from( 'validaciones' ).insert( { entregable_id: plano( e5, 'a' ), decision: 'aprobado', confirmado: true } );
	const lista = async ( v ) => exigir( admin.rpc( 'validacion_lista', { p_promocion: 'prueba-a', p_version: v, p_tipo: 'experiencia' } ), 'validación lista' );
	const antes = await lista( 'v5' );
	await exigir( adminPromA.sb.rpc( 'guardar_aprobadores', { p_promocion: 'prueba-a', p_tipo: 'experiencia', p_personas: [ gestorAId, soloCompradores.id ] } ), 'aprobadores experiencia' );
	const ajeno = await aprobA.from( 'validaciones' ).insert( { entregable_id: plano( e5, 'a' ), decision: 'aprobado', confirmado: true } );
	await exigir( gestorA.from( 'validaciones' ).insert( { entregable_id: plano( e5, 'a' ), decision: 'aprobado', confirmado: true } ), 'aprobar a' );
	await exigir( soloCompradores.sb.from( 'validaciones' ).insert( { entregable_id: plano( e5, 'a' ), decision: 'aprobado', confirmado: true } ), 'aprobar a (2)' );
	await exigir( gestorA.from( 'validaciones' ).insert( { entregable_id: plano( e5, 'b' ), decision: 'rechazado', comentario: 'La encimera no es la de la memoria', zona: 'Cocina' } ), 'cambios b' );
	const enCambios = await lista( 'v5' );
	const vista = await exigir( soloCompradores.sb.rpc( 'validacion_de_version', { p_promocion: 'prueba-a', p_version: 'v5', p_tipo: 'experiencia' } ), 'ver experiencia' );
	const e6 = await exigir( enviarExperiencia( 'v6', [ [ 'a', '3d-a' ], [ 'b', '3d-b-corregida' ] ] ), 'experiencia v6' );
	const pendienteV6 = await lista( 'v6' );
	for ( const sb of [ gestorA, soloCompradores.sb ] ) await exigir( sb.from( 'validaciones' ).insert( { entregable_id: plano( e6, 'b' ), decision: 'aprobado', confirmado: true } ), 'aprobar b v6' );
	const v6 = await exigir( admin.rpc( 'validacion_de_version', { p_promocion: 'prueba-a', p_version: 'v6', p_tipo: 'experiencia' } ), 'v6' );
	const ajenoVe = await aprobB.rpc( 'validacion_de_version', { p_promocion: 'prueba-a', p_version: 'v6', p_tipo: 'experiencia' } );
	const b5 = vista.find( ( x ) => x.clave === 'b' );
	return falla( sinAprobadores ) && /nadie designado para validar/.test( sinAprobadores.error.message ) && antes === 'sin_aprobadores'
		&& falla( ajeno ) && enCambios === 'cambios' && b5.estado === 'cambios' && b5.personas.some( ( x ) => x.zona === 'Cocina' )
		&& pendienteV6 === 'pendientes' && ( await lista( 'v6' ) ) === 'listos'
		&& v6.find( ( x ) => x.clave === 'a' ).heredada_de === 'v5' && falla( ajenoVe );

} );

await caso( DEBE_FUNCIONAR, 'Documentos de varios archivos: cada archivo con lo que contiene y su propia versión; sustituir solo la más reciente', async () => {

	const [ rv ] = await exigir( admin.from( 'requisitos' ).insert( { promocion_id: 'prueba-a', bloque: 'Calidades', elemento: 'Memoria de calidades técnica', varios: true, contenidos: [ 'Memoria técnica', 'Cuadro de carpinterías' ] } ).select( 'id' ), 'requisito varios' );
	const subir = async ( extra, texto ) => {

		const contenido = pdf( texto );
		const ruta = `${ pA.id }/prueba-a/${ rv.id }/${ Date.now() }-${ texto.replace( /\W/g, '' ) }.pdf`;
		await exigir( gestorA.storage.from( 'documentos' ).upload( ruta, contenido, { contentType: 'application/pdf' } ), 'subir archivo' );
		return gestorA.from( 'documentos' ).insert( { promocion_id: 'prueba-a', requisito_id: rv.id, nombre: `${ texto }.pdf`, ruta, tipo: 'application/pdf', tamano: contenido.length, huella: huella( contenido ), ...extra } ).select( 'id, version, reemplaza_a, contenido, detalle' ).single();

	};
	const sinContenido = await subir( {}, 'sin contenido' );
	const memoria = await exigir( subir( { contenido: 'Memoria técnica' }, 'memoria' ), 'memoria' );
	const carpinterias = await exigir( subir( { contenido: 'Cuadro de carpinterías', detalle: 'Ventanas fachada sur' }, 'carpinterias' ), 'carpinterías' );
	const memoria2 = await exigir( subir( { reemplaza_a: memoria.id }, 'memoria v2' ), 'sustituir memoria' );
	const otraVez = await subir( { reemplaza_a: memoria.id }, 'memoria v2 bis' );
	return falla( sinContenido ) && memoria.version === 1 && carpinterias.version === 1 && carpinterias.detalle === 'Ventanas fachada sur'
		&& memoria2.version === 2 && memoria2.reemplaza_a === memoria.id && memoria2.contenido === 'Memoria técnica' && falla( otraVez );

} );

await caso( DEBE_FUNCIONAR, 'Textos legales: el equipo con «datos» los guarda; el robot los lee para preparar la versión', async () => {

	await exigir( gestorA.rpc( 'guardar_textos_legales', { p_promocion: 'prueba-a', p_planos: 'Superficies orientativas.', p_renders: 'Imágenes no contractuales.', p_experiencia: 'Infografía orientativa.', p_personalizacion: '' } ), 'textos legales' );
	const ajeno = await aprobB.rpc( 'guardar_textos_legales', { p_promocion: 'prueba-a', p_planos: 'x', p_renders: '', p_experiencia: '', p_personalizacion: '' } );
	const leidos = ( await robot.from( 'promociones' ).select( 'textos_legales' ).eq( 'id', 'prueba-a' ).single() ).data;
	return falla( ajeno ) && leidos.textos_legales.renders === 'Imágenes no contractuales.' && ! ( 'personalizacion' in leidos.textos_legales );

} );

// ─── Fase del proyecto (018 y 019) ──────────────────────────────────────────
await caso( DEBE_FUNCIONAR, 'Fase del proyecto: el equipo la cambia (con historial) y los documentos nuevos quedan marcados; nadie más la cambia ni ve el historial', async () => {

	const ajenaB = await aprobB.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'ejecucion' } );
	const deRobot = await robot.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'ejecucion' } );
	const sinSesion = await anonimo.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'ejecucion' } );
	const otraPromocion = await gestorA.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a2', p_fase: 'basico' } );
	const mala = await gestorA.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'obra' } );
	await exigir( gestorA.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'basico' } ), 'fase básico' );
	await exigir( gestorA.rpc( 'cambiar_fase_proyecto', { p_promocion: 'prueba-a', p_fase: 'ejecucion' } ), 'fase ejecución' );
	const doc = await subirDocumento( gestorA, pA.id, 'prueba-a', 'documento en fase de ejecución' );
	const historialA = ( await gestorA.from( 'fases_promocion' ).select( 'fase' ).eq( 'promocion_id', 'prueba-a' ) ).data ?? [];
	const historialB = await aprobB.from( 'fases_promocion' ).select( 'fase' ).eq( 'promocion_id', 'prueba-a' );
	const historialAnonimo = await anonimo.from( 'fases_promocion' ).select( 'fase' ).limit( 1 );
	return falla( ajenaB ) && falla( deRobot ) && falla( sinSesion ) && falla( otraPromocion ) && falla( mala )
		&& ( await filaDe( 'promociones', 'prueba-a' ) ).fase_proyecto === 'ejecucion'
		&& ( await filaDe( 'documentos', doc.data.id ) ).fase === 'ejecucion'
		&& historialA.length === 2 && vacio( historialB ) && ( falla( historialAnonimo ) || vacio( historialAnonimo ) )
		&& ( await filaDe( 'promociones', 'prueba-a2' ) ).fase_proyecto === null;

} );

await caso( DEBE_FUNCIONAR, 'Planos: los cambios pedidos en una versión no cuentan en la siguiente (vuelve a estar pendiente, con la petición a la vista)', async () => {

	const v40 = await exigir( enviarPlanos( 'v40', [ [ 'c', 'geometria-c' ] ] ), 'planos v40' );
	await exigir( gestorA.from( 'validaciones' ).insert( { entregable_id: plano( v40, 'c' ), decision: 'rechazado', comentario: 'Falta la terraza' } ), 'pedir cambios c v40' );
	const enV4 = ( await exigir( gestorA.rpc( 'validacion_de_version', { p_promocion: 'prueba-a', p_version: 'v40', p_tipo: 'planos' } ), 'v40' ) )[ 0 ];
	// v41 con el mismo contenido: la petición de la v40 ya no cuenta, pero se ve
	await exigir( enviarPlanos( 'v41', [ [ 'c', 'geometria-c' ] ] ), 'planos v5' );
	const enV5 = ( await exigir( gestorA.rpc( 'validacion_de_version', { p_promocion: 'prueba-a', p_version: 'v41', p_tipo: 'planos' } ), 'v41' ) )[ 0 ];
	const suyo = enV5.personas.find( ( p ) => p.user_id === gestorAId );
	return enV4.estado === 'cambios' && enV5.estado === 'pendiente' && suyo.decision === null
		&& suyo.anterior?.version === 'v40' && suyo.anterior?.comentario === 'Falta la terraza';

} );

// ─── Módulos de la promoción, modo de publicación y documentos que cubren varios requisitos (022) ──

await caso( DEBE_FALLAR, '37. Módulos: la promotora activa o desactiva partes, cambia el modo de publicación o marca lo que cubre un documento ajeno; con el acceso de compradores apagado se crean códigos o se entra con uno', async () => {

	const modulos = ( sb ) => sb.rpc( 'guardar_modulos', { p_promocion: 'prueba-a', p_experiencia_publica: true, p_acceso_comprador: true, p_personalizacion: false, p_publicacion: 'manual' } );
	const otroReq = ( await exigir( admin.from( 'requisitos' ).insert( { promocion_id: 'prueba-a', bloque: 'Planos', elemento: 'Alzados (prueba 022)', descripcion: '', obligatorio: false, orden: 99 } ).select( 'id' ), 'requisito extra' ) )[ 0 ].id;
	const docA = await exigir( gestorA.from( 'documentos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ).limit( 1 ), 'documento A' );
	// un código válido antes de apagar el acceso
	const codigo = ( await exigir( generar( admin, 'Prueba 022' ), 'código antes' ) );
	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a', p_experiencia_publica: true, p_acceso_comprador: false, p_personalizacion: true, p_publicacion: 'automatica' } ), 'apagar acceso' );
	const r = {
		promotora: await modulos( aprobA ),
		directo: await aprobA.from( 'promociones' ).update( { publicacion: 'manual' } ).eq( 'id', 'prueba-a' ).select( 'id' ),
		otraPromotora: await aprobB.rpc( 'cubrir_requisitos', { p_documento: docA[ 0 ].id, p_requisitos: [ otroReq ] } ),
		requisitoAjeno: await gestorA.rpc( 'cubrir_requisitos', { p_documento: docA[ 0 ].id, p_requisitos: [ req[ 'prueba-b' ] ] } ),
		codigoSinAcceso: await generar( admin, 'Prueba 022 bis' ),
	};
	const entra = await entrarComprador( String( codigo ) );
	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a', p_experiencia_publica: true, p_acceso_comprador: true, p_personalizacion: true, p_publicacion: 'automatica' } ), 'encender acceso' );
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	if ( entra.data ) throw new Error( 'se entra con el acceso de compradores apagado' );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Módulos y documentos: MUNE Studio cambia los módulos y el modo de publicación; un archivo cubre varios requisitos y su versión nueva cubre lo mismo', async () => {

	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a', p_experiencia_publica: false, p_acceso_comprador: true, p_personalizacion: false, p_publicacion: 'manual' } ), 'módulos' );
	const promo = await filaDe( 'promociones', 'prueba-a' );
	const visto = ( await gestorA.from( 'promociones' ).select( 'modulos, publicacion' ).eq( 'id', 'prueba-a' ).single() ).data;
	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a', p_experiencia_publica: true, p_acceso_comprador: true, p_personalizacion: true, p_publicacion: 'automatica' } ), 'módulos de vuelta' );
	const otroReq = ( await exigir( admin.from( 'requisitos' ).select( 'id' ).eq( 'promocion_id', 'prueba-a' ).eq( 'elemento', 'Alzados (prueba 022)' ), 'requisito extra' ) )[ 0 ].id;
	const doc = await subirDocumento( gestorA, pA.id, 'prueba-a', 'documento completo 022' );
	if ( doc.error ) throw doc.error;
	await exigir( gestorA.rpc( 'cubrir_requisitos', { p_documento: doc.data.id, p_requisitos: [ otroReq, req[ 'prueba-a' ] ] } ), 'cubrir' );
	const cubre = ( await gestorA.from( 'documento_cubre' ).select( 'requisito_id' ).eq( 'documento_id', doc.data.id ) ).data ?? [];
	// versión nueva del mismo archivo: cubre lo mismo
	const contenido = pdf( 'documento completo 022 v2' );
	const ruta = `${ pA.id }/prueba-a/${ req[ 'prueba-a' ] }/${ Date.now() }-completo.pdf`;
	await exigir( gestorA.storage.from( 'documentos' ).upload( ruta, contenido, { contentType: 'application/pdf' } ), 'subir v2' );
	const nueva = await exigir( gestorA.from( 'documentos' ).insert( { promocion_id: 'prueba-a', requisito_id: req[ 'prueba-a' ], nombre: 'completo.pdf', ruta,
		tipo: 'application/pdf', tamano: contenido.length, huella: huella( contenido ), reemplaza_a: doc.data.id } ).select( 'id' ).single(), 'versión nueva' );
	const cubreNueva = ( await gestorA.from( 'documento_cubre' ).select( 'requisito_id' ).eq( 'documento_id', nueva.id ) ).data ?? [];
	const ajeno = await aprobB.from( 'documento_cubre' ).select( 'requisito_id' ).eq( 'documento_id', doc.data.id );
	return promo.publicacion === 'manual' && promo.modulos.experiencia_publica === false && promo.modulos.personalizacion === false
		&& visto?.publicacion === 'manual'
		&& cubre.length === 1 && cubre[ 0 ].requisito_id === otroReq
		&& cubreNueva.length === 1 && cubreNueva[ 0 ].requisito_id === otroReq
		&& ( falla( ajeno ) || vacio( ajeno ) );

} );

// ─── Copias de seguridad (023_copias.sql, receta 18) ────────────────────────

const copiasId = await crearUsuario( 'hello.muneprojects+copias@gmail.com' );
execFileSync( 'psql', [ DB_URL, '-q', '-c', `insert into public.cuentas_copias (user_id) values ('${ copiasId }') on conflict do nothing` ] );
execFileSync( 'psql', [ DB_URL, '-q', '-c', "alter role copias with password 'prueba-copias-123'" ] );
const cuentaCopias = await entrar( 'hello.muneprojects+copias@gmail.com' );
const comoCopias = ( sql ) => execFileSync( 'psql', [ DB_URL.replace( /\/\/[^@]*@/, '//copias:prueba-copias-123@' ), '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql ],
	{ stdio: [ 'ignore', 'pipe', 'pipe' ] } ).toString().trim();

await caso( DEBE_FALLAR, 'Copias: la cuenta de copias lee datos de MUNE, sube o borra archivos; el usuario «copias» de la base de datos cambia algo; otro apunta una copia o ve el registro de copias', async () => {

	const r = {
		leePromociones: await cuentaCopias.from( 'promociones' ).select( 'id' ),
		leeDocumentos: await cuentaCopias.from( 'documentos' ).select( 'id' ),
		leeMiembros: await cuentaCopias.from( 'miembros' ).select( 'id' ),
		sube: await cuentaCopias.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a/${ req[ 'prueba-a' ] }/copias.pdf`, pdf( 'x' ), { contentType: 'application/pdf' } ),
		borra: await cuentaCopias.storage.from( 'entregables' ).remove( [ planoA.ruta ] ),
		promotoraApunta: await gestorA.rpc( 'registrar_copia', { p_tipo: 'copia', p_correcta: true, p_detalle: {} } ),
		robotApunta: await robot.rpc( 'registrar_copia', { p_tipo: 'copia', p_correcta: true, p_detalle: {} } ),
		anonimoApunta: await anonimo.rpc( 'registrar_copia', { p_tipo: 'copia', p_correcta: true, p_detalle: {} } ),
		promotoraVe: await gestorA.from( 'copias_hechas' ).select( 'id' ),
		copiasVe: await cuentaCopias.from( 'copias_hechas' ).select( 'id' ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	// remove() no da error si no borra nada: se comprueba que el plano sigue ahí
	if ( ! ( await admin.storage.from( 'entregables' ).download( planoA.ruta ) ).data ) noFallan.push( 'borra' );
	for ( const [ k, sql ] of Object.entries( {
		escribe: `insert into public.registro (user_id, accion) values ('${ copiasId }', 'x')`,
		cambia: `update public.promociones set nombre = 'x'`,
		borraFilas: 'delete from public.copias_hechas',
		creaTabla: 'create table public.x (id int)',
		usuarios: `update auth.users set email = 'x@x.x'`,
	} ) ) {

		try {

			comoCopias( sql );
			noFallan.push( `bd:${ k }` );

		} catch { /* debe fallar */ }

	}
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Copias: el usuario «copias» lee toda la base de datos y los usuarios; la cuenta de copias descarga los archivos de todas las promotoras y apunta la copia; MUNE Studio la ve', async () => {

	const promociones = Number( comoCopias( 'select count(*) from public.promociones' ) );
	const usuarios = Number( comoCopias( 'select count(*) from copias.usuarios' ) );
	const factores = Number( comoCopias( 'select count(*) from copias.factores' ) );
	const archivos = Number( comoCopias( "select count(*) from storage.objects where bucket_id in ('documentos', 'entregables', 'referencias')" ) );
	const docBRuta = ( await exigir( aprobB.from( 'documentos' ).select( 'ruta' ).limit( 1 ), 'documento B' ) )[ 0 ].ruta;
	const bajadas = await Promise.all( [ [ 'documentos', docB.ruta ?? docBRuta ], [ 'entregables', planoA.ruta ], [ 'entregables', planoB.ruta ] ]
		.map( ( [ a, ruta ] ) => cuentaCopias.storage.from( a ).download( ruta ) ) );
	await exigir( cuentaCopias.rpc( 'registrar_copia', { p_tipo: 'copia', p_correcta: true, p_detalle: { prueba: true } } ), 'apuntar copia' );
	const estado = await exigir( admin.rpc( 'estado_sistema' ), 'estado' );
	const avisos = await exigir( admin.rpc( 'avisos_sistema' ), 'avisos' );
	return promociones >= 4 && usuarios >= 6 && factores >= 1 && archivos > 0
		&& bajadas.every( ( b ) => b.data && ! b.error )
		&& estado.ultima_copia && estado.copias[ 0 ]?.tipo === 'copia'
		&& ! avisos.some( ( x ) => x.clave === 'copias' ) && avisos.some( ( x ) => x.clave === 'simulacro' );

} );

// ─── Datos privados de cada versión (024_datos_privados.sql, paso 5a) ───────

const datosPrueba = {
	catalogo: { moneda: 'EUR', categorias: [ { id: 'suelo', nombre: 'Suelo', opciones: [ { id: 'base', nombre: 'Base', precio: 0 }, { id: 'nogal', nombre: 'Nogal', precio: 1900 } ] } ] },
	packs: [ { id: 'acabados', titulo: 'Acabados', desde: '2026-01-01', hasta: '2030-12-31', categorias: [ 'suelo' ] } ],
	tipologias: [ { id: 'a', opciones: { suelo: [ 'base', 'nogal' ] } } ],
	viviendas: [ { ref: 'Bajo A', planta: 'Baja', tipologia: 'a', espejo: false }, { ref: 'Bajo B', planta: 'Baja', tipologia: 'a', espejo: true } ],
};
const guardarDatos = ( sb, version, promocion = 'prueba-a' ) => sb.rpc( 'guardar_datos_privados', { p_promocion: promocion, p_version: version, p_contenido: datosPrueba } );

await caso( DEBE_FALLAR, '38. Datos privados: la promotora o alguien sin sesión guardan o leen los de una versión; se cambian los de una versión ya enviada a validar; otra promotora ve sus viviendas', async () => {

	await exigir( guardarDatos( robot, 'v90' ), 'datos v90' );
	const r = {
		promotoraGuarda: await guardarDatos( gestorA, 'v91' ),
		anonimoGuarda: await guardarDatos( anonimo, 'v91' ),
		yaEnviada: await guardarDatos( robot, 'v1' ),
		promotoraLee: await gestorA.from( 'datos_privados' ).select( 'version' ),
		anonimoLee: await anonimo.from( 'datos_privados' ).select( 'version' ),
		otraVeViviendas: await aprobB.rpc( 'viviendas_de_promocion', { p_promocion: 'prueba-a' } ),
		anonimoVeViviendas: await anonimo.rpc( 'viviendas_de_promocion', { p_promocion: 'prueba-a' } ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Datos privados: el robot guarda los de una versión; el comprador recibe, con su código, el catálogo con precios y solo su vivienda; el equipo ve la lista de viviendas', async () => {

	await exigir( guardarDatos( robot, 'v90' ), 'datos v90 otra vez (repetible)' );
	const codigo = await exigir( generar( admin, 'Bajo B', true ), 'código Bajo B' );
	const { data: sinVersion } = await entrarComprador( String( codigo ) );
	const { data: entra, error } = await anonimo.rpc( 'entrar_comprador', { p_promocion: 'prueba-a', p_codigo: String( codigo ), p_version: 'v90' } );
	if ( error ) throw error;
	const lista = await exigir( gestorA.rpc( 'viviendas_de_promocion', { p_promocion: 'prueba-a' } ), 'viviendas' );
	const filas = await exigir( admin.from( 'datos_privados' ).select( 'version, huella' ).eq( 'promocion_id', 'prueba-a' ), 'admin lee' );
	const texto = JSON.stringify( entra.datos );
	return sinVersion?.vivienda === 'Bajo B' && sinVersion.datos === null
		&& entra.datos?.vivienda?.ref === 'Bajo B' && ! texto.includes( 'Bajo A' )
		&& entra.datos.catalogo.categorias[ 0 ].opciones[ 1 ].precio === 1900 && entra.datos.packs.length === 1
		&& entra.datos.tipologia?.id === 'a'
		&& lista.length === 2 && lista[ 0 ].ref === 'Bajo A' && ! ( 'opciones' in lista[ 0 ] )
		&& filas.some( ( f ) => f.version === 'v90' );

} );

// ─── Selecciones: Seleccionada → Cerrada (025_selecciones.sql, paso 5b) ─────

const guardarComoComprador = ( codigo, pack, opciones, version = 'v90' ) => anonimo.rpc( 'guardar_seleccion', { p_promocion: 'prueba-a', p_codigo: codigo, p_version: version, p_pack: pack, p_opciones: opciones } );
const guardarComoEquipo = ( sb, vivienda, opciones ) => sb.rpc( 'guardar_seleccion_equipo', { p_promocion: 'prueba-a', p_vivienda: vivienda, p_pack: 'acabados', p_opciones: opciones } );
const codigoSel = String( await exigir( generar( admin, 'Bajo A', true ), 'código Bajo A (selecciones)' ) );

await caso( DEBE_FUNCIONAR, 'Selecciones: el comprador guarda la suya (Seleccionada, con el importe calculado por Supabase) y la cambia; el equipo con «personalización» guarda otra en nombre de un comprador y lo ve todo', async () => {

	const primera = await exigir( guardarComoComprador( codigoSel, 'acabados', { suelo: 'base' } ), 'guardar' );
	const cambio = await exigir( guardarComoComprador( codigoSel, 'acabados', { suelo: 'nogal' } ), 'cambiar' );
	const equipo = await exigir( guardarComoEquipo( gestorA, 'Bajo B', { suelo: 'nogal' } ), 'equipo' );
	const lista = await exigir( gestorA.rpc( 'personalizacion_de_promocion', { p_promocion: 'prueba-a' } ), 'lista' );
	const deA = lista.selecciones.find( ( s ) => s.vivienda === 'Bajo A' );
	const deB = lista.selecciones.find( ( s ) => s.vivienda === 'Bajo B' );
	const { data: entra } = await anonimo.rpc( 'entrar_comprador', { p_promocion: 'prueba-a', p_codigo: codigoSel, p_version: 'v90' } );
	return primera.estado === 'seleccionada' && Number( primera.importe ) === 0
		&& Number( cambio.importe ) === 1900 && cambio.opciones.suelo === 'nogal'
		&& Number( equipo.importe ) === 1900 && deA?.estado === 'seleccionada' && deA.hecho_por === 'comprador'
		&& deB?.hecho_por === 'equipo' && deA.detalle[ 0 ]?.nombre === 'Nogal'
		&& entra?.selecciones?.acabados?.estado === 'seleccionada';

} );

await caso( DEBE_FALLAR, '39. Selecciones: MUNE, otra promotora, el robot o alguien sin sesión guardan una; el comprador elige fuera de su pack, una opción que no existe o un precio inventado; se escribe directamente en la tabla; se cambia una selección cerrada', async () => {

	const r = {
		mune: await guardarComoEquipo( admin, 'Bajo A', { suelo: 'base' } ),
		otraPromotora: await guardarComoEquipo( aprobB, 'Bajo A', { suelo: 'base' } ),
		robot: await guardarComoEquipo( robot, 'Bajo A', { suelo: 'base' } ),
		anonimoEquipo: await guardarComoEquipo( anonimo, 'Bajo A', { suelo: 'base' } ),
		otraCategoria: await guardarComoComprador( codigoSel, 'acabados', { cocina: 'nogal' } ),
		noExiste: await guardarComoComprador( codigoSel, 'acabados', { suelo: 'marmol' } ),
		otroPack: await guardarComoComprador( codigoSel, 'extras', {} ),
		directa: await admin.from( 'selecciones_comprador' ).insert( { promocion_id: 'prueba-a', vivienda_ref: 'Bajo A', pack: 'x', opciones: {}, fecha: '2026-01-01' } ),
		cambiaImporte: await admin.from( 'selecciones_comprador' ).update( { importe: 1 } ).eq( 'promocion_id', 'prueba-a' ).select( 'id' ),
	};
	const codigoFalso = await guardarComoComprador( 'c-000000000000', 'acabados', { suelo: 'base' } );
	if ( codigoFalso.data ) r.codigoFalso = { error: null, data: [ 1 ] };
	// el periodo termina (versión nueva con el pack cerrado ayer): pasa a Cerrada y ya no cambia
	const ayer = new Date( Date.now() - 86_400_000 ).toISOString().slice( 0, 10 );
	await exigir( anonimo.rpc( 'entrar_comprador', { p_promocion: 'prueba-a', p_codigo: codigoSel, p_version: 'v90' } ), 'entra' );
	await exigir( robot.rpc( 'guardar_datos_privados', { p_promocion: 'prueba-a', p_version: 'v91', p_contenido: { ...datosPrueba, packs: [ { ...datosPrueba.packs[ 0 ], hasta: ayer } ] } } ), 'datos v91' );
	r.cerrada = await guardarComoComprador( codigoSel, 'acabados', { suelo: 'base' } );
	r.cerradaEquipo = await guardarComoEquipo( gestorA, 'Bajo A', { suelo: 'base' } );
	const lista = await exigir( admin.rpc( 'personalizacion_de_promocion', { p_promocion: 'prueba-a' } ), 'lista' );
	if ( lista.selecciones.find( ( s ) => s.vivienda === 'Bajo A' )?.estado !== 'cerrada' ) throw new Error( 'no pasa a Cerrada' );
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

// ─── Puerta general del comprador (026_puerta_comprador.sql, paso 5c) ───────

const buscar = ( codigo ) => anonimo.rpc( 'buscar_vivienda_comprador', { p_codigo: codigo } );

await caso( DEBE_FUNCIONAR, 'Puerta del comprador: con un código válido (escrito de cualquier forma) dice de qué promoción es, y nada más', async () => {

	const codigo = String( await exigir( generar( gestorA, 'Bajo A' ), 'código' ) );
	const { data, error } = await buscar( ` ${ codigo.toUpperCase() } ` );
	if ( error ) throw error;
	return data?.promocion === 'prueba-a' && Object.keys( data ).length === 1;

} );

await caso( DEBE_FALLAR, '40. Puerta del comprador: un código cambiado, de una promoción sin acceso de compradores o inventado da algo; probar códigos al azar no se bloquea', async () => {

	const viejo = String( await exigir( generar( gestorA, 'Bajo B' ), 'código B' ) );
	await exigir( generar( gestorA, 'Bajo B' ), 'cambio del código B' );
	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a2', p_experiencia_publica: true, p_acceso_comprador: true, p_personalizacion: true, p_publicacion: 'automatica' } ), 'acceso A2' );
	const deA2 = String( await exigir( generar( admin, 'Bajo A', false, 'prueba-a2' ), 'código A2' ) );
	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a2', p_experiencia_publica: true, p_acceso_comprador: false, p_personalizacion: true, p_publicacion: 'automatica' } ), 'sin acceso A2' );
	const r = { viejo: ( await buscar( viejo ) ).data, sinAcceso: ( await buscar( deA2 ) ).data, inventado: ( await buscar( 'c-000000000000' ) ).data };
	await exigir( admin.rpc( 'guardar_modulos', { p_promocion: 'prueba-a2', p_experiencia_publica: true, p_acceso_comprador: true, p_personalizacion: true, p_publicacion: 'automatica' } ), 'acceso A2 de vuelta' );
	let bloqueado = false;
	for ( let i = 0; i < 12 && ! bloqueado; i ++ ) bloqueado = /Demasiados intentos/.test( ( await buscar( `c-00000000000${ i % 10 }` ) ).error?.message ?? '' );
	const dan = Object.keys( r ).filter( ( k ) => r[ k ] );
	if ( dan.length ) throw new Error( `dan algo: ${ dan.join( ', ' ) }` );
	if ( ! bloqueado ) throw new Error( 'no se bloquea' );
	return true;

} );

// ─── 3D profesional desde MUNE Portal (027_profesional.sql, paso 6a) ────────

const abrirPase = ( sb, promocion = 'prueba-a' ) => sb.rpc( 'abrir_experiencia_profesional', { p_promocion: promocion } );
const entrarPro = ( pase, promocion = 'prueba-a', version = 'v92' ) => anonimo.rpc( 'entrar_profesional', { p_promocion: promocion, p_pase: pase, p_version: version } );
const guardarPro = ( pase, vivienda, opciones ) => anonimo.rpc( 'guardar_seleccion_profesional', { p_promocion: 'prueba-a', p_pase: pase, p_version: 'v92', p_vivienda: vivienda, p_pack: 'acabados', p_opciones: opciones } );
await exigir( robot.rpc( 'guardar_datos_privados', { p_promocion: 'prueba-a', p_version: 'v92', p_contenido: {
	...datosPrueba, viviendas: [ ...datosPrueba.viviendas, { ref: 'Bajo C', planta: 'Baja', tipologia: 'a', espejo: false } ] } } ), 'datos v92' );

await caso( DEBE_FUNCIONAR, '3D profesional: el equipo abre el 3D desde el Portal con un pase y ve todas las viviendas, los precios y lo elegido; quien tiene «personalización» elige en nombre del comprador', async () => {

	const pase = await exigir( abrirPase( gestorA ), 'pase' );
	const pro = await exigir( entrarPro( pase ), 'entrar' );
	const r = await exigir( guardarPro( pase, 'Bajo C', { suelo: 'nogal' } ), 'guardar' );
	const lista = await exigir( gestorA.rpc( 'personalizacion_de_promocion', { p_promocion: 'prueba-a' } ), 'lista' );
	const deC = lista.selecciones.find( ( s ) => s.vivienda === 'Bajo C' );
	const paseCompradores = await exigir( abrirPase( soloCompradores.sb ), 'pase sin personalización' );
	const proCompradores = await exigir( entrarPro( paseCompradores ), 'entrar sin personalización' );
	return /^[0-9a-f]{48}$/.test( pase ) && pro.viviendas.length === 3 && pro.catalogo.categorias[ 0 ].opciones[ 1 ].precio === 1900
		&& pro.puede_personalizar === true && 'Bajo A' in pro.selecciones
		&& Number( r.importe ) === 1900 && deC?.hecho_por === 'equipo'
		&& proCompradores.puede_personalizar === false && proCompradores.viviendas.length === 3;

} );

await caso( DEBE_FALLAR, '41. 3D profesional: otra promotora, el robot o alguien sin sesión abren un pase; un pase inventado, de otra promoción o de hace más de 12 horas da datos; sin «personalización» o desde MUNE se elige en nombre del comprador', async () => {

	const noFallanExtra = [];
	const paseA = await exigir( abrirPase( gestorA ), 'pase A' );
	const paseCompradores = await exigir( abrirPase( soloCompradores.sb ), 'pase sin personalización' );
	const paseMune = await exigir( abrirPase( admin ), 'pase MUNE' );
	const r = {
		otraPromotora: await abrirPase( aprobB ),
		robot: await abrirPase( robot ),
		anonimo: await abrirPase( anonimo ),
		sinPermisoGuarda: await guardarPro( paseCompradores, 'Bajo C', { suelo: 'base' } ),
		muneGuarda: await guardarPro( paseMune, 'Bajo C', { suelo: 'base' } ),
		paseInventadoGuarda: await guardarPro( 'f'.repeat( 48 ), 'Bajo C', { suelo: 'base' } ),
		promotoraLeePases: await gestorA.from( 'pases_profesionales' ).select( 'id' ),
	};
	const inventado = ( await entrarPro( '0'.repeat( 48 ) ) ).data;
	const otraPromocion = ( await entrarPro( paseA, 'prueba-b' ) ).data;
	// un pase de hace más de una jornada ya no vale
	const paseViejo = await exigir( abrirPase( gestorA ), 'pase viejo' );
	execFileSync( 'psql', [ DB_URL, '-q', '-c', "update public.pases_profesionales set creado_en = now() - interval '13 hours' where id = (select max(id) from public.pases_profesionales)" ] );
	if ( ( await entrarPro( paseViejo ) ).data ) noFallanExtra.push( 'paseViejo' );
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( inventado ) noFallan.push( 'inventado' );
	if ( otraPromocion ) noFallan.push( 'otraPromocion' );
	noFallan.push( ...noFallanExtra );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

// ─── Experience pública (028_experiencia_publica.sql, paso 6b) ──────────────

const infoPublica = ( promocion = 'prueba-a' ) => anonimo.rpc( 'experiencia_publica', { p_promocion: promocion } );
const guardarInfo = ( sb, enlace, promocion = 'prueba-a' ) => sb.rpc( 'guardar_solicitar_info', { p_promocion: promocion, p_enlace: enlace } );

await caso( DEBE_FUNCIONAR, 'Experience pública: el equipo con «datos» pone el enlace de «Solicitar información» (o un email) y la web pública lo ve, con si está activa', async () => {

	await exigir( guardarInfo( gestorA, 'ventas@promotora-a.es' ), 'email' );
	const conEmail = await exigir( infoPublica(), 'leer email' );
	await exigir( guardarInfo( gestorA, 'https://promotora-a.es/contacto' ), 'enlace' );
	const conEnlace = await exigir( infoPublica(), 'leer enlace' );
	const inventada = await exigir( infoPublica( 'no-existe' ), 'inventada' );
	return conEmail.solicitar_info === 'mailto:ventas@promotora-a.es' && conEnlace.solicitar_info === 'https://promotora-a.es/contacto'
		&& typeof conEnlace.activa === 'boolean' && inventada.activa === false && inventada.solicitar_info === null;

} );

await caso( DEBE_FALLAR, '42. Experience pública: otra promotora, el robot, alguien sin «datos» o sin sesión cambian el enlace de «Solicitar información», o se guarda un enlace que no es https', async () => {

	const r = {
		otraPromotora: await guardarInfo( aprobB, 'https://malo.es' ),
		robot: await guardarInfo( robot, 'https://malo.es' ),
		sinDatos: await guardarInfo( soloCompradores.sb, 'https://malo.es' ),
		anonimo: await guardarInfo( anonimo, 'https://malo.es' ),
		javascript: await guardarInfo( gestorA, 'javascript:alert(1)' ),
		http: await guardarInfo( gestorA, 'http://promotora-a.es' ),
		anonimoLeeTabla: await anonimo.from( 'promociones' ).select( 'solicitar_info' ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( ( await exigir( infoPublica(), 'leer' ) ).solicitar_info !== 'https://promotora-a.es/contacto' ) noFallan.push( 'cambiado' );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

// ─── «Solicitar información» con el formulario de la promotora (033) ─────────

const FORMULARIO = '<form><input name="nombre"></form><script src="https://crm.example/formulario.js"></script>';
const guardarSolicitar = ( sb, modo, enlace, formulario, promocion = 'prueba-a' ) =>
	sb.rpc( 'guardar_solicitar_informacion', { p_promocion: promocion, p_modo: modo, p_enlace: enlace, p_formulario: formulario } );

await caso( DEBE_FUNCIONAR, '«Solicitar información»: el equipo con «datos» pone el formulario de su CRM y la web pública lo recibe; al volver a «enlace», la web pública ya no lo recibe', async () => {

	await exigir( guardarSolicitar( gestorA, 'formulario', 'https://promotora-a.es/contacto', FORMULARIO ), 'formulario' );
	const conFormulario = await exigir( infoPublica(), 'leer formulario' );
	await exigir( guardarSolicitar( gestorA, 'enlace', 'https://promotora-a.es/contacto', FORMULARIO ), 'enlace' );
	const conEnlace = await exigir( infoPublica(), 'leer enlace' );
	return conFormulario.solicitar_modo === 'formulario' && conFormulario.solicitar_formulario === FORMULARIO
		&& conEnlace.solicitar_modo === 'enlace' && conEnlace.solicitar_formulario === null && conEnlace.solicitar_info === 'https://promotora-a.es/contacto';

} );

await caso( DEBE_FALLAR, '46. «Solicitar información»: otra promotora, el robot, alguien sin «datos» o sin sesión ponen un formulario; un formulario vacío o un modo inventado', async () => {

	const r = {
		otraPromotora: await guardarSolicitar( aprobB, 'formulario', null, FORMULARIO ),
		robot: await guardarSolicitar( robot, 'formulario', null, FORMULARIO ),
		sinDatos: await guardarSolicitar( soloCompradores.sb, 'formulario', null, FORMULARIO ),
		anonimo: await guardarSolicitar( anonimo, 'formulario', null, FORMULARIO ),
		vacio: await guardarSolicitar( gestorA, 'formulario', null, '' ),
		sinHtml: await guardarSolicitar( gestorA, 'formulario', null, 'hola' ),
		modoInventado: await guardarSolicitar( gestorA, 'ventana', null, FORMULARIO ),
		enlaceMalo: await guardarSolicitar( gestorA, 'enlace', 'javascript:alert(1)', null ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( ( await exigir( infoPublica(), 'leer' ) ).solicitar_modo !== 'enlace' ) noFallan.push( 'cambiado' );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

// ─── Catálogo y precios de la promotora (029_catalogo_promotora.sql, paso 8a) ─
// Una versión nueva con un pack que aún no se ha abierto (exterior) además del
// de acabados (abierto desde 2026). Va al final: cambia los últimos datos privados.

const datosCatalogo = {
	...datosPrueba,
	catalogo: { moneda: 'EUR', categorias: [ ...datosPrueba.catalogo.categorias,
		{ id: 'exterior', nombre: 'Exterior', opciones: [ { id: 'sin-mejora', nombre: 'Sin mejora', precio: 0 }, { id: 'piscina', nombre: 'Piscina', precio: 18000 } ] } ] },
	packs: [ ...datosPrueba.packs, { id: 'extras', titulo: 'Extras', desde: '2099-01-01', hasta: '2099-12-31', categorias: [ 'exterior' ] } ],
	tipologias: [ { id: 'a', opciones: { suelo: [ 'base', 'nogal' ], exterior: [ 'sin-mejora', 'piscina' ] } } ],
};
await exigir( robot.rpc( 'guardar_datos_privados', { p_promocion: 'prueba-a', p_version: 'v95', p_contenido: datosCatalogo } ), 'datos v95' );
const guardarCatalogo = ( sb, cambios ) => sb.rpc( 'guardar_catalogo', { p_promocion: 'prueba-a', p_cambios: cambios } );

await caso( DEBE_FALLAR, '43. Catálogo: otra promotora, alguien sin «personalización» o sin sesión lo leen o lo cambian; se cambia el precio de un pack ya abierto; se quita la opción incluida de serie; la promotora atiende las opciones pedidas', async () => {

	const r = {
		otraLee: await aprobB.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ),
		otraCambia: await guardarCatalogo( aprobB, [ { categoria: 'exterior', opcion: 'piscina', precio: 1 } ] ),
		sinPermisoLee: await soloCompradores.sb.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ),
		sinPermisoCambia: await guardarCatalogo( soloCompradores.sb, [ { categoria: 'exterior', opcion: 'piscina', precio: 1 } ] ),
		anonimoLee: await anonimo.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ),
		anonimoCambia: await guardarCatalogo( anonimo, [ { categoria: 'exterior', opcion: 'piscina', precio: 1 } ] ),
		anonimoLeeTabla: await anonimo.from( 'catalogo_ajustes' ).select( 'precio' ),
		promotoraLeeTabla: await gestorA.from( 'catalogo_ajustes' ).select( 'precio' ),
		precioPackAbierto: await guardarCatalogo( gestorA, [ { categoria: 'suelo', opcion: 'nogal', precio: 1 } ] ),
		quitarIncluida: await guardarCatalogo( gestorA, [ { categoria: 'suelo', opcion: 'base', ofrecida: false } ] ),
		otraPide: await aprobB.rpc( 'pedir_opcion', { p_promocion: 'prueba-a', p_categoria: 'suelo', p_categoria_nueva: '', p_nombre: 'X', p_descripcion: '', p_precio: null } ),
		promotoraAtiende: await gestorA.rpc( 'atender_opcion', { p_id: 1, p_estado: 'hecha', p_nota: '' } ),
		promotoraVePendientesDeTodas: await gestorA.rpc( 'opciones_pedidas_pendientes' ),
		otraGuardaPacks: await aprobB.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: datosCatalogo.packs } ),
		quitarPackAbierto: await gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: [ datosCatalogo.packs[ 1 ] ] } ),
		moverCategoriaAbierta: await gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: [ { ...datosCatalogo.packs[ 0 ], categorias: [] }, { ...datosCatalogo.packs[ 1 ], categorias: [ 'exterior', 'suelo' ] } ] } ),
		packEnElPasado: await gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: [ datosCatalogo.packs[ 0 ], { ...datosCatalogo.packs[ 1 ], desde: '2020-01-01' } ] } ),
		archivoAjeno: await gestorA.rpc( 'pedir_opcion', { p_promocion: 'prueba-a', p_categoria: 'suelo', p_categoria_nueva: '', p_nombre: 'X', p_descripcion: '', p_precio: null, p_archivos: [ { ruta: 'otra/prueba-b/opciones/x.png', nombre: 'x.png' } ] } ),
		otraSubeOpcion: await aprobB.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a/opciones/intruso.png`, pdf( 'intruso' ) ),
		robotCambia: await guardarCatalogo( robot, [ { categoria: 'exterior', opcion: 'piscina', precio: 1 } ] ),
		robotPide: await robot.rpc( 'pedir_opcion', { p_promocion: 'prueba-a', p_categoria: 'suelo', p_categoria_nueva: '', p_nombre: 'X', p_descripcion: '', p_precio: null } ),
		robotSube: await robot.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a/opciones/robot.png`, pdf( 'robot' ) ),
		sinFechas: await gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: [ datosCatalogo.packs[ 0 ] ] } ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Catálogo: la promotora cambia un precio de un pack aún no abierto y deja de ofrecer una opción; el comprador lo ve al momento; quien ya la eligió la conserva; pide una opción nueva y MUNE la marca como añadida', async () => {

	// un comprador elige nogal antes de que se deje de ofrecer
	const codigo = String( await exigir( generar( admin, 'Bajo A', true ), 'código catálogo' ) );
	await exigir( anonimo.rpc( 'guardar_seleccion', { p_promocion: 'prueba-a', p_codigo: codigo, p_version: 'v95', p_pack: 'acabados', p_opciones: { suelo: 'nogal' } } ), 'elige nogal' );
	await exigir( guardarCatalogo( gestorA, [
		{ categoria: 'exterior', opcion: 'piscina', precio: 19500, nombre: 'Piscina privada' },
		{ categoria: 'suelo', opcion: 'nogal', ofrecida: false, nombre: 'Nogal americano' },
		{ categoria: 'suelo', nombre_categoria: 'Pavimentos' },
	] ), 'guardar catálogo' );
	const vista = await exigir( gestorA.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ), 'ver catálogo' );
	const entra = await exigir( anonimo.rpc( 'entrar_comprador', { p_promocion: 'prueba-a', p_codigo: codigo, p_version: 'v95' } ), 'entrar' );
	const piscina = entra.datos.catalogo.categorias.find( ( c ) => c.id === 'exterior' ).opciones.find( ( o ) => o.id === 'piscina' );
	const conserva = await exigir( anonimo.rpc( 'guardar_seleccion', { p_promocion: 'prueba-a', p_codigo: codigo, p_version: 'v95', p_pack: 'acabados', p_opciones: { suelo: 'nogal' } } ), 'conserva nogal' );
	const otro = String( await exigir( generar( admin, 'Bajo B', true ), 'código otro' ) );
	const otroElige = await anonimo.rpc( 'guardar_seleccion', { p_promocion: 'prueba-a', p_codigo: otro, p_version: 'v95', p_pack: 'acabados', p_opciones: { suelo: 'nogal' } } );
	// packs: la promotora pasa «exterior» a un pack nuevo y alarga el que no se ha abierto
	await exigir( gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: [ datosCatalogo.packs[ 0 ],
		{ ...datosCatalogo.packs[ 1 ], categorias: [], hasta: '2099-06-30' },
		{ id: 'sola-exterior', titulo: 'Exterior', desde: '2099-07-01', hasta: '2099-08-31', categorias: [ 'exterior' ], individual: true } ] } ), 'packs' );
	const conPacks = await exigir( anonimo.rpc( 'entrar_comprador', { p_promocion: 'prueba-a', p_codigo: codigo, p_version: 'v95' } ), 'entrar con packs' );
	// opción nueva con una foto subida a la carpeta de opciones de la promoción
	const ruta = `${ pA.id }/prueba-a/opciones/roble.png`;
	await exigir( gestorA.storage.from( 'documentos' ).upload( ruta, pdf( 'foto' ), { upsert: true } ), 'subir foto' );
	const id = await exigir( gestorA.rpc( 'pedir_opcion', { p_promocion: 'prueba-a', p_categoria: 'suelo', p_categoria_nueva: '', p_nombre: 'Roble ahumado', p_descripcion: 'Ficha en Documentación', p_precio: 1200, p_archivos: [ { ruta, nombre: 'roble.png' } ] } ), 'pedir' );
	const adminVeFoto = await admin.storage.from( 'documentos' ).createSignedUrl( ruta, 60 );
	// una categoría nueva, y el robot de Claude lee lo añadido y su documento para preparar el 3D
	await exigir( gestorA.rpc( 'pedir_opcion', { p_promocion: 'prueba-a', p_categoria: '', p_categoria_nueva: 'Climatización', p_nombre: 'Aerotermia', p_descripcion: '', p_precio: 6500 } ), 'categoría nueva' );
	// lo que está en preparación ya se mete en un pack y se cambia (los compradores aún no lo ven)
	const enPrep = await exigir( gestorA.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ), 'ver en preparación' );
	const aerotermia = enPrep.pedidas.find( ( x ) => x.nombre === 'Aerotermia' );
	const packsConNueva = [ ...enPrep.packs.filter( ( x ) => x.id !== 'extras' ),
		{ id: 'confort', titulo: 'Confort', desde: '2099-09-01', hasta: '2099-09-30', categorias: [ 'climatizacion' ] } ];
	const faltaNueva = await gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: enPrep.packs } );
	await exigir( gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: packsConNueva } ), 'pack con categoría en preparación' );
	// tipologías de lo que está en preparación (030): solo las de la promoción
	const tipologiaInventada = await guardarCatalogo( gestorA, [ { pedida: aerotermia.id, tipologias: [ 'z' ] } ] );
	await exigir( guardarCatalogo( gestorA, [ { pedida: aerotermia.id, precio: 6900, nombre: 'Aerotermia y suelo radiante', tipologias: [ 'a' ] },
		{ categoria: 'climatizacion', nombre_categoria: 'Clima' } ] ), 'cambiar en preparación' );
	// otra en una categoría nueva, por separado, que la promotora retira
	const toldo = await exigir( gestorA.rpc( 'pedir_opcion', { p_promocion: 'prueba-a', p_categoria: '', p_categoria_nueva: 'Sombra', p_nombre: 'Toldo', p_descripcion: '', p_precio: 900 } ), 'pedir toldo' );
	await exigir( gestorA.rpc( 'guardar_packs', { p_promocion: 'prueba-a', p_packs: [ ...packsConNueva,
		{ id: 'sola-sombra', titulo: 'Sombra', desde: '2099-10-01', hasta: '2099-10-31', categorias: [ 'sombra' ], individual: true } ] } ), 'pack de sombra' );
	await exigir( guardarCatalogo( gestorA, [ { pedida: toldo, quitar: true } ] ), 'retirar toldo' );
	const trasRetirar = await exigir( gestorA.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ), 'tras retirar' );
	const compradorNoVe = await exigir( anonimo.rpc( 'entrar_comprador', { p_promocion: 'prueba-a', p_codigo: codigo, p_version: 'v95' } ), 'comprador sin lo nuevo' );
	const robotLee = await exigir( robot.rpc( 'opciones_pedidas_pendientes' ), 'robot lee pendientes' );
	const robotDescarga = await robot.storage.from( 'documentos' ).download( ruta );
	const pendientes = await exigir( admin.rpc( 'opciones_pedidas_pendientes' ), 'pendientes' );
	await exigir( admin.rpc( 'atender_opcion', { p_id: id, p_estado: 'hecha', p_nota: 'Añadida en la v96' } ), 'atender' );
	const despues = await exigir( gestorA.rpc( 'catalogo_de_promocion', { p_promocion: 'prueba-a' } ), 'ver catálogo después' );
	const mal = Object.entries( {
		precioNuevo: piscina.precio === 19500 && piscina.nombre === 'Piscina privada',
		nogalRetirado: ! entra.datos.tipologia.opciones.suelo.includes( 'nogal' ),
		nombreCategoria: entra.datos.catalogo.categorias.find( ( c ) => c.id === 'suelo' ).nombre === 'Pavimentos',
		lanzadas: vista.lanzadas.includes( 'suelo' ) && ! vista.lanzadas.includes( 'exterior' ),
		conserva: conserva.opciones.suelo === 'nogal' && Number( conserva.importe ) === 1900,
		otroNoPuede: falla( otroElige ),
		pendiente: pendientes.some( ( x ) => x.id === id ),
		atendida: despues.pedidas.find( ( x ) => x.id === id )?.estado === 'hecha',
		// el pack que se quedó sin categorías no lo ven los compradores
		packs: conPacks.datos.packs.length === 2 && conPacks.datos.packs[ 1 ].categorias[ 0 ] === 'exterior' && conPacks.datos.packs[ 1 ].individual === true
			&& enPrep.packs.find( ( x ) => x.id === 'extras' )?.hasta === '2099-06-30',
		enPreparacion: falla( faltaNueva ) && falla( tipologiaInventada ) && trasRetirar.packs.some( ( x ) => x.id === 'confort' && x.categorias[ 0 ] === 'climatizacion' )
			&& trasRetirar.en_preparacion.climatizacion === 'Clima' && ! ( 'sombra' in trasRetirar.en_preparacion )
			&& ! trasRetirar.packs.some( ( x ) => x.id === 'sola-sombra' )
			&& trasRetirar.pedidas.find( ( x ) => x.id === toldo )?.estado === 'descartada'
			&& trasRetirar.pedidas.find( ( x ) => x.id === aerotermia.id )?.precio === 6900
			&& trasRetirar.pedidas.find( ( x ) => x.id === aerotermia.id )?.categoria_nueva === 'Clima'
			&& ! compradorNoVe.datos.packs.some( ( x ) => x.id === 'confort' ),
		foto: despues.pedidas.find( ( x ) => x.id === id )?.archivos?.[ 0 ]?.ruta === ruta && ! adminVeFoto.error,
		robot: robotLee.some( ( x ) => x.categoria === 'climatizacion' && x.categoria_nombre === 'Clima' && x.categoria_nueva && x.pack?.id === 'confort' && x.tipologias?.join() === 'a' ) && ! robotDescarga.error,
	} ).filter( ( [ , ok ] ) => ! ok ).map( ( [ k ] ) => k );
	if ( mal.length ) throw new Error( `no cumple: ${ mal.join( ', ' ) } (${ JSON.stringify( { piscina, suelo: entra.datos.tipologia.opciones.suelo, lanzadas: vista.lanzadas, conserva, otro: otroElige.error?.message, packs: conPacks.datos.packs, trasRetirar: { packs: trasRetirar.packs, en_preparacion: trasRetirar.en_preparacion }, faltaNueva: faltaNueva.error?.message } ) })` );
	return true;

} );

// ─── Marca de la promotora (031_marca.sql, paso 8c) ──────────────────────────

const soloMarca = await altaEquipo( 'marca.a@prueba.local', 'prueba-a', [ 'marca' ] );
const marcaBuena = ( nombre, logo ) => ( { nombre, logo_svg: logo ?? null, color_principal: '#7a2e3b', color_secundario: '#b8946a', tipografia: 'Lora', telefono: '900 000 000', web: 'promotora-a.es' } );
const LOGO_PNG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><image href="data:image/png;base64,iVBORw0KGgo=" width="10" height="10"/></svg>';
const guardarMarca = ( sb, promotora, promocion, marca ) => sb.rpc( 'guardar_marca', { p_promotora: promotora, p_promocion: promocion, p_marca: marca } );
// una tipografía propia (y un PDF) subidos por quien administra la promotora a su carpeta de marca
const FUENTE_A = `${ pA.id }/marca/mi-fuente.woff2`;
const PDF_EN_MARCA = `${ pA.id }/marca/no-es-fuente.pdf`;
await exigir( aprobA.storage.from( 'documentos' ).upload( FUENTE_A, pdf( 'fuente' ), { upsert: true } ), 'subir tipografía' );
await exigir( aprobA.storage.from( 'documentos' ).upload( PDF_EN_MARCA, pdf( 'pdf' ), { upsert: true } ), 'subir pdf a marca' );

await caso( DEBE_FALLAR, '44. Marca: otra promotora, alguien sin «marca», sin administrar la promotora, sin sesión o el robot la leen o la cambian; un logo con código; una tipografía o un color que no valen', async () => {

	const r = {
		otraLeeGeneral: await aprobB.rpc( 'marca_de_promotora', { p_promotora: pA.id } ),
		otraLeePromocion: await aprobB.rpc( 'marca_de_promocion', { p_promocion: 'prueba-a' } ),
		otraCambiaGeneral: await guardarMarca( aprobB, pA.id, null, marcaBuena( 'Intrusa' ) ),
		otraCambiaPromocion: await guardarMarca( aprobB, pA.id, 'prueba-a', marcaBuena( 'Intrusa' ) ),
		sinAdministrarCambiaGeneral: await guardarMarca( gestorA, pA.id, null, marcaBuena( 'Gestor' ) ),
		sinCapacidadCambia: await guardarMarca( soloCompradores.sb, pA.id, 'prueba-a', marcaBuena( 'Sin permiso' ) ),
		sinCapacidadQuita: await soloCompradores.sb.rpc( 'quitar_marca_propia', { p_promocion: 'prueba-a' } ),
		promocionDeOtra: await guardarMarca( aprobA, pA.id, 'prueba-b', marcaBuena( 'Cruzada' ) ),
		anonimoLee: await anonimo.rpc( 'marca_de_promocion', { p_promocion: 'prueba-a' } ),
		anonimoCambia: await guardarMarca( anonimo, pA.id, null, marcaBuena( 'Anónima' ) ),
		robotCambia: await guardarMarca( robot, pA.id, null, marcaBuena( 'Robot' ) ),
		leeTabla: await aprobA.from( 'marcas' ).select( 'nombre' ),
		logoConScript: await guardarMarca( aprobA, pA.id, null, marcaBuena( 'A', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>' ) ),
		logoConEvento: await guardarMarca( aprobA, pA.id, null, marcaBuena( 'A', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>' ) ),
		logoConEnlaceFuera: await guardarMarca( aprobA, pA.id, null, marcaBuena( 'A', '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://fuera.example/x.png"/></svg>' ) ),
		logoNoSvg: await guardarMarca( aprobA, pA.id, null, marcaBuena( 'A', '<html><body>hola</body></html>' ) ),
		tipografiaRara: await guardarMarca( aprobA, pA.id, null, { ...marcaBuena( 'A' ), tipografia: 'Lora"><script>' } ),
		fuenteSinLicencia: await guardarMarca( aprobA, pA.id, null, { ...marcaBuena( 'A' ), tipografia: 'Mi Fuente', tipografia_archivos: [ { ruta: FUENTE_A, nombre: 'mi.woff2', peso: 400, estilo: 'normal' } ] } ),
		fuenteDeOtraPromotora: await guardarMarca( aprobB, pB.id, null, { ...marcaBuena( 'B' ), tipografia: 'Mi Fuente', licencia: true, tipografia_archivos: [ { ruta: FUENTE_A, nombre: 'mi.woff2', peso: 400, estilo: 'normal' } ] } ),
		fuenteQueNoEsFuente: await guardarMarca( aprobA, pA.id, null, { ...marcaBuena( 'A' ), tipografia: 'Mi Fuente', licencia: true, tipografia_archivos: [ { ruta: PDF_EN_MARCA, nombre: 'x.pdf', peso: 400, estilo: 'normal' } ] } ),
		otraSubeFuente: await aprobB.storage.from( 'documentos' ).upload( `${ pA.id }/marca/intrusa.woff2`, pdf( 'x' ) ),
		sinCapacidadSubeFuente: await soloCompradores.sb.storage.from( 'documentos' ).upload( `${ pA.id }/prueba-a/marca/x.woff2`, pdf( 'x' ) ),
		sinAdministrarSubeFuenteGeneral: await gestorA.storage.from( 'documentos' ).upload( `${ pA.id }/marca/x.woff2`, pdf( 'x' ) ),
		otraVeFuente: await aprobB.storage.from( 'documentos' ).download( FUENTE_A ),
		colorRaro: await guardarMarca( aprobA, pA.id, null, { ...marcaBuena( 'A' ), color_principal: 'red' } ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Marca: la administradora de la promotora pone la general (con un logo PNG dentro de un SVG); quien tiene «marca» pone una propia en su promoción y la quita; el robot de Claude lee la que se usa en cada promoción', async () => {

	await exigir( guardarMarca( aprobA, pA.id, null, marcaBuena( 'Promotora A', LOGO_PNG ) ), 'general' );
	// la propia de la promoción usa la tipografía de la promotora (sus archivos), con la licencia confirmada
	await exigir( guardarMarca( soloMarca.sb, pA.id, 'prueba-a', { ...marcaBuena( 'Residencial A' ), tipografia: 'Mi Fuente', color_principal: '#123456', licencia: true,
		tipografia_archivos: [ { ruta: FUENTE_A, nombre: 'mi.woff2', peso: 700, estilo: 'italic' } ] } ), 'propia' );
	const robotBajaFuente = await robot.storage.from( 'documentos' ).download( FUENTE_A );
	const conPropia = await exigir( robot.rpc( 'marca_de_promocion', { p_promocion: 'prueba-a' } ), 'robot lee prueba-a' );
	const otra = await exigir( robot.rpc( 'marca_de_promocion', { p_promocion: 'prueba-a2' } ), 'robot lee prueba-a2' );
	const equipoVe = await exigir( soloCompradores.sb.rpc( 'marca_de_promocion', { p_promocion: 'prueba-a' } ), 'el equipo la ve' );
	const general = await exigir( aprobA.rpc( 'marca_de_promotora', { p_promotora: pA.id } ), 'general' );
	await exigir( soloMarca.sb.rpc( 'quitar_marca_propia', { p_promocion: 'prueba-a' } ), 'quitar propia' );
	const sinPropia = await exigir( robot.rpc( 'marca_de_promocion', { p_promocion: 'prueba-a' } ), 'robot lee sin propia' );
	const mal = Object.entries( {
		propia: conPropia.efectiva?.promotora === 'Residencial A' && conPropia.efectiva?.tipografia?.familia === 'Mi Fuente' && conPropia.efectiva?.colorPrincipal === '#123456'
			&& conPropia.efectiva?.tipografia?.archivos?.[ 0 ]?.peso === 700 && !! conPropia.efectiva?.tipografia?.licencia && ! robotBajaFuente.error,
		general: otra.efectiva?.promotora === 'Promotora A' && otra.efectiva?.logoSvg === LOGO_PNG && otra.efectiva?.contacto?.telefono === '900 000 000'
			&& otra.efectiva?.tipografia?.familia === 'Lora' && ! otra.efectiva?.tipografia?.archivos,
		equipo: equipoVe.puede_cambiar === false && equipoVe.efectiva?.promotora === 'Residencial A',
		lista: general.puede_cambiar === true && general.propias?.some( ( x ) => x.id === 'prueba-a' ),
		quitada: sinPropia.propia === null && sinPropia.efectiva?.promotora === 'Promotora A',
	} ).filter( ( [ , ok ] ) => ! ok ).map( ( [ k ] ) => k );
	if ( mal.length ) throw new Error( `no cumple: ${ mal.join( ', ' ) } (${ JSON.stringify( { conPropia: conPropia.efectiva, otra: otra.efectiva && { ...otra.efectiva, logoSvg: '…' } } ) })` );
	return true;

} );

// ─── Comparar versiones: lo privado (034_comparar_versiones.sql) ─────────────

const compararVersion = ( sb ) => sb.rpc( 'comparar_version', { p_promocion: 'prueba-a', p_version: 'v95', p_anterior: 'v92' } );

await caso( DEBE_FALLAR, '47. Comparar versiones: otra promotora, el robot, alguien sin «personalización» o sin sesión ven el catálogo, los precios o los compradores afectados de otra versión', async () => {

	const r = {
		otraPromotora: await compararVersion( aprobB ),
		robot: await compararVersion( robot ),
		sinPersonalizacion: await compararVersion( soloCompradores.sb ),
		anonimo: await compararVersion( anonimo ),
	};
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Comparar versiones: quien tiene «personalización» y MUNE Studio ven qué cambia en el catálogo y qué compradores se ven afectados', async () => {

	const equipo = await exigir( compararVersion( soloPersonalizacion.sb ), 'equipo' );
	const mune = await exigir( compararVersion( admin ), 'MUNE' );
	const mal = Object.entries( {
		catalogo: equipo.catalogo?.some( ( x ) => x.includes( 'Exterior' ) ),
		afectados: Array.isArray( equipo.afectados ) && equipo.afectados.some( ( a ) => a.vivienda === 'Bajo A' ),
		mune: JSON.stringify( mune.catalogo ) === JSON.stringify( equipo.catalogo ),
	} ).filter( ( [ , ok ] ) => ! ok ).map( ( [ k ] ) => k );
	if ( mal.length ) throw new Error( `no cumple: ${ mal.join( ', ' ) } (${ JSON.stringify( equipo ) })` );
	return true;

} );

// ─── Modelo de cada promoción (035_modelo_promocion.sql) ────────────────────

const MODELO = {
	'promocion.json': JSON.stringify( { id: 'prueba-a', nombre: 'Residencial A' }, null, 2 ),
	'catalogo.json': '{ "categorias": [] }',
	'tipologias/a/vivienda.json': '{ "estancias": [] }',
};
const guardarModelo = ( sb, archivos, extra = {}, promocion = 'prueba-a' ) => sb.rpc( 'guardar_modelo_promocion', { p_promocion: promocion, p_archivos: archivos, ...extra } );
const COMMIT = 'a'.repeat( 40 );

await caso( DEBE_FALLAR, '48. Modelo de la promoción: la promotora, alguien sin sesión o MUNE sin el código del móvil lo leen o lo guardan; se cambia una versión ya guardada; archivos no válidos', async () => {

	await exigir( guardarModelo( robot, MODELO, { p_version: 'v90', p_codigo: COMMIT, p_nota: 'v90 de prueba' } ), 'el robot guarda la v90' );
	const r = {
		promotoraGuarda: await guardarModelo( aprobA, MODELO ),
		anonimoGuarda: await guardarModelo( anonimo, MODELO ),
		adminSinMovilGuarda: await guardarModelo( adminSinMovil, MODELO ),
		cambiarVersion: await guardarModelo( robot, { ...MODELO, 'catalogo.json': '{ "cambiado": true }' }, { p_version: 'v90', p_codigo: COMMIT } ),
		versionSinCommit: await guardarModelo( robot, MODELO, { p_version: 'v91' } ),
		commitSinVersion: await guardarModelo( robot, MODELO, { p_codigo: COMMIT } ),
		sinPromocionJson: await guardarModelo( robot, { 'catalogo.json': '{}' } ),
		rutaFuera: await guardarModelo( robot, { ...MODELO, '../promocion.json': '{}' } ),
		rutaOculta: await guardarModelo( robot, { ...MODELO, 'tipologias/.oculto.json': '{}' } ),
		noJson: await guardarModelo( robot, { ...MODELO, 'catalogo.json': 'esto no es JSON' } ),
		noTexto: await guardarModelo( robot, { ...MODELO, 'catalogo.json': { categorias: [] } } ),
		otraExtension: await guardarModelo( robot, { ...MODELO, 'plano.png': 'x' } ),
		promocionInventada: await guardarModelo( robot, MODELO, {}, 'no-existe' ),
	};
	const lecturas = {
		promotoraLee: await aprobA.from( 'modelo_promocion' ).select( 'id' ),
		gestorLee: await gestorA.from( 'modelo_promocion' ).select( 'id' ),
		anonimoLee: await anonimo.from( 'modelo_promocion' ).select( 'id' ),
		adminSinMovilLee: await adminSinMovil.from( 'modelo_promocion' ).select( 'id' ),
		copiasCuentaLee: await cuentaCopias.from( 'modelo_promocion' ).select( 'id' ),
		promotoraCambia: await aprobA.from( 'modelo_promocion' ).update( { nota: 'x' } ).eq( 'promocion_id', 'prueba-a' ).select( 'id' ),
		robotCambia: await robot.from( 'modelo_promocion' ).update( { nota: 'x' } ).eq( 'promocion_id', 'prueba-a' ).select( 'id' ),
		robotBorra: await robot.from( 'modelo_promocion' ).delete().eq( 'promocion_id', 'prueba-a' ).select( 'id' ),
	};
	const v90 = ( await servicio.from( 'modelo_promocion' ).select( 'archivos, nota' ).eq( 'promocion_id', 'prueba-a' ).eq( 'version', 'v90' ) ).data;
	const noFallan = [
		...Object.keys( r ).filter( ( k ) => ! falla( r[ k ] ) ),
		...Object.keys( lecturas ).filter( ( k ) => ! ( falla( lecturas[ k ] ) || vacio( lecturas[ k ] ) ) ),
	];
	if ( v90?.length !== 1 || v90[ 0 ].archivos[ 'catalogo.json' ] !== MODELO[ 'catalogo.json' ] || v90[ 0 ].nota !== 'v90 de prueba' ) noFallan.push( 'v90 cambiada' );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Modelo de la promoción: el robot guarda la versión de trabajo (sin pisar las anteriores) y la de cada versión; MUNE Studio los lee; al borrar la promoción se borran', async () => {

	const h1 = await exigir( guardarModelo( robot, MODELO, { p_nota: 'primera' } ), 'guardar trabajo' );
	const h2 = await exigir( guardarModelo( robot, { ...MODELO, 'catalogo.json': '{ "categorias": [ 1 ] }' }, { p_nota: 'segunda' } ), 'guardar trabajo otra vez' );
	const filas = await exigir( admin.from( 'modelo_promocion' ).select( 'version, huella, nota, archivos' ).eq( 'promocion_id', 'prueba-a' ).is( 'version', null ).order( 'id' ), 'admin lee' );
	const robotLee = await exigir( robot.from( 'modelo_promocion' ).select( 'version' ).eq( 'promocion_id', 'prueba-a' ), 'robot lee' );
	const apunte = await exigir( admin.from( 'registro' ).select( 'accion' ).eq( 'accion', 'guarda los datos de una versión' ), 'registro' );

	// una promoción con su modelo, desactivada y borrada: no queda nada suyo
	await exigir( admin.from( 'promociones' ).insert( { id: 'prueba-modelo', promotora_id: pA.id, nombre: 'Modelo (se borra)' } ), 'alta prueba-modelo' );
	await exigir( guardarModelo( robot, MODELO, {}, 'prueba-modelo' ), 'modelo de prueba-modelo' );
	await exigir( guardarModelo( robot, MODELO, { p_version: 'v1', p_codigo: COMMIT }, 'prueba-modelo' ), 'v1 de prueba-modelo' );
	await exigir( admin.from( 'promociones' ).update( { activa: false } ).eq( 'id', 'prueba-modelo' ), 'desactivar' );
	await exigir( admin.rpc( 'borrar_promocion', { p_id: 'prueba-modelo', p_nombre: 'Modelo (se borra)' } ), 'borrar' );
	const quedan = ( await servicio.from( 'modelo_promocion' ).select( 'id' ).eq( 'promocion_id', 'prueba-modelo' ) ).data;

	return filas.length === 2 && filas[ 0 ].huella === h1 && filas[ 1 ].huella === h2 && filas[ 0 ].nota === 'primera'
		&& filas[ 1 ].archivos[ 'catalogo.json' ] === '{ "categorias": [ 1 ] }' && robotLee.length === 3
		&& apunte.length >= 1 && quedan?.length === 0;

} );

// ─── Comentarios visuales (038_comentarios.sql) ─────────────────────────────

// una versión nueva con el plano «a», para comentarla y pedir cambios
const [ planoV99 ] = await exigir( enviarPlanos( 'v99', [ [ 'a', 'geometria-a-v99' ] ] ), 'planos v99' );
const comentar = ( sb, extra = {} ) => sb.rpc( 'comentar', { p_promocion: 'prueba-a', p_version: 'v99', p_tipo: 'plano', p_clave: 'a', p_punto: { x: 0.4, y: 0.5 }, p_texto: 'La puerta abre hacia el otro lado', ...extra } );
const comentarioA = await exigir( comentar( aprobA ), 'comentario de la promotora A' );
const notaMune = await exigir( comentar( admin, { p_tipo: 'version', p_clave: null, p_punto: null, p_texto: 'Nota interna para Claude' } ), 'nota de MUNE' );

await caso( DEBE_FALLAR, '51. Comentarios visuales: otra promotora, el robot o sin sesión comentan o leen los de otra promotora; la promotora ve las notas de MUNE, resuelve, borra lo enviado o lo ajeno, devuelve a Claude o comenta la personalización sin permiso; puntos, sitios o versiones inventados', async () => {

	const paseB = await exigir( abrirPase( aprobB, 'prueba-b' ), 'pase B' );
	const r = {
		otraPromotora: await comentar( aprobB ),
		robot: await comentar( robot ),
		anonimo: await comentar( anonimo ),
		leeOtra: await aprobB.rpc( 'comentarios_de', { p_promocion: 'prueba-a' } ),
		leeAnonimo: await anonimo.rpc( 'comentarios_de', { p_promocion: 'prueba-a' } ),
		tablaDirecta: await aprobA.from( 'comentarios' ).select( 'id' ),
		resuelvePromotora: await aprobA.rpc( 'resolver_comentarios', { p_promocion: 'prueba-a', p_version: 'v100', p_comentarios: [ comentarioA ] } ),
		resuelveEnviada: await robot.rpc( 'resolver_comentarios', { p_promocion: 'prueba-a', p_version: 'v99', p_comentarios: [ comentarioA ] } ),
		reabrePromotora: await aprobA.rpc( 'reabrir_comentario', { p_comentario: comentarioA } ),
		devuelvePromotora: await aprobA.rpc( 'devolver_a_claude', { p_promocion: 'prueba-a' } ),
		borraOtra: await aprobB.rpc( 'borrar_comentario', { p_comentario: comentarioA } ),
		respondeOtra: await comentar( aprobB, { p_padre: comentarioA } ),
		respondeNotaMune: await comentar( aprobA, { p_padre: notaMune } ),
		personalizacionSinPermiso: await comentar( soloCompradores.sb, { p_tipo: 'personalizacion', p_clave: null, p_punto: null } ),
		pidePersonalizacionOtra: await aprobB.rpc( 'pedir_cambios_personalizacion', { p_promocion: 'prueba-a' } ),
		puntoFuera: await comentar( aprobA, { p_punto: { x: 2, y: 0.5 } } ),
		puntoRaro: await comentar( aprobA, { p_tipo: 'experiencia', p_punto: { p: [ 0, 0 ], cam: [ 0, 0, 0 ], obj: [ 0, 0, 0 ] } } ),
		versionConPunto: await comentar( aprobA, { p_tipo: 'version', p_clave: null } ),
		versionInventada: await comentar( aprobA, { p_version: 'v999' } ),
		vacio: await comentar( aprobA, { p_texto: '   ' } ),
		paseAjeno: await anonimo.rpc( 'comentar_profesional', { p_promocion: 'prueba-a', p_pase: paseB, p_version: 'v99', p_tipo: 'experiencia', p_clave: 'a', p_punto: null, p_texto: 'x' } ),
		paseFalso: await anonimo.rpc( 'comentar_profesional', { p_promocion: 'prueba-a', p_pase: 'f'.repeat( 48 ), p_version: 'v99', p_tipo: 'experiencia', p_clave: 'a', p_punto: null, p_texto: 'x' } ),
		avisoOtra: await aprobB.rpc( 'marcar_aviso_comentarios', { p_promocion: 'prueba-a' } ),
		avisoAnonimo: await anonimo.rpc( 'marcar_aviso_comentarios', { p_promocion: 'prueba-a' } ),
		bandejaPromotora: await aprobA.rpc( 'comentarios_abiertos' ),
	};
	const verPaseAjeno = await anonimo.rpc( 'comentarios_profesional', { p_promocion: 'prueba-a', p_pase: paseB } );
	const veNotas = ( await aprobA.rpc( 'comentarios_de', { p_promocion: 'prueba-a' } ) ).data?.some( ( h ) => h.interno );
	const noFallan = Object.keys( r ).filter( ( k ) => ! ( falla( r[ k ] ) || vacio( r[ k ] ) ) );
	if ( ! ( verPaseAjeno.error || verPaseAjeno.data === null ) ) noFallan.push( 'verPaseAjeno' );
	if ( veNotas !== false ) noFallan.push( 'promotoraVeNotasDeMune' );
	if ( noFallan.length ) throw new Error( `no fallan: ${ noFallan.join( ', ' ) }` );
	return true;

} );

await caso( DEBE_FUNCIONAR, 'Comentarios visuales: pendiente → enviado al pedir cambios (plano y personalización), el aviso sale una vez con lo enviado, MUNE devuelve a Claude sus notas, el robot lee lo enviado y lo resuelve al preparar, y responder reabre', async () => {

	const general = await exigir( comentar( aprobA, { p_tipo: 'version', p_clave: null, p_punto: null, p_texto: 'Falta la piscina' } ), 'general' );
	const pase = await exigir( abrirPase( soloPersonalizacion.sb ), 'pase' );
	const personalizacion = await exigir( anonimo.rpc( 'comentar_profesional', { p_promocion: 'prueba-a', p_pase: pase, p_version: 'v99', p_tipo: 'personalizacion', p_clave: 'a',
		p_punto: { p: [ 1, 1.2, - 2 ], cam: [ 3, 1.6, 0 ], obj: [ 1, 1.2, - 2 ], planta: 0, vista: 'Salón' }, p_texto: 'El roble se ve oscuro' } ), '3D personalización' );
	const antes = await exigir( aprobA.rpc( 'marcar_aviso_comentarios', { p_promocion: 'prueba-a' } ), 'aviso antes de pedir' );
	// pedir cambios del plano «a» envía su comentario y el de toda la versión
	await exigir( aprobA.from( 'validaciones' ).insert( { entregable_id: planoV99.id, decision: 'rechazado', comentario: 'Ver comentarios' } ), 'pedir cambios plano' );
	const enviados = await exigir( soloPersonalizacion.sb.rpc( 'pedir_cambios_personalizacion', { p_promocion: 'prueba-a' } ), 'pedir cambios personalización' );
	const aviso1 = await exigir( aprobA.rpc( 'marcar_aviso_comentarios', { p_promocion: 'prueba-a' } ), 'aviso 1' );
	const aviso2 = await exigir( aprobA.rpc( 'marcar_aviso_comentarios', { p_promocion: 'prueba-a' } ), 'aviso 2' );
	const devueltas = await exigir( admin.rpc( 'devolver_a_claude', { p_promocion: 'prueba-a' } ), 'devolver a Claude' );
	const robotLee = await exigir( robot.rpc( 'comentarios_de', { p_promocion: 'prueba-a' } ), 'robot lee' );
	const resueltos = await exigir( robot.rpc( 'resolver_comentarios', { p_promocion: 'prueba-a', p_version: 'v100', p_comentarios: [ comentarioA, general, notaMune ] } ), 'robot resuelve' );
	await exigir( comentar( aprobA, { p_padre: comentarioA, p_texto: 'Sigue igual' } ), 'responde' );
	const hilos = await exigir( aprobA.rpc( 'comentarios_de', { p_promocion: 'prueba-a' } ), 'lee' );
	const reabierto = hilos.find( ( h ) => h.id === comentarioA );
	const desde3D = await exigir( anonimo.rpc( 'comentarios_profesional', { p_promocion: 'prueba-a', p_pase: pase } ), '3D lee' );
	const bandeja = await exigir( admin.rpc( 'comentarios_abiertos' ), 'bandeja' );
	const mal = Object.entries( {
		nadaAntes: antes.length === 0,
		personalizacionEnviada: enviados === 1,
		aviso: aviso1.length === 3 && aviso1.some( ( c ) => c.tipo === 'personalizacion' && c.con_punto ) && aviso1.some( ( c ) => c.tipo === 'version' ),
		unaVez: aviso2.length === 0,
		devueltas: devueltas === 1,
		robotVeNotas: robotLee.some( ( h ) => h.id === notaMune && h.interno && h.enviado_en ),
		resueltos: resueltos === 3,
		reabierto: reabierto && ! reabierto.resuelto_en && ! reabierto.enviado_en,
		general: hilos.find( ( h ) => h.id === general )?.resuelto_version === 'v100',
		sinNotas: ! hilos.some( ( h ) => h.interno ),
		solo3D: desde3D.length === 1 && desde3D[ 0 ].id === personalizacion,
		bandeja: bandeja.some( ( x ) => x.promocion_id === 'prueba-a' && x.enviados === 1 && x.pendientes === 1 ),
	} ).filter( ( [ , ok ] ) => ! ok ).map( ( [ k ] ) => k );
	if ( mal.length ) throw new Error( `no cumple: ${ mal.join( ', ' ) }` );
	return true;

} );

// ─── Resumen ────────────────────────────────────────────────────────────────

const fallidos = resultados.filter( ( r ) => ! r.ok );
const resumen = [
	'## Prueba de aislamiento entre promotoras',
	'',
	fallidos.length ? `**✘ ${ fallidos.length } comprobación(es) fallida(s).** No se debe aprobar este cambio.` : `**✔ Las ${ resultados.length } comprobaciones son correctas.**`,
	'',
	...[ DEBE_FALLAR, DEBE_FUNCIONAR ].flatMap( ( g ) => [
		`### ${ g }`, '', '| | Comprobación |', '|---|---|',
		...resultados.filter( ( r ) => r.grupo === g ).map( ( r ) => `| ${ r.ok ? '✔' : '✘' } | ${ r.texto }${ r.detalle ? ` — ${ r.detalle }` : '' } |` ),
		'',
	] ),
].join( '\n' );
if ( process.env.GITHUB_STEP_SUMMARY ) appendFileSync( process.env.GITHUB_STEP_SUMMARY, resumen + '\n' );
console.log( `\n${ fallidos.length ? `✘ ${ fallidos.length } fallida(s)` : `✔ ${ resultados.length } de ${ resultados.length } correctas` }` );
process.exit( fallidos.length ? 1 : 0 );
