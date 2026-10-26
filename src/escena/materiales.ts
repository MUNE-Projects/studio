// Materiales procedurales (TSL). Ninguna textura externa: los patrones se
// calculan en el shader a partir de un ruido pre-generado al cargar.
//
// Cada superficie comparte el mismo mecanismo de estados:
//   uPlano    1 = gráfico plano de planta (sin luz), 0 = iluminado
//   uAcabado  0 = maqueta blanca, 1 = acabado real (barrido oeste -> este)
//   uMuros    altura de los muros (barrido oeste -> este)
//   uMasa     altura de los volúmenes de estancias

import * as THREE from 'three/webgpu';
import {
	Fn, If, abs, attribute, bumpMap, clamp, float, floor, fract, hash, max, mix, normalWorld, normalWorldGeometry, positionLocal,
	positionWorld, sin, smoothstep, step, struct, texture, uniform, vec2, vec3,
} from 'three/tsl';

type N = any; // nodos TSL: el tipado de @types/three para TSL es demasiado estricto para componer libremente

// ------------------------------------------------------------ ruido pre-generado
//
// El ruido (vetas, grano, nubes de pintura, motas) se lee de una textura
// pequeña generada al cargar, en vez de calcularse dentro de cada shader: las
// funciones de ruido de MaterialX multiplicaban el tamaño de cada shader y el
// tiempo de compilación de la primera carga. Visualmente es equivalente.
//   R: ruido de valor (8 celdas por tesela)      → ruido()
//   G: ruido fractal de 3 octavas (4 celdas)     → ruidoFractal()
//   B: valor aleatorio por celda (32 celdas)     → ruidoCelda()
//   A: segundo ruido de valor, independiente     → descorrelación de la 3.ª coordenada

const TAM_RUIDO = 256;
const texturaRuido = ( () => {

	const azar = ( n: number ) => {

		const t = Math.sin( n * 127.1 + 311.7 ) * 43758.5453;
		return t - Math.floor( t );

	};
	const red = ( celdas: number, semilla: number ) => {

		const v = new Float32Array( celdas * celdas );
		for ( let i = 0; i < v.length; i ++ ) v[ i ] = azar( i * 1.37 + semilla * 91.3 );
		return v;

	};
	const suave = ( t: number ) => t * t * ( 3 - 2 * t );
	// ruido de valor periódico (tesela sin costuras)
	const valorEn = ( v: Float32Array, celdas: number, x: number, y: number ) => {

		const fx = x * celdas / TAM_RUIDO, fy = y * celdas / TAM_RUIDO;
		const x0 = Math.floor( fx ), y0 = Math.floor( fy );
		const tx = suave( fx - x0 ), ty = suave( fy - y0 );
		const at = ( i: number, j: number ) => v[ ( ( j % celdas ) + celdas ) % celdas * celdas + ( ( i % celdas ) + celdas ) % celdas ];
		const a = at( x0, y0 ), b = at( x0 + 1, y0 ), c = at( x0, y0 + 1 ), d = at( x0 + 1, y0 + 1 );
		return ( a + ( b - a ) * tx ) + ( ( c + ( d - c ) * tx ) - ( a + ( b - a ) * tx ) ) * ty;

	};
	const r8 = red( 8, 1 ), f4 = red( 4, 2 ), f8 = red( 8, 3 ), f16 = red( 16, 4 ), c32 = red( 32, 5 ), a8 = red( 8, 6 );
	const datos = new Uint8Array( TAM_RUIDO * TAM_RUIDO * 4 );
	for ( let y = 0; y < TAM_RUIDO; y ++ ) for ( let x = 0; x < TAM_RUIDO; x ++ ) {

		const k = ( y * TAM_RUIDO + x ) * 4;
		const fr = ( valorEn( f4, 4, x, y ) + valorEn( f8, 8, x, y ) * 0.5 + valorEn( f16, 16, x, y ) * 0.25 ) / 1.75;
		datos[ k ] = Math.round( valorEn( r8, 8, x, y ) * 255 );
		datos[ k + 1 ] = Math.round( fr * 255 );
		datos[ k + 2 ] = Math.round( c32[ Math.floor( y * 32 / TAM_RUIDO ) * 32 + Math.floor( x * 32 / TAM_RUIDO ) ] * 255 );
		datos[ k + 3 ] = Math.round( valorEn( a8, 8, x, y ) * 255 );

	}

	const t = new THREE.DataTexture( datos, TAM_RUIDO, TAM_RUIDO, THREE.RGBAFormat, THREE.UnsignedByteType );
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.magFilter = THREE.LinearFilter;
	t.minFilter = THREE.LinearMipmapLinearFilter;
	t.generateMipmaps = true;
	t.colorSpace = THREE.NoColorSpace;
	t.needsUpdate = true;
	return t;

} )();

