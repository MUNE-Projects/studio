// Render HD: imagen comercial de la vista actual, separada del visor interactivo.
//
// El visor prioriza fluidez (iluminación global a media calidad, reflejos a
// media resolución, antialiasing temporal). El render HD usa la MISMA escena
// y la misma cámara con otra cadena de render, más cara:
//  - iluminación global con más cortes y pasos;
//  - reflejos a resolución completa y máxima calidad;
//  - sombras del sol a 8K (si la GPU lo permite);
//  - supermuestreo: N imágenes con la cámara desplazada una fracción de píxel
//    (antialiasing real) cuyo promedio también elimina el ruido del GI;
//  - por mosaicos con margen solapado: resoluciones de impresión (24 MP o más)
//    sin superar los límites de memoria de la GPU ni dejar costuras (por eso
//    sin bloom, cuyo halo cambia de un mosaico a otro).
// Sin interfaz: solo el lienzo 3D.

import * as THREE from 'three/webgpu';
import { add, diffuseColor, float, luminance, max, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, pow, roughness, sample, unpackRGBToNormal, vec3, vec4 } from 'three/tsl';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';

export interface OpcionesHD {
	ancho: number;
	alto: number;
	/** Imágenes promediadas por mosaico (antialiasing + limpieza del GI). */
	muestras: number;
	progreso?: ( texto: string ) => void;
	tipo?: 'image/jpeg' | 'image/png';
	/** Aviso legal de la promotora, en letra pequeña abajo a la izquierda (máx. 2 líneas). */
	aviso?: string;
}

/** Aviso legal sobre la imagen: banda oscura suave abajo, texto claro proporcional al ancho. */
export function dibujarAviso( ctx: CanvasRenderingContext2D, W: number, H: number, aviso: string ) {

	const texto = aviso.replace( /\s+/g, ' ' ).trim();
	if ( ! texto ) return;
	const tam = Math.max( 11, Math.round( W * 0.0085 ) );
	const margen = Math.round( tam * 1.4 );
	const fuente = getComputedStyle( document.documentElement ).getPropertyValue( '--fuente' ).trim() || 'Helvetica, Arial, sans-serif';
	ctx.save();
	ctx.font = `400 ${ tam }px ${ fuente }`;
	// hasta 2 líneas en el 70 % del ancho; lo que no cabe se acorta con «…»
	const maximo = W * 0.7;
	const lineas: string[] = [];
	let actual = '';
	for ( const palabra of texto.split( ' ' ) ) {

		const prueba = actual ? `${ actual } ${ palabra }` : palabra;
		if ( ctx.measureText( prueba ).width <= maximo || ! actual ) actual = prueba;
		else {

			lineas.push( actual );
			actual = palabra;

		}

	}
	if ( actual ) lineas.push( actual );
	if ( lineas.length > 2 ) {

		let ultima = lineas[ 1 ];
		while ( ultima && ctx.measureText( `${ ultima }…` ).width > maximo ) ultima = ultima.slice( 0, ultima.lastIndexOf( ' ' ) > 0 ? ultima.lastIndexOf( ' ' ) : ultima.length - 1 );
		lineas.splice( 1, Infinity, `${ ultima }…` );

	}
	const interlinea = Math.round( tam * 1.35 );
	const alto = lineas.length * interlinea + margen * 1.6;
	const banda = ctx.createLinearGradient( 0, H - alto * 1.6, 0, H );
	banda.addColorStop( 0, 'rgb(0 0 0 / 0)' );
	banda.addColorStop( 1, 'rgb(0 0 0 / 0.42)' );
	ctx.fillStyle = banda;
	ctx.fillRect( 0, H - alto * 1.6, W, alto * 1.6 );
	ctx.fillStyle = 'rgb(255 255 255 / 0.88)';
	ctx.shadowColor = 'rgb(0 0 0 / 0.5)';
	ctx.shadowBlur = tam * 0.3;
	ctx.textBaseline = 'alphabetic';
	lineas.forEach( ( l, i ) => ctx.fillText( l, margen, H - margen - ( lineas.length - 1 - i ) * interlinea ) );
	ctx.restore();

}

const MOSAICO = 2048; // lado máximo de cada mosaico (px)
const MARGEN = 96; // solape para que GI, reflejos y bloom no dejen costuras

/** Secuencia de Halton (baja discrepancia) para los desplazamientos de subpíxel. */
const halton = ( i: number, b: number ) => {

	let f = 1, r = 0;
	while ( i > 0 ) {

		f /= b;
		r += f * ( i % b );
		i = Math.floor( i / b );

	}

	return r;

};

export class RenderHD {

