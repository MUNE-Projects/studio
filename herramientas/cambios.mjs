#!/usr/bin/env node
// Qué cambia de una versión a otra (comparar versiones).
//
//   node herramientas/cambios.mjs <promoción> --antes <commit> [--salida <carpeta>]
//
// Compara los datos de la promoción (trabajo/<id>/, lo guardado ahora) con los de
// la versión anterior (su copia en Supabase, decisión 59; o, en las de antes, el
// commit del taller con el que se preparó, en su registro) y deja
// en <salida>/cambios/cambios.json una lista de cambios escrita en sencillo:
// tipologías, estancias y superficies, huecos (puertas, ventanas, balconeras),
// tabiques, equipamiento, alturas, superficies oficiales y acabados. Solo lo
// que ya va en la web pública: el catálogo, los precios y las viviendas son
// datos privados y se comparan en Supabase (comparar_version, 034).
// «publicacion.mjs preparar» lo llama solo con la versión publicada y además
// pone, de cada plano que cambia, el de antes y otro con las diferencias en rojo.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRABAJO } from './promociones.mjs';

const RAIZ = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );

const fmt = ( n, d = 2 ) => Number( n ).toLocaleString( 'es-ES', { minimumFractionDigits: d, maximumFractionDigits: d } );
const m2 = ( n ) => `${ fmt( n ) } m²`;
const cm = ( m ) => `${ Math.round( Math.abs( m ) * 100 ) } cm`;
const TIPO_HUECO = { entrada: 'la puerta de entrada', puerta: 'una puerta', paso: 'un paso', balconera: 'una balconera', ventana: 'una ventana', garaje: 'la puerta del garaje' };
const TIPO_HUECO_CORTO = { entrada: 'Puerta de entrada', puerta: 'Puerta', paso: 'Paso', balconera: 'Balconera', ventana: 'Ventana', garaje: 'Puerta del garaje' };
const EQUIPO = {
	banera: 'bañera', 'banera-exenta': 'bañera exenta', 'columna-frigorifico': 'frigorífico', 'columna-hornos': 'columna de hornos', 'lavabo-doble': 'lavabo doble',
	'mesa-auxiliar': 'mesa auxiliar', 'mesa-centro': 'mesa de centro', 'mesa-comedor': 'mesa de comedor', 'mueble-tv': 'mueble de televisión', bide: 'bidé',
	placa: 'placa de cocina', fregadero: 'fregadero', lavavajillas: 'lavavajillas', secadora: 'secadora', isla: 'isla de cocina', peninsula: 'península',
};
const ACABADO = {
	carpinteria_exterior: 'Carpintería exterior', puertas_interiores: 'Puertas interiores', armarios: 'Armarios', paredes: 'Paredes', techos: 'Techos',
	suelo_general: 'Suelo general', suelo_cocina_banos: 'Suelo de cocina y baños', suelo_espacio_homes: 'Suelo del espacio homes', suelo_terraza: 'Suelo de la terraza',
	alicatado_banos: 'Alicatado de los baños', cocina: 'Cocina', fachada: 'Fachada', rodapie: 'Rodapié', griferia: 'Grifería',
};
const nombreEquipo = ( t ) => EQUIPO[ t ] ?? String( t ).replace( /-/g, ' ' );
const nombreAcabado = ( k ) => ACABADO[ k ] ?? ( k.charAt( 0 ).toUpperCase() + k.slice( 1 ).replace( /_/g, ' ' ) );
const valor = ( v ) => ( v && typeof v === 'object' && 'valor' in v ? v.valor : v );
const texto = ( v ) => {

	const x = valor( v );
	if ( x === null || x === undefined ) return '—';
	if ( typeof x === 'object' ) return Object.entries( x ).filter( ( [ k ] ) => k !== 'origen' ).map( ( [ k, w ] ) => `${ k } ${ texto( w ) }` ).join( ', ' );
	return String( x );

};
const igual = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );
const porId = ( lista ) => new Map( ( lista ?? [] ).map( ( x ) => [ x.id, x ] ) );

// ---------------------------------------------------------------- geometría