/** Coordenadas de lectura: la 3.ª coordenada desplaza el plano para no repetir el dibujo. */
const coordRuido = ( p: any, celdas: number ): any => vec2( p.x.add( p.z.mul( 0.371 ) ), p.y.add( p.z.mul( 0.613 ) ) ).div( celdas );
/** Ruido suave en [-1, 1] (equivalente a mx_noise_float). */
const mx_noise_float = ( p: any ): any => texture( texturaRuido, coordRuido( p, 8 ) ).r.mul( 2 ).sub( 1 );
/** Ruido fractal en [-1, 1] (equivalente a mx_fractal_noise_float; octavas y ganancia fijas). */
const mx_fractal_noise_float = ( p: any, _octavas?: number, _lacunaridad?: number, _ganancia?: number ): any => texture( texturaRuido, coordRuido( p, 4 ) ).g.mul( 2 ).sub( 1 );
/** Valor aleatorio por celda unidad en [0, 1] (equivalente a mx_cell_noise_float). */
const mx_cell_noise_float = ( p: any ): any => texture( texturaRuido, coordRuido( p, 32 ) ).b;


// ------------------------------------------------------------ estados y opciones

export const U = {
	plano: uniform( 1 ),
	acabado: uniform( 0 ),
	muros: uniform( 0 ),
	masa: uniform( 0 ),
	altura: uniform( 2.5 ),
	anchoX: uniform( 13 ),
};

// Parámetros de acabado configurables. Cada material que depende de una opción
// comercial lee estos uniforms: cambiar una opción es cambiar valores, sin
// reconstruir geometría ni recompilar shaders. Valores iniciales = opción incluida.
const uc = ( hex: string ) => uniform( new THREE.Color( hex ) );
export const P = {
	suelo: { claro: uc( '#b38c63' ), oscuro: uc( '#8c6845' ), rugosidad: uniform( 0.5 ) },
	cocina: { claro: uc( '#efeeea' ), oscuro: uc( '#efeeea' ), veta: uniform( 0 ), rugosidad: uniform( 0.5 ) },
	encimera: { base: uc( '#ecebe7' ), mota: uc( '#b9b6b0' ), densidad: uniform( 0.04 ), nube: uniform( 0.02 ), rugosidad: uniform( 0.2 ) },
	banos: { pared: uc( '#dcd8d1' ), suelo: uc( '#d6d2cb' ) },
};

export const PALETA = {
	papel: '#f5f3ef',
	poche: '#232323',
	arcilla: '#ebe8e2',
	arcillaSombra: '#dcd8d0',
	corte: '#3a3835',
};

/** Color como uniform (para materiales especiales: vidrio, líneas…). */
export const color = ( hex: string ): N => uniform( new THREE.Color( hex ) );

// ------------------------------------------------------------ utilidades

/** Progreso de un barrido oeste->este: 0 antes de llegar el frente, 1 después. */
const barrido = ( u: N, x: N, suavidad = 0.18 ): N => {

	const xn = clamp( x.div( U.anchoX ), 0, 1 );
	return clamp( u.mul( float( 1 ).add( suavidad ) ).sub( xn ).div( suavidad ), 0, 1 );

};

/** Coordenada 2D sobre una pared alineada a los ejes: (recorrido horizontal, altura). */
const uvPared = (): N => {

	// normal geométrica (no la perturbada por el relieve: el relieve depende de este patrón)
	const n = normalWorldGeometry;
	const horizontal = mix( positionWorld.x, positionWorld.z, step( abs( n.z ), abs( n.x ) ) );
	return vec2( horizontal, positionWorld.y );

};

/** Baldosas: devuelve [junta 0..1, id aleatorio de pieza]. */
const baldosas = ( p: N, tam: N, junta: N, desfase = 0 ): [ N, N ] => {

	const q = p.div( tam );
	const fila = floor( q.y );
	const qx = q.x.add( fila.mul( desfase ) );
	const celda = vec2( floor( qx ), fila );
	const f = vec2( fract( qx ), fract( q.y ) );
	const jx = float( junta ).div( tam.x ), jy = float( junta ).div( tam.y );
	const enJunta = max(
		float( 1 ).sub( smoothstep( 0, jx, f.x ).mul( smoothstep( 0, jx, float( 1 ).sub( f.x ) ) ) ),
		float( 1 ).sub( smoothstep( 0, jy, f.y ).mul( smoothstep( 0, jy, float( 1 ).sub( f.y ) ) ) ),
	);
	const id = hash( celda.x.mul( 37.0 ).add( celda.y.mul( 113.0 ) ).add( 17.0 ) );
	return [ enJunta, id ];

};

const ruidoSuave = ( p: N, escala: number | N ): N => mx_fractal_noise_float( p.mul( escala ) );

/** Oscurece un color hexadecimal (f < 1) o lo aclara (f > 1). */
export function oscurecer( hex: string, f: number ) {

	const c = new THREE.Color( hex );
	c.r = Math.min( 1, c.r * f ); c.g = Math.min( 1, c.g * f ); c.b = Math.min( 1, c.b * f );
	return `#${ c.getHexString() }`;

}

// ------------------------------------------------------------ material único
//
// Preparar un material en el navegador (construir y compilar su shader) es lo
// que más tarda en la primera carga, y cada shader repite todo el cálculo de
// luces y sombras. Por eso todos los acabados opacos comparten UN material: el
// acabado (tarima, porcelánico, textil…) es un parámetro, y cada material solo
// aporta sus valores (colores, rugosidad, tamaño de pieza…) al dibujarse. Solo
// hay unas pocas variantes estructurales (doble cara, muros que crecen).

