// Documento de selección de un pack (PDF): mecanismo de formalización.
// Se genera en el navegador del comprador; no se guarda nada en ningún sistema.
// Procedimiento: descargar → firmar → transferencia → enviar el documento
// firmado y el justificante a quien indique la promotora (o al comercial).

import { jsPDF } from 'jspdf';
import type { Configurador } from '../configurador/configurador';
import { fmtEuros } from '../configurador/configurador';
import { fmtM2 } from '../configurador/alternativas';
import type { Promocion, Tipologia, ViviendaPromocion } from '../modelo/tipos';
import { logoPNG } from '../promocion/marca';
import { fmtFecha, type PackVivienda } from '../configurador/packs';

export interface DatosDocumento {
	promocion: Promocion;
	vivienda: ViviendaPromocion;
	tipologia: Tipologia;
	conf: Configurador;
	pack: PackVivienda;
	superficieUtil: number;
	imagen: string;
	/** Datos que el comprador haya escrito (si no, quedan líneas para rellenar a mano). */
	comprador: { nombre: string; dni: string };
	/** Concepto de la transferencia, ya resuelto. */
	concepto: string;
}

type RGB = [ number, number, number ];
const rgb = ( hex: string ): RGB => {

	const n = parseInt( hex.replace( '#', '' ), 16 );
	return [ ( n >> 16 ) & 255, ( n >> 8 ) & 255, n & 255 ];

};

const TINTA: RGB = [ 28, 28, 26 ];
const GRIS: RGB = [ 110, 106, 99 ];
const GRIS_CLARO: RGB = [ 150, 145, 137 ];
const LINEA: RGB = [ 222, 219, 213 ];
const A4 = { ancho: 210, alto: 297 };
const M = 18; // margen