function dentro( [ x, y ], poligono ) {

	let si = false;
	for ( let i = 0, j = poligono.length - 1; i < poligono.length; j = i ++ ) {

		const [ xi, yi ] = poligono[ i ], [ xj, yj ] = poligono[ j ];
		if ( ( yi > y ) !== ( yj > y ) && x < ( xj - xi ) * ( y - yi ) / ( yj - yi ) + xi ) si = ! si;

	}
	return si;

}

/** Estancias a un lado y a otro de un hueco (o «el exterior»). */
function ladosDeHueco( h, viv ) {

	const muro = ( viv.muros ?? [] ).find( ( m ) => m.id === h.muro );
	if ( ! muro?.rect ) return [];
	const [ x0, y0, x1, y1 ] = muro.rect;
	const medio = ( h.desde + h.hasta ) / 2;
	const p = h.eje === 'x' ? [ medio, ( y0 + y1 ) / 2 ] : [ ( x0 + x1 ) / 2, medio ];
	const grueso = h.eje === 'x' ? Math.abs( y1 - y0 ) : Math.abs( x1 - x0 );
	const d = grueso / 2 + 0.15;
	const puntos = h.eje === 'x' ? [ [ p[ 0 ], p[ 1 ] - d ], [ p[ 0 ], p[ 1 ] + d ] ] : [ [ p[ 0 ] - d, p[ 1 ] ], [ p[ 0 ] + d, p[ 1 ] ] ];
	return puntos.map( ( q ) => ( viv.estancias ?? [] ).find( ( e ) => e.poligono && dentro( q, e.poligono ) )?.nombre ?? 'el exterior' );

}

const dondeHueco = ( h, viv ) => {

	const lados = [ ...new Set( ladosDeHueco( h, viv ) ) ];
	return lados.length === 2 ? ` entre ${ lados[ 0 ] } y ${ lados[ 1 ] }` : lados.length === 1 ? ` en ${ lados[ 0 ] }` : '';

};

const dondeEquipo = ( q, viv ) => {

	if ( ! q.rect ) return '';
	const c = [ ( q.rect[ 0 ] + q.rect[ 2 ] ) / 2, ( q.rect[ 1 ] + q.rect[ 3 ] ) / 2 ];
	const e = ( viv.estancias ?? [] ).find( ( x ) => x.poligono && dentro( c, x.poligono ) );
	return e ? ` (${ e.nombre })` : '';

};

// ---------------------------------------------------------------- comparar