/** Acabados del material único. */
const A = {
	LISO: 0, PORCELANICO: 1, ALICATADO: 2, PINTURA: 3, SATE: 4, MADERA: 5, CUARZO: 6, LAMINADO: 7,
	TARIMA: 8, TEXTIL: 9, BOUCLE: 10, MARMOL: 11, HOJA: 12, LIENZO: 13, PUERTA: 14, EXTERIOR: 15,
} as const;

/** Valores que aporta cada material al dibujarse (userData.u). */
interface Valores {
	acabado: number;
	c0: THREE.Color; c1: THREE.Color; c2: THREE.Color;
	v0: number; v1: number; v2: number; v3: number;
	/** color base desde una opción comercial: 0 propio (c0), 1 suelo de baño, 2 pared de baño */
	fuente: number;
	arcilla: THREE.Color; plano: THREE.Color;
	corte: number; local: number; poche: number; emision: number; relieve: number;
}

const DEFECTO: Valores = {
	acabado: A.LISO, c0: new THREE.Color( '#cccccc' ), c1: new THREE.Color( '#888888' ), c2: new THREE.Color( '#444444' ),
	v0: 0.7, v1: 0, v2: 0, v3: 0, fuente: 0,
	arcilla: new THREE.Color( PALETA.arcilla ), plano: new THREE.Color( PALETA.papel ),
	corte: 0, local: 0, poche: 0, emision: 0, relieve: 1,
};

// uniforms por material: cada objeto los rellena con los valores de su material
const porMaterial = <K extends keyof Valores>( clave: K ): N => {

	const defecto = DEFECTO[ clave ];
	const u: N = ( uniform as N )( defecto instanceof THREE.Color ? defecto.clone() : defecto );
	return u.onObjectUpdate( ( { material }: { material?: THREE.Material | null } ) => ( material?.userData.u as Valores | undefined )?.[ clave ] ?? defecto );

};
const V = {
	acabado: porMaterial( 'acabado' ), c0: porMaterial( 'c0' ), c1: porMaterial( 'c1' ), c2: porMaterial( 'c2' ),
	v0: porMaterial( 'v0' ), v1: porMaterial( 'v1' ), v2: porMaterial( 'v2' ), v3: porMaterial( 'v3' ),
	fuente: porMaterial( 'fuente' ), arcilla: porMaterial( 'arcilla' ), plano: porMaterial( 'plano' ),
	corte: porMaterial( 'corte' ), local: porMaterial( 'local' ), poche: porMaterial( 'poche' ),
	emision: porMaterial( 'emision' ), relieve: porMaterial( 'relieve' ),
};

const Superficie = struct( { color: 'vec3', rugosidad: 'float', metal: 'float', relieve: 'float' } );

/** Variables de salida de un patrón y color base resuelto. */
interface Salida { col: N; rug: N; met: N; rel: N; c0: N }

