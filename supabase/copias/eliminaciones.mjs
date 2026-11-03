// Eliminaciones fuera de Supabase (receta 18, decisión 70, 045_cierre_y_eliminacion.sql).
//
// Cada promoción, promotora, acceso o código de comprador eliminado o retirado
// queda apuntado en la tabla «eliminaciones» con solo una huella (sin nombres).
// Esta herramienta:
//
//   node supabase/copias/eliminaciones.mjs guardar
//     Copia esa lista a la release «eliminaciones» del almacén de copias
//     (eliminaciones.json), sumándola a la que ya había: no caduca a los 31 días
//     como las copias, porque es lo que impide reabrir lo eliminado. La lanzan
//     eliminaciones.yml (después de cada eliminación) y copias.yml (cada noche).
//
//   node supabase/copias/eliminaciones.mjs aplicar --bd <dirección> [--lista archivo.json] [--abrir]
//     Paso obligatorio después de recuperar una copia (restaurar.mjs deja el
//     proyecto «pendiente de comprobar»: ni promotoras ni compradores pueden
//     entrar y no se publica). Junta la lista guardada fuera con la de la copia,
//     vuelve a eliminar o retirar lo que aparezca (también sus archivos) y
//     comprueba que no queda nada. Con --abrir, y solo si la comprobación sale
//     bien, abre el proyecto recuperado.
//
// Variables:
//   guardar: SUPABASE_POOLER, COPIAS_BD_CLAVE (usuario «copias», solo lectura), COPIAS_REPO, COPIAS_TOKEN (llave B)
//   aplicar: COPIAS_REPO y COPIAS_TOKEN (o --lista), y SUPABASE_URL y SUPABASE_SERVICE_KEY del
//            proyecto recuperado (para borrar sus archivos). Nunca contra el proyecto real.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCCION, carpetaTemporal, codificar, conexion, consulta, falta, pg } from './comun.mjs';
import { almacenCopias } from './github.mjs';

const RELEASE = 'eliminaciones';
const ADJUNTO = 'eliminaciones.json';
const { positionals: [ orden ], values: op } = parseArgs( { allowPositionals: true, options: {
	bd: { type: 'string' }, lista: { type: 'string' }, abrir: { type: 'boolean' },
} } );
const tmp = carpetaTemporal();
const clave = ( e ) => `${ e.tipo }|${ e.huella }|${ e.momento }`;
const unir = ( ...listas ) => [ ...new Map( listas.flat().map( ( e ) => [ clave( e ), e ] ) ).values() ]
	.sort( ( a, b ) => a.momento.localeCompare( b.momento ) || a.tipo.localeCompare( b.tipo ) );
const desdeBD = ( con ) => JSON.parse( consulta( `select coalesce(json_agg(json_build_object('tipo', tipo, 'huella', huella, 'momento', to_char(momento at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id), '[]') from public.eliminaciones`, con, tmp ) || '[]' );

async function guardada( almacen ) {

	const release = ( await almacen.lista() ).find( ( r ) => r.name === RELEASE );
	if ( ! release ) return { release: null, lista: [] };
	const adjunto = release.assets.find( ( a ) => a.name === ADJUNTO );
	return { release, lista: adjunto ? JSON.parse( String( await almacen.bajar( release, ADJUNTO ) ) ).eliminaciones : [] };

}

