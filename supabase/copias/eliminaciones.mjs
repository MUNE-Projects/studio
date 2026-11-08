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
//     eliminaciones.yml, que se lanza sola con cada eliminación (pg_net →
//     función «exportacion»), y copias.yml (cada noche). Sube la lista nueva,
//     la comprueba y solo entonces sustituye la anterior y marca las filas
//     como guardadas: hasta entonces no se puede eliminar una promoción.
//
//   node supabase/copias/eliminaciones.mjs aplicar --bd <dirección> [--lista archivo.json] [--abrir]
//     Paso obligatorio después de recuperar una copia (restaurar.mjs deja el
//     proyecto «pendiente de comprobar»: ni promotoras ni compradores pueden
//     entrar y no se publica). Junta la lista guardada fuera con la de la copia,
//     vuelve a eliminar o retirar lo que aparezca (también sus archivos) y
//     comprueba que no queda nada. Con --abrir, y solo si la comprobación sale
//     bien, abre el proyecto recuperado.
//
// Si la lista de fuera no se puede leer, no existe o es anterior a la copia
// recuperada, el proyecto sigue cerrado (solo se abre con una lista
// actualizada o, tras revisarlo, con --lista-revisada "quién y por qué").
//
// Variables:
//   guardar: EJECUTOR_CLAVE (cuenta «ejecutor»: lee la tabla y marca lo guardado), COPIAS_REPO, COPIAS_TOKEN (llave B)
//   aplicar: COPIAS_REPO y COPIAS_TOKEN (o --lista), y SUPABASE_URL y SUPABASE_SERVICE_KEY del
//            proyecto recuperado (para borrar sus archivos). Nunca contra el proyecto real.

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { PRODUCCION, carpetaTemporal, codificar, conexion, consulta, falta, pg } from './comun.mjs';
import { almacenCopias } from './github.mjs';

const RELEASE = 'eliminaciones';
const ADJUNTO = 'eliminaciones.json';
const NUEVA = 'eliminaciones-nueva.json'; // mientras se sustituye: nunca se queda sin lista
const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const PUBLICA = process.env.SUPABASE_CLAVE_PUBLICA ?? 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
const { positionals: [ orden ], values: op } = parseArgs( { allowPositionals: true, options: {
	bd: { type: 'string' }, lista: { type: 'string' }, abrir: { type: 'boolean' }, 'lista-revisada': { type: 'string' },
} } );
const tmp = carpetaTemporal();
const norm = ( e ) => ( { tipo: e.tipo, huella: e.huella, momento: new Date( e.momento ).toISOString() } );
const clave = ( e ) => `${ e.tipo }|${ e.huella }|${ e.momento }`;
const unir = ( ...listas ) => [ ...new Map( listas.flat().map( norm ).map( ( e ) => [ clave( e ), e ] ) ).values() ]
	.sort( ( a, b ) => a.momento.localeCompare( b.momento ) || a.tipo.localeCompare( b.tipo ) );
const desdeBD = ( con ) => JSON.parse( consulta( `select coalesce(json_agg(json_build_object('tipo', tipo, 'huella', huella, 'momento', to_char(momento at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by id), '[]') from public.eliminaciones`, con, tmp ) || '[]' );

/** La lista guardada fuera de Supabase. Si no se puede leer, error (nunca «vacía» por un fallo). */
async function guardada( almacen ) {

	const release = ( await almacen.lista() ).find( ( r ) => r.name === RELEASE );
	if ( ! release ) return { release: null, lista: null, guardada: null };
	const nombre = [ ADJUNTO, NUEVA ].find( ( n ) => release.assets.some( ( a ) => a.name === n ) );
	if ( ! nombre ) return { release, lista: null, guardada: null };
	const datos = JSON.parse( String( await almacen.bajar( release, nombre ) ) );
	if ( ! Array.isArray( datos.eliminaciones ) ) throw new Error( `${ nombre } no tiene la lista de eliminaciones` );
	return { release, lista: datos.eliminaciones, guardada: datos.guardada };

}