/** Patrón de cada acabado: escribe color, rugosidad, metal y altura de relieve. */
const pw = positionWorld, pl = positionLocal;
const PATRONES: Record<number, ( o: Salida ) => void> = {
	[ A.LISO ]: ( { col, rug, met, c0 } ) => {

		col.assign( c0 );
		rug.assign( V.v0 );
		met.assign( V.v1 );


	},

	[ A.PORCELANICO ]: ( { col, rug, rel, c0 } ) => {

		// gres en baldosa: v0 tamaño, v1 junta, v2 rugosidad
		const p = vec2( pw.x, pw.z );
		const [ enJunta, pieza ] = baldosas( p, vec2( V.v0, V.v0 ), V.v1 );
		const vetas = ruidoSuave( vec3( p.x, p.y, pieza.mul( 9 ) ), 1.6 ).mul( 0.5 ).add( 0.5 );
		const grano = mx_noise_float( vec3( p.mul( 90 ), 0 ) ).mul( 0.5 ).add( 0.5 );
		const base = c0.mul( float( 0.975 ).add( pieza.mul( 0.05 ) ) ).mul( float( 0.97 ).add( vetas.mul( 0.05 ) ).add( grano.mul( 0.012 ) ) );
		col.assign( mix( base, c0.mul( 0.72 ), enJunta ) );
		rug.assign( mix( V.v2.add( vetas.mul( 0.08 ) ), float( 0.9 ), enJunta ) );
		rel.assign( enJunta.oneMinus().mul( 0.6 ) );


	},

	[ A.ALICATADO ]: ( { col, rug, rel, c0 } ) => {

		const [ enJunta, pieza ] = baldosas( uvPared(), vec2( 0.6, 0.3 ), float( 0.002 ) );
		col.assign( mix( c0.mul( float( 0.985 ).add( pieza.mul( 0.03 ) ) ), c0.mul( 0.78 ), enJunta ) );
		rug.assign( mix( float( 0.16 ), float( 0.85 ), enJunta ) );
		rel.assign( enJunta.oneMinus() );


	},

	[ A.PINTURA ]: ( { col, rug, rel, c0 } ) => {

		// pintura plástica mate: leves nubes de rodillo y grano fino que atrapan la luz rasante
		const nube = ruidoSuave( pw, 1.4 ).mul( 0.5 ).add( 0.5 );
		const grano = mx_noise_float( pw.mul( 260 ) ).mul( 0.5 ).add( 0.5 );
		col.assign( c0.mul( float( 0.985 ).add( nube.mul( 0.02 ) ).add( grano.mul( 0.006 ) ) ) );
		rug.assign( float( 0.84 ).add( nube.mul( 0.08 ) ) );
		rel.assign( grano.mul( 0.5 ).add( nube.mul( 0.2 ) ) );


	},

	[ A.SATE ]: ( { col, rug, rel, c0 } ) => {

		col.assign( c0.mul( float( 0.985 ).add( ruidoSuave( pw, 1.2 ).mul( 0.02 ) ) ) );
		rug.assign( 0.95 );
		rel.assign( mx_noise_float( pw.mul( 160 ) ).mul( 0.5 ) );


	},

	[ A.MADERA ]: ( { col, rug, rel, c0 } ) => {

		// veta a lo largo del eje x local: c0 claro, c1 oscuro, v0 rugosidad
		const deform = mx_noise_float( vec3( pl.x.mul( 0.6 ), pl.y.mul( 6 ), pl.z.mul( 6 ) ) ).mul( 0.35 );
		const anillos = fract( pl.z.mul( 18 ).add( pl.y.mul( 18 ) ).add( deform.mul( 4 ) ) );
		const veta = smoothstep( 0.0, 0.5, anillos ).mul( smoothstep( 1.0, 0.5, anillos ) );
		const fibra = mx_noise_float( vec3( pl.x.mul( 3 ), pl.y.mul( 180 ), pl.z.mul( 180 ) ) ).mul( 0.5 ).add( 0.5 );
		col.assign( mix( V.c1, c0, veta.mul( 0.55 ).add( fibra.mul( 0.45 ) ) ) );
		rug.assign( V.v0.add( fibra.mul( 0.1 ) ) );
		rel.assign( fibra.mul( 0.4 ) );


	},

	[ A.CUARZO ]: ( { col, rug } ) => {

		const e = P.encimera;
		const motas = step( float( 1 ).sub( e.densidad ), mx_cell_noise_float( pw.mul( 520 ) ) );
		const nube = ruidoSuave( pw, 5 ).mul( 0.5 ).add( 0.5 );
		const base = mix( e.base, e.mota, nube.mul( e.nube ).mul( 4 ) );
		col.assign( mix( base, e.mota, motas.mul( 0.85 ) ) );
		rug.assign( e.rugosidad );


	},

	[ A.LAMINADO ]: ( { col, rug, rel } ) => {

		// frentes de cocina: liso o con veta de madera según P.cocina (veta 0..1)
		const k = P.cocina;
		const deform = mx_noise_float( vec3( pl.x.mul( 0.6 ), pl.y.mul( 6 ), pl.z.mul( 6 ) ) ).mul( 0.35 );
		const anillos = fract( pl.y.mul( 14 ).add( pl.z.mul( 14 ) ).add( deform.mul( 4 ) ) );
		const veta = smoothstep( 0.0, 0.5, anillos ).mul( smoothstep( 1.0, 0.5, anillos ) );
		const fibra = mx_noise_float( vec3( pl.x.mul( 3 ), pl.y.mul( 160 ), pl.z.mul( 160 ) ) ).mul( 0.5 ).add( 0.5 );
		const madera = mix( k.oscuro, k.claro, veta.mul( 0.55 ).add( fibra.mul( 0.45 ) ) );
		col.assign( mix( k.claro, madera, k.veta ) );
		rug.assign( k.rugosidad );
		rel.assign( fibra.mul( k.veta ).mul( 0.4 ) );


	},

	[ A.TARIMA ]: ( { col, rug, rel } ) => {

		// lamas de 19 x 145 cm a junta trabada, según P.suelo
		const s = P.suelo;
		const p = vec2( pw.x, pw.z );
		const ancho = 0.19, largo = 1.45;
		const fila = floor( p.y.div( ancho ) );
		const u = p.x.div( largo ).add( hash( fila.mul( 7.13 ).add( 3.0 ) ) );
		const tabla = floor( u );
		const fu = fract( u ), fv = fract( p.y.div( ancho ) );
		const jx = 0.0015 / largo, jy = 0.0015 / ancho;
		const enJunta = max(
			float( 1 ).sub( smoothstep( 0, jx, fu ).mul( smoothstep( 0, jx, float( 1 ).sub( fu ) ) ) ),
			float( 1 ).sub( smoothstep( 0, jy, fv ).mul( smoothstep( 0, jy, float( 1 ).sub( fv ) ) ) ),
		);
		const lama = hash( tabla.mul( 31.7 ).add( fila.mul( 17.3 ) ).add( 5.0 ) );
		const veta = mx_noise_float( vec3( p.x.mul( 1.2 ).add( lama.mul( 40 ) ), p.y.mul( 55 ), lama.mul( 7 ) ) ).mul( 0.5 ).add( 0.5 );
		const fibra = mx_noise_float( vec3( p.x.mul( 6 ), p.y.mul( 420 ), lama.mul( 3 ) ) ).mul( 0.5 ).add( 0.5 );
		const t = clamp( lama.mul( 0.45 ).add( veta.mul( 0.4 ) ).add( fibra.mul( 0.25 ) ).sub( 0.1 ), 0, 1 );
		col.assign( mix( mix( s.oscuro, s.claro, t ), s.oscuro.mul( 0.6 ), enJunta ) );
		rug.assign( s.rugosidad.add( fibra.mul( 0.1 ) ) );
		rel.assign( enJunta.oneMinus().mul( 0.7 ).add( fibra.mul( 0.3 ) ) );


	},

	[ A.TEXTIL ]: ( { col, rug, rel, c0 } ) => {

		// trama fina (v0 escala de la trama) + irregularidad del tejido
		const p = pw.mul( V.v0.mul( 700 ) );
		const trama = sin( p.x.add( p.z ) ).mul( sin( p.y.add( p.z.mul( 0.7 ) ) ) ).mul( 0.5 ).add( 0.5 );
		const irregular = mx_noise_float( pw.mul( 40 ) ).mul( 0.5 ).add( 0.5 );
		col.assign( c0.mul( float( 0.94 ).add( irregular.mul( 0.08 ) ) ) );
		rug.assign( 0.95 );
		rel.assign( trama.mul( 0.5 ).add( irregular.mul( 0.5 ) ) );


	},

	[ A.BOUCLE ]: ( { col, rug, rel, c0 } ) => {

		const rizo = mx_cell_noise_float( pw.mul( 260 ) );
		const grano = mx_noise_float( pw.mul( 120 ) ).mul( 0.5 ).add( 0.5 );
		col.assign( c0.mul( float( 0.9 ).add( rizo.mul( 0.08 ) ).add( grano.mul( 0.06 ) ) ) );
		rug.assign( 0.97 );
		rel.assign( rizo.mul( 0.6 ).add( grano.mul( 0.4 ) ) );


	},

	[ A.MARMOL ]: ( { col, rug, c0 } ) => {

		// mármol pulido: c0 tono, c1 color de la veta
		const turb = mx_fractal_noise_float( pw.mul( 3.2 ) );
		const veta = abs( sin( pw.x.mul( 4 ).add( pw.z.mul( 2.5 ) ).add( turb.mul( 6 ) ) ) );
		const linea = float( 1 ).sub( smoothstep( 0.0, 0.08, veta ) );
		const nube = mx_noise_float( pw.mul( 1.5 ) ).mul( 0.5 ).add( 0.5 );
		col.assign( mix( c0.mul( float( 0.95 ).add( nube.mul( 0.05 ) ) ), V.c1, linea.mul( 0.7 ) ) );
		rug.assign( 0.12 );


	},

	[ A.HOJA ]: ( { col, rug, rel, c0 } ) => {

		// follaje: c0 oscuro, c1 claro, variación por hoja
		const celda = mx_cell_noise_float( pw.mul( 28 ) );
		const ruido = mx_noise_float( pw.mul( 9 ) ).mul( 0.5 ).add( 0.5 );
		col.assign( mix( c0, V.c1, celda.mul( 0.6 ).add( ruido.mul( 0.4 ) ) ) );
		rug.assign( 0.6 );
		rel.assign( celda );


	},

	[ A.LIENZO ]: ( { col, rug, rel, c0 } ) => {

		// lienzo abstracto: manchas de color con bordes pintados (no reproduce obra alguna)
		const n1 = mx_fractal_noise_float( pl.mul( 2.2 ) ).mul( 0.5 ).add( 0.5 );
		const n2 = mx_fractal_noise_float( pl.mul( 3.1 ).add( 7.3 ) ).mul( 0.5 ).add( 0.5 );
		const pincel = mx_noise_float( vec3( pl.x.mul( 60 ), pl.y.mul( 8 ), pl.z.mul( 60 ) ) ).mul( 0.04 );
		const t1 = smoothstep( 0.52, 0.56, n1.add( pincel ) ), t2 = smoothstep( 0.6, 0.64, n2.add( pincel ) );
		col.assign( mix( mix( c0, V.c1, t1 ), V.c2, t2 ) );
		rug.assign( 0.75 );
		rel.assign( pincel.mul( 10 ) );


	},

	[ A.PUERTA ]: ( { col, rug, rel, c0 } ) => {

		// hoja lacada con pantografiado horizontal (patrón supuesto: 4 ranuras)
		const y = pl.y;
		const ranura = smoothstep( 0.0035, 0.0015, abs( fract( y.div( 0.42 ) ).sub( 0.5 ) ).mul( 0.42 ) )
			.mul( smoothstep( 0.3, 0.35, y ) ).mul( smoothstep( 1.95, 1.9, y ) );
		col.assign( mix( c0, V.c1, ranura ) );
		rug.assign( 0.4 );
		rel.assign( ranura.oneMinus() );


	},

	[ A.EXTERIOR ]: ( { col, rug, rel } ) => {

		// urbanización: pavimento que se funde con el fondo; v0/v1 centro, v2 inicio del césped
		const p = vec2( pw.x, pw.z );
		const lejos = smoothstep( 14, 42, p.sub( vec2( V.v0, V.v1 ) ).length() );
		const [ enJunta ] = baldosas( p, vec2( 0.6, 0.6 ), float( 0.004 ) );
		const pav = mix( vec3( 0.769, 0.749, 0.714 ), vec3( 0.667, 0.647, 0.612 ), enJunta.mul( 0.8 ) ).mul( float( 0.97 ).add( ruidoSuave( vec3( p.x, p.y, 0 ), 0.6 ).mul( 0.05 ) ) );
		// zonas comunes: césped con un paseo de losas
		const manchas = ruidoSuave( vec3( p.x, p.y, 0 ), 0.35 ).mul( 0.5 ).add( 0.5 );
		const brizna = mx_noise_float( vec3( p.x.mul( 60 ), p.y.mul( 60 ), 0 ) ).mul( 0.5 ).add( 0.5 );
		const cesped = mix( vec3( 0.435, 0.541, 0.290 ), vec3( 0.576, 0.635, 0.384 ), manchas.mul( 0.7 ).add( brizna.mul( 0.3 ) ) );
		const zc = V.v2;
		const esCesped = smoothstep( zc, zc.add( 0.08 ), p.y );
		const paseo = smoothstep( zc.add( 2.5 ), zc.add( 2.55 ), p.y ).mul( smoothstep( zc.add( 3.75 ), zc.add( 3.7 ), p.y ) );
		const [ juntaPaseo ] = baldosas( p, vec2( 0.9, 0.45 ), float( 0.012 ), 0.5 );
		const losas = mix( vec3( 0.847, 0.816, 0.761 ), vec3( 0.663, 0.631, 0.576 ), juntaPaseo.mul( 0.9 ) );
		const verde = mix( cesped, losas, paseo );
		col.assign( mix( mix( pav, verde, esCesped ), vec3( 0.875, 0.878, 0.827 ), lejos ) );
		rug.assign( mix( float( 0.85 ), float( 0.95 ), esCesped ) );
		rel.assign( brizna.mul( esCesped ).mul( float( 1 ).sub( paseo ) ) );


	},
};