/** Cambios de una vivienda (vivienda.json) de una tipología. */
function compararVivienda( a, b ) {

	const c = [];
	// estancias
	const ea = porId( a.estancias ), eb = porId( b.estancias );
	for ( const [ id, e ] of eb ) {

		const v = ea.get( id );
		if ( ! v ) { c.push( `Nueva estancia: ${ e.nombre }${ e.superficie ? ` (${ m2( e.superficie ) })` : '' }.` ); continue; }
		if ( v.nombre !== e.nombre ) c.push( `${ v.nombre } pasa a llamarse ${ e.nombre }.` );
		if ( Math.abs( ( v.superficie ?? 0 ) - ( e.superficie ?? 0 ) ) >= 0.01 ) c.push( `${ e.nombre }: ${ m2( v.superficie ?? 0 ) } → ${ m2( e.superficie ?? 0 ) }.` );
		else if ( ! igual( v.poligono, e.poligono ) ) c.push( `${ e.nombre }: cambia de forma (misma superficie).` );
		if ( v.suelo !== e.suelo && v.suelo && e.suelo ) c.push( `${ e.nombre }: suelo ${ v.suelo } → ${ e.suelo }.` );

	}
	for ( const [ id, e ] of ea ) if ( ! eb.has( id ) ) c.push( `Se quita la estancia ${ e.nombre }${ e.superficie ? ` (${ m2( e.superficie ) })` : '' }.` );

	// huecos
	const ha = porId( a.huecos ), hb = porId( b.huecos );
	for ( const [ id, h ] of hb ) {

		const v = ha.get( id );
		const ancho = h.hasta - h.desde;
		if ( ! v ) { c.push( `Nueva ${ ( TIPO_HUECO[ h.tipo ] ?? 'abertura' ).replace( /^(una|un|la) /, '' ) }${ dondeHueco( h, b ) } (${ fmt( ancho ) } m).` ); continue; }
		const nombre = `${ TIPO_HUECO_CORTO[ h.tipo ] ?? 'Hueco' }${ dondeHueco( h, b ) }`;
		const anchoAntes = v.hasta - v.desde;
		if ( v.tipo !== h.tipo ) c.push( `${ TIPO_HUECO_CORTO[ v.tipo ] ?? 'Hueco' }${ dondeHueco( v, a ) } pasa a ser ${ TIPO_HUECO[ h.tipo ] ?? 'otra abertura' }.` );
		else if ( Math.abs( anchoAntes - ancho ) >= 0.02 ) c.push( `${ nombre }: ${ fmt( anchoAntes ) } m → ${ fmt( ancho ) } m de ancho.` );
		else if ( v.muro !== h.muro || Math.abs( v.desde - h.desde ) >= 0.02 ) c.push( `${ nombre }: se mueve ${ v.muro === h.muro ? cm( h.desde - v.desde ) : 'de pared' }.` );
		else if ( v.abre !== h.abre || v.bisagra !== h.bisagra || v.apertura !== h.apertura || v.hojas !== h.hojas ) c.push( `${ nombre }: cambia cómo abre.` );

	}
	for ( const [ id, h ] of ha ) if ( ! hb.has( id ) ) c.push( `Se quita ${ TIPO_HUECO[ h.tipo ] ?? 'una abertura' }${ dondeHueco( h, a ) } (${ fmt( h.hasta - h.desde ) } m).` );

	// tabiques y muros
	const ma = porId( a.muros ), mb = porId( b.muros );
	const nuevos = [ ...mb.keys() ].filter( ( k ) => ! ma.has( k ) ).length;
	const quitados = [ ...ma.keys() ].filter( ( k ) => ! mb.has( k ) ).length;
	const movidos = [ ...mb.keys() ].filter( ( k ) => ma.has( k ) && ! igual( ma.get( k ).rect, mb.get( k ).rect ) ).length;
	const partes = [ nuevos && `${ nuevos } nuevo${ nuevos === 1 ? '' : 's' }`, quitados && `${ quitados } quitado${ quitados === 1 ? '' : 's' }`, movidos && `${ movidos } movido${ movidos === 1 ? '' : 's' }` ].filter( Boolean );
	if ( partes.length ) c.push( `Muros y tabiques: ${ partes.join( ', ' ) }.` );

	// equipamiento
	const qa = porId( a.equipamiento ), qb = porId( b.equipamiento );
	for ( const [ id, q ] of qb ) {

		const v = qa.get( id );
		if ( ! v ) c.push( `Nuevo: ${ nombreEquipo( q.tipo ) }${ dondeEquipo( q, b ) }.` );
		else if ( v.tipo !== q.tipo ) c.push( `${ nombreEquipo( v.tipo ) }${ dondeEquipo( q, b ) } pasa a ser ${ nombreEquipo( q.tipo ) }.` );
		else if ( ! igual( v.rect, q.rect ) ) c.push( `Se mueve: ${ nombreEquipo( q.tipo ) }${ dondeEquipo( q, b ) }.` );

	}
	for ( const [ id, q ] of qa ) if ( ! qb.has( id ) ) c.push( `Se quita: ${ nombreEquipo( q.tipo ) }${ dondeEquipo( q, a ) }.` );

	// alturas, superficies oficiales, exterior y acabados
	const altA = valor( a.alturas?.libre ), altB = valor( b.alturas?.libre );
	if ( altA !== altB && altA != null && altB != null ) c.push( `Altura libre: ${ fmt( altA ) } m → ${ fmt( altB ) } m.` );
	const so = ( x ) => x?.meta?.superficies_oficiales ?? {};
	for ( const [ k, t ] of [ [ 'interior', 'Superficie útil interior' ], [ 'exterior', 'Superficie exterior' ], [ 'construida', 'Superficie construida' ] ] ) {

		const va = so( a )[ k ], vb = so( b )[ k ];
		if ( va != null && vb != null && Math.abs( va - vb ) >= 0.01 ) c.push( `${ t } oficial: ${ m2( va ) } → ${ m2( vb ) }.` );

	}
	const barA = texto( a.exterior?.barandilla?.tipo ), barB = texto( b.exterior?.barandilla?.tipo );
	if ( barA !== barB ) c.push( `Barandilla: ${ barA } → ${ barB }.` );
	c.push( ...compararAcabados( a.acabados, b.acabados ) );
	return c;

}

