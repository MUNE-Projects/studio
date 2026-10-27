// Choques en la distribución: muebles y equipamiento que se pisan entre sí,
// que atraviesan una pared o que quedan donde barre una puerta al abrirse, y
// placas o fregaderos fuera de su encimera. Si hay alguno, «preparar» se
// detiene: la vivienda saldría así en el 3D, en los renders y en los planos.

import type { Equipamiento, Hueco, Muro, Rect, Vivienda } from './tipos';

/** Pares que sí pueden solaparse en planta (las sillas entran bajo la mesa). */
const JUNTOS: [ string, string ][] = [ [ 'silla', 'mesa-comedor' ], [ 'silla', 'isla' ], [ 'silla', 'peninsula' ] ];
/** No ocupan suelo como un mueble (o se comprueban aparte). */
const IGNORAR = new Set( [ 'barandilla' ] );
/** Holgura: lo que se pisa menos de esto no cuenta (cotas redondeadas del plano). */
const HOLGURA = 0.02;

const plantaDe = ( x: { planta?: number } ) => x.planta ?? 0;
const solape = ( a: Rect, b: Rect ) => Math.min( a[ 2 ], b[ 2 ] ) - Math.max( a[ 0 ], b[ 0 ] ) > HOLGURA && Math.min( a[ 3 ], b[ 3 ] ) - Math.max( a[ 1 ], b[ 1 ] ) > HOLGURA;
const juntos = ( a: string, b: string ) => JUNTOS.some( ( [ x, y ] ) => ( a === x && b === y ) || ( a === y && b === x ) );

/** Hojas de una puerta abatible: bisagra y ancho de cada una, y hacia dónde barre. */
function hojas( h: Hueco, m: Muro ): { bx: number; by: number; ancho: number; signo: number }[] {

	const abatible = h.tipo === 'entrada' || ( h.tipo === 'puerta' && ( ! h.puerta || h.puerta === 'abatible' || h.puerta === 'doble' ) );
	if ( ! abatible || ! h.abre ) return [];
	const [ x0, y0, x1, y1 ] = m.rect;
	// la hoja gira desde la cara del muro hacia el lado al que abre
	const signo = h.abre === 'n' || h.abre === 'e' ? 1 : - 1;
	const cara = h.eje === 'x' ? ( signo > 0 ? y1 : y0 ) : ( signo > 0 ? x1 : x0 );
	const punto = ( t: number ) => ( h.eje === 'x' ? { bx: t, by: cara } : { bx: cara, by: t } );
	const luz = h.hasta - h.desde;
	if ( h.puerta === 'doble' ) return [ { ...punto( h.desde ), ancho: luz / 2, signo }, { ...punto( h.hasta ), ancho: luz / 2, signo } ];
	return [ { ...punto( h.bisagra === 'fin' ? h.hasta : h.desde ), ancho: luz, signo } ];

}

/** ¿Barre la hoja algún punto del rectángulo? (muestreo cada 5 cm, sin la holgura del borde) */
function barre( h: Hueco, hoja: { bx: number; by: number; ancho: number; signo: number }, r: Rect ) {

	const [ x0, y0, x1, y1 ] = [ r[ 0 ] + HOLGURA, r[ 1 ] + HOLGURA, r[ 2 ] - HOLGURA, r[ 3 ] - HOLGURA ];
	if ( x1 <= x0 || y1 <= y0 ) return false;
	const nx = Math.max( 2, Math.ceil( ( x1 - x0 ) / 0.05 ) ), ny = Math.max( 2, Math.ceil( ( y1 - y0 ) / 0.05 ) );
	for ( let i = 0; i <= nx; i ++ ) for ( let j = 0; j <= ny; j ++ ) {

		const x = x0 + ( ( x1 - x0 ) * i ) / nx, y = y0 + ( ( y1 - y0 ) * j ) / ny;
		// distancia a lo largo del muro y hacia el lado al que abre
		const a = h.eje === 'x' ? x : y, d = ( h.eje === 'x' ? y - hoja.by : x - hoja.bx ) * hoja.signo;
		const enLuz = a >= Math.min( h.desde, h.hasta ) - 0.001 && a <= Math.max( h.desde, h.hasta ) + 0.001;
		if ( enLuz && d > 0 && Math.hypot( x - hoja.bx, y - hoja.by ) < hoja.ancho ) return true;

	}
	return false;

}

/** Choques de la distribución, explicados para corregir los datos. */
export function revisarChoques( v: Vivienda ): string[] {

	const salida: string[] = [];
	const nombre = ( e: Equipamiento ) => `«${ e.id }» (${ e.tipo })`;
	const equipos = v.equipamiento.filter( ( e ) => ! IGNORAR.has( e.tipo ) );

	// equipamiento que se pisa
	for ( let i = 0; i < equipos.length; i ++ ) for ( let j = i + 1; j < equipos.length; j ++ ) {

		const a = equipos[ i ], b = equipos[ j ];
		if ( plantaDe( a ) !== plantaDe( b ) || juntos( a.tipo, b.tipo ) ) continue;
		if ( solape( a.rect, b.rect ) ) salida.push( `${ nombre( a ) } y ${ nombre( b ) } ocupan el mismo sitio` );

	}

	// equipamiento que atraviesa una pared
	for ( const e of equipos ) for ( const m of v.muros ) {

		if ( plantaDe( e ) === plantaDe( m ) && solape( e.rect, m.rect ) ) salida.push( `${ nombre( e ) } atraviesa el muro «${ m.id }»` );

	}

	// puertas que al abrirse chocan con un mueble
	const muros = new Map( v.muros.map( ( m ) => [ m.id, m ] ) );
	for ( const h of v.huecos ) {

		const m = muros.get( h.muro );
		if ( ! m ) continue;
		for ( const hoja of hojas( h, m ) ) for ( const e of equipos ) {

			if ( plantaDe( e ) === plantaDe( m ) && e.tipo !== 'escalera' && barre( h, hoja, e.rect ) )
				salida.push( `la puerta «${ h.id }» choca con ${ nombre( e ) } al abrirse` );

		}

	}

	// placa, fregadero y lavavajillas dentro de su encimera
	for ( const e of equipos ) {

		if ( e.tipo !== 'encimera' && e.tipo !== 'isla' && e.tipo !== 'peninsula' ) continue;
		const lateral = e.frente === 'e' || e.frente === 'o';
		const [ a0, a1 ] = lateral ? [ e.rect[ 1 ], e.rect[ 3 ] ] : [ e.rect[ 0 ], e.rect[ 2 ] ];
		for ( const [ k, r ] of [ [ 'placa', e.placa ], [ 'fregadero', e.fregadero ], [ 'lavavajillas', e.lavavajillas ] ] as const ) {

			if ( r && ( Math.min( ...r ) < a0 - 0.01 || Math.max( ...r ) > a1 + 0.01 ) )
				salida.push( `${ k } de ${ nombre( e ) } fuera de la encimera (va de ${ a0 } a ${ a1 } en ${ lateral ? 'y' : 'x' }; ${ k }: ${ r[ 0 ] }–${ r[ 1 ] })` );

		}

	}
	return [ ...new Set( salida ) ];

}