/**
 * Grupos de acabados: cada grupo es un shader. Un único shader con todos los
 * acabados era enorme y no se podía compilar en paralelo; unos pocos shaders
 * medianos se compilan a la vez en varios núcleos.
 */
const GRUPOS: number[][] = [
	[ A.LISO ],
	[ A.PORCELANICO, A.ALICATADO, A.PINTURA, A.SATE, A.TARIMA, A.EXTERIOR ],
	[ A.MADERA, A.CUARZO, A.LAMINADO, A.PUERTA ],
	[ A.TEXTIL, A.BOUCLE, A.MARMOL, A.HOJA, A.LIENZO ],
];
const grupoDe = ( acabado: number ) => GRUPOS.findIndex( ( g ) => g.includes( acabado ) );

/** Superficie de un grupo de acabados: elige el patrón según el acabado del material. */
const superficieDe = ( grupo: number[] ) => Fn( () => {

	const col = vec3( 1 ).toVar();
	const rug = float( 0.8 ).toVar();
	const met = float( 0 ).toVar();
	const rel = float( 0 ).toVar();
	// color base: propio o de una opción comercial (baños)
	// (toVar: se calcula antes de elegir el acabado; si no, quedaría dentro de la primera rama)
	const c0 = mix( mix( V.c0, P.banos.suelo, step( 0.5, V.fuente ).mul( step( V.fuente, 1.5 ) ) ), P.banos.pared, step( 1.5, V.fuente ) ).toVar();
	const salida: Salida = { col, rug, met, rel, c0 };
	if ( grupo.length === 1 ) PATRONES[ grupo[ 0 ] ]( salida );
	else {

		let cadena: N = null;
		for ( const acabado of grupo ) {

			const rama = () => PATRONES[ acabado ]( salida );
			cadena = cadena ? cadena.ElseIf( V.acabado.equal( acabado ), rama ) : If( V.acabado.equal( acabado ), rama );

		}

	}

	return Superficie( col, rug, met, rel );

} );