function compararAcabados( a = {}, b = {} ) {

	const c = [];
	for ( const k of new Set( [ ...Object.keys( a ?? {} ), ...Object.keys( b ?? {} ) ] ) ) {

		const ta = texto( a?.[ k ] ), tb = texto( b?.[ k ] );
		if ( ta !== tb ) c.push( `${ nombreAcabado( k ) }: ${ ta } → ${ tb }.` );

	}
	return c;

}

/**
 * Compara dos estados de la promoción: { promocion, tipologias: { id: { tipologia, vivienda } } }.
 * Devuelve grupos { titulo, cambios: [texto] } (vacío si no cambia nada visible).
 */
export function compararDatos( antes, ahora ) {

	const grupos = [];
	const general = [];
	const pa = antes.promocion ?? {}, pb = ahora.promocion ?? {};
	if ( pa.promocion?.nombre !== pb.promocion?.nombre ) general.push( `Nombre de la promoción: ${ pa.promocion?.nombre ?? '—' } → ${ pb.promocion?.nombre ?? '—' }.` );
	general.push( ...compararAcabados( pa.acabados, pb.acabados ) );
	const ta = antes.tipologias ?? {}, tb = ahora.tipologias ?? {};
	for ( const id of Object.keys( tb ) ) if ( ! ta[ id ] ) general.push( `Nueva tipología: ${ tb[ id ].tipologia?.nombre ?? id.toUpperCase() }.` );
	for ( const id of Object.keys( ta ) ) if ( ! tb[ id ] ) general.push( `Se quita la tipología ${ ta[ id ].tipologia?.nombre ?? id.toUpperCase() }.` );
	if ( general.length ) grupos.push( { titulo: 'Promoción', cambios: general } );
	for ( const id of Object.keys( tb ) ) {

		if ( ! ta[ id ] ) continue;
		const cambios = [];
		const [ a, b ] = [ ta[ id ], tb[ id ] ];
		if ( a.tipologia?.nombre !== b.tipologia?.nombre ) cambios.push( `Pasa a llamarse ${ b.tipologia?.nombre }.` );
		if ( a.tipologia?.resumen !== b.tipologia?.resumen && b.tipologia?.resumen ) cambios.push( `Resumen: ${ b.tipologia.resumen }.` );
		cambios.push( ...compararVivienda( a.vivienda ?? {}, b.vivienda ?? {} ) );
		if ( cambios.length ) grupos.push( { titulo: b.tipologia?.nombre ?? `Tipología ${ id.toUpperCase() }`, tipologia: id, cambios } );

	}
	return grupos;

}

// ---------------------------------------------------------------- leer de disco o de git

/** Estado de la promoción en su carpeta de trabajo (trabajo/<id>/, bajada de Supabase). */
export function leerAhora( id ) {

	const base = join( TRABAJO, id );
	const leer = ( f ) => JSON.parse( readFileSync( join( base, f ), 'utf8' ) );
	const tipologias = {};
	if ( existsSync( join( base, 'tipologias' ) ) ) {

		for ( const t of readdirSync( join( base, 'tipologias' ) ) ) {

			if ( ! existsSync( join( base, 'tipologias', t, 'vivienda.json' ) ) ) continue;
			tipologias[ t ] = { tipologia: leer( `tipologias/${ t }/tipologia.json` ), vivienda: leer( `tipologias/${ t }/vivienda.json` ) };

		}

	}
	return { promocion: leer( 'promocion.json' ), tipologias };

}

