// Puertas, ventanas, balconeras y barandilla, generadas a partir de los huecos del JSON.

import * as THREE from 'three/webgpu';
import type { Hueco, Vivienda } from '../modelo/tipos';
import { caja, unir } from '../util/geo';
import { alturaHueco } from './muros';
import { alturasHueco, esCarpinteriaExterior, hojasDe, ladoInterior } from '../modelo/huecos';
import { barandillasDe } from '../modelo/exteriores';
import * as M from './materiales';
import { ACABADOS, ACABADOS_DEFECTO, colorLiso } from '../promocion/acabados';

// puertas totalmente abiertas (contra el muro): no tapan la estancia en las vistas comerciales
export const ANGULO_PUERTA = THREE.MathUtils.degToRad( 89.5 );

let MAT: ReturnType<typeof materiales> | null = null;
function materiales() {

	// hoja lacada con pantografiado horizontal (patrón supuesto: 4 ranuras)
	const P = ACABADOS.puertas;
	const hoja = P.color === ACABADOS_DEFECTO.puertas.color && P.ranuras === 4
		? M.puertaRanurada( '#f2f0eb', '#d9d6cf' )
		: M.puertaRanurada( P.color, M.oscurecer( P.color, 0.88 ), P.ranuras > 0 ? 1.68 / P.ranuras : 100 );
	return {
		hoja,
		lacado: M.lacado( P.color, 0.42 ),
		cromo: M.metalico( '#c4c6c7', 0.32 ),
		aluminio: M.liso( ACABADOS.carpinteria_exterior.color, 0.34, 0.8 ),
		vidrio: M.vidrio(),
		sate: M.sate( colorLiso(), false ),
		seccional: M.lacado( '#d6d3cd', 0.5 ),
	};

}

/** Convierte cajas en coordenadas locales de planta (lx, ly, z) a geometría de mundo local. */
const cajaLocal = ( x0: number, y0: number, x1: number, y1: number, z0: number, z1: number ) =>
	caja( Math.min( x0, x1 ), Math.min( y0, y1 ), Math.max( x0, x1 ), Math.max( y0, y1 ), z0, z1 );