interface Variante { grupo: number; crece: boolean; lado: THREE.Side }
const bases = new Map<string, THREE.MeshStandardNodeMaterial>();

/** Material base de una variante estructural (se crea una sola vez). */
function base( { grupo, crece, lado }: Variante ) {

	const clave = `${ grupo }:${ crece }:${ lado }`;
	const existente = bases.get( clave );
	if ( existente ) return existente;

	const m = new THREE.MeshStandardNodeMaterial();
	const s: N = superficieDe( GRUPOS[ grupo ] )();
	const r = barrido( U.acabado, mix( positionWorld.x, positionLocal.x, V.local ) );
	let col: N = mix( V.arcilla, s.get( 'color' ), r );
	// cara superior de los muros con color de sección
	const tapa = step( 0.5, normalWorld.y ).mul( step( U.altura.sub( 0.02 ), positionWorld.y ) ).mul( V.corte );
	col = mix( col, color( PALETA.corte ), tapa.mul( r ).mul( 0.85 ) );
	m.colorNode = col.mul( float( 1 ).sub( U.plano ) );
	// en planta: papel (o poché oscuro en los muros); emisores encendidos con el acabado
	const plano = mix( V.plano.mul( 1.12 ), color( PALETA.poche ), V.poche );
	m.emissiveNode = mix( s.get( 'color' ).mul( V.emision.mul( U.acabado ) ), plano, U.plano );
	m.roughnessNode = mix( float( 0.9 ), s.get( 'rugosidad' ), r );
	m.metalnessNode = mix( float( 0 ), s.get( 'metal' ), r );
	m.normalNode = bumpMap( s.get( 'relieve' ).mul( r ), V.relieve );
	if ( crece ) {

		const xn = clamp( positionLocal.x.div( U.anchoX ), 0, 1 );
		const f = clamp( U.muros.mul( 1.35 ).sub( xn.mul( 0.35 ) ), 0.004, 1 );
		const suave = f.mul( f ).mul( float( 3 ).sub( f.mul( 2 ) ) );
		// los dinteles (piezas que no arrancan del suelo) esperan bajo el forjado
		// hasta que el muro casi ha subido, y entonces encajan en su sitio
		const enBase = attribute( 'base', 'float' );
		const oculto = enBase.mul( float( 1 ).sub( smoothstep( 0.82, 1.0, f ) ) ).mul( 3 );
		m.positionNode = vec3( positionLocal.x, positionLocal.y.mul( max( suave, 0.004 ) ).sub( oculto ), positionLocal.z );

	}

	m.side = lado;
	bases.set( clave, m );
	return m;

}

