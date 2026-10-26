// Plano comercial (A3 apaisado): entregable generado a partir de la misma
// geometría de la vivienda que usan el visor 3D y los renders.
//
// Un único dibujo con dos salidas:
//  - PDF vectorial (jsPDF): nítido a cualquier escala de impresión;
//  - PNG a 300 ppp (Canvas 2D): para web, portales y presentaciones.
//
// Contenido: logos de promotora y promoción, tipología, plano a escala
// normalizada con rótulos colocados sin solapes, tabla de superficies,
// leyenda, escala gráfica, norte, aviso legal y revisión del documento.

import { jsPDF } from 'jspdf';
import type { Equipamiento, Estancia, Promocion, Punto, Tipologia, Vivienda, ViviendaPromocion } from '../modelo/tipos';
import { colocarRotulo, type Formato, type Medida } from '../escena/rotulos';
import { svgPNG } from '../promocion/marca';
import { CATALOGO } from '../promocion/promocion';
import { barridoHueco, simbolosHueco, type Estilo } from '../modelo/simbolos';
import { esCarpinteriaExterior } from '../modelo/huecos';
import { dePlanta, esMultiplanta, plantasDe } from '../modelo/plantas';
import { esGaraje, esUtil } from '../modelo/estancias';

type P2 = [ number, number ];

/** Primitivas de dibujo en milímetros de hoja (y hacia abajo). */
interface Dibujo {
	pol( pts: P2[], relleno: string | null, trazo?: string | null, grosor?: number, discontinua?: number[] ): void;
	lin( pts: P2[], color: string, grosor: number, discontinua?: number[] ): void;
	circ( x: number, y: number, r: number, relleno: string | null, trazo?: string | null, grosor?: number ): void;
	txt( s: string, x: number, y: number, o: EstiloTexto ): void;
	ancho( s: string, o: EstiloTexto ): number;
	img( url: string, x: number, y: number, w: number, h: number ): void;
}

interface EstiloTexto { tam: number; negrita?: boolean; color?: string; alinear?: 'left' | 'center' | 'right'; espaciado?: number }

const HOJA = { ancho: 420, alto: 297 };
const PT = 25.4 / 72; // mm por punto tipográfico

// ------------------------------------------------------------ salidas

function dibujoPDF( doc: jsPDF ): Dibujo {

	const trazos = ( pts: P2[] ) => pts.slice( 1 ).map( ( p, i ) => [ p[ 0 ] - pts[ i ][ 0 ], p[ 1 ] - pts[ i ][ 1 ] ] );
	const fuente = ( o: EstiloTexto ) => {

		doc.setFont( 'helvetica', o.negrita ? 'bold' : 'normal' );
		doc.setFontSize( o.tam );

	};

	return {
		pol( pts, relleno, trazo = null, grosor = 0.2, discontinua ) {

			if ( pts.length < 3 ) return;
			if ( relleno ) doc.setFillColor( relleno );
			if ( trazo ) {

				doc.setDrawColor( trazo );
				doc.setLineWidth( grosor );

			}

			if ( discontinua ) doc.setLineDashPattern( discontinua, 0 );
			doc.lines( trazos( pts ), pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], [ 1, 1 ], relleno && trazo ? 'FD' : relleno ? 'F' : 'S', true );
			if ( discontinua ) doc.setLineDashPattern( [], 0 );

		},
		lin( pts, color, grosor, discontinua ) {

			doc.setDrawColor( color );
			doc.setLineWidth( grosor );
			if ( discontinua ) doc.setLineDashPattern( discontinua, 0 );
			doc.lines( trazos( pts ), pts[ 0 ][ 0 ], pts[ 0 ][ 1 ], [ 1, 1 ], 'S', false );
			if ( discontinua ) doc.setLineDashPattern( [], 0 );

		},
		circ( x, y, r, relleno, trazo = null, grosor = 0.2 ) {

			if ( relleno ) doc.setFillColor( relleno );
			if ( trazo ) {

				doc.setDrawColor( trazo );
				doc.setLineWidth( grosor );

			}

			doc.circle( x, y, r, relleno && trazo ? 'FD' : relleno ? 'F' : 'S' );

		},
		txt( s, x, y, o ) {

			fuente( o );
			doc.setTextColor( o.color ?? '#1c1c1a' );
			doc.text( s, x, y, { align: o.alinear ?? 'left', charSpace: o.espaciado ?? 0, baseline: 'alphabetic' } );

		},
		ancho( s, o ) {

			fuente( o );
			return doc.getTextWidth( s ) + ( o.espaciado ?? 0 ) * Math.max( 0, s.length - 1 );

		},
		img( url, x, y, w, h ) {

			doc.addImage( url, 'PNG', x, y, w, h, undefined, 'FAST' );

		},
	};

}

