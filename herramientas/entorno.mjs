#!/usr/bin/env node
// Entorno real de una promoción (lista maestra, punto 13; decisión 64), etapa 1:
// descarga de fuentes públicas y gratuitas lo que rodea a la parcela y lo deja,
// en coordenadas locales (x hacia el este, y hacia el norte, en metros, con el
// origen en el centro de la parcela), en el almacén privado «entornos» de
// Supabase (<promoción>/entorno.json y <promoción>/orto.jpg).
//
//   node herramientas/entorno.mjs generar <promoción> [--referencia <RC>]   (GitHub: proceso «Generar el entorno»)
//   node herramientas/entorno.mjs prueba --referencia <RC> [--salida <carpeta>]   (sin Supabase: descarga y resume)
//
// Capas y fiabilidad (decisión 11): A, la parcela de los planos (la pone la
// promoción completa); B, lo próximo, de aquí: parcela y edificios del Catastro
// (con sus plantas), calles, árboles y zonas verdes de OpenStreetMap, relieve
// del MDT del IGN y la ortofoto PNOA; C, el horizonte lejano (etapa 3).
// Cada fuente lleva su licencia y su atribución, que la visita enseña.
//
// La referencia catastral sale de la ficha de la promoción (MUNE Portal →
// Ficha y datos), o de --referencia. En GitHub Actions entra con la cuenta
// «ejecutor» (EJECUTOR_CLAVE), que solo puede leer la ficha para esto y guardar
// el entorno.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { RAIZ } from './promociones.mjs';
import { leerTiff } from './tiff.mjs';
import { cabecerasEjecutor, cabecerasRobotVersiones, llamar } from './versiones.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'https://iowtdenlkxjqzlpwizgb.supabase.co';
const RADIO = 250; // m alrededor del centro de la parcela (edificios, calles y relieve)
const LADO_ORTO = 2 * RADIO; // m de la ortofoto
const PIXELES_ORTO = 1024;
const AGENTE = 'MUNE (mune-projects.workers.dev) entorno de promociones';

const args = process.argv.slice( 2 );
const opcion = ( n ) => {

	const i = args.indexOf( `--${ n }` );
	return i >= 0 ? args[ i + 1 ] : undefined;

};
const ok = ( t ) => console.log( `✓ ${ t }` );
const aviso = ( t ) => console.log( `! ${ t }` );
function fallo( texto ) {

	console.error( `\n✗ ${ texto }\n` );
	process.exit( 1 );

}

/** GET/POST con reintentos y tiempo límite; devuelve la respuesta (ok). */
async function descargar( url, opciones = {}, intentos = 3 ) {

	let ultimo;
	for ( let i = 0; i < intentos; i ++ ) {

		try {

			const r = await fetch( url, { ...opciones, headers: { 'User-Agent': AGENTE, ...opciones.headers }, signal: AbortSignal.timeout( 90000 ) } );
			if ( r.ok ) return r;
			ultimo = new Error( `${ new URL( url ).host } respondió ${ r.status }: ${ ( await r.text() ).slice( 0, 200 ) }` );

		} catch ( e ) {

			ultimo = e;

		}
		await new Promise( ( res ) => setTimeout( res, 3000 * ( i + 1 ) ) );

	}
	throw ultimo;

}

// ---------------------------------------------------------------- coordenadas
// ETRS89 / UTM 30N (EPSG:25830) ↔ geográficas. El Catastro y el IGN dan UTM; OpenStreetMap, latitud y longitud.

const A = 6378137, F = 1 / 298.257222101, K0 = 0.9996, LON0 = -3 * Math.PI / 180;
const E2 = F * ( 2 - F ), EP2 = E2 / ( 1 - E2 );