interface Parametros {
	acabado: number;
	colores?: string[];
	valores?: number[];
	fuente?: number;
	arcilla?: string;
	plano?: string;
	corte?: boolean;
	local?: boolean;
	emision?: number;
	relieve?: number;
	crece?: boolean;
	lado?: THREE.Side;
}

/**
 * Material de un acabado: copia ligera del material base de su variante, que
 * comparte con él nodos y shader y solo aporta sus valores.
 */
function universal( p: Parametros ): THREE.MeshStandardNodeMaterial {

	const b = base( { grupo: grupoDe( p.acabado ), crece: !! p.crece, lado: p.lado ?? THREE.FrontSide } );
	const m = b.clone() as THREE.MeshStandardNodeMaterial;
	const c = p.colores ?? [], v = p.valores ?? [];
	const u: Valores = {
		acabado: p.acabado,
		c0: new THREE.Color( c[ 0 ] ?? '#cccccc' ), c1: new THREE.Color( c[ 1 ] ?? '#888888' ), c2: new THREE.Color( c[ 2 ] ?? '#444444' ),
		v0: v[ 0 ] ?? 0, v1: v[ 1 ] ?? 0, v2: v[ 2 ] ?? 0, v3: v[ 3 ] ?? 0,
		fuente: p.fuente ?? 0,
		arcilla: new THREE.Color( p.arcilla ?? PALETA.arcilla ), plano: new THREE.Color( p.plano ?? PALETA.papel ),
		corte: p.corte ? 1 : 0, local: p.local ? 1 : 0, poche: 0, emision: p.emision ?? 0, relieve: p.relieve ?? 1,
	};
	m.userData.u = u;
	return m;

}

/** Fuente de color de los baños (opción comercial) en lugar de un color fijo. */
const fuenteDe = ( tono: string | N ) => ( tono === P.banos.suelo ? 1 : tono === P.banos.pared ? 2 : 0 );
const hexDe = ( tono: string | N ) => ( typeof tono === 'string' ? tono : '#cccccc' );

// ------------------------------------------------------------ acabados

/** Liso (lacados, metales, cerámica, plásticos…): color, rugosidad y metal. */
export const liso = ( tono: string, rugosidad = 0.7, metal = 0 ) =>
	universal( { acabado: A.LISO, colores: [ tono ], valores: [ rugosidad, metal ] } );

/** Gres porcelánico en baldosa grande, junta fina, leve variación entre piezas. */
export const porcelanico = ( tono: string | N, tam = 0.9, junta = 0.0025, rug = 0.32 ) =>
	universal( { acabado: A.PORCELANICO, colores: [ hexDe( tono ) ], fuente: fuenteDe( tono ), valores: [ tam, junta, rug ], relieve: 0.35 } );

/** Alicatado de paredes (baños): pieza rectangular apaisada con brillo. */
export const alicatado = ( tono: string | N, creceConMuros = false ) =>
	universal( { acabado: A.ALICATADO, colores: [ hexDe( tono ) ], fuente: fuenteDe( tono ), relieve: 0.25, crece: creceConMuros } );

/** Pintura plástica lisa con variación casi imperceptible. */
export const pintura = ( tono: string, conCorte = false, creceConMuros = false ) =>
	universal( { acabado: A.PINTURA, colores: [ tono ], relieve: 0.06, corte: conCorte, crece: creceConMuros } );

/** Fachada SATE: mortero acrílico con grano fino. */
export const sate = ( tono: string, creceConMuros = true ) =>
	universal( { acabado: A.SATE, colores: [ tono ], relieve: 0.12, corte: true, crece: creceConMuros } );

/** Madera (roble claro) con veta a lo largo del eje x local. */
export const madera = ( tono = '#b99a78', oscuro = '#94765a', rug = 0.55 ) =>
	universal( { acabado: A.MADERA, colores: [ tono, oscuro ], valores: [ rug ], relieve: 0.1 } );