async function rest( ruta, cabeceras, opciones = {} ) {

	const r = await fetch( `${ SUPABASE_URL }${ ruta }`, { ...opciones, headers: { ...cabeceras, 'Content-Type': 'application/json', ...opciones.headers } } );
	if ( ! r.ok ) throw new Error( `Supabase ${ ruta.split( '?' )[ 0 ] }: ${ r.status } ${ ( await r.text() ).slice( 0, 200 ) }` );
	return r.json();

}

if ( orden === 'guardar' ) {

	falta( 'EJECUTOR_CLAVE', 'COPIAS_REPO', 'COPIAS_TOKEN' );
	const { access_token: token } = await rest( '/auth/v1/token?grant_type=password', { apikey: PUBLICA }, {
		method: 'POST', body: JSON.stringify( { email: process.env.EJECUTOR_EMAIL || 'hello.muneprojects+ejecutor@gmail.com', password: process.env.EJECUTOR_CLAVE } ),
	} );
	const cab = { apikey: PUBLICA, Authorization: `Bearer ${ token }` };
	const almacen = almacenCopias( process.env.COPIAS_REPO, process.env.COPIAS_TOKEN );
	for ( let vuelta = 1; vuelta <= 3; vuelta ++ ) {

		// 1. Lo que hay en Supabase (cuenta «ejecutor»: solo lee esta tabla y marca lo guardado)
		const filas = [];
		for ( let desde = 0; ; desde += 1000 ) {

			const lote = await rest( `/rest/v1/eliminaciones?select=id,tipo,huella,momento,guardada_en&order=id&offset=${ desde }&limit=1000`, cab );
			filas.push( ...lote );
			if ( lote.length < 1000 ) break;

		}
		const pendientes = filas.filter( ( f ) => ! f.guardada_en ).length;
		if ( vuelta > 1 && ! pendientes ) break;

		// 2. Sumarlo a lo que ya está fuera (nunca se quita nada) y subirlo sin quedarse en ningún momento sin lista
		const antes = await guardada( almacen );
		const todas = unir( antes.lista ?? [], filas );
		let release = antes.release ?? await almacen.crear( RELEASE, 'Lista de eliminaciones (solo huellas, sin nombres). No caduca: impide reabrir lo eliminado al recuperar una copia. Receta 18.' );
		const contenido = Buffer.from( JSON.stringify( { guardada: new Date().toISOString(), eliminaciones: todas }, null, '\t' ) );
		const refrescar = async () => ( release = await almacen.obtener( release.id ) );
		await refrescar();
		await almacen.borrarAdjunto( release, NUEVA );
		await almacen.subir( release, NUEVA, contenido );
		await refrescar();
		const comprobar = async ( nombre ) => {

			const vuelto = JSON.parse( String( await almacen.bajar( release, nombre ) ) ).eliminaciones.map( norm );
			const hay = new Set( vuelto.map( clave ) );
			if ( vuelto.length !== todas.length || ! todas.every( ( e ) => hay.has( clave( e ) ) ) ) throw new Error( `${ nombre } no ha quedado completo` );

		};
		await comprobar( NUEVA );
		await almacen.borrarAdjunto( release, ADJUNTO );
		await almacen.renombrarAdjunto( release, NUEVA, ADJUNTO );
		await refrescar();
		await comprobar( ADJUNTO );

		// 3. Marcar como guardadas las filas que ya están fuera
		const hasta = filas.length ? Math.max( ...filas.map( ( f ) => f.id ) ) : 0;
		const marcadas = hasta ? await rest( '/rest/v1/rpc/marcar_eliminaciones_guardadas', cab, { method: 'POST', body: JSON.stringify( { p_hasta: hasta } ) } ) : 0;
		console.log( `Eliminaciones guardadas fuera de Supabase y comprobadas: ${ todas.length } (${ todas.length - ( antes.lista?.length ?? 0 ) } nuevas; ${ marcadas } marcadas como guardadas).` );
		if ( ! pendientes ) break;

	}

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
	const cerrado = ( motivo ) => {

		consulta( `update public.restauracion set pendiente = true, comprobada_en = null, detalle = detalle || '${ JSON.stringify( { problema: motivo } ).replace( /'/g, "''" ) }'::jsonb where id = 1`, con, tmp );
		console.error( `✗ ${ motivo }\n  El proyecto recuperado sigue CERRADO (ni promotoras ni compradores entran, y no se publica). Receta 18.` );
		process.exit( 1 );

	};

	// 1. Que nadie entre mientras tanto (aunque falle lo que sigue)
	consulta( `insert into public.restauracion (id, pendiente, detalle) values (1, true, '{"paso": "aplicando eliminaciones"}')
		on conflict (id) do update set pendiente = true, comprobada_en = null`, con, tmp );
	const copia = consulta( `select coalesce(detalle->>'copia_creada', '') from public.restauracion where id = 1`, con, tmp );

	// 2. La lista guardada fuera de Supabase, obligatoria y posterior a la copia recuperada
	let fuera;
	try {

		if ( op.lista ) fuera = JSON.parse( readFileSync( op.lista, 'utf8' ) );
		else {

			falta( 'COPIAS_REPO', 'COPIAS_TOKEN' );
			fuera = await guardada( almacenCopias( process.env.COPIAS_REPO, process.env.COPIAS_TOKEN ) );

		}

	} catch ( e ) {

		cerrado( `No se ha podido leer la lista de eliminaciones guardada fuera de Supabase (${ e.message.slice( 0, 160 ) }).` );

	}
	if ( ! Array.isArray( fuera?.eliminaciones ?? fuera?.lista ) ) cerrado( 'No hay lista de eliminaciones guardada fuera de Supabase.' );
	fuera = { guardada: fuera.guardada, lista: fuera.eliminaciones ?? fuera.lista };
	if ( copia && ! ( fuera.guardada && new Date( fuera.guardada ) >= new Date( copia ) ) ) {

		if ( ! op[ 'lista-revisada' ] || op[ 'lista-revisada' ].trim().length < 10 ) {

			cerrado( `La lista de eliminaciones (guardada ${ fuera.guardada ?? 'sin fecha' }) es anterior a la copia recuperada (${ copia }): puede faltar algo eliminado después. Consigue una lista actualizada o, tras revisarlo, repite con --lista-revisada "quién y por qué".` );

		}
		consulta( `update public.restauracion set detalle = detalle || '${ JSON.stringify( { lista_revisada: op[ 'lista-revisada' ].trim().slice( 0, 300 ) } ).replace( /'/g, "''" ) }'::jsonb where id = 1`, con, tmp );

	}
	fuera = fuera.lista;
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
	const portfolio = huellas( de( 'portfolio_retirado' ) );
	const quedan = () => JSON.parse( consulta( `select json_build_object(
		'promociones', (select coalesce(json_agg(id), '[]') from public.promociones where ${ H( `'promocion:' || id` ) } = any(${ promos })),
		'promotoras', (select coalesce(json_agg(id), '[]') from public.promotoras where ${ H( `'promotora:' || id` ) } = any(${ promotoras })),
		'accesos', (select count(*) from public.miembros where ${ H( `'acceso:' || id` ) } = any(${ accesosBorrados })
			or (activo and ${ H( `'acceso:' || id` ) } = any(${ accesosRetirados }))),
		'codigos', (select count(*) from public.codigos_comprador where activo and ${ H( `'codigo:' || id` ) } = any(${ codigos })),
		'portfolio', (select coalesce(json_agg(id), '[]') from public.portfolio_autorizaciones where ${ H( `'portfolio:' || id` ) } = any(${ portfolio })
			and (retirada_en is null or exists (select 1 from public.portfolio_piezas p where p.autorizacion_id = portfolio_autorizaciones.id))))`, con, tmp ) );

	const antes = quedan();
	console.log( `Lista de eliminaciones: ${ todas.length } apuntes (${ fuera.length } guardados fuera de Supabase).` );
	console.log( `En el proyecto recuperado había que volver a eliminar: ${ antes.promociones.length } promociones, ${ antes.promotoras.length } promotoras, ${ antes.accesos } accesos, ${ antes.codigos } códigos de comprador y ${ antes.portfolio.length } autorizaciones de portfolio retiradas.` );

	// 2. Sus archivos (con la API de almacenamiento del proyecto recuperado)
	const archivos = JSON.parse( consulta( `select coalesce(json_agg(json_build_object('almacen', bucket_id, 'nombre', name)), '[]') from storage.objects
		where public.promocion_del_archivo(bucket_id, name) = any(select jsonb_array_elements_text('${ JSON.stringify( antes.promociones ) }'::jsonb))
			or (bucket_id = 'documentos' and (storage.foldername(name))[1] = any(select jsonb_array_elements_text('${ JSON.stringify( antes.promotoras ) }'::jsonb)))
			or (bucket_id = 'portfolio' and (storage.foldername(name))[1] = any(select jsonb_array_elements_text('${ JSON.stringify( antes.portfolio ) }'::jsonb)))`, con, tmp ) );
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
delete from public.portfolio_piezas where autorizacion_id in (select id from public.portfolio_autorizaciones where ${ H( `'portfolio:' || id` ) } = any(${ portfolio }));
update public.portfolio_autorizaciones set retirada_en = coalesce(retirada_en, now()) where ${ H( `'portfolio:' || id` ) } = any(${ portfolio });
-- las exportaciones no van en las copias: las que la copia trae sin sus archivos ya no sirven
update public.exportaciones e set estado = 'caducada', token_huella = null, terminada_en = now()
where e.estado in ('preparando', 'lista', 'enviada')
	and not exists (select 1 from storage.objects o where o.bucket_id = 'exportaciones' and (storage.foldername(o.name))[1] = e.id::text);
commit;
` );
	pg( 'psql', [ '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '/w/aplicar.sql' ], con, tmp );

	// 4. Comprobación
	const despues = quedan();
	const restos = Number( consulta( `select count(*) from storage.objects where public.promocion_del_archivo(bucket_id, name) = any(select jsonb_array_elements_text('${ JSON.stringify( antes.promociones ) }'::jsonb))`, con, tmp ) );
	const limpio = ! despues.promociones.length && ! despues.promotoras.length && ! despues.accesos && ! despues.codigos && ! despues.portfolio.length && ! restos;
	const detalle = { lista: todas.length, fuera: fuera.length, eliminado: { promociones: antes.promociones.length, promotoras: antes.promotoras.length, accesos: antes.accesos, codigos: antes.codigos, portfolio: antes.portfolio.length, archivos: archivos.length }, limpio };
	if ( ! limpio ) {

		consulta( `update public.restauracion set detalle = detalle || '${ JSON.stringify( detalle ) }'::jsonb where id = 1`, con, tmp );
		console.error( `✗ Sigue habiendo algo eliminado en el proyecto recuperado: ${ JSON.stringify( despues ) }, archivos: ${ restos }. No se abre.` );
		process.exit( 1 );

	}
	if ( op.abrir ) {

		consulta( `update public.restauracion set pendiente = false, comprobada_en = now(), detalle = detalle || '${ JSON.stringify( detalle ) }'::jsonb where id = 1`, con, tmp );
		console.log( '✓ Comprobado: no queda nada de lo eliminado. El proyecto recuperado ya se puede abrir.' );

	} else {

		consulta( `update public.restauracion set detalle = detalle || '${ JSON.stringify( detalle ) }'::jsonb where id = 1`, con, tmp );
		console.log( '✓ Comprobado: no queda nada de lo eliminado. Sigue cerrado: para abrirlo, repite con --abrir.' );

	}

} else {

	console.error( 'Usa: guardar | aplicar --bd <dirección> [--lista archivo.json] [--abrir]' );
	process.exit( 2 );

}
