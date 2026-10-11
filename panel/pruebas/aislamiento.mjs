// Prueba automática de aislamiento entre promotoras.
//
// Levanta una base de datos de Supabase local y vacía (con `supabase start`,
// nunca la real), le aplica los archivos de panel/supabase en orden, como
// se hace en el SQL Editor, crea dos promotoras inventadas (A y B) y
// comprueba, con la misma clave pública que usan las páginas, que:
//  · todos los intentos de saltarse las reglas FALLAN;
//  · el uso normal SIGUE FUNCIONANDO.
//
// Uso (desde panel/, con el Supabase local en marcha en panel/pruebas):
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

const SQL = join( dirname( fileURLToPath( import.meta.url ) ), '..', 'supabase' );
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

async function entrar( email ) {

	const sb = nuevo();
	const { error } = await sb.auth.signInWithPassword( { email, password: CLAVE } );
	if ( error ) throw new Error( `entrar ${ email }: ${ error.message }` );
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
	return falla( intruso ) && falla( repetida ) && n === 10 && lista.some( ( r ) => r.plantilla === '/plantillas/tabla-viviendas.xlsx' )
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
	// lo formalizado por el primer comprador (lo registra la administradora)
	await exigir( admin.from( 'selecciones_comprador' ).insert( { promocion_id: 'prueba-a', vivienda_ref: 'Bajo A', comprador: 1, pack: 'cocinas', opciones: { cocina: 'nogal' }, fecha: '2026-10-01' } ), 'selección' );
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