/** Encimera (cuarzo, granito o piedra) según los parámetros de P.encimera. */
export const cuarzo = () => universal( { acabado: A.CUARZO } );

/** Frentes de cocina: liso o con veta de madera según P.cocina (veta 0..1). */
export const laminadoCocina = () => universal( { acabado: A.LAMINADO, relieve: 0.1 } );

/** Tarima de madera en lamas de 19 x 145 cm a junta trabada, según P.suelo. */
export const tarima = () => universal( { acabado: A.TARIMA, relieve: 0.25 } );

/** Lacado / laminado liso. */
export const lacado = ( tono = '#f1efea', rug = 0.38 ) => liso( tono, rug );

/** Textil (tapicería, ropa de cama): trama fina e irregularidad del tejido. */
export const textil = ( tono: string, escala = 1 ) =>
	universal( { acabado: A.TEXTIL, colores: [ tono ], valores: [ escala ], relieve: 0.06 } );

/** Bouclé: tejido de rizo, relieve granulado. */
export const boucle = ( tono: string ) => universal( { acabado: A.BOUCLE, colores: [ tono ], relieve: 0.12 } );

/** Mármol pulido con vetas. */
export const marmol = ( tono = '#eeebe6' ) => universal( { acabado: A.MARMOL, colores: [ tono, oscurecer( tono, 0.62 ) ] } );

/** Follaje: variación de tono por hoja, a doble cara. */
export const hoja = ( tono = '#4d6b3c' ) =>
	universal( { acabado: A.HOJA, colores: [ oscurecer( tono, 0.7 ), oscurecer( tono, 1.25 ) ], relieve: 0.15, lado: THREE.DoubleSide } );

/** Emisor (difusor de luminaria, pantalla de lámpara encendida). */
export const emisivo = ( tono = '#fff4e0', intensidad = 2 ) =>
	universal( { acabado: A.LISO, colores: [ tono ], valores: [ 0.8, 0 ], emision: intensidad } );

/** Lienzo abstracto: manchas de color con bordes pintados (no reproduce obra alguna). */
export const lienzo = ( tonos: string[] ) => {

	const [ a = '#d9cfc0', b = '#b86f4c', c = '#39475a' ] = tonos;
	return universal( { acabado: A.LIENZO, colores: [ a, b, c ], relieve: 0.05 } );

};

/** Hoja de puerta lacada con ranuras horizontales. */
export const puertaRanurada = ( tono = '#f2f0eb', ranura = '#d9d6cf' ) =>
	universal( { acabado: A.PUERTA, colores: [ tono, ranura ], relieve: 0.6 } );

export const metalico = ( tono: string, rug: number ) => liso( tono, rug, 1 );

export const ceramica = () => liso( '#f6f5f2', 0.1 );

export const negroBrillo = () => liso( '#101112', 0.06 );

export function vidrio( tono = '#dfe8e8', opacidad = 0.14 ) {

	// estándar (no físico): mismo aspecto con un shader mucho más ligero
	const m = new THREE.MeshStandardNodeMaterial( { transparent: true, depthWrite: false } );
	m.colorNode = color( tono );
	m.opacityNode = mix( float( 0 ), float( opacidad ), barrido( U.acabado, positionWorld.x ).mul( 0.6 ).add( 0.4 ) ).mul( float( 1 ).sub( U.plano ) );
	m.roughnessNode = float( 0.03 );
	m.metalnessNode = float( 0 );
	m.side = THREE.DoubleSide;
	return m;

}

export const espejo = () => liso( '#d9dedf', 0.02, 1 );

/** Exterior: suelo de urbanización que se funde con el fondo a distancia. */
export const suelo_exterior = ( centro: THREE.Vector3, zCesped = Infinity ) =>
	universal( { acabado: A.EXTERIOR, valores: [ centro.x, centro.z, Number.isFinite( zCesped ) ? zCesped : 1e6 ], relieve: 0.2 } );

// ------------------------------------------------------------ volúmenes (massing)

const COLORES_USO: Record<string, string> = {
	dia: '#e7c9a4',
	noche: '#b9c6d3',
	humedo: '#a9cbc6',
	servicio: '#cfc6b4',
	circulacion: '#e3ddd3',
	exterior: '#c9d3bb',
	garaje: '#c4c2bd',
};

export function volumen( uso: string ) {

	const m = new THREE.MeshStandardNodeMaterial();
	m.colorNode = color( COLORES_USO[ uso ] ?? '#dddddd' );
	m.roughnessNode = float( 0.85 );
	m.positionNode = vec3( positionLocal.x, positionLocal.y.mul( max( U.masa, 0.001 ) ), positionLocal.z );
	return m;

}

export const colorUso = ( uso: string ) => COLORES_USO[ uso ] ?? '#dddddd';

/** Muros en modo plano: poché oscuro que pasa a su acabado en 3D. */
export function murosInterior() {

	const m = pintura( '#efede8', true, true );
	return conPoche( m );

}

export function conPoche( m: THREE.MeshStandardNodeMaterial ) {

	// En planta los muros se leen como relleno oscuro; al subir, recuperan su material.
	( m.userData.u as { poche: number } ).poche = 1;
	return m;

}