export function utmALatLon( x, y ) {

	const m = y / K0;
	const mu = m / ( A * ( 1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256 ) );
	const e1 = ( 1 - Math.sqrt( 1 - E2 ) ) / ( 1 + Math.sqrt( 1 - E2 ) );
	const p = mu + ( 3 * e1 / 2 - 27 * e1 ** 3 / 32 ) * Math.sin( 2 * mu ) + ( 21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32 ) * Math.sin( 4 * mu )
		+ ( 151 * e1 ** 3 / 96 ) * Math.sin( 6 * mu ) + ( 1097 * e1 ** 4 / 512 ) * Math.sin( 8 * mu );
	const c1 = EP2 * Math.cos( p ) ** 2, t1 = Math.tan( p ) ** 2;
	const n1 = A / Math.sqrt( 1 - E2 * Math.sin( p ) ** 2 ), r1 = A * ( 1 - E2 ) / ( 1 - E2 * Math.sin( p ) ** 2 ) ** 1.5;
	const d = ( x - 500000 ) / ( n1 * K0 );
	const lat = p - ( n1 * Math.tan( p ) / r1 ) * ( d ** 2 / 2 - ( 5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * EP2 ) * d ** 4 / 24
		+ ( 61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * EP2 - 3 * c1 ** 2 ) * d ** 6 / 720 );
	const lon = LON0 + ( d - ( 1 + 2 * t1 + c1 ) * d ** 3 / 6 + ( 5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * EP2 + 24 * t1 ** 2 ) * d ** 5 / 120 ) / Math.cos( p );
	return [ lat * 180 / Math.PI, lon * 180 / Math.PI ];

}

export function latLonAUtm( latG, lonG ) {

	const lat = latG * Math.PI / 180, lon = lonG * Math.PI / 180;
	const n = A / Math.sqrt( 1 - E2 * Math.sin( lat ) ** 2 ), t = Math.tan( lat ) ** 2, c = EP2 * Math.cos( lat ) ** 2;
	const a = Math.cos( lat ) * ( lon - LON0 );
	const m = A * ( ( 1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256 ) * lat - ( 3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024 ) * Math.sin( 2 * lat )
		+ ( 15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024 ) * Math.sin( 4 * lat ) - ( 35 * E2 ** 3 / 3072 ) * Math.sin( 6 * lat ) );
	const x = K0 * n * ( a + ( 1 - t + c ) * a ** 3 / 6 + ( 5 - 18 * t + t ** 2 + 72 * c - 58 * EP2 ) * a ** 5 / 120 ) + 500000;
	const y = K0 * ( m + n * Math.tan( lat ) * ( a ** 2 / 2 + ( 5 - t + 9 * c + 4 * c ** 2 ) * a ** 4 / 24 + ( 61 - 58 * t + t ** 2 + 600 * c - 330 * EP2 ) * a ** 6 / 720 ) );
	return [ x, y ];

}

const redondear = ( p ) => p.map( ( v ) => Math.round( v * 100 ) / 100 );

/** Pares de números de un gml:posList (x y x y …). */
const pares = ( texto ) => {

	const n = texto.trim().split( /\s+/ ).map( Number );
	const out = [];
	for ( let i = 0; i + 1 < n.length; i += 2 ) out.push( [ n[ i ], n[ i + 1 ] ] );
	return out;

};

function area( poligono ) {

	let s = 0;
	for ( let i = 0; i < poligono.length; i ++ ) {

		const [ x1, y1 ] = poligono[ i ], [ x2, y2 ] = poligono[ ( i + 1 ) % poligono.length ];
		s += x1 * y2 - x2 * y1;

	}
	return s / 2;

}

function centroide( poligono ) {

	let cx = 0, cy = 0, a = 0;
	for ( let i = 0; i < poligono.length; i ++ ) {

		const [ x1, y1 ] = poligono[ i ], [ x2, y2 ] = poligono[ ( i + 1 ) % poligono.length ];
		const f = x1 * y2 - x2 * y1;
		cx += ( x1 + x2 ) * f;
		cy += ( y1 + y2 ) * f;
		a += f;

	}
	return a ? [ cx / ( 3 * a ), cy / ( 3 * a ) ] : poligono[ 0 ];

}

function dentro( [ x, y ], poligono ) {

	let si = false;
	for ( let i = 0, j = poligono.length - 1; i < poligono.length; j = i ++ ) {

		const [ xi, yi ] = poligono[ i ], [ xj, yj ] = poligono[ j ];
		if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) si = ! si;

	}
	return si;

}

