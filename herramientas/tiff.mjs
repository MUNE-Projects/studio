// Lector mínimo de GeoTIFF (el modelo digital del terreno del IGN), sin
// dependencias: una banda, en tiras o mosaicos, sin comprimir, con Deflate o
// con LZW, y predictor 1 (ninguno), 2 (horizontal) o 3 (coma flotante). Lo usa
// herramientas/entorno.mjs.

import { inflateSync } from 'node:zlib';

const TIPOS = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 16: 8 };

function lzw( entrada ) {

	const salida = [];
	let tabla = [];
	let bits = 9, pos = 0, anterior = null;
	const reiniciar = () => {

		tabla = Array.from( { length: 258 }, ( _, i ) => ( i < 256 ? [ i ] : [] ) );
		bits = 9;

	};
	const leer = () => {

		let v = 0;
		for ( let i = 0; i < bits; i ++ ) {

			const byte = entrada[ ( pos + i ) >> 3 ];
			if ( byte === undefined ) return 257;
			v = ( v << 1 ) | ( ( byte >> ( 7 - ( ( pos + i ) & 7 ) ) ) & 1 );

		}
		pos += bits;
		return v;

	};
	reiniciar();
	for ( ;; ) {

		const codigo = leer();
		if ( codigo === 257 ) break;
		if ( codigo === 256 ) {

			reiniciar();
			anterior = null;
			continue;

		}
		let palabra;
		if ( codigo < tabla.length ) {

			palabra = tabla[ codigo ];
			if ( anterior ) tabla.push( [ ...anterior, palabra[ 0 ] ] );

		} else {

			palabra = [ ...anterior, anterior[ 0 ] ];
			tabla.push( palabra );

		}
		salida.push( ...palabra );
		anterior = palabra;
		if ( tabla.length + 1 >= ( 1 << bits ) && bits < 12 ) bits ++;

	}
	return Uint8Array.from( salida );

}