function dibujoCanvas( ctx: CanvasRenderingContext2D, k: number ): Dibujo {

	const camino = ( pts: P2[], cerrar: boolean ) => {

		ctx.beginPath();
		pts.forEach( ( [ x, y ], i ) => ( i ? ctx.lineTo( x * k, y * k ) : ctx.moveTo( x * k, y * k ) ) );
		if ( cerrar ) ctx.closePath();

	};

	const fuente = ( o: EstiloTexto ) => {

		ctx.font = `${ o.negrita ? 700 : 400 } ${ o.tam * PT * k }px Helvetica, Arial, sans-serif`;
		( ctx as unknown as { letterSpacing: string } ).letterSpacing = `${ ( o.espaciado ?? 0 ) * k }px`;

	};

	return {
		pol( pts, relleno, trazo = null, grosor = 0.2, discontinua ) {

			camino( pts, true );
			if ( relleno ) {

				ctx.fillStyle = relleno;
				ctx.fill( 'evenodd' );

			}

			if ( trazo ) {

				ctx.strokeStyle = trazo;
				ctx.lineWidth = grosor * k;
				ctx.setLineDash( discontinua ? discontinua.map( ( d ) => d * k ) : [] );
				ctx.stroke();
				ctx.setLineDash( [] );

			}

		},
		lin( pts, color, grosor, discontinua ) {

			camino( pts, false );
			ctx.strokeStyle = color;
			ctx.lineWidth = grosor * k;
			ctx.lineCap = 'butt';
			ctx.setLineDash( discontinua ? discontinua.map( ( d ) => d * k ) : [] );
			ctx.stroke();
			ctx.setLineDash( [] );

		},
		circ( x, y, r, relleno, trazo = null, grosor = 0.2 ) {

			ctx.beginPath();
			ctx.arc( x * k, y * k, r * k, 0, Math.PI * 2 );
			if ( relleno ) {

				ctx.fillStyle = relleno;
				ctx.fill();

			}

			if ( trazo ) {

				ctx.strokeStyle = trazo;
				ctx.lineWidth = grosor * k;
				ctx.stroke();

			}

		},
		txt( s, x, y, o ) {

			fuente( o );
			ctx.fillStyle = o.color ?? '#1c1c1a';
			const w = this.ancho( s, o );
			const dx = o.alinear === 'center' ? - w / 2 : o.alinear === 'right' ? - w : 0;
			ctx.textAlign = 'left';
			ctx.textBaseline = 'alphabetic';
			ctx.fillText( s, ( x + dx ) * k, y * k );

		},
		ancho( s, o ) {

			fuente( o );
			// el espaciado del último carácter no cuenta (igual que en el PDF)
			return ctx.measureText( s ).width / k - ( s.length ? ( o.espaciado ?? 0 ) : 0 );

		},
		img( url, x, y, w, h ) {

			const im = imagenes.get( url );
			if ( im ) ctx.drawImage( im, x * k, y * k, w * k, h * k );

		},
	};

}

const imagenes = new Map<string, HTMLImageElement>();
const cargarImagen = ( url: string ) => new Promise<void>( ( ok ) => {

	const im = new Image();
	im.onload = () => {

		imagenes.set( url, im );
		ok();

	};
	im.onerror = () => ok();
	im.src = url;

} );

// ------------------------------------------------------------ geometría

/** Tramos de una recta horizontal (y) dentro de un polígono (regla par-impar). */
function cortesH( pol: Punto[], y: number ): [ number, number ][] {

	const xs: number[] = [];
	for ( let i = 0, j = pol.length - 1; i < pol.length; j = i ++ ) {

		const [ xi, yi ] = pol[ i ], [ xj, yj ] = pol[ j ];
		if ( ( yi > y ) !== ( yj > y ) ) xs.push( xi + ( y - yi ) * ( xj - xi ) / ( yj - yi ) );

	}

	xs.sort( ( a, b ) => a - b );
	const out: [ number, number ][] = [];
	for ( let i = 0; i + 1 < xs.length; i += 2 ) out.push( [ xs[ i ], xs[ i + 1 ] ] );
	return out;

}

const trasponer = ( pol: Punto[] ): Punto[] => pol.map( ( [ x, y ] ) => [ y, x ] );

/** Piezas macizas de cada muro (sin los huecos) en planta. */
function piezasMuro( v: Vivienda ) {

	const out: [ number, number, number, number ][] = [];
	for ( const m of v.muros ) {

		const [ x0, y0, x1, y1 ] = m.rect;
		const enX = x1 - x0 >= y1 - y0;
		const hs = v.huecos.filter( ( h ) => h.muro === m.id ).sort( ( a, b ) => a.desde - b.desde );
		let c = enX ? x0 : y0;
		const fin = enX ? x1 : y1;
		for ( const h of hs ) {

			if ( h.desde > c ) out.push( enX ? [ c, y0, h.desde, y1 ] : [ x0, c, x1, h.desde ] );
			c = Math.max( c, h.hasta );

		}

		if ( fin > c ) out.push( enX ? [ c, y0, fin, y1 ] : [ x0, c, x1, fin ] );

	}

	return out;

}

const GIRO: Record<string, number> = { s: 0, n: Math.PI, e: Math.PI / 2, o: - Math.PI / 2 };

/** Marco local de un equipamiento: ancho W (x local), fondo D (frente hacia +z local). */
function marcoLocal( e: Equipamiento ) {

	const [ x0, y0, x1, y1 ] = e.rect;
	const cx = ( x0 + x1 ) / 2, cy = ( y0 + y1 ) / 2;
	const girado = e.frente === 'e' || e.frente === 'o';
	const W = girado ? y1 - y0 : x1 - x0, D = girado ? x1 - x0 : y1 - y0;
	const t = GIRO[ e.frente ], c = Math.cos( t ), s = Math.sin( t );
	// local (x, z) -> planta: mundo = rotY(t)·(x, 0, z); planta y = -mundo z
	const L = ( lx: number, lz: number ): P2 => [ cx + lx * c + lz * s, cy + lx * s - lz * c ];
	return { W, D, L };

}

// ------------------------------------------------------------ documento

export interface DatosPlano {
	promocion: Promocion;
	tipologia: Tipologia;
	vivienda: Vivienda;
	/** Vivienda concreta (si se descarga desde el acceso de un comprador). */
	ficha: ViviendaPromocion | null;
	/** Nombre de la distribución representada («base» = la opción incluida del catálogo). */
	distribucion: string;
	/** Viviendas en varias plantas: la planta de esta página y la superficie útil de toda la vivienda. */
	planta?: { nombre: string; utilTotal: number };
}

const COLORES = {
	papel: '#ffffff', tinta: '#1c1c1a', gris: '#6e6a63', grisClaro: '#9a958d', linea: '#dedad3',
	muro: '#2b2a28', mueble: '#8d8a84', muebleFijo: '#5d5a55',
	suelo: { madera: '#f1e9dc', ceramico: '#ebeeee', humedo: '#e5ecee', exterior: '#f1f0ea', garaje: '#e6e5e2' } as Record<string, string>,
	vetas: { madera: '#e6dac7', ceramico: '#dde1e1', humedo: '#d7e0e2', exterior: '#e3e1d9', garaje: '#d6d4d0' } as Record<string, string>,
};

const claseSuelo = ( e: Estancia ) => e.uso === 'exterior' ? 'exterior' : e.uso === 'garaje' ? 'garaje' : e.suelo === 'madera' ? 'madera' : e.suelo === 'porcelanico-bano' ? 'humedo' : 'ceramico';