// ---------------------------------------------------------------- fuentes

/** Parcela catastral (INSPIRE, Catastro): su contorno en UTM 30. */
async function parcela( rc ) {

	const url = `https://ovc.catastro.meh.es/INSPIRE/wfsCP.aspx?service=wfs&version=2.0.0&request=GetFeature&STOREDQUERIE_ID=GetParcel&refcat=${ encodeURIComponent( rc.slice( 0, 14 ) ) }&srsname=EPSG::25830`;
	const gml = await ( await descargar( url ) ).text();
	const listas = [ ...gml.matchAll( /<gml:posList[^>]*>([^<]+)<\/gml:posList>/g ) ].map( ( m ) => pares( m[ 1 ] ) );
	if ( ! listas.length ) throw new Error( `el Catastro no tiene la parcela ${ rc.slice( 0, 14 ) } (${ gml.slice( 0, 200 ).replace( /\s+/g, ' ' ) })` );
	// el contorno exterior es el de mayor área
	return listas.sort( ( a, b ) => Math.abs( area( b ) ) - Math.abs( area( a ) ) )[ 0 ];

}

/** Edificios del Catastro (INSPIRE, partes de edificio con sus plantas sobre rasante) en un recuadro UTM. */
async function edificios( [ x0, y0, x1, y1 ] ) {

	const url = `https://ovc.catastro.meh.es/INSPIRE/wfsBU.aspx?service=wfs&version=2.0.0&request=GetFeature&typeNames=BU:BuildingPart&srsname=EPSG::25830&bbox=${ x0 },${ y0 },${ x1 },${ y1 }`;
	const gml = await ( await descargar( url ) ).text();
	const partes = gml.split( /<bu-ext2d:BuildingPart\b/ ).slice( 1 );
	if ( ! partes.length && /Exception|excede/i.test( gml ) ) throw new Error( `el Catastro no ha dado los edificios: ${ gml.slice( 0, 300 ).replace( /\s+/g, ' ' ) }` );
	return partes.map( ( p ) => {

		const lista = p.match( /<gml:posList[^>]*>([^<]+)<\/gml:posList>/ );
		const plantas = Number( p.match( /numberOfFloorsAboveGround>(\d+)</ )?.[ 1 ] ?? 1 );
		return lista ? { contorno: pares( lista[ 1 ] ), plantas } : null;

	} ).filter( ( e ) => e && e.contorno.length >= 3 && e.plantas > 0 );

}