/** Lee la primera banda: { ancho, alto, valores (Float64Array), sinDato, origen [x, y], paso [dx, dy] }. */
export function leerTiff( buffer ) {

	const b = Buffer.from( buffer );
	const le = b.toString( 'ascii', 0, 2 ) === 'II';
	if ( ! le && b.toString( 'ascii', 0, 2 ) !== 'MM' ) throw new Error( 'No es un TIFF' );
	const u16 = ( o ) => ( le ? b.readUInt16LE( o ) : b.readUInt16BE( o ) );
	const u32 = ( o ) => ( le ? b.readUInt32LE( o ) : b.readUInt32BE( o ) );
	if ( u16( 2 ) !== 42 ) throw new Error( 'TIFF no admitido (BigTIFF)' );
	const etiquetas = new Map();
	const ifd = u32( 4 );
	for ( let i = 0, n = u16( ifd ); i < n; i ++ ) {

		const o = ifd + 2 + i * 12;
		const tag = u16( o ), tipo = u16( o + 2 ), cuenta = u32( o + 4 );
		const tam = ( TIPOS[ tipo ] ?? 1 ) * cuenta;
		const dato = tam <= 4 ? o + 8 : u32( o + 8 );
		const valores = [];
		for ( let k = 0; k < cuenta; k ++ ) {

			const p = dato + k * ( TIPOS[ tipo ] ?? 1 );
			valores.push( tipo === 3 ? u16( p ) : tipo === 4 || tipo === 16 ? u32( p ) : tipo === 12 ? ( le ? b.readDoubleLE( p ) : b.readDoubleBE( p ) )
				: tipo === 11 ? ( le ? b.readFloatLE( p ) : b.readFloatBE( p ) ) : tipo === 2 ? b[ p ] : b[ p ] );

		}
		etiquetas.set( tag, tipo === 2 ? Buffer.from( valores ).toString( 'ascii' ).replace( /\0+$/, '' ) : valores );

	}
	const v = ( t, d ) => etiquetas.get( t )?.[ 0 ] ?? d;
	const ancho = v( 256 ), alto = v( 257 );
	const bits = v( 258, 8 ), compresion = v( 259, 1 ), predictor = v( 317, 1 ), formato = v( 339, 1 );
	const muestras = v( 277, 1 );
	if ( muestras !== 1 ) throw new Error( `TIFF con ${ muestras } bandas` );
	const bytes = bits / 8;
	const enMosaicos = etiquetas.has( 324 );
	const anchoBloque = enMosaicos ? v( 322 ) : ancho;
	const altoBloque = enMosaicos ? v( 323 ) : v( 278, alto );
	const offsets = etiquetas.get( enMosaicos ? 324 : 273 );
	const tamanos = etiquetas.get( enMosaicos ? 325 : 279 );
	const porFila = Math.ceil( ancho / anchoBloque );
	const valores = new Float64Array( ancho * alto );

	const leerValor = ( dv, i ) => {

		const o = i * bytes;
		if ( formato === 3 ) return bits === 64 ? dv.getFloat64( o, le ) : dv.getFloat32( o, le );
		if ( formato === 2 ) return bits === 32 ? dv.getInt32( o, le ) : bits === 16 ? dv.getInt16( o, le ) : dv.getInt8( o );
		return bits === 32 ? dv.getUint32( o, le ) : bits === 16 ? dv.getUint16( o, le ) : dv.getUint8( o );

	};

	offsets.forEach( ( off, n ) => {

		let datos = b.subarray( off, off + tamanos[ n ] );
		if ( compresion === 8 || compresion === 32946 ) datos = inflateSync( datos );
		else if ( compresion === 5 ) datos = Buffer.from( lzw( datos ) );
		else if ( compresion !== 1 ) throw new Error( `TIFF con compresión ${ compresion }` );
		datos = Uint8Array.from( datos );
		const filasBloque = Math.min( altoBloque, alto - Math.floor( n / porFila ) * altoBloque );
		const anchoFila = anchoBloque;
		if ( predictor === 2 ) {

			for ( let f = 0; f < filasBloque; f ++ ) {

				const dv = new DataView( datos.buffer, f * anchoFila * bytes );
				for ( let c = 1; c < anchoFila; c ++ ) {

					if ( bytes === 1 ) datos[ f * anchoFila + c ] = ( datos[ f * anchoFila + c ] + datos[ f * anchoFila + c - 1 ] ) & 255;
					else if ( bytes === 2 ) dv.setUint16( c * 2, ( dv.getUint16( c * 2, le ) + dv.getUint16( ( c - 1 ) * 2, le ) ) & 0xffff, le );
					else dv.setUint32( c * 4, ( dv.getUint32( c * 4, le ) + dv.getUint32( ( c - 1 ) * 4, le ) ) >>> 0, le );

				}

			}

		} else if ( predictor === 3 ) {

			// coma flotante: diferencias por bytes y bytes reordenados por planos
			const fila = anchoFila * bytes;
			for ( let f = 0; f < filasBloque; f ++ ) {

				const o = f * fila;
				for ( let c = 1; c < fila; c ++ ) datos[ o + c ] = ( datos[ o + c ] + datos[ o + c - 1 ] ) & 255;
				const copia = datos.slice( o, o + fila );
				for ( let c = 0; c < anchoFila; c ++ ) {

					for ( let k = 0; k < bytes; k ++ ) datos[ o + c * bytes + ( le ? bytes - 1 - k : k ) ] = copia[ k * anchoFila + c ];

				}

			}

		}
		const dv = new DataView( datos.buffer, datos.byteOffset, datos.byteLength );
		const bx = ( n % porFila ) * anchoBloque, by = Math.floor( n / porFila ) * altoBloque;
		for ( let f = 0; f < filasBloque; f ++ ) {

			for ( let c = 0; c < anchoBloque && bx + c < ancho; c ++ ) valores[ ( by + f ) * ancho + bx + c ] = leerValor( dv, f * anchoFila + c );

		}

	} );

	// georreferencia: ModelTiepoint (33922) y ModelPixelScale (33550)
	const punto = etiquetas.get( 33922 ), escala = etiquetas.get( 33550 );
	const sinDato = etiquetas.has( 42113 ) ? Number( etiquetas.get( 42113 ) ) : null;
	return {
		ancho, alto, valores, sinDato,
		origen: punto ? [ punto[ 3 ] - punto[ 0 ] * escala[ 0 ], punto[ 4 ] + punto[ 1 ] * escala[ 1 ] ] : null,
		paso: escala ? [ escala[ 0 ], escala[ 1 ] ] : null,
	};

}