function puerta( h: Hueco, v: Vivienda, m: NonNullable<typeof MAT> ) {

	const muro = v.muros.find( ( w ) => w.id === h.muro )!;
	const [ x0, y0, x1, y1 ] = muro.rect;
	const enX = h.eje === 'x';
	const hd = alturaHueco( h, v );
	const [ c0, c1 ] = enX ? [ y0, y1 ] : [ x0, x1 ]; // banda del espesor del muro
	const a = h.desde, b = h.hasta;
	const g = new THREE.Group();
	g.name = h.id;

	// en un sistema (u = a lo largo del muro, w = a través), luego se mapea a planta
	const P = ( u0: number, w0: number, u1: number, w1: number, z0: number, z1: number ) =>
		enX ? cajaLocal( u0, w0, u1, w1, z0, z1 ) : cajaLocal( w0, u0, w1, u1, z0, z1 );

	// cerco (forra el hueco) y tapajuntas a ambas caras
	const e = 0.02, tj = 0.07, tjg = 0.012;
	const marco = unir( [
		P( a, c0 - 0.005, a + e, c1 + 0.005, 0, hd ),
		P( b - e, c0 - 0.005, b, c1 + 0.005, 0, hd ),
		P( a, c0 - 0.005, b, c1 + 0.005, hd - e, hd ),
		...[ c0 - tjg, c1 ].map( ( w ) => unir( [
			P( a - tj, w, a, w + tjg, 0, hd + tj ),
			P( b, w, b + tj, w + tjg, 0, hd + tj ),
			P( a - tj, w, b + tj, w + tjg, hd, hd + tj ),
		] ) ),
	] );
	const mMarco = new THREE.Mesh( marco!, m.lacado );
	mMarco.castShadow = mMarco.receiveShadow = true;
	g.add( mMarco );

	const esp = h.tipo === 'entrada' ? 0.07 : 0.04;
	const altoHoja = hd - e - 0.008;
	const abrePositivo = h.abre === 'n' || h.abre === 'e';
	const tipoHoja = h.tipo === 'entrada' ? 'abatible' : h.puerta ?? 'abatible';

	// corredera escondida en el tabique: abierta, la hoja no se ve
	if ( tipoHoja === 'corredera-empotrada' ) return g;

	// corredera vista: la hoja corre por la cara hacia la que «abre», junto al hueco
	if ( tipoHoja === 'corredera' ) {

		const ancho = b - a + 0.06;
		const wc = abrePositivo ? c1 + 0.03 : c0 - 0.03;
		const lado = h.bisagra === 'inicio' ? - 1 : 1; // se aparta hacia el lado contrario a la «bisagra»
		const u0 = lado > 0 ? b - 0.05 : a + 0.05 - ancho;
		const hojaC = new THREE.Mesh( P( u0, wc - esp / 2, u0 + ancho, wc + esp / 2, 0.01, altoHoja ), m.hoja );
		hojaC.castShadow = hojaC.receiveShadow = true;
		const guia = new THREE.Mesh( P( Math.min( a, u0 ) - 0.05, wc - 0.03, Math.max( b, u0 + ancho ) + 0.05, wc + 0.03, altoHoja + 0.01, altoHoja + 0.05 ), m.cromo );
		g.add( hojaC, guia );
		return g;

	}

	// abatible (una hoja) o doble (dos hojas, una en cada jamba)
	const hojas: [ 'inicio' | 'fin', number ][] = tipoHoja === 'doble'
		? [ [ 'inicio', ( b - a - 2 * e - 0.009 ) / 2 ], [ 'fin', ( b - a - 2 * e - 0.009 ) / 2 ] ]
		: [ [ h.bisagra ?? 'inicio', b - a - 2 * e - 0.006 ] ];
	for ( const [ bisagra, anchoHoja ] of hojas ) {

		const s = bisagra === 'inicio' ? 1 : - 1;
		const uPivote = bisagra === 'inicio' ? a + e + 0.003 : b - e - 0.003;
		const wPivote = abrePositivo ? c1 - 0.004 : c0 + 0.004;
		const signoW = abrePositivo ? - 1 : 1; // la hoja cerrada queda dentro del muro

		const pivote = new THREE.Group();
		const hojaGeo = P( 0, 0, s * anchoHoja, signoW * esp, 0.004, altoHoja );
		const hoja = new THREE.Mesh( hojaGeo, m.hoja );
		hoja.castShadow = hoja.receiveShadow = true;
		pivote.add( hoja );

		// manillas (roseta + palanca) en ambas caras, cerca del canto libre
		const uMan = s * ( anchoHoja - 0.065 );
		const piezasManilla: THREE.BufferGeometry[] = [];
		for ( const ladoM of [ - 1, 1 ] ) {

			const wCara = ladoM === signoW ? signoW * esp : 0;
			const hacia = ladoM === signoW ? signoW : - signoW;
			const ros = new THREE.CylinderGeometry( 0.026, 0.026, 0.01, 24 );
			ros.rotateX( Math.PI / 2 );
			if ( ! enX ) ros.rotateY( Math.PI / 2 );
			const rp = enX ? [ uMan, 1.05, - ( wCara + hacia * 0.005 ) ] : [ wCara + hacia * 0.005, 1.05, - uMan ];
			ros.translate( rp[ 0 ], rp[ 1 ], rp[ 2 ] );
			piezasManilla.push( ros );
			const w0 = wCara + hacia * 0.01, w1 = wCara + hacia * 0.058;
			piezasManilla.push( P( uMan - 0.009, w0, uMan + 0.009, w1, 1.041, 1.059 ) );
			piezasManilla.push( P( uMan - s * 0.13, w1 - hacia * 0.018, uMan + s * 0.009, w1, 1.041, 1.059 ) );

		}

		const manillas = new THREE.Mesh( unir( piezasManilla )!, m.cromo );
		manillas.castShadow = true;
		pivote.add( manillas );

		// las puertas interiores se muestran abiertas; la de entrada, cerrada
		const giro = h.tipo === 'entrada' ? 0 : ANGULO_PUERTA;
		pivote.rotation.y = enX ? giro * s * ( abrePositivo ? 1 : - 1 ) : giro * - s * ( abrePositivo ? 1 : - 1 );
		pivote.position.copy( enX ? new THREE.Vector3( uPivote, 0, - wPivote ) : new THREE.Vector3( wPivote, 0, - uPivote ) );
		g.add( pivote );

	}
	return g;

}

/**
 * Ventana o balconera en cualquier fachada: cerco, hojas según su apertura,
 * vidrio, alféizar (ventanas) y guías de la persiana por fuera (si la lleva).
 */