	private pipeline: THREE.RenderPipeline | null = null;

	constructor( private renderer: THREE.WebGPURenderer, private escena: THREE.Scene, private camara: THREE.PerspectiveCamera, private sol: THREE.DirectionalLight, private ventanas: () => THREE.SpotLight[] = () => [] ) {}

	/** Cadena de render de alta calidad (se crea la primera vez que se usa). */
	private cadena() {

		if ( this.pipeline ) return this.pipeline;
		const p = new THREE.RenderPipeline( this.renderer );
		const escenaPass = pass( this.escena, this.camara );
		// mismas salidas que el visor (dentro del límite de 32 bytes/píxel de WebGPU)
		escenaPass.setMRT( mrt( { output, diffuseColor: vec4( diffuseColor.rgb, metalness ), normal: vec4( packNormalToRGB( normalView ), roughness ) } ) );
		escenaPass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;
		escenaPass.getTexture( 'normal' ).type = THREE.UnsignedByteType;
		const color = escenaPass.getTextureNode( 'output' );
		const difuso = escenaPass.getTextureNode( 'diffuseColor' );
		const normal = escenaPass.getTextureNode( 'normal' );
		const profundidad = escenaPass.getTextureNode( 'depth' );
		const normalEscena = sample( ( uv ) => unpackRGBToNormal( normal.sample( uv ) ) );

		const gi = ssgi( color, profundidad, normalEscena, this.camara );
		gi.sliceCount.value = 4;
		gi.stepCount.value = 20;
		gi.radius.value = 4;
		gi.giIntensity.value = 1.6;
		gi.aoIntensity.value = 1.1;
		gi.thickness.value = 0.5;
		const compuesto = vec4( add( color.rgb.mul( gi.getAONode() ), difuso.rgb.mul( gi.getGINode().rgb ) ), color.a );

		const reflectancia = max( difuso.a, pow( float( 1 ).sub( normal.a ), 3 ).mul( 0.6 ) );
		const reflejos = ssr( color, profundidad, normalEscena, { metalnessNode: reflectancia, roughnessNode: normal.a, reflectNonMetals: true, camera: this.camara } );
		reflejos.resolutionScale = 1;
		reflejos.maxDistance.value = 6;
		reflejos.thickness.value = 0.03;
		reflejos.quality.value = 1;
		reflejos.blurQuality = 3;
		reflejos.intensity.value = 0.85;
		// sin bloom: su halo depende del contenido de cada mosaico y dejaría juntas
		// de distinto brillo entre mosaicos (se comprobó a 4K)
		const conReflejos = compuesto.rgb.add( reflejos.rgb );
		const graduado = mix( vec3( luminance( conReflejos ) ), conReflejos, 1.05 ).mul( vec3( 1.004, 1.0, 0.99 ) );
		p.outputNode = vec4( graduado, 1 );
		this.pipeline = p;
		return p;

	}

	private tamanoSombraMax() {

		const b = this.renderer.backend as unknown as { device?: GPUDevice; gl?: WebGL2RenderingContext };
		const max = b.device?.limits.maxTextureDimension2D ?? b.gl?.getParameter( b.gl.MAX_TEXTURE_SIZE ) ?? 4096;
		return Math.min( 8192, max );

	}