/** Calles, árboles y zonas verdes de OpenStreetMap (Overpass) alrededor de un punto. */
async function openStreetMap( lat, lon, radio ) {

	const consulta = `[out:json][timeout:60];(
		way["highway"](around:${ radio },${ lat },${ lon });
		node["natural"="tree"](around:${ radio },${ lat },${ lon });
		way["natural"="tree_row"](around:${ radio },${ lat },${ lon });
		way["leisure"~"park|garden|pitch|playground"](around:${ radio },${ lat },${ lon });
		way["landuse"~"grass|recreation_ground|forest"](around:${ radio },${ lat },${ lon });
		way["natural"~"water|wood|scrub"](around:${ radio },${ lat },${ lon });
	);out geom;`;
	const r = await descargar( 'https://overpass-api.de/api/interpreter', {
		method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${ encodeURIComponent( consulta ) }`,
	} );
	return ( await r.json() ).elements ?? [];

}

/** Modelo digital del terreno del IGN (5 m) en un recuadro UTM. */
async function terreno( [ x0, y0, x1, y1 ] ) {

	const url = 'https://servicios.idee.es/wcs-inspire/mdt?SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&COVERAGEID=Elevacion25830_5'
		+ `&SUBSET=x(${ x0 },${ x1 })&SUBSET=y(${ y0 },${ y1 })&FORMAT=image/tiff`;
	const r = await descargar( url );
	return leerTiff( Buffer.from( await r.arrayBuffer() ) );

}

/** Ortofoto PNOA (máxima actualidad) del IGN en un recuadro UTM. */
async function ortofoto( [ x0, y0, x1, y1 ] ) {

	const url = 'https://www.ign.es/wms-inspire/pnoa-ma?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=OI.OrthoimageCoverage&STYLES='
		+ `&CRS=EPSG:25830&BBOX=${ x0 },${ y0 },${ x1 },${ y1 }&WIDTH=${ PIXELES_ORTO }&HEIGHT=${ PIXELES_ORTO }&FORMAT=image/jpeg`;
	const r = await descargar( url );
	const tipo = r.headers.get( 'content-type' ) ?? '';
	if ( ! tipo.startsWith( 'image/' ) ) throw new Error( `la ortofoto no es una imagen: ${ ( await r.text() ).slice( 0, 200 ) }` );
	return Buffer.from( await r.arrayBuffer() );

}

// ---------------------------------------------------------------- montar el entorno

const FUENTES = {
	catastro: { fuente: 'Dirección General del Catastro', licencia: 'Uso libre con mención de la fuente', atribucion: 'Catastro: © Dirección General del Catastro' },
	osm: { fuente: 'OpenStreetMap', licencia: 'ODbL 1.0', atribucion: 'Calles y vegetación: © colaboradores de OpenStreetMap (ODbL)' },
	mdt: { fuente: 'Instituto Geográfico Nacional (MDT05)', licencia: 'CC BY 4.0', atribucion: 'Relieve: MDT05 CC BY 4.0 scne.es' },
	pnoa: { fuente: 'Instituto Geográfico Nacional (PNOA)', licencia: 'CC BY 4.0', atribucion: 'Ortofoto: PNOA CC BY 4.0 scne.es' },
};

/** Descarga y monta el entorno de una referencia catastral. Devuelve { entorno, orto }. */
export async function montarEntorno( rc ) {

	const avisos = [];
	const contorno = await parcela( rc );
	const [ cx, cy ] = centroide( contorno ).map( Math.round );
	const [ lat, lon ] = utmALatLon( cx, cy );
	ok( `Parcela ${ rc.slice( 0, 14 ) }: ${ Math.round( Math.abs( area( contorno ) ) ) } m², en ${ lat.toFixed( 5 ) }, ${ lon.toFixed( 5 ) }` );
	const local = ( [ x, y ] ) => redondear( [ x - cx, y - cy ] );
	const recuadro = [ cx - RADIO, cy - RADIO, cx + RADIO, cy + RADIO ];
	const parcelaLocal = contorno.map( local );

	let listaEdificios = [];
	try {

		listaEdificios = ( await edificios( recuadro ) ).map( ( e ) => {

			const p = e.contorno.map( local );
			const centro = centroide( p );
			return { contorno: p, plantas: e.plantas, altura: Math.round( e.plantas * 3.1 * 10 ) / 10, enParcela: dentro( centro, parcelaLocal ) };

		} ).filter( ( e ) => Math.abs( area( e.contorno ) ) >= 4
			// el Catastro puede devolver partes de edificio de fuera del recuadro pedido
			&& e.contorno.some( ( [ x, y ] ) => Math.abs( x ) <= RADIO && Math.abs( y ) <= RADIO ) );
		ok( `Edificios del Catastro: ${ listaEdificios.length } (${ listaEdificios.filter( ( e ) => e.enParcela ).length } dentro de la parcela, que no se dibujan)` );

	} catch ( e ) {

		avisos.push( `No se han podido descargar los edificios del Catastro: ${ e.message }` );

	}

	const calles = [], arboles = [], verdes = [];
	try {

		for ( const el of await openStreetMap( lat, lon, Math.round( RADIO * 1.2 ) ) ) {

			const linea = ( el.geometry ?? [] ).map( ( g ) => local( latLonAUtm( g.lat, g.lon ) ) );
			if ( el.type === 'node' ) arboles.push( local( latLonAUtm( el.lat, el.lon ) ) );
			else if ( el.tags?.highway ) calles.push( { tipo: el.tags.highway, nombre: el.tags.name ?? null, carriles: Number( el.tags.lanes ) || null, linea } );
			else if ( el.tags?.natural === 'tree_row' ) arboles.push( ...linea.filter( ( _, i ) => i % 2 === 0 ) );
			else if ( linea.length >= 3 ) verdes.push( { tipo: el.tags?.leisure ?? el.tags?.landuse ?? el.tags?.natural, contorno: linea } );

		}
		ok( `OpenStreetMap: ${ calles.length } calles y caminos, ${ arboles.length } árboles, ${ verdes.length } zonas verdes o de agua` );

	} catch ( e ) {

		avisos.push( `No se han podido descargar las calles de OpenStreetMap: ${ e.message }` );

	}

	let relieve = null;
	try {

		const t = await terreno( recuadro );
		// alturas en decímetros, de norte a sur y de oeste a este, respecto a la del centro
		const paso = t.paso?.[ 0 ] ?? 5;
		const centro = t.valores[ Math.floor( t.alto / 2 ) * t.ancho + Math.floor( t.ancho / 2 ) ];
		const valida = ( v ) => Number.isFinite( v ) && v > -1000 && v !== t.sinDato;
		relieve = {
			ancho: t.ancho, alto: t.alto, paso,
			esquina: t.origen ? local( t.origen ) : local( [ recuadro[ 0 ], recuadro[ 3 ] ] ),
			cota: Math.round( centro * 10 ) / 10,
			alturas: Array.from( t.valores, ( v ) => ( valida( v ) ? Math.round( ( v - centro ) * 10 ) : 0 ) ),
		};
		const min = Math.min( ...relieve.alturas ) / 10, max = Math.max( ...relieve.alturas ) / 10;
		ok( `Relieve (MDT05): ${ t.ancho } × ${ t.alto } puntos cada ${ paso } m; cota ${ relieve.cota } m; desnivel de ${ min } a +${ max } m` );

	} catch ( e ) {

		avisos.push( `No se ha podido descargar el relieve del IGN: ${ e.message }` );

	}

	let orto = null;
	try {

		orto = await ortofoto( recuadro );
		ok( `Ortofoto PNOA: ${ Math.round( orto.length / 1024 ) } KB (${ PIXELES_ORTO } × ${ PIXELES_ORTO } px, ${ ( LADO_ORTO / PIXELES_ORTO ).toFixed( 2 ) } m por píxel)` );

	} catch ( e ) {

		avisos.push( `No se ha podido descargar la ortofoto del IGN: ${ e.message }` );

	}

	for ( const a of avisos ) aviso( a );
	const entorno = {
		formato: 1,
		generado: new Date().toISOString(),
		referencia: rc,
		crs: 'EPSG:25830',
		origen: [ cx, cy ],
		latlon: [ Math.round( lat * 1e6 ) / 1e6, Math.round( lon * 1e6 ) / 1e6 ],
		radio: RADIO,
		parcela: parcelaLocal,
		edificios: listaEdificios,
		calles, arboles, verdes,
		relieve,
		orto: orto ? { archivo: 'orto.jpg', recuadro: [ - RADIO, - RADIO, RADIO, RADIO ] } : null,
		capas: [
			{ capa: 'B', que: 'Parcela y edificios de alrededor (volúmenes con su número de plantas; la altura es aproximada, 3,1 m por planta)', ...FUENTES.catastro, fiabilidad: 'Contornos precisos; alturas aproximadas' },
			...( calles.length || arboles.length ? [ { capa: 'B', que: 'Calles, árboles y zonas verdes', ...FUENTES.osm, fiabilidad: 'Trazado orientativo (lo mantienen voluntarios)' } ] : [] ),
			...( relieve ? [ { capa: 'B', que: 'Relieve del terreno', ...FUENTES.mdt, fiabilidad: 'Malla de 5 m; precisión de unos 0,5 m en altura' } ] : [] ),
			...( orto ? [ { capa: 'B', que: 'Foto aérea del suelo', ...FUENTES.pnoa, fiabilidad: `${ ( LADO_ORTO / PIXELES_ORTO ).toFixed( 2 ) } m por píxel; puede tener unos años` } ] : [] ),
		],
		atribucion: [ FUENTES.catastro, ...( calles.length ? [ FUENTES.osm ] : [] ), ...( relieve ? [ FUENTES.mdt ] : [] ), ...( orto ? [ FUENTES.pnoa ] : [] ) ].map( ( f ) => f.atribucion ),
		avisos,
	};
	return { entorno, orto };

}

// ---------------------------------------------------------------- órdenes

const directo = import.meta.url === pathToFileURL( process.argv[ 1 ] ?? '' ).href;
const [ orden, id ] = args.filter( ( a, i ) => ! a.startsWith( '--' ) && ! args[ i - 1 ]?.startsWith( '--' ) );

if ( ! directo ) {

	// importado (pruebas): nada que hacer

} else if ( orden === 'prueba' ) {

	const rc = ( opcion( 'referencia' ) ?? '' ).toUpperCase().replace( /\s+/g, '' );
	if ( ! /^[0-9A-Z]{14}([0-9A-Z]{6})?$/.test( rc ) ) fallo( 'Indica una referencia catastral (14 o 20 caracteres) con --referencia' );
	const { entorno, orto } = await montarEntorno( rc ).catch( ( e ) => fallo( e.message ) );
	const salida = resolve( opcion( 'salida' ) ?? join( RAIZ, 'salida', 'entorno', 'prueba' ) );
	mkdirSync( salida, { recursive: true } );
	writeFileSync( join( salida, 'entorno.json' ), JSON.stringify( entorno ) );
	if ( orto ) writeFileSync( join( salida, 'orto.jpg' ), orto );
	ok( `Guardado en ${ salida } (${ Math.round( JSON.stringify( entorno ).length / 1024 ) } KB de datos)` );

} else if ( orden === 'generar' ) {

	if ( ! /^[a-z0-9-]{1,60}$/.test( id ?? '' ) ) fallo( 'Indica la promoción, por ejemplo: residencial-demo' );
	const cabeceras = await cabecerasEjecutor().catch( ( e ) => fallo( e.message ) ) ?? await cabecerasRobotVersiones().catch( ( e ) => fallo( e.message ) );
	if ( ! cabeceras ) fallo( 'Faltan las credenciales: la cuenta «ejecutor» (EJECUTOR_CLAVE).' );
	const ficha = await llamar( cabeceras, 'ficha_para_entorno', { p_promocion: id } ).catch( ( e ) => fallo( `No se ha podido leer la ficha: ${ e.message }` ) );
	const rc = ( opcion( 'referencia' ) || ficha?.referencia_catastral || '' ).toUpperCase().replace( /\s+/g, '' );
	if ( ! /^[0-9A-Z]{14}([0-9A-Z]{6})?$/.test( rc ) ) fallo( 'La promoción no tiene referencia catastral en su ficha (MUNE Portal o MUNE Studio → Ficha y datos).' );
	const { entorno, orto } = await montarEntorno( rc ).catch( ( e ) => fallo( e.message ) );
	const subir = async ( nombre, cuerpo, tipo ) => {

		const r = await fetch( `${ SUPABASE_URL }/storage/v1/object/entornos/${ encodeURIComponent( id ) }/${ nombre }`, {
			method: 'POST', headers: { ...cabeceras, 'Content-Type': tipo, 'x-upsert': 'true' }, body: cuerpo,
		} );
		if ( ! r.ok ) fallo( `No se ha podido guardar ${ nombre }: ${ ( await r.text() ).slice( 0, 200 ) }` );

	};
	if ( orto ) await subir( 'orto.jpg', orto, 'image/jpeg' );
	await subir( 'entorno.json', JSON.stringify( entorno ), 'application/json' );
	await llamar( cabeceras, 'entorno_generado', { p_promocion: id, p_resumen: {
		referencia: rc, edificios: entorno.edificios.filter( ( e ) => ! e.enParcela ).length, calles: entorno.calles.length,
		relieve: !! entorno.relieve, orto: !! orto, avisos: entorno.avisos,
	} } ).catch( ( e ) => aviso( `No se ha podido apuntar en el registro: ${ e.message }` ) );
	ok( `Entorno de ${ id } guardado en Supabase (almacén «entornos»).` );

} else fallo( 'Orden desconocida. Usa: generar <promoción> | prueba --referencia <RC>' );