function carpinteriaExterior( h: Hueco, v: Vivienda, m: NonNullable<typeof MAT> ) {

	const muro = v.muros.find( ( w ) => w.id === h.muro )!;
	const [ x0, y0, x1, y1 ] = muro.rect;
	const enX = h.eje === 'x';
	const [ c0, c1 ] = enX ? [ y0, y1 ] : [ x0, x1 ];
	const lado = ladoInterior( h, v );
	const caraInt = lado > 0 ? c1 : c0, caraExt = lado > 0 ? c0 : c1;
	const wF = caraInt - lado * 0.09; // plano de la carpintería, en el tercio interior del muro
	const [ z0, z1 ] = alturasHueco( h, v );
	const P = ( u0: number, w0: number, u1: number, w1: number, za: number, zb: number ) =>
		enX ? cajaLocal( u0, w0, u1, w1, za, zb ) : cajaLocal( w0, u0, w1, u1, za, zb );
	const a = h.desde, b = h.hasta;
	const g = new THREE.Group();
	g.name = h.id;
	const perfil = 0.055, fondo = 0.07;
	const alu: THREE.BufferGeometry[] = [];
	const vid: THREE.BufferGeometry[] = [];
	const crom: THREE.BufferGeometry[] = [];

	// cerco perimetral y umbral (balconera) o marco inferior (ventana)
	alu.push( P( a, wF - fondo / 2, a + perfil, wF + fondo / 2, z0, z1 ) );
	alu.push( P( b - perfil, wF - fondo / 2, b, wF + fondo / 2, z0, z1 ) );
	alu.push( P( a, wF - fondo / 2, b, wF + fondo / 2, z1 - perfil, z1 ) );
	alu.push( P( a, wF - fondo / 2 - 0.02, b, wF + fondo / 2, z0, z0 + 0.018 ) );
	const sill: THREE.BufferGeometry[] = [];
	if ( h.tipo === 'ventana' ) {

		// alféizar interior y vierteaguas exterior
		sill.push( P( a - 0.03, caraInt - lado * 0.005, b + 0.03, caraInt + lado * 0.04, z0 - 0.03, z0 ) );
		alu.push( P( a, caraExt - lado * 0.04, b, caraExt + lado * 0.03, z0 - 0.02, z0 ) );

	}

	const zi = z0 + 0.018, zs = z1 - perfil;
	const hoja = ( u0: number, u1: number, wc: number, prof: number ) => {

		const p = 0.07;
		alu.push( P( u0, wc - prof / 2, u0 + p, wc + prof / 2, zi, zs ) );
		alu.push( P( u1 - p, wc - prof / 2, u1, wc + prof / 2, zi, zs ) );
		alu.push( P( u0, wc - prof / 2, u1, wc + prof / 2, zi, zi + ( h.tipo === 'balconera' ? 0.09 : p ) ) );
		alu.push( P( u0, wc - prof / 2, u1, wc + prof / 2, zs - p, zs ) );
		vid.push( P( u0 + p, wc - 0.008, u1 - p, wc + 0.008, zi + ( h.tipo === 'balconera' ? 0.09 : p ), zs - p ) );

	};
	const manilla = ( u: number, z: number, horizontal = false ) => crom.push( horizontal
		? P( u - 0.08, wF + lado * 0.03, u + 0.08, wF + lado * 0.055, z, z + 0.02 )
		: P( u - 0.01, wF + lado * 0.03, u + 0.01, wF + lado * 0.055, z, z + 0.16 ) );

	const ui = a + perfil, ue = b - perfil, n = hojasDe( h );
	const ap = h.apertura ?? 'oscilobatiente';
	const zMan = Math.min( z0 + 1.0, ( z0 + z1 ) / 2 );
	if ( ap === 'fija' ) {

		vid.push( P( ui, wF - 0.008, ue, wF + 0.008, zi, zs ) );

	} else if ( ap === 'corredera' ) {

		const paso = ( ue - ui ) / n;
		for ( let i = 0; i < n; i ++ ) {

			const s0 = ui + i * paso - ( i ? 0.04 : 0 ), s1 = ui + ( i + 1 ) * paso + ( i < n - 1 ? 0.04 : 0 );
			hoja( s0, s1, wF + ( i % 2 ? - 0.018 : 0.018 ), 0.032 );

		}
		manilla( ui + paso - 0.06, zMan );

	} else {

		const paso = ( ue - ui ) / n;
		for ( let i = 0; i < n; i ++ ) hoja( ui + i * paso, ui + ( i + 1 ) * paso, wF, 0.06 );
		if ( ap === 'proyectante' ) manilla( ( ui + ue ) / 2, zi + 0.02, true );
		else manilla( n === 1 ? ue - 0.09 : ui + paso + 0.03, zMan );

	}

	// guías y cajón de la persiana, por fuera
	if ( h.persiana !== false ) {

		const g0 = caraExt + lado * 0.005, g1 = caraExt + lado * 0.06;
		alu.push( P( a, g0, a + 0.035, g1, z0, z1 ) );
		alu.push( P( b - 0.035, g0, b, g1, z0, z1 ) );
		alu.push( P( a, g0, b, g1, z1 - 0.03, z1 ) );

	}

	const mAlu = new THREE.Mesh( unir( alu )!, m.aluminio );
	mAlu.castShadow = mAlu.receiveShadow = true;
	g.add( mAlu );
	const mVid = new THREE.Mesh( unir( vid )!, m.vidrio );
	mVid.renderOrder = 2;
	g.add( mVid );
	if ( crom.length ) g.add( new THREE.Mesh( unir( crom )!, m.cromo ) );
	if ( sill.length ) {

		const mSill = new THREE.Mesh( unir( sill )!, m.lacado );
		mSill.castShadow = mSill.receiveShadow = true;
		g.add( mSill );

	}
	g.userData.ancho = b - a;
	return g;

}