	async generar( o: OpcionesHD ): Promise<Blob> {

		const { ancho: W, alto: H } = o;
		const r = this.renderer, c = this.camara;
		const antes = {
			ratio: r.getPixelRatio(), tam: r.getSize( new THREE.Vector2() ), aspecto: c.aspect, zoom: c.zoom, film: c.filmOffset,
			sombra: this.sol.shadow.mapSize.clone(), radio: this.sol.shadow.radius,
		};
		const rehacer = ( l: THREE.Light & { shadow: THREE.LightShadow }, t: number, radio: number ) => {

			l.shadow.mapSize.set( t, t );
			l.shadow.radius = radio;
			l.shadow.map?.dispose();
			( l.shadow as unknown as { map: unknown } ).map = null;

		};
		const sombraVentana = this.ventanas()[ 0 ]?.shadow.mapSize.x ?? 1024;
		const cambiarSombra = ( t: number, radio: number, tv = sombraVentana ) => {

			rehacer( this.sol, t, radio );
			for ( const l of this.ventanas() ) rehacer( l, tv, 5 );

		};

		const final = document.createElement( 'canvas' );
		final.width = W;
		final.height = H;
		const fctx = final.getContext( '2d' )!;
		const lectura = document.createElement( 'canvas' );
		const lctx = lectura.getContext( '2d', { willReadFrequently: true } )!;
		const pipeline = this.cadena();

		try {

			cambiarSombra( this.tamanoSombraMax(), 3, 2048 );
			r.setPixelRatio( 1 );
			c.aspect = W / H;
			c.zoom = 1;
			c.filmOffset = 0;
			const nx = Math.ceil( W / MOSAICO ), ny = Math.ceil( H / MOSAICO );
			const tw = Math.ceil( W / nx ), th = Math.ceil( H / ny );
			let n = 0;
			for ( let j = 0; j < ny; j ++ ) for ( let i = 0; i < nx; i ++ ) {

				n ++;
				const x = i * tw, y = j * th;
				const w = Math.min( tw, W - x ), h = Math.min( th, H - y );
				// mosaico con margen (recortado al encuadre completo)
				const x0 = Math.max( 0, x - MARGEN ), y0 = Math.max( 0, y - MARGEN );
				const x1 = Math.min( W, x + w + MARGEN ), y1 = Math.min( H, y + h + MARGEN );
				const mw = x1 - x0, mh = y1 - y0;
				r.setSize( mw, mh, false );
				lectura.width = mw;
				lectura.height = mh;
				const suma = new Float32Array( w * h * 3 );
				// fotogramas de calentamiento (se descartan): los mapas de sombra recién
				// creados y los búferes redimensionados necesitan un pase antes de valer
				c.setViewOffset( W, H, x0, y0, mw, mh );
				c.updateProjectionMatrix();
				for ( let k = 0; k < ( n === 1 ? 3 : 1 ); k ++ ) {

					pipeline.render();
					await new Promise( requestAnimationFrame );

				}

				for ( let s = 0; s < o.muestras; s ++ ) {

					o.progreso?.( `Renderizando${ nx * ny > 1 ? ` mosaico ${ n } de ${ nx * ny },` : '' } muestra ${ s + 1 } de ${ o.muestras }…` );
					// desplazamiento de subpíxel (supermuestreo) dentro del encuadre completo
					const jx = s === 0 ? 0 : halton( s, 2 ) - 0.5, jy = s === 0 ? 0 : halton( s, 3 ) - 0.5;
					c.setViewOffset( W, H, x0 + jx, y0 + jy, mw, mh );
					c.updateProjectionMatrix();
					pipeline.render();
					lctx.drawImage( r.domElement, 0, 0 );
					const px = lctx.getImageData( x - x0, y - y0, w, h ).data;
					for ( let k = 0, q = 0; k < px.length; k += 4, q += 3 ) {

						suma[ q ] += px[ k ];
						suma[ q + 1 ] += px[ k + 1 ];
						suma[ q + 2 ] += px[ k + 2 ];

					}

					// deja respirar a la interfaz (progreso, cancelación del navegador)
					await new Promise( requestAnimationFrame );

				}

				const img = fctx.createImageData( w, h );
				for ( let k = 0, q = 0; k < img.data.length; k += 4, q += 3 ) {

					img.data[ k ] = suma[ q ] / o.muestras;
					img.data[ k + 1 ] = suma[ q + 1 ] / o.muestras;
					img.data[ k + 2 ] = suma[ q + 2 ] / o.muestras;
					img.data[ k + 3 ] = 255;

				}

				fctx.putImageData( img, x, y );

			}

			// viñeteado sobre la imagen completa (no por mosaico)
			o.progreso?.( 'Acabado final…' );
			const g = fctx.createRadialGradient( W / 2, H / 2, Math.min( W, H ) * 0.35, W / 2, H / 2, Math.hypot( W, H ) * 0.56 );
			g.addColorStop( 0, 'rgb(255 255 255)' );
			g.addColorStop( 1, 'rgb(218 216 214)' );
			fctx.globalCompositeOperation = 'multiply';
			fctx.fillStyle = g;
			fctx.fillRect( 0, 0, W, H );
			fctx.globalCompositeOperation = 'source-over';
			if ( o.aviso ) dibujarAviso( fctx, W, H, o.aviso );

		} finally {

			c.clearViewOffset();
			c.aspect = antes.aspecto;
			c.zoom = antes.zoom;
			c.filmOffset = antes.film;
			c.updateProjectionMatrix();
			r.setPixelRatio( antes.ratio );
			r.setSize( antes.tam.x, antes.tam.y, false );
			cambiarSombra( antes.sombra.x, antes.radio );

		}

		o.progreso?.( 'Comprimiendo la imagen…' );
		return new Promise( ( ok, mal ) => final.toBlob( ( b ) => ( b ? ok( b ) : mal( new Error( 'No se pudo codificar la imagen' ) ) ), o.tipo ?? 'image/jpeg', 0.93 ) );

	}

}