if ( orden === 'guardar' ) {

	falta( 'SUPABASE_POOLER', 'COPIAS_BD_CLAVE', 'COPIAS_REPO', 'COPIAS_TOKEN' );
	const url = new URL( process.env.SUPABASE_POOLER.trim().replace( '[YOUR-PASSWORD]', 'x' ) );
	url.username = decodeURIComponent( url.username ).replace( /^postgres(?=\.|$)/, 'copias' );
	url.password = encodeURIComponent( process.env.COPIAS_BD_CLAVE );
	const almacen = almacenCopias( process.env.COPIAS_REPO, process.env.COPIAS_TOKEN );
	const antes = await guardada( almacen );
	const todas = unir( antes.lista, desdeBD( conexion( url.href ) ) );
	const release = antes.release ?? await almacen.crear( RELEASE, 'Lista de eliminaciones (solo huellas, sin nombres). No caduca: impide reabrir lo eliminado al recuperar una copia. Receta 18.' );
	if ( antes.release?.assets.some( ( a ) => a.name === ADJUNTO ) ) await almacen.borrarAdjunto( release, ADJUNTO );
	await almacen.subir( release, ADJUNTO, Buffer.from( JSON.stringify( { guardada: new Date().toISOString(), eliminaciones: todas }, null, '\t' ) ) );
	console.log( `Eliminaciones guardadas fuera de Supabase: ${ todas.length } (${ todas.length - antes.lista.length } nuevas).` );

} else if ( orden === 'aplicar' ) {

	if ( ! op.bd ) {

		console.error( 'Falta --bd <dirección de la base de datos recuperada>' );
		process.exit( 2 );

	}
	if ( [ op.bd, process.env.SUPABASE_URL ?? '' ].some( ( u ) => u.includes( PRODUCCION ) ) ) {

		console.error( 'Esa es la base de datos real de MUNE: aquí no se aplica nada. Solo sobre un proyecto recuperado.' );
		process.exit( 2 );

	}
	const con = conexion( op.bd );
	let fuera;
	if ( op.lista ) fuera = JSON.parse( readFileSync( op.lista, 'utf8' ) ).eliminaciones;
	else {

		falta( 'COPIAS_REPO', 'COPIAS_TOKEN' );
		fuera = ( await guardada( almacenCopias( process.env.COPIAS_REPO, process.env.COPIAS_TOKEN ) ) ).lista;

	}
	const todas = unir( fuera, desdeBD( con ) );
	// lo último que pasó con cada cosa (un acceso retirado y luego devuelto sigue activo)
	const ultimo = new Map();
	for ( const e of todas ) ultimo.set( e.huella, e.tipo );
	const de = ( ...tipos ) => [ ...ultimo ].filter( ( [ , t ] ) => tipos.includes( t ) ).map( ( [ h ] ) => h );
	const huellas = ( lista ) => lista.length ? `array[${ lista.map( ( h ) => `'${ h.replace( /[^0-9a-f]/g, '' ) }'` ).join( ',' ) }]` : 'array[]::text[]';
	const H = ( expr ) => `encode(sha256(convert_to(${ expr }, 'UTF8')), 'hex')`;
	const promos = huellas( de( 'promocion' ) );
	const promotoras = huellas( de( 'promotora' ) );
	const accesosBorrados = huellas( de( 'acceso_borrado' ) );
	const accesosRetirados = huellas( de( 'acceso_retirado' ) );
	const codigos = huellas( de( 'codigo_revocado' ) );
	const quedan = () => JSON.parse( consulta( `select json_build_object(
		'promociones', (select coalesce(json_agg(id), '[]') from public.promociones where ${ H( `'promocion:' || id` ) } = any(${ promos })),
		'promotoras', (select coalesce(json_agg(id), '[]') from public.promotoras where ${ H( `'promotora:' || id` ) } = any(${ promotoras })),
		'accesos', (select count(*) from public.miembros where ${ H( `'acceso:' || id` ) } = any(${ accesosBorrados })
			or (activo and ${ H( `'acceso:' || id` ) } = any(${ accesosRetirados }))),
		'codigos', (select count(*) from public.codigos_comprador where activo and ${ H( `'codigo:' || id` ) } = any(${ codigos })))`, con, tmp ) );

	// 1. Que nadie entre mientras tanto
	consulta( `insert into public.restauracion (id, pendiente, detalle) values (1, true, '{"paso": "aplicando eliminaciones"}')
		on conflict (id) do update set pendiente = true, comprobada_en = null`, con, tmp );
	const antes = quedan();
	console.log( `Lista de eliminaciones: ${ todas.length } apuntes (${ fuera.length } guardados fuera de Supabase).` );
	console.log( `En el proyecto recuperado había que volver a eliminar: ${ antes.promociones.length } promociones, ${ antes.promotoras.length } promotoras, ${ antes.accesos } accesos y ${ antes.codigos } códigos de comprador.` );

	// 2. Sus archivos (con la API de almacenamiento del proyecto recuperado)
	const archivos = JSON.parse( consulta( `select coalesce(json_agg(json_build_object('almacen', bucket_id, 'nombre', name)), '[]') from storage.objects
		where public.promocion_del_archivo(bucket_id, name) = any(select jsonb_array_elements_text('${ JSON.stringify( antes.promociones ) }'::jsonb))
			or (bucket_id = 'documentos' and (storage.foldername(name))[1] = any(select jsonb_array_elements_text('${ JSON.stringify( antes.promotoras ) }'::jsonb)))`, con, tmp ) );
	if ( archivos.length ) {

		falta( 'SUPABASE_URL', 'SUPABASE_SERVICE_KEY' );
		const porAlmacen = new Map();
		for ( const a of archivos ) porAlmacen.set( a.almacen, [ ...( porAlmacen.get( a.almacen ) ?? [] ), a.nombre ] );
		for ( const [ almacen, nombres ] of porAlmacen ) {

			for ( let i = 0; i < nombres.length; i += 100 ) {

				const r = await fetch( `${ process.env.SUPABASE_URL }/storage/v1/object/${ codificar( almacen ) }`, {
					method: 'DELETE', body: JSON.stringify( { prefixes: nombres.slice( i, i + 100 ) } ),
					headers: { apikey: process.env.SUPABASE_SERVICE_KEY, Authorization: `Bearer ${ process.env.SUPABASE_SERVICE_KEY }`, 'Content-Type': 'application/json' },
				} );
				if ( ! r.ok ) throw new Error( `No se han podido borrar archivos de ${ almacen }: ${ r.status }` );

			}

		}
		console.log( `Archivos borrados otra vez: ${ archivos.length }.` );

	}

	// 3. Las filas (como al eliminar desde MUNE Studio)
	writeFileSync( join( tmp, 'aplicar.sql' ), `\\set ON_ERROR_STOP 1
begin;
select public.borrar_filas_de_promocion(id) from public.promociones where ${ H( `'promocion:' || id` ) } = any(${ promos });
delete from public.miembros where promotora_id in (select id from public.promotoras where ${ H( `'promotora:' || id` ) } = any(${ promotoras }));
select public.borrar_filas_de_promocion(id) from public.promociones where promotora_id in (select id from public.promotoras where ${ H( `'promotora:' || id` ) } = any(${ promotoras }));
delete from public.promotoras where ${ H( `'promotora:' || id` ) } = any(${ promotoras });
delete from public.miembros where ${ H( `'acceso:' || id` ) } = any(${ accesosBorrados });
update public.miembros set activo = false where activo and ${ H( `'acceso:' || id` ) } = any(${ accesosRetirados });
update public.codigos_comprador set activo = false where activo and ${ H( `'codigo:' || id` ) } = any(${ codigos });
commit;
` );
	pg( 'psql', [ '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/w/aplicar.sql' ], con, tmp );

	// 4. Comprobación
	const despues = quedan();
	const restos = Number( consulta( `select count(*) from storage.objects where public.promocion_del_archivo(bucket_id, name) = any(select jsonb_array_elements_text('${ JSON.stringify( antes.promociones ) }'::jsonb))`, con, tmp ) );
	const limpio = ! despues.promociones.length && ! despues.promotoras.length && ! despues.accesos && ! despues.codigos && ! restos;
	const detalle = { lista: todas.length, fuera: fuera.length, eliminado: { promociones: antes.promociones.length, promotoras: antes.promotoras.length, accesos: antes.accesos, codigos: antes.codigos, archivos: archivos.length }, limpio };
	if ( ! limpio ) {

		consulta( `update public.restauracion set detalle = '${ JSON.stringify( detalle ) }'::jsonb where id = 1`, con, tmp );
		console.error( `✗ Sigue habiendo algo eliminado en el proyecto recuperado: ${ JSON.stringify( despues ) }, archivos: ${ restos }. No se abre.` );
		process.exit( 1 );

	}
	if ( op.abrir ) {

		consulta( `update public.restauracion set pendiente = false, comprobada_en = now(), detalle = '${ JSON.stringify( detalle ) }'::jsonb where id = 1`, con, tmp );
		console.log( '✓ Comprobado: no queda nada de lo eliminado. El proyecto recuperado ya se puede abrir.' );

	} else {

		consulta( `update public.restauracion set detalle = '${ JSON.stringify( detalle ) }'::jsonb where id = 1`, con, tmp );
		console.log( '✓ Comprobado: no queda nada de lo eliminado. Sigue cerrado: para abrirlo, repite con --abrir.' );

	}

} else {

	console.error( 'Usa: guardar | aplicar --bd <dirección> [--lista archivo.json] [--abrir]' );
	process.exit( 2 );

}