/** Nombre visible de la distribución: «base» se muestra con el nombre de la opción incluida del catálogo. */
const nombreDistribucion = ( d: string ) => d !== 'base' ? d
	: CATALOGO.categorias.find( ( c ) => c.id === 'distribucion' )?.opciones.find( ( o ) => ! o.alternativa )?.nombre ?? 'Distribución base';
const fmtM2 = ( n: number ) => `${ n.toLocaleString( 'es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 } ) } m²`;

/** Dibuja la hoja completa. */
function componer( D: Dibujo, d: DatosPlano, logos: { promotora: { url: string; ancho: number; alto: number }; promocion: { url: string; ancho: number; alto: number } | null } ) {

	const { promocion: p, tipologia: t, vivienda: v } = d;
	const marca = p.marca;
	const acento = marca.colorPrincipal;
	const M = 14;
	const colX = 296; // columna de información
	const colW = HOJA.ancho - M - colX;

	D.pol( [ [ 0, 0 ], [ HOJA.ancho, 0 ], [ HOJA.ancho, HOJA.alto ], [ 0, HOJA.alto ] ], COLORES.papel );

	// ---------------------------------------------------------------- plano
	const xs = [ ...v.muros.flatMap( ( m ) => [ m.rect[ 0 ], m.rect[ 2 ] ] ), ...v.exterior.barandilla.recorrido.map( ( q ) => q[ 0 ] ) ];
	const ys = [ ...v.muros.flatMap( ( m ) => [ m.rect[ 1 ], m.rect[ 3 ] ] ), ...v.exterior.barandilla.recorrido.map( ( q ) => q[ 1 ] ) ];
	const bx0 = Math.min( ...xs ), bx1 = Math.max( ...xs ), by0 = Math.min( ...ys ), by1 = Math.max( ...ys );
	const area = { x: M + 2, y: M, w: colX - M - 14, h: HOJA.alto - 2 * M - 16 };
	// escala normalizada que quepa (1:50, 1:75, 1:100…)
	const den = [ 50, 75, 100, 125, 150, 200, 250 ].find( ( n ) => ( bx1 - bx0 ) * 1000 / n <= area.w && ( by1 - by0 ) * 1000 / n <= area.h ) ?? 300;
	const s = 1000 / den; // mm de hoja por metro
	const ox = area.x + ( area.w - ( bx1 - bx0 ) * s ) / 2, oy = area.y + ( area.h - ( by1 - by0 ) * s ) / 2;
	const T = ( x: number, y: number ): P2 => [ ox + ( x - bx0 ) * s, oy + ( by1 - y ) * s ];
	const TT = ( pts: Punto[] ) => pts.map( ( [ x, y ] ) => T( x, y ) );

	// suelos con su textura gráfica (lamas de madera, retícula de baldosa)
	for ( const e of v.estancias ) {

		const c = claseSuelo( e );
		D.pol( TT( e.poligono ), COLORES.suelo[ c ] );
		const vy = e.poligono.map( ( q ) => q[ 1 ] ), vx = e.poligono.map( ( q ) => q[ 0 ] );
		const paso = c === 'madera' ? 0.19 : c === 'exterior' ? 0.6 : c === 'garaje' ? 3 : 0.45;
		for ( let y = Math.min( ...vy ) + paso; y < Math.max( ...vy ); y += paso ) for ( const [ a, b ] of cortesH( e.poligono, y ) ) D.lin( [ T( a, y ), T( b, y ) ], COLORES.vetas[ c ], 0.08 );
		if ( c !== 'madera' ) for ( let x = Math.min( ...vx ) + paso; x < Math.max( ...vx ); x += paso ) for ( const [ a, b ] of cortesH( trasponer( e.poligono ), x ) ) D.lin( [ T( x, a ), T( x, b ) ], COLORES.vetas[ c ], 0.08 );

	}

	// proyección del porche (discontinua)
	const porche = v.estancias.find( ( e ) => e.id === 'porche' );
	if ( porche ) {

		const px = porche.poligono.map( ( q ) => q[ 0 ] ), py = porche.poligono.map( ( q ) => q[ 1 ] );
		D.lin( [ T( Math.min( ...px ), Math.max( ...py ) ), T( Math.min( ...px ), Math.min( ...py ) ), T( Math.max( ...px ), Math.min( ...py ) ) ], COLORES.gris, 0.18, [ 1.4, 1 ] );

	}

	// techos inclinados: línea donde la altura libre es de 1,50 m (punto y raya)
	const lineas150: [ number, number ][][] = [];
	for ( const e of v.estancias ) {

		const inc = e.techo?.inclinado;
		if ( ! inc || ( 1.5 - inc.bajo ) * ( 1.5 - inc.alto ) >= 0 ) continue;
		const f = ( 1.5 - inc.bajo ) / ( inc.alto - inc.bajo );
		const xs = e.poligono.map( ( q ) => q[ 0 ] ), ys = e.poligono.map( ( q ) => q[ 1 ] );
		const [ x0, x1, y0, y1 ] = [ Math.min( ...xs ), Math.max( ...xs ), Math.min( ...ys ), Math.max( ...ys ) ];
		const l: [ number, number ][] = inc.sube === 'n' ? [ [ x0, y0 + f * ( y1 - y0 ) ], [ x1, y0 + f * ( y1 - y0 ) ] ]
			: inc.sube === 's' ? [ [ x0, y1 - f * ( y1 - y0 ) ], [ x1, y1 - f * ( y1 - y0 ) ] ]
				: inc.sube === 'e' ? [ [ x0 + f * ( x1 - x0 ), y0 ], [ x0 + f * ( x1 - x0 ), y1 ] ]
					: [ [ x1 - f * ( x1 - x0 ), y0 ], [ x1 - f * ( x1 - x0 ), y1 ] ];
		lineas150.push( l );
		D.lin( l.map( ( [ x, y ] ) => T( x, y ) ), COLORES.gris, 0.18, [ 2.2, 0.8, 0.4, 0.8 ] );

	}

	// barandilla de la terraza
	const rec = v.exterior.barandilla.recorrido;
	if ( rec.length > 1 ) D.lin( TT( rec ), '#4a4845', 0.35 );

	// mobiliario y equipamiento (trazo fino)
	for ( const e of v.equipamiento ) dibujarEquipo( D, e, T, s );

	// muros (poché) sin huecos
	for ( const [ x0, y0, x1, y1 ] of piezasMuro( v ) ) D.pol( [ T( x0, y0 ), T( x1, y0 ), T( x1, y1 ), T( x0, y1 ) ], COLORES.muro );

	// huecos: puertas con su giro y carpinterías exteriores (símbolos comunes con la visita 3D)
	const grosor: Record<Estilo, [ string, number ]> = {
		jamba: [ COLORES.tinta, 0.18 ], carpinteria: [ COLORES.tinta, 0.18 ], vidrio: [ '#7fa6b5', 0.3 ], exterior: [ COLORES.gris, 0.12 ],
		hoja: [ COLORES.tinta, 0.35 ], giro: [ COLORES.gris, 0.13 ], fino: [ COLORES.gris, 0.1 ],
	};
	for ( const h of v.huecos ) {

		for ( const t of simbolosHueco( h, v ) ) {

			const [ c, g ] = grosor[ t.estilo ];
			D.lin( t.puntos.map( ( [ x, y ] ) => T( x, y ) ), c, t.estilo === 'hoja' && h.tipo === 'entrada' ? 0.5 : g );

		}
		if ( h.tipo === 'entrada' ) {

			// flecha de acceso, desde fuera
			const [ x0, y0, x1, y1 ] = v.muros.find( ( m ) => m.id === h.muro )!.rect;
			const enX = h.eje === 'x';
			const P = ( u: number, w: number ) => enX ? T( u, w ) : T( w, u );
			const w0 = enX ? y0 : x0, w1 = enX ? y1 : x1;
			const pos = h.abre === 'n' || h.abre === 'e';
			const um = ( h.desde + h.hasta ) / 2, wa = pos ? w0 - 0.5 : w1 + 0.5;
			D.lin( [ P( um, wa ), P( um, pos ? w0 - 0.1 : w1 + 0.1 ) ], acento, 0.35 );
			D.pol( [ P( um - 0.09, pos ? w0 - 0.22 : w1 + 0.22 ), P( um + 0.09, pos ? w0 - 0.22 : w1 + 0.22 ), P( um, pos ? w0 - 0.08 : w1 + 0.08 ) ], acento );

		}

	}

	// rótulos de estancias: sin pisar muros, muebles ni otros rótulos
	const k = 0.28; // mm de hoja por "px" de las métricas de rótulo
	const ocupados: [ number, number, number, number ][] = [];
	const TAM: Record<Formato, [ number, number ]> = { normal: [ 9.5, 10.5 ], compacta: [ 8.5, 9.5 ], 'dos-lineas': [ 8.5, 9.5 ], minima: [ 7.5, 8.5 ], 'solo-nombre': [ 7.5, 0 ], 'solo-nombre-2': [ 7.5, 0 ] };
	const aPt = ( px: number ) => px * k / PT;
	const estilos = ( f: Formato ) => {

		const [ tn, ts ] = TAM[ f ];
		return {
			nombre: { tam: aPt( tn ), negrita: true, alinear: 'center' as const, espaciado: 0.25, color: COLORES.tinta },
			area: { tam: aPt( ts ), alinear: 'center' as const, color: COLORES.gris },
			ts,
		};

	};
	// la caja de cada rótulo se mide con la tipografía real del documento
	const medida: Medida = ( f, lineas, sup ) => {

		const e = estilos( f );
		const ancho = Math.max( ...lineas.map( ( l ) => D.ancho( l.toUpperCase(), e.nombre ) ), e.ts && sup ? D.ancho( sup, e.area ) : 0 ) + 3.2;
		const alto = lineas.length * e.nombre.tam * PT * 1.15 + ( e.ts && sup ? e.area.tam * PT * 1.2 : 0 ) + 2.2;
		return { ancho: ancho / k, alto: alto / k };

	};
	// barridos de puertas: el rótulo tampoco debe taparlos
	const giros = v.huecos.map( ( h ) => barridoHueco( h, v ) ).filter( ( r ): r is [ number, number, number, number ] => !! r );
	for ( const e of [ ...v.estancias ].sort( ( a, b ) => a.superficie - b.superficie ) ) {

		const sup = fmtM2( e.superficie );
		const r = colocarRotulo( e, v, s / k, sup, giros, ocupados, medida );
		ocupados.push( r.caja );
		const ts = TAM[ r.formato ][ 1 ];
		const [ cx, cy ] = T( r.x, r.y );
		const { nombre, area: area2 } = estilos( r.formato );
		const lineas = r.lineas.map( ( l ) => l.toUpperCase() );
		const altoN = nombre.tam * PT * 1.15, altoS = ts ? area2.tam * PT * 1.2 : 0;
		const alto = lineas.length * altoN + altoS;
		const anchoMax = Math.max( ...lineas.map( ( l ) => D.ancho( l, nombre ) ), ts ? D.ancho( sup, area2 ) : 0 );
		// halo de papel
		const hx = anchoMax / 2 + 1.6, hy = alto / 2 + 1.1;
		D.pol( [ [ cx - hx, cy - hy ], [ cx + hx, cy - hy ], [ cx + hx, cy + hy ], [ cx - hx, cy + hy ] ], '#ffffff' );
		let yt = cy - alto / 2 + altoN * 0.82;
		for ( const l of lineas ) {

			D.txt( l, cx, yt, nombre );
			yt += altoN;

		}

		if ( ts ) D.txt( sup, cx, yt + altoS * 0.02, area2 );

	}

	// escala gráfica y norte, bajo el plano
	const ye = HOJA.alto - M - 10;
	const xe = area.x;
	const tramo = s; // 1 m
	for ( let i = 0; i < 5; i ++ ) D.pol( [ [ xe + i * tramo, ye ], [ xe + ( i + 1 ) * tramo, ye ], [ xe + ( i + 1 ) * tramo, ye + 1.6 ], [ xe + i * tramo, ye + 1.6 ] ], i % 2 ? '#ffffff' : COLORES.tinta, COLORES.tinta, 0.18 );
	for ( let i = 0; i <= 5; i ++ ) D.txt( String( i ), xe + i * tramo, ye + 5.2, { tam: 6.5, alinear: 'center', color: COLORES.gris } );
	D.txt( 'm', xe + 5 * tramo + 3, ye + 5.2, { tam: 6.5, color: COLORES.gris } );
	D.txt( `ESCALA 1:${ den } (A3)`, xe, ye - 2.6, { tam: 6.2, negrita: true, espaciado: 0.3, color: COLORES.gris } );

	if ( t.norte ) {

		const cx = xe + 5 * tramo + 22, cy = ye + 0.8, r = 5;
		const a = t.norte.angulo * Math.PI / 180;
		const rot = ( x: number, y: number ): P2 => [ cx + x * Math.cos( a ) - y * Math.sin( a ), cy + x * Math.sin( a ) + y * Math.cos( a ) ];
		D.circ( cx, cy, r, null, COLORES.gris, 0.18 );
		D.pol( [ rot( 0, - r + 0.6 ), rot( 1.8, r - 1.4 ), rot( 0, r - 2.6 ), rot( - 1.8, r - 1.4 ) ], COLORES.tinta );
		const [ nx, ny ] = rot( 0, - r - 2 );
		D.txt( 'N', nx, ny, { tam: 7, negrita: true, alinear: 'center' } );
		if ( t.norte.origen === 'supuesto' ) D.txt( 'Norte orientativo', cx + r + 3, cy + 1, { tam: 5.8, color: COLORES.grisClaro } );

	}

	// ---------------------------------------------------------------- columna de información
	D.lin( [ [ colX - 8, M ], [ colX - 8, HOJA.alto - M ] ], COLORES.linea, 0.25 );
	let y = M + 2;
	const lp = logos.promotora;
	D.img( lp.url, colX, y, 9 * lp.ancho / lp.alto, 9 );
	y += 16;
	if ( logos.promocion ) {

		const lq = logos.promocion;
		const alto = 15, ancho = Math.min( colW, alto * lq.ancho / lq.alto );
		D.img( lq.url, colX, y, ancho, ancho * lq.alto / lq.ancho );
		y += ancho * lq.alto / lq.ancho + 6;

	}

	D.txt( p.promocion.nombre, colX, y, { tam: 14, negrita: true } );
	y += 5.2;
	D.txt( p.promocion.ubicacion, colX, y, { tam: 8.5, color: COLORES.gris } );
	y += 7;
	D.lin( [ [ colX, y ], [ colX + colW, y ] ], acento, 0.5 );
	y += 7;
	D.txt( 'PLANO COMERCIAL', colX, y, { tam: 6.8, negrita: true, espaciado: 0.5, color: acento } );
	y += 8.5;
	D.txt( t.nombre, colX, y, { tam: 21, negrita: true } );
	y += 6;
	const plural = ( n: number, uno: string, varios: string ) => `${ n } ${ n === 1 ? uno : varios }`;
	D.txt( `${ plural( t.dormitorios, 'dormitorio', 'dormitorios' ) } · ${ plural( t.banos, 'baño', 'baños' ) }`, colX, y, { tam: 9, color: COLORES.gris } );
	if ( d.ficha ) {

		y += 4.6;
		D.txt( `Vivienda ${ d.ficha.ref } · Planta ${ d.ficha.planta.toLowerCase() }${ d.ficha.portal ? ` · Portal ${ d.ficha.portal }` : '' }`, colX, y, { tam: 9, color: COLORES.gris } );

	}

	y += 4.6;
	D.txt( nombreDistribucion( d.distribucion ), colX, y, { tam: 9, color: COLORES.gris } );
	if ( d.planta ) {

		y += 6;
		D.txt( d.planta.nombre.toUpperCase(), colX, y, { tam: 9.5, negrita: true, espaciado: 0.4, color: acento } );

	}

	// tabla de superficies
	y += 11;
	const fila = ( a: string, b: string, o: { negrita?: boolean; color?: string; tam?: number } = {} ) => {

		D.txt( a, colX, y, { tam: o.tam ?? 8.2, negrita: o.negrita, color: o.color ?? COLORES.tinta } );
		D.txt( b, colX + colW, y, { tam: o.tam ?? 8.2, negrita: o.negrita, color: o.color ?? COLORES.tinta, alinear: 'right' } );
		y += 1.9;
		D.lin( [ [ colX, y ], [ colX + colW, y ] ], COLORES.linea, 0.15 );
		y += 3.5;

	};

	D.txt( 'SUPERFICIES ÚTILES', colX, y, { tam: 6.6, negrita: true, espaciado: 0.4, color: COLORES.gris } );
	y += 5;
	const interiores = v.estancias.filter( esUtil );
	for ( const e of interiores ) fila( e.nombre, fmtM2( e.superficie ) );
	const util = interiores.reduce( ( a, e ) => a + e.superficie, 0 );
	fila( d.planta ? `Superficie útil · ${ d.planta.nombre.toLowerCase() }` : 'Superficie útil interior', fmtM2( util ), { negrita: true } );
	if ( d.planta ) fila( 'Superficie útil de la vivienda', fmtM2( d.planta.utilTotal ), { negrita: true } );
	const garajes = v.estancias.filter( esGaraje );
	if ( garajes.length ) {

		y += 2;
		D.txt( 'GARAJE', colX, y, { tam: 6.6, negrita: true, espaciado: 0.4, color: COLORES.gris } );
		y += 5;
		for ( const e of garajes ) fila( e.nombre, fmtM2( e.superficie ) );
		if ( garajes.length > 1 ) fila( 'Total garaje', fmtM2( garajes.reduce( ( a, e ) => a + e.superficie, 0 ) ), { negrita: true } );

	}
	const exteriores = v.estancias.filter( ( e ) => e.uso === 'exterior' );
	if ( exteriores.length ) {

		y += 2;
		D.txt( 'SUPERFICIES EXTERIORES', colX, y, { tam: 6.6, negrita: true, espaciado: 0.4, color: COLORES.gris } );
		y += 5;
		for ( const e of exteriores ) fila( e.nombre, fmtM2( e.superficie ) );
		fila( 'Total exterior', fmtM2( exteriores.reduce( ( a, e ) => a + e.superficie, 0 ) ), { negrita: true } );

	}

	const construida = d.ficha?.superficies.construida ?? v.meta.superficies_oficiales.construida;
	if ( construida ) {

		y += 2;
		fila( 'Superficie construida', fmtM2( construida ), { negrita: true, color: acento, tam: 9 } );

	}

	// leyenda
	y += 4;
	D.txt( 'LEYENDA', colX, y, { tam: 6.6, negrita: true, espaciado: 0.4, color: COLORES.gris } );
	y += 4.5;
	// solo lo que aparece en este plano (cada promoción es distinta)
	const hay = ( f: ( e: typeof v.estancias[ number ] ) => boolean ) => v.estancias.some( f );
	const conPorche = hay( ( e ) => e.id === 'porche' ), conExterior = hay( ( e ) => e.uso === 'exterior' );
	const nombresExteriores = [ ...new Set( v.estancias.filter( ( e ) => e.uso === 'exterior' ).map( ( e ) => e.nombre.toLowerCase() ) ) ];
	const textoExterior = nombresExteriores.length ? nombresExteriores.join( ', ' ).replace( /, ([^,]*)$/, ' y $1' ) : '';
	const leyenda: [ string, ( x: number, y: number ) => void ][] = [
		...( hay( ( e ) => e.suelo === 'madera' ) ? [ [ 'Pavimento de madera', ( x: number, yy: number ) => D.pol( [ [ x, yy - 2.6 ], [ x + 6, yy - 2.6 ], [ x + 6, yy + 0.6 ], [ x, yy + 0.6 ] ], COLORES.suelo.madera, COLORES.vetas.madera, 0.15 ) ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
		...( hay( ( e ) => esUtil( e ) && e.suelo !== 'madera' ) ? [ [ 'Pavimento cerámico', ( x: number, yy: number ) => D.pol( [ [ x, yy - 2.6 ], [ x + 6, yy - 2.6 ], [ x + 6, yy + 0.6 ], [ x, yy + 0.6 ] ], COLORES.suelo.ceramico, COLORES.vetas.ceramico, 0.15 ) ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
		...( conExterior ? [ [ textoExterior.charAt( 0 ).toUpperCase() + textoExterior.slice( 1 ), ( x: number, yy: number ) => D.pol( [ [ x, yy - 2.6 ], [ x + 6, yy - 2.6 ], [ x + 6, yy + 0.6 ], [ x, yy + 0.6 ] ], COLORES.suelo.exterior, COLORES.vetas.exterior, 0.15 ) ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
		...( hay( esGaraje ) ? [ [ 'Garaje', ( x: number, yy: number ) => D.pol( [ [ x, yy - 2.6 ], [ x + 6, yy - 2.6 ], [ x + 6, yy + 0.6 ], [ x, yy + 0.6 ] ], COLORES.suelo.garaje, COLORES.vetas.garaje, 0.15 ) ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
		[ 'Muro / tabique', ( x, yy ) => D.pol( [ [ x, yy - 2.6 ], [ x + 6, yy - 2.6 ], [ x + 6, yy + 0.6 ], [ x, yy + 0.6 ] ], COLORES.muro ) ],
		...( v.huecos.some( esCarpinteriaExterior ) ? [ [ 'Carpintería exterior', ( x: number, yy: number ) => {

			D.lin( [ [ x, yy - 1.8 ], [ x + 6, yy - 1.8 ] ], COLORES.tinta, 0.18 );
			D.lin( [ [ x, yy - 1 ], [ x + 6, yy - 1 ] ], '#7fa6b5', 0.3 );
			D.lin( [ [ x, yy - 0.2 ], [ x + 6, yy - 0.2 ] ], COLORES.tinta, 0.18 );

		} ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
		...( lineas150.length ? [ [ 'Altura libre de 1,50 m', ( x: number, yy: number ) => D.lin( [ [ x, yy - 1 ], [ x + 6, yy - 1 ] ], COLORES.gris, 0.18, [ 2.2, 0.8, 0.4, 0.8 ] ) ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
		...( conPorche ? [ [ 'Proyección del porche', ( x: number, yy: number ) => D.lin( [ [ x, yy - 1 ], [ x + 6, yy - 1 ] ], COLORES.gris, 0.18, [ 1.4, 1 ] ) ] as [ string, ( x: number, y: number ) => void ] ] : [] ),
	];
	leyenda.forEach( ( [ texto, icono ], i ) => {

		const cx = colX + ( i % 2 ) * ( colW / 2 ), cy = y + Math.floor( i / 2 ) * 5.4;
		icono( cx, cy );
		D.txt( texto, cx + 8, cy, { tam: 7, color: COLORES.gris } );

	} );
	y += Math.ceil( leyenda.length / 2 ) * 5.4 + 4;

	// aviso legal y revisión, al pie de la columna
	const aviso = marca.legal.plano ?? marca.legal.imagenes;
	const lineasAviso = partirTexto( D, aviso, colW, { tam: 6.3, color: COLORES.grisClaro } );
	let yp = HOJA.alto - M - 20 - lineasAviso.length * 2.8;
	for ( const l of lineasAviso ) {

		D.txt( l, colX, yp, { tam: 6.3, color: COLORES.grisClaro } );
		yp += 2.8;

	}

	yp += 3;
	D.lin( [ [ colX, yp ], [ colX + colW, yp ] ], COLORES.linea, 0.2 );
	yp += 4.5;
	const rev = t.revision;
	D.txt( rev ? `${ rev.fase } · v${ rev.version } · ${ fechaCorta( rev.fecha ) }` : 'Documento comercial', colX, yp, { tam: 7, negrita: true, color: COLORES.gris } );
	D.txt( `Generado el ${ new Date().toLocaleDateString( 'es-ES' ) }`, colX + colW, yp, { tam: 7, color: COLORES.grisClaro, alinear: 'right' } );
	yp += 4;
	D.txt( [ marca.promotora, marca.contacto?.web, marca.contacto?.telefono ].filter( Boolean ).join( ' · ' ), colX, yp, { tam: 6.5, color: COLORES.grisClaro } );

}

const fechaCorta = ( iso: string ) => new Date( `${ iso }T12:00:00` ).toLocaleDateString( 'es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' } );

function partirTexto( D: Dibujo, s: string, ancho: number, o: EstiloTexto ) {

	const out: string[] = [];
	let actual = '';
	for ( const w of s.split( /\s+/ ) ) {

		const prueba = actual ? `${ actual } ${ w }` : w;
		if ( D.ancho( prueba, o ) > ancho && actual ) {

			out.push( actual );
			actual = w;

		} else actual = prueba;

	}

	if ( actual ) out.push( actual );
	return out;

}

/** Mobiliario y equipamiento con el grafismo habitual de planta. */
function dibujarEquipo( D: Dibujo, e: Equipamiento, T: ( x: number, y: number ) => P2, s: number ) {

	const { W, D: F, L } = marcoLocal( e );
	const col = e.fijo ? COLORES.muebleFijo : COLORES.mueble;
	const g = e.fijo ? 0.2 : 0.16;
	const Q = ( a: number, b: number ) => T( ...L( a, b ) );
	const caja = ( x0: number, z0: number, x1: number, z1: number, relleno: string | null = '#ffffff', gr = g ) => D.pol( [ Q( x0, z0 ), Q( x1, z0 ), Q( x1, z1 ), Q( x0, z1 ) ], relleno, col, gr );
	const elipse = ( cx: number, cz: number, rx: number, rz: number ) => {

		const pts: P2[] = [];
		for ( let i = 0; i < 28; i ++ ) {

			const a = ( i / 28 ) * Math.PI * 2;
			pts.push( Q( cx + rx * Math.cos( a ), cz + rz * Math.sin( a ) ) );

		}

		D.pol( pts, '#ffffff', col, g );

	};

	const x0 = - W / 2, x1 = W / 2, z0 = - F / 2, z1 = F / 2;
	switch ( e.tipo ) {

		case 'cama': {

			caja( x0, z0, x1, z1 );
			caja( x0, z0, x1, z0 + 0.08, '#f4f2ee' ); // cabecero
			const doble = W > 1.2;
			const n = doble ? 2 : 1, aw = doble ? ( W - 0.24 ) / 2 : W - 0.3;
			for ( let i = 0; i < n; i ++ ) {

				const cx = doble ? ( i ? W / 4 : - W / 4 ) : 0;
				caja( cx - aw / 2, z0 + 0.14, cx + aw / 2, z0 + 0.46, '#ffffff', 0.12 );

			}

			// embozo doblado
			D.lin( [ Q( x0, z0 + 0.62 ), Q( x1, z0 + 0.62 ) ], col, 0.12 );
			D.lin( [ Q( x0, z0 + 0.72 ), Q( x1, z0 + 0.72 ) ], col, 0.1 );
			break;

		}

		case 'sofa': {

			caja( x0, z0, x1, z1 );
			caja( x0 + 0.15, z0, x1 - 0.15, z0 + 0.2, null, 0.12 );
			D.lin( [ Q( x0 + 0.15, z0 ), Q( x0 + 0.15, z1 ) ], col, 0.12 );
			D.lin( [ Q( x1 - 0.15, z0 ), Q( x1 - 0.15, z1 ) ], col, 0.12 );
			const util = W - 0.3, nA = Math.max( 1, Math.round( util / 0.75 ) );
			for ( let i = 1; i < nA; i ++ ) D.lin( [ Q( x0 + 0.15 + i * util / nA, z0 + 0.2 ), Q( x0 + 0.15 + i * util / nA, z1 ) ], col, 0.1 );
			break;

		}

		case 'mesa-auxiliar': {

			const [ cx, cy ] = Q( 0, 0 );
			D.circ( cx, cy, Math.min( W, F ) / 2 * s * 0.95, '#ffffff', col, g );
			break;

		}

		case 'silla':
			caja( x0 + 0.02, z0 + 0.03, x1 - 0.02, z1 );
			D.lin( [ Q( x0 + 0.04, z0 + 0.1 ), Q( x1 - 0.04, z0 + 0.1 ) ], col, 0.12 );
			break;

		case 'armario': {

			caja( x0, z0, x1, z1, '#ffffff' );
			D.lin( [ Q( x0, z1 - 0.03 ), Q( x1, z1 - 0.03 ) ], col, 0.12 );
			D.lin( [ Q( x0, z0 ), Q( x1, z1 - 0.03 ) ], col, 0.1, [ 1, 0.8 ] );
			break;

		}

		case 'encimera': {

			caja( x0, z0, x1, z1 );
			// fregadero y placa en sus tramos (en coordenadas de planta)
			const [ ex0, ey0, ex1, ey1 ] = e.rect;
			const lateral = e.frente === 'e' || e.frente === 'o';
			const tramo = ( r: [ number, number ], dibujar: ( a: number, b: number, c0: number, c1: number ) => void ) => lateral ? dibujar( r[ 0 ], r[ 1 ], ex0, ex1 ) : dibujar( r[ 0 ], r[ 1 ], ey0, ey1 );
			if ( e.fregadero ) tramo( e.fregadero, ( a, b, c0, c1 ) => {

				const m = 0.08, pts: [ number, number ][] = lateral
					? [ [ c0 + m, a + m ], [ c1 - m, a + m ], [ c1 - m, b - m ], [ c0 + m, b - m ] ]
					: [ [ a + m, c0 + m ], [ b - m, c0 + m ], [ b - m, c1 - m ], [ a + m, c1 - m ] ];
				D.pol( pts.map( ( [ x, y ] ) => T( x, y ) ), '#ffffff', col, 0.14 );

			} );
			if ( e.placa ) tramo( e.placa, ( a, b, c0, c1 ) => {

				const cc = ( c0 + c1 ) / 2, paso = ( b - a ) / 4;
				for ( const [ du, dc, r ] of [ [ 1, - 0.13, 0.1 ], [ 3, - 0.13, 0.08 ], [ 1, 0.13, 0.08 ], [ 3, 0.13, 0.1 ] ] ) {

					const [ px, py ] = lateral ? T( cc + dc, a + du * paso ) : T( a + du * paso, cc + dc );
					D.circ( px, py, r * s, null, col, 0.12 );

				}

			} );
			break;

		}

		case 'columna-frigorifico':
		case 'columna-hornos':
			caja( x0, z0, x1, z1 );
			D.lin( [ Q( x0, z0 ), Q( x1, z1 ) ], col, 0.1 );
			D.lin( [ Q( x1, z0 ), Q( x0, z1 ) ], col, 0.1 );
			break;

		case 'banera':
			caja( x0, z0, x1, z1 );
			caja( x0 + 0.07, z0 + 0.07, x1 - 0.07, z1 - 0.07, null, 0.12 );
			break;

		case 'ducha':
			caja( x0, z0, x1, z1 );
			D.lin( [ Q( x0, z0 ), Q( x1, z1 ) ], col, 0.1 );
			D.lin( [ Q( x1, z0 ), Q( x0, z1 ) ], col, 0.1 );
			break;

		case 'inodoro':
			caja( - 0.19, z0, 0.19, z0 + 0.17 );
			elipse( 0, z0 + 0.17 + ( F - 0.19 ) / 2, 0.17, ( F - 0.19 ) / 2 );
			break;

		case 'lavabo':
		case 'lavabo-doble': {

			caja( x0, z0, x1, z1 );
			const n = e.tipo === 'lavabo-doble' ? 2 : 1;
			for ( let i = 0; i < n; i ++ ) elipse( n === 2 ? ( i ? W / 4 : - W / 4 ) : 0, 0.02, 0.17, Math.min( 0.14, F / 2 - 0.06 ) );
			break;

		}

		case 'lavadora': {

			caja( x0 + 0.01, z0, x1 - 0.01, z1 );
			const [ cx, cy ] = Q( 0, 0.03 );
			D.circ( cx, cy, 0.18 * s, null, col, 0.12 );
			break;

		}

		case 'escalera': {

			// peldaños y flecha de subida (hacia el frente)
			caja( x0, z0, x1, z1, '#ffffff' );
			const n = Math.max( 2, Math.round( ( e.sube ?? 2.9 ) / 0.175 ) );
			for ( let k = 1; k < n; k ++ ) D.lin( [ Q( x0, z0 + k * F / n ), Q( x1, z0 + k * F / n ) ], col, 0.12 );
			D.lin( [ Q( 0, z0 + 0.15 ), Q( 0, z1 - 0.12 ) ], COLORES.tinta, 0.25 );
			D.pol( [ Q( - 0.1, z1 - 0.3 ), Q( 0.1, z1 - 0.3 ), Q( 0, z1 - 0.1 ) ], COLORES.tinta );
			break;

		}

		case 'plaza': {

			// plaza de aparcamiento: sus líneas y un coche orientativo (entra por el frente)
			D.lin( [ Q( x0, z1 ), Q( x0, z0 ), Q( x1, z0 ), Q( x1, z1 ) ], COLORES.gris, 0.18, [ 1.4, 1 ] );
			const cw = Math.min( 1.8, W - 0.5 ) / 2, cl = Math.min( 4.4, F - 0.5 ), c0 = z0 + ( F - cl ) / 2, c1 = c0 + cl;
			caja( - cw, c0, cw, c1, '#ffffff', 0.15 );
			caja( - cw + 0.12, c0 + cl * 0.3, cw - 0.12, c0 + cl * 0.72, null, 0.12 ); // habitáculo
			D.lin( [ Q( - cw + 0.12, c0 + cl * 0.62 ), Q( cw - 0.12, c0 + cl * 0.62 ) ], col, 0.12 );
			break;

		}

		case 'barandilla':
			D.lin( [ Q( x0, - 0.02 ), Q( x1, - 0.02 ) ], COLORES.tinta, 0.18 );
			D.lin( [ Q( x0, 0.02 ), Q( x1, 0.02 ) ], COLORES.tinta, 0.18 );
			break;

		default:
			caja( x0, z0, x1, z1 );

	}

}

// ------------------------------------------------------------ exportación

async function recursos( d: DatosPlano ) {

	const promotora = await svgPNG( d.promocion.marca.logoSvg, 240 );
	const promocion = d.promocion.promocion.logoSvg ? await svgPNG( d.promocion.promocion.logoSvg, 240 ) : null;
	await Promise.all( [ promotora.url, promocion?.url ].filter( ( u ): u is string => !! u ).map( cargarImagen ) );
	return { promotora, promocion };

}

/** Páginas del plano: una por planta (con una sola planta, la vivienda tal cual). */
function paginas( d: DatosPlano ): DatosPlano[] {

	if ( ! esMultiplanta( d.vivienda ) ) return [ d ];
	const utilTotal = d.vivienda.estancias.filter( esUtil ).reduce( ( a, e ) => a + e.superficie, 0 );
	const ps = plantasDe( d.vivienda );
	return ps.map( ( p, i ) => ( { ...d, vivienda: dePlanta( d.vivienda, i ), planta: { nombre: p.nombre, utilTotal } } ) );

}

export async function planoPDF( d: DatosPlano ): Promise<Blob> {

	const doc = new jsPDF( { unit: 'mm', format: 'a3', orientation: 'landscape', compress: true } );
	const logos = await recursos( d );
	// una página por planta (dúplex, unifamiliares)
	paginas( d ).forEach( ( pagina, i ) => {

		if ( i ) doc.addPage( 'a3', 'landscape' );
		componer( dibujoPDF( doc ), pagina, logos );

	} );
	doc.setProperties( { title: `Plano comercial · ${ d.tipologia.nombre } · ${ d.promocion.promocion.nombre }`, author: d.promocion.marca.promotora, creator: d.promocion.marca.promotora } );
	return doc.output( 'blob' );

}

export async function planoPNG( d: DatosPlano, ppp = 300 ): Promise<Blob> {

	const k = ppp / 25.4;
	const c = document.createElement( 'canvas' );
	c.width = Math.round( HOJA.ancho * k );
	// varias plantas: una hoja debajo de otra en la misma imagen
	const ps = paginas( d );
	c.height = Math.round( HOJA.alto * k ) * ps.length;
	const ctx = c.getContext( '2d' )!;
	const logos = await recursos( d );
	ps.forEach( ( pagina, i ) => {

		ctx.save();
		ctx.translate( 0, i * Math.round( HOJA.alto * k ) );
		componer( dibujoCanvas( ctx, k ), pagina, logos );
		ctx.restore();

	} );
	return new Promise( ( ok, mal ) => c.toBlob( ( b ) => ( b ? ok( b ) : mal( new Error( 'No se pudo generar la imagen' ) ) ), 'image/png' ) );

}