/** Estado de la promoción en un commit del taller (el de una versión anterior). */
export function leerEnCommit( id, commit ) {

	const git = ( ...a ) => execFileSync( 'git', a, { cwd: RAIZ, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 } );
	const leer = ( f ) => JSON.parse( git( 'show', `${ commit }:promociones/${ id }/${ f }` ) );
	const tipologias = {};
	const lista = git( 'ls-tree', '--name-only', `${ commit }:promociones/${ id }/tipologias` ).split( '\n' ).filter( Boolean );
	for ( const t of lista ) {

		try {

			tipologias[ t ] = { tipologia: leer( `tipologias/${ t }/tipologia.json` ), vivienda: leer( `tipologias/${ t }/vivienda.json` ) };

		} catch { /* carpeta sin vivienda */ }

	}
	return { promocion: leer( 'promocion.json' ), tipologias };

}

/** Estado de la promoción a partir de sus archivos guardados en Supabase ({ ruta: texto }, decisión 59). */
export function leerDeArchivos( archivos ) {

	const leer = ( f ) => JSON.parse( archivos[ f ] );
	const tipologias = {};
	for ( const ruta of Object.keys( archivos ) ) {

		const m = /^tipologias\/([^/]+)\/vivienda\.json$/.exec( ruta );
		if ( m && archivos[ `tipologias/${ m[ 1 ] }/tipologia.json` ] ) tipologias[ m[ 1 ] ] = { tipologia: leer( `tipologias/${ m[ 1 ] }/tipologia.json` ), vivienda: leer( ruta ) };

	}
	return { promocion: leer( 'promocion.json' ), tipologias };

}

/** Escribe <salida>/cambios/cambios.json y devuelve su contenido. */
export function escribirCambios( salida, { promocion, version, anterior, grupos, planos = [] } ) {

	const carpeta = join( salida, 'cambios' );
	mkdirSync( carpeta, { recursive: true } );
	const contenido = { promocion, version, anterior, generados: new Date().toISOString(), grupos, planos };
	writeFileSync( join( carpeta, 'cambios.json' ), `${ JSON.stringify( contenido, null, '\t' ) }\n` );
	return contenido;

}

// ---------------------------------------------------------------- planos: antes y diferencias

/**
 * Para cada plano que cambia (su huella de datos es otra), deja en <salida>/cambios/
 * el plano de antes (<clave>-antes.png) y el de ahora con las diferencias en rojo
 * (<clave>-diferencias.png). planosAntes: { clave: { huellaDatos, png (Buffer) } }.
 */