export async function generarPDF( d: DatosDocumento ): Promise<Blob> {

	const { promocion: p, vivienda: v, tipologia: t, conf, pack: pv } = d;
	const marca = p.marca;
	const { pago: pagos, contacto } = v.formalizacion ?? {};
	// a quién se envía el documento firmado (lo configura la promotora en MUNE Portal)
	const destino = contacto?.email ?? 'tu comercial';
	const acento = rgb( marca.colorPrincipal );
	const suave: RGB = acento.map( ( x ) => Math.round( x + ( 255 - x ) * 0.9 ) ) as RGB;
	const doc = new jsPDF( { unit: 'mm', format: 'a4', compress: true } );
	const logo = await logoPNG( marca, 120 );
	const ahora = new Date();
	const fecha = ahora.toLocaleDateString( 'es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' } );
	const hora = ahora.toLocaleTimeString( 'es-ES', { hour: '2-digit', minute: '2-digit' } );
	const anchoUtil = A4.ancho - 2 * M;
	const extras = conf.extrasDe( pv.pack.id );
	const total = conf.totalPack( pv.pack.id );

	const color = ( c: RGB ) => doc.setTextColor( c[ 0 ], c[ 1 ], c[ 2 ] );
	const texto = ( s: string | string[], x: number, y: number, tam: number, c: RGB = TINTA, estilo: 'normal' | 'bold' = 'normal', opciones: Parameters<jsPDF[ 'text' ]>[ 3 ] = {} ) => {

		doc.setFont( 'helvetica', estilo );
		doc.setFontSize( tam );
		color( c );
		doc.text( s, x, y, opciones );

	};

	/** Parte un texto en líneas para un ancho dado, con el tamaño con el que se va a escribir. */
	const partir = ( s: string, ancho: number, tam: number, estilo: 'normal' | 'bold' = 'normal' ) => {

		doc.setFont( 'helvetica', estilo );
		doc.setFontSize( tam );
		return doc.splitTextToSize( s, ancho ) as string[];

	};

	const linea = ( x1: number, y1: number, x2: number, y2: number, c: RGB = LINEA, grosor = 0.2 ) => {

		doc.setDrawColor( c[ 0 ], c[ 1 ], c[ 2 ] );
		doc.setLineWidth( grosor );
		doc.line( x1, y1, x2, y2 );

	};

	const cabecera = () => {

		const alto = 10;
		doc.addImage( logo.url, 'PNG', M, 12, alto * logo.ancho / logo.alto, alto );
		texto( 'DOCUMENTO DE SELECCIÓN', A4.ancho - M, 16, 7.5, acento, 'bold', { align: 'right', charSpace: 0.4 } );
		texto( `${ p.promocion.nombre } · ${ v.ref } · ${ pv.pack.titulo }`, A4.ancho - M, 21, 8.5, GRIS, 'normal', { align: 'right' } );
		linea( M, 27, A4.ancho - M, 27, acento, 0.5 );

	};

	const titulo = ( s: string, y: number ) => texto( s, M, y, 13, TINTA, 'bold' );

	// ---------------------------------------------------------------- página 1: selección
	cabecera();
	let y = 40;
	texto( pv.pack.titulo, M, y, 21, TINTA, 'bold' );
	y += 6.5;
	texto( `${ p.promocion.nombre } · ${ p.promocion.ubicacion } · ${ marca.promotora }`, M, y, 9.5, GRIS );
	y += 5;
	texto( `Periodo de selección: del ${ fmtFecha( pv.pack.desde ) } al ${ fmtFecha( pv.pack.hasta ) }`, M, y, 8.5, acento, 'bold' );

	// ficha de la vivienda
	y += 10;
	const fichas: [ string, string, string ][] = [
		[ 'Vivienda', v.ref, [ v.portal ? `Portal ${ v.portal }` : '', `Planta ${ v.planta.toLowerCase() }` ].filter( Boolean ).join( ' · ' ) ],
		[ 'Tipología', t.nombre, `${ t.dormitorios } dormitorios · ${ t.banos } baños` ],
		[ 'Superficie útil', fmtM2( d.superficieUtil ), `Construida ${ fmtM2( v.superficies.construida ) }` ],
		[ 'Exterior', fmtM2( v.superficies.exterior ), `Orientación ${ v.orientacion.toLowerCase() }` ],
	];
	const col = anchoUtil / fichas.length;
	fichas.forEach( ( [ etiqueta, valor, extra ], i ) => {

		const x = M + i * col;
		if ( i > 0 ) linea( x - 3, y - 3, x - 3, y + 12 );
		texto( etiqueta.toUpperCase(), x, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
		texto( valor, x, y + 5.5, 11, TINTA, 'bold' );
		texto( extra, x, y + 10.5, 7.5, GRIS );

	} );

	// imagen
	y += 18;
	const altoImg = anchoUtil * 9 / 16;
	doc.addImage( d.imagen, 'JPEG', M, y, anchoUtil, altoImg, undefined, 'FAST' );
	y += altoImg + 4.5;
	texto( partir( `Imagen con tu selección aplicada. ${ marca.legal.imagenes }`, anchoUtil, 7 ), M, y, 7, GRIS_CLARO );

	// selección del pack
	y += 11;
	titulo( 'Opciones elegidas', y );
	y += 4;
	for ( const c of pv.categorias ) {

		const o = conf.opcion( c.id );
		const alto = o.detalle ? 11 : 9;
		linea( M, y, A4.ancho - M, y );
		texto( c.nombre, M, y + 6, 8.5, GRIS );
		texto( o.nombre, M + 38, y + 6, 10, TINTA, o.precio > 0 ? 'bold' : 'normal' );
		if ( o.detalle ) texto( o.detalle, M + 38, y + 10, 7.5, GRIS );
		texto( o.precio > 0 ? `+${ fmtEuros( o.precio ) }` : 'Incluido', A4.ancho - M, y + 6, 10, o.precio > 0 ? acento : GRIS_CLARO, o.precio > 0 ? 'bold' : 'normal', { align: 'right' } );
		y += alto;

	}

	linea( M, y, A4.ancho - M, y );
	y += 3;
	doc.setFillColor( suave[ 0 ], suave[ 1 ], suave[ 2 ] );
	doc.roundedRect( M, y, anchoUtil, 13, 2, 2, 'F' );
	texto( `Total de las mejoras del pack (${ extras.length })`, M + 5, y + 8.4, 11, TINTA, 'bold' );
	texto( total ? fmtEuros( total ) : '0 €', A4.ancho - M - 5, y + 8.8, 15, acento, 'bold', { align: 'right' } );
	y += 18;
	const aviso = partir( marca.legal.precios, anchoUtil, 7.2 );
	texto( aviso, M, y, 7.2, GRIS_CLARO );

	// ---------------------------------------------------------------- página 2: formalización y pago
	doc.addPage();
	cabecera();
	y = 40;
	texto( 'Formalización y pago', M, y, 17, TINTA, 'bold' );
	y += 7;
	const intro = partir( total
		? `Para formalizar tu selección, firma este documento, haz la transferencia por el importe indicado y envía el documento firmado y el justificante de pago a ${ destino }.`
		: `Este pack no tiene mejoras con coste. Para dejar constancia de tu selección, firma este documento y envíalo a ${ destino }.`, anchoUtil, 9.5 );
	texto( intro, M, y, 9.5, GRIS );
	y += intro.length * 4.3 + 5;

	// pasos
	const pasos = total
		? [ [ 'Descargar', 'Este documento' ], [ 'Firmar', 'Completa tus datos y firma' ], [ 'Transferir', `Importe: ${ fmtEuros( total ) }` ], [ 'Enviar', 'Documento firmado y justificante de pago' ] ]
		: [ [ 'Descargar', 'Este documento' ], [ 'Firmar', 'Completa tus datos y firma' ], [ 'Enviar', 'Documento firmado' ] ];
	const anchoPaso = anchoUtil / pasos.length;
	pasos.forEach( ( [ a, b ], i ) => {

		const x = M + i * anchoPaso;
		doc.setFillColor( acento[ 0 ], acento[ 1 ], acento[ 2 ] );
		doc.circle( x + 4, y + 3, 3.6, 'F' );
		texto( String( i + 1 ), x + 4, y + 4.4, 9, [ 255, 255, 255 ], 'bold', { align: 'center' } );
		texto( a, x + 10, y + 2.5, 9.5, TINTA, 'bold' );
		texto( partir( b, anchoPaso - 12, 7.5 ), x + 10, y + 6.5, 7.5, GRIS );

	} );
	y += 18;

	if ( total && pagos?.iban ) {

		titulo( 'Datos para la transferencia', y );
		y += 4;
		doc.setDrawColor( acento[ 0 ], acento[ 1 ], acento[ 2 ] );
		doc.setLineWidth( 0.4 );
		const filas: [ string, string ][] = [
			[ 'Importe', fmtEuros( total ) ],
			...( pagos.titular ? [ [ 'Beneficiario', pagos.titular ] as [ string, string ] ] : [] ),
			...( pagos.banco ? [ [ 'Entidad', pagos.banco ] as [ string, string ] ] : [] ),
			[ 'IBAN', pagos.iban ],
			...( pagos.bic ? [ [ 'BIC / SWIFT', pagos.bic ] as [ string, string ] ] : [] ),
			[ 'Concepto', d.concepto ],
			...( pagos.plazoDias ? [ [ 'Plazo', `${ pagos.plazoDias } días naturales desde la firma y, como tarde, el ${ fmtFecha( pv.pack.hasta ) } (fin del periodo del pack)` ] as [ string, string ] ] : [] ),
		];
		const alto = filas.reduce( ( s, [ , b ] ) => s + Math.max( 1, partir( b, anchoUtil - 50, 9.5 ).length ) * 4.6 + 3, 0 ) + 4;
		doc.roundedRect( M, y, anchoUtil, alto, 2, 2, 'S' );
		let yf = y + 6;
		for ( const [ a, b ] of filas ) {

			texto( a.toUpperCase(), M + 5, yf, 6.8, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
			const l = partir( b, anchoUtil - 50, 9.5, a === 'Importe' || a === 'IBAN' || a === 'Concepto' ? 'bold' : 'normal' );
			texto( l, M + 42, yf, 9.5, a === 'Importe' ? acento : TINTA, a === 'Importe' || a === 'IBAN' || a === 'Concepto' ? 'bold' : 'normal' );
			yf += Math.max( 1, l.length ) * 4.6 + 3;

		}

		y += alto + 4;
		if ( pagos.instrucciones ) {

			const l = partir( pagos.instrucciones, anchoUtil, 7.8 );
			texto( l, M, y + 2, 7.8, GRIS );
			y += l.length * 3.5 + 5;

		}

	}

	// conformidad del comprador
	y += 3;
	titulo( 'Conformidad', y );
	y += 4;
	const decl = partir( `En relación con la vivienda ${ v.ref } de ${ p.promocion.nombre }, declaro conocer y aceptar la selección indicada en este documento y su importe.`, anchoUtil, 8.5 );
	texto( decl, M, y + 3, 8.5, GRIS );
	y += decl.length * 3.8 + 8;
	const campo = ( etiqueta: string, x: number, ancho: number, valor = '' ) => {

		texto( etiqueta.toUpperCase(), x, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
		if ( valor ) texto( valor, x, y + 7.5, 10.5, TINTA );
		linea( x, y + 9, x + ancho, y + 9, GRIS, 0.3 );

	};

	campo( 'Nombre y apellidos', M, anchoUtil, d.comprador.nombre );
	y += 15;
	campo( 'DNI / NIE', M, anchoUtil * 0.48, d.comprador.dni );
	campo( 'Fecha', M + anchoUtil * 0.52, anchoUtil * 0.48 );
	y += 15;
	texto( 'FIRMA', M, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
	doc.setDrawColor( GRIS[ 0 ], GRIS[ 1 ], GRIS[ 2 ] );
	doc.setLineWidth( 0.3 );
	doc.roundedRect( M, y + 2.5, anchoUtil * 0.48, 26, 1.5, 1.5, 'S' );
	texto( 'OBSERVACIONES', M + anchoUtil * 0.52, y, 6.5, GRIS_CLARO, 'bold', { charSpace: 0.3 } );
	doc.roundedRect( M + anchoUtil * 0.52, y + 2.5, anchoUtil * 0.48, 26, 1.5, 1.5, 'S' );
	y += 35;

	if ( contacto?.email ) texto( `Envía la documentación a: ${ [ contacto.nombre, contacto.email, contacto.telefono ].filter( Boolean ).join( ' · ' ) }`, M, y, 8.5, GRIS );

	// ---------------------------------------------------------------- pie en todas las páginas
	const paginas = doc.getNumberOfPages();
	for ( let i = 1; i <= paginas; i ++ ) {

		doc.setPage( i );
		linea( M, A4.alto - 20, A4.ancho - M, A4.alto - 20 );
		texto( marca.legal.pie, M, A4.alto - 15.5, 6.8, GRIS_CLARO );
		texto( [ marca.contacto?.web, marca.contacto?.telefono, marca.contacto?.email ].filter( Boolean ).join( ' · ' ), M, A4.alto - 12, 6.8, GRIS_CLARO );
		texto( `Generado el ${ fecha } a las ${ hora } · Página ${ i } de ${ paginas }`, A4.ancho - M, A4.alto - 12, 6.8, GRIS_CLARO, 'normal', { align: 'right' } );

	}

	doc.setProperties( { title: `${ pv.pack.titulo } · ${ p.promocion.nombre } · ${ v.ref }`, author: marca.promotora, creator: marca.promotora } );
	return doc.output( 'blob' );

}