/** Puerta de garaje seccional: paneles horizontales en la cara exterior, con su cerco. */
function puertaGaraje( h: Hueco, v: Vivienda, m: NonNullable<typeof MAT> ) {

	const [ x0, y0, x1, y1 ] = v.muros.find( ( w ) => w.id === h.muro )!.rect;
	const enX = h.eje === 'x';
	const [ c0, c1 ] = enX ? [ y0, y1 ] : [ x0, x1 ];
	const lado = ladoInterior( h, v );
	const hd = alturaHueco( h, v );
	const a = h.desde, b = h.hasta;
	const P = ( u0: number, w0: number, u1: number, w1: number, z0: number, z1: number ) =>
		enX ? cajaLocal( u0, w0, u1, w1, z0, z1 ) : cajaLocal( w0, u0, w1, u1, z0, z1 );
	const g = new THREE.Group();
	g.name = h.id;
	// la hoja, un poco metida respecto a la fachada
	const wE = ( lado > 0 ? c0 : c1 ) + lado * 0.06, gr = 0.04;
	const n = Math.max( 3, Math.round( hd / 0.55 ) ), alto = hd / n;
	const paneles = [];
	for ( let i = 0; i < n; i ++ ) paneles.push( P( a, wE, b, wE + lado * gr, i * alto + ( i ? 0.006 : 0 ), ( i + 1 ) * alto ) );
	const mPan = new THREE.Mesh( unir( paneles )!, m.seccional );
	mPan.castShadow = mPan.receiveShadow = true;
	const cerco = unir( [ P( a, wE - lado * 0.01, a + 0.03, wE + lado * 0.05, 0, hd ), P( b - 0.03, wE - lado * 0.01, b, wE + lado * 0.05, 0, hd ), P( a, wE - lado * 0.01, b, wE + lado * 0.05, hd - 0.03, hd ) ] );
	g.add( mPan, new THREE.Mesh( cerco!, m.aluminio ) );
	g.userData.ancho = b - a;
	return g;

}

/**
 * Barandillas de terrazas y balcones, cada una con su tipo: vidrio con
 * perfilería (por defecto), barrotes metálicos, peto de obra o peto bajo con
 * vidrio encima.
 */