export async function planosCambiados( salida, planosAntes ) {

	const lista = JSON.parse( readFileSync( join( salida, 'planos', 'planos.json' ), 'utf8' ) ).planos ?? [];
	const cambiados = lista.filter( ( p ) => ! planosAntes[ p.clave ] || planosAntes[ p.clave ].huellaDatos !== p.huellaDatos );
	if ( ! cambiados.length ) return [];
	mkdirSync( join( salida, 'cambios' ), { recursive: true } );
	const { chromium } = await import( 'playwright-core' );
	const CHROMIUM = [ process.env.CHROMIUM, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/opt/pw-browsers/chromium/chrome-linux/chrome' ].find( ( r ) => r && existsSync( r ) );
	const navegador = await chromium.launch( CHROMIUM ? { executablePath: CHROMIUM } : {} );
	const resultado = [];
	try {

		const pagina = await navegador.newPage();
		for ( const p of cambiados ) {

			const ahora = readFileSync( join( salida, 'planos', p.miniatura ) );
			const antes = planosAntes[ p.clave ]?.png;
			const r = { clave: p.clave, titulo: p.titulo, ahora: `../planos/${ p.miniatura }`, nuevo: ! antes };
			if ( antes ) {

				writeFileSync( join( salida, 'cambios', `${ p.clave }-antes.png` ), antes );
				r.antes = `${ p.clave }-antes.png`;
				const dif = await pagina.evaluate( diferenciasEnNavegador, { antes: antes.toString( 'base64' ), ahora: ahora.toString( 'base64' ) } );
				if ( dif ) {

					writeFileSync( join( salida, 'cambios', `${ p.clave }-diferencias.png` ), Buffer.from( dif, 'base64' ) );
					r.diferencias = `${ p.clave }-diferencias.png`;

				}

			}
			resultado.push( r );

		}

	} finally {

		await navegador.close();

	}
	return resultado;

}

/** En el navegador: el plano de ahora, aclarado, con lo que cambia respecto al de antes en rojo (null si no son comparables). */
async function diferenciasEnNavegador( { antes, ahora } ) {

	const cargar = ( b64 ) => new Promise( ( ok, mal ) => {

		const i = new Image();
		i.onload = () => ok( i );
		i.onerror = mal;
		i.src = `data:image/png;base64,${ b64 }`;

	} );
	const [ a, b ] = await Promise.all( [ cargar( antes ), cargar( ahora ) ] );
	if ( a.naturalWidth !== b.naturalWidth || a.naturalHeight !== b.naturalHeight ) return null;
	const w = b.naturalWidth, h = b.naturalHeight;
	const lienzo = ( img ) => {

		const c = document.createElement( 'canvas' );
		c.width = w;
		c.height = h;
		const x = c.getContext( '2d' );
		x.fillStyle = '#fff';
		x.fillRect( 0, 0, w, h );
		x.drawImage( img, 0, 0 );
		return x.getImageData( 0, 0, w, h );

	};
	const da = lienzo( a ), db = lienzo( b );
	const salida = new ImageData( w, h );
	const luz = ( d, i ) => 0.3 * d[ i ] + 0.59 * d[ i + 1 ] + 0.11 * d[ i + 2 ];
	// lo que cambia, engrosado un par de píxeles para que se vea
	const cambia = new Uint8Array( w * h );
	for ( let i = 0, p = 0; i < db.data.length; i += 4, p ++ ) if ( Math.abs( luz( da.data, i ) - luz( db.data, i ) ) > 40 ) cambia[ p ] = 1;
	const marca = new Uint8Array( w * h );
	for ( let y = 0; y < h; y ++ ) for ( let x = 0; x < w; x ++ ) {

		if ( ! cambia[ y * w + x ] ) continue;
		for ( let dy = - 2; dy <= 2; dy ++ ) for ( let dx = - 2; dx <= 2; dx ++ ) {

			const xx = x + dx, yy = y + dy;
			if ( xx >= 0 && yy >= 0 && xx < w && yy < h ) marca[ yy * w + xx ] = 1;

		}

	}
	let algo = false;
	for ( let i = 0, p = 0; i < db.data.length; i += 4, p ++ ) {

		if ( marca[ p ] ) {

			algo = true;
			salida.data.set( [ 214, 40, 40, 255 ], i );

		} else {

			// el plano de ahora, aclarado, para que lo rojo destaque
			const l = 255 - ( 255 - luz( db.data, i ) ) * 0.35;
			salida.data.set( [ l, l, l, 255 ], i );

		}

	}
	if ( ! algo ) return null;
	const c = document.createElement( 'canvas' );
	c.width = w;
	c.height = h;
	c.getContext( '2d' ).putImageData( salida, 0, 0 );
	return c.toDataURL( 'image/png' ).split( ',' )[ 1 ];

}

// ---------------------------------------------------------------- uso desde la línea de órdenes

if ( process.argv[ 1 ] && resolve( process.argv[ 1 ] ) === fileURLToPath( import.meta.url ) ) {

	const [ id ] = process.argv.slice( 2 );
	const opcion = ( n ) => { const i = process.argv.indexOf( `--${ n }` ); return i > 0 ? process.argv[ i + 1 ] : null; };
	const antes = opcion( 'antes' );
	if ( ! id || ! antes ) {

		console.error( 'Uso: node herramientas/cambios.mjs <promoción> --antes <commit> [--salida <carpeta>]' );
		process.exit( 1 );

	}
	const grupos = compararDatos( leerEnCommit( id, antes ), leerAhora( id ) );
	const salida = opcion( 'salida' ) ?? join( RAIZ, 'salida', 'cambios', id );
	escribirCambios( salida, { promocion: id, version: null, anterior: antes, grupos } );
	for ( const g of grupos ) console.log( `\n${ g.titulo }\n${ g.cambios.map( ( c ) => `  · ${ c }` ).join( '\n' ) }` );
	if ( ! grupos.length ) console.log( 'No cambia nada de lo que se ve en la web pública.' );

}