function barandillas( v: Vivienda, m: NonNullable<typeof MAT> ) {

	const g = new THREE.Group();
	g.name = 'barandilla';
	const base: THREE.BufferGeometry[] = [], alu: THREE.BufferGeometry[] = [], vid: THREE.BufferGeometry[] = [], obra: THREE.BufferGeometry[] = [], albardilla: THREE.BufferGeometry[] = [];

	for ( const b of barandillasDe( v ) ) {

		const { recorrido, postes_x } = b;
		const modelo = b.modelo ?? 'vidrio';
		const alto = b.alto ?? v.alturas.barandilla.valor;
		const zb = 0.08; // peto de apoyo
		const zp = modelo === 'peto' ? alto : modelo === 'peto-vidrio' ? Math.min( 0.5, alto - 0.3 ) : 0; // altura del peto de obra

		for ( let i = 0; i < recorrido.length - 1; i ++ ) {

			const [ ax, ay ] = recorrido[ i ], [ bx, by ] = recorrido[ i + 1 ];
			const enX = Math.abs( bx - ax ) > Math.abs( by - ay );
			const L = ( lo: number, hi: number, grosor: number, z0: number, z1: number ) => enX
				? caja( Math.min( ax, bx ) + lo, ay - grosor / 2, Math.max( ax, bx ) + hi, ay + grosor / 2, z0, z1 )
				: caja( ax - grosor / 2, Math.min( ay, by ) + lo, ax + grosor / 2, Math.max( ay, by ) + hi, z0, z1 );
			const largo = enX ? Math.abs( bx - ax ) : Math.abs( by - ay );
			const enTramo = ( t: number, grosor: number, z0: number, z1: number ) => {

				const p0 = enX ? Math.min( ax, bx ) + t : Math.min( ay, by ) + t;
				return enX ? caja( p0 - grosor / 2, ay - grosor / 2, p0 + grosor / 2, ay + grosor / 2, z0, z1 ) : caja( ax - grosor / 2, p0 - grosor / 2, ax + grosor / 2, p0 + grosor / 2, z0, z1 );

			};

			if ( zp > 0 ) {

				// peto de obra con su albardilla
				obra.push( L( - 0.075, 0.075, 0.15, - 0.02, zp - 0.03 ) );
				albardilla.push( L( - 0.09, 0.09, 0.19, zp - 0.03, zp + 0.01 ) );
				if ( modelo === 'peto' ) continue;

			} else base.push( L( - 0.1, 0.1, 0.2, - 0.02, zb ) );

			const z0 = zp > 0 ? zp + 0.01 : zb;
			alu.push( L( - 0.02, 0.02, 0.05, z0, z0 + 0.06 ) );
			alu.push( L( - 0.02, 0.02, 0.05, alto - 0.03, alto ) );
			if ( modelo === 'barrotes' ) {

				// barrotes cada 11 cm (hueco libre menor de 10 cm)
				const n = Math.max( 1, Math.round( largo / 0.11 ) );
				for ( let k = 1; k < n; k ++ ) alu.push( enTramo( k * largo / n, 0.016, z0 + 0.06, alto - 0.03 ) );

			} else vid.push( L( 0, 0, 0.012, z0 + 0.06, alto - 0.02 ) );

			// postes: los del plano en los tramos a lo largo de x; si no, en esquinas y repartidos
			const reparto = () => {

				const n = Math.max( 2, Math.round( largo / 1.3 ) );
				return [ 0.02, ...Array.from( { length: n - 1 }, ( _, k ) => ( k + 1 ) * largo / n ), largo - 0.02 ];

			};
			const posiciones = enX && postes_x ? postes_x.map( ( x ) => x - Math.min( ax, bx ) ) : b.id === 'barandilla' && ! enX ? [ 0.02, largo / 2, largo - 0.02 ] : reparto();
			for ( const t of posiciones ) alu.push( enTramo( t, 0.04, z0, alto ) );

		}

	}

	const malla = ( geos: THREE.BufferGeometry[], mat: THREE.Material, sombras = true ) => {

		if ( ! geos.length ) return;
		const mm = new THREE.Mesh( unir( geos )!, mat );
		mm.castShadow = mm.receiveShadow = sombras;
		if ( mat === m.vidrio ) mm.renderOrder = 2;
		g.add( mm );

	};
	malla( base, m.sate );
	malla( alu, m.aluminio );
	malla( vid, m.vidrio, false );
	malla( obra, m.sate );
	malla( albardilla, m.lacado );
	return g;

}

export function construirCarpinterias( v: Vivienda ) {

	MAT ??= materiales();
	const g = new THREE.Group();
	g.name = 'carpinterias';
	for ( const h of v.huecos ) {

		if ( h.tipo === 'paso' ) continue; // hueco sin puerta: solo el corte del muro
		g.add( esCarpinteriaExterior( h ) ? carpinteriaExterior( h, v, MAT ) : h.tipo === 'garaje' ? puertaGaraje( h, v, MAT ) : puerta( h, v, MAT ) );

	}
	const baranda = barandillas( v, MAT );
	return { carpinterias: g, barandilla: baranda };

}
