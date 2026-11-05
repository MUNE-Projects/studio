// Render foto: la vista actual calculada como en los programas de infografía,
// siguiendo los rayos de luz que rebotan por la vivienda (trazado de rayos), en
// la tarjeta gráfica de quien lo pide: gratis y sin límite (decisión 70).
//
// Usa three-gpu-pathtracer (MIT, código abierto). Trabaja con materiales
// estándar: la escena se copia con exportarRender.escenaEstandar (colores y
// rugosidad de cada acabado y las opciones del catálogo elegidas). Mientras
// calcula, el visor se detiene; al terminar vuelve como estaba.

import * as THREE from 'three/webgpu';
import { WebGPUPathTracer } from 'three-gpu-pathtracer/webgpu';
import { escenaEstandar } from './exportarRender';
import { dibujarAviso } from './renderHD';

export interface OpcionesFoto {
	ancho: number;
	alto: number;
	/** Muestras por píxel: más, menos grano (y más tiempo). */
	muestras: number;
	progreso?: ( fraccion: number ) => void;
	tipo?: 'image/jpeg' | 'image/png';
	/** Aviso legal de la promotora, en letra pequeña (como en el Render HD). */
	aviso?: string;
}

/** Cielo de día (equirectangular): cenit azul, horizonte claro, suelo lejano. */
function cielo(): THREE.DataTexture {

	const W = 256, H = 128;
	const d = new Float32Array( W * H * 4 );
	const cenit = new THREE.Color( '#7fa6d6' ), horizonte = new THREE.Color( '#e9eef2' ), suelo = new THREE.Color( '#8f8a7e' );
	const c = new THREE.Color();
	for ( let y = 0; y < H; y ++ ) {

		const alt = ( 0.5 - ( y + 0.5 ) / H ) * Math.PI; // de +90° a −90°
		const s = Math.sin( alt );
		if ( s >= 0 ) c.copy( horizonte ).lerp( cenit, Math.pow( s, 0.6 ) );
		else c.copy( horizonte ).lerp( suelo, Math.min( 1, - s * 6 ) );
		for ( let x = 0; x < W; x ++ ) {

			const i = ( y * W + x ) * 4;
			d[ i ] = c.r; d[ i + 1 ] = c.g; d[ i + 2 ] = c.b; d[ i + 3 ] = 1;

		}

	}
	const t = new THREE.DataTexture( d, W, H, THREE.RGBAFormat, THREE.FloatType );
	t.mapping = THREE.EquirectangularReflectionMapping;
	t.colorSpace = THREE.LinearSRGBColorSpace;
	t.needsUpdate = true;
	return t;

}

/** Materiales para el trazado de rayos: físicos, y el vidrio, transparente de verdad. */
function fisicos( escena: THREE.Scene ) {

	const hechos = new Map<THREE.Material, THREE.Material>();
	const fisico = ( m: THREE.Material ): THREE.Material => {

		const ya = hechos.get( m );
		if ( ya ) return ya;
		const s = m as THREE.MeshStandardMaterial;
		let r: THREE.MeshPhysicalMaterial;
		if ( m.name === 'mune:vidrio' ) {

			r = new THREE.MeshPhysicalMaterial( { color: '#ffffff', roughness: 0, metalness: 0, transmission: 1, ior: 1.5, thickness: 0 } );

		} else {

			r = new THREE.MeshPhysicalMaterial( {
				color: s.color?.clone() ?? new THREE.Color( '#cccccc' ), roughness: s.roughness ?? 0.6, metalness: s.metalness ?? 0,
				map: s.map ?? null, normalMap: s.normalMap ?? null, roughnessMap: s.roughnessMap ?? null, metalnessMap: s.metalnessMap ?? null,
				emissive: s.emissive?.clone() ?? new THREE.Color( 0 ), emissiveIntensity: s.emissiveIntensity ?? 0,
				transparent: s.transparent, opacity: s.opacity, alphaTest: s.alphaTest, side: s.side,
			} );

		}
		r.name = m.name;
		hechos.set( m, r );
		return r;

	};
	escena.traverse( ( o ) => {

		const malla = o as THREE.Mesh;
		if ( malla.isMesh ) malla.material = Array.isArray( malla.material ) ? malla.material.map( fisico ) : fisico( malla.material );

	} );

}

const esperarFotograma = () => new Promise<void>( ( ok ) => requestAnimationFrame( () => ok() ) );

/**
 * Calcula la vista de `camara` y devuelve la imagen. `pausar` detiene el bucle
 * del visor mientras dura (el trazador dibuja en el mismo lienzo).
 */
export async function renderFoto( renderer: THREE.WebGPURenderer, escena: THREE.Scene, camara: THREE.PerspectiveCamera,
	sol: THREE.DirectionalLight, pausar: ( p: boolean ) => void, o: OpcionesFoto ): Promise<Blob> {

	const { ancho: W, alto: H } = o;
	const antes = { ratio: renderer.getPixelRatio(), tam: renderer.getSize( new THREE.Vector2() ), exposicion: renderer.toneMappingExposure };
	const foto = escenaEstandar( escena );
	fisicos( foto );
	// la misma luz del sol, y el cielo como luz de fondo
	const luz = new THREE.DirectionalLight( sol.color, sol.intensity );
	luz.position.copy( sol.position );
	luz.target.position.copy( sol.target.position );
	foto.add( luz, luz.target );
	const fondo = cielo();
	foto.environment = fondo;
	foto.background = fondo;
	const cam = camara.clone();
	cam.aspect = W / H;
	cam.clearViewOffset();
	cam.updateProjectionMatrix();

	pausar( true );
	const trazador = new WebGPUPathTracer( renderer );
	try {

		renderer.setPixelRatio( 1 );
		renderer.setSize( W, H, false );
		renderer.toneMappingExposure = 1.4;
		trazador.renderDelay = 0;
		trazador.fadeDuration = 0;
		trazador.minSamples = 1;
		trazador.dynamicLowRes = false;
		trazador.maxSamples = o.muestras;
		trazador.setScene( foto, cam );
		// acumular hasta llegar a las muestras pedidas
		for ( let vuelta = 0; ; vuelta ++ ) {

			await esperarFotograma();
			trazador.renderSample();
			if ( vuelta % 8 === 7 ) {

				const n = await trazador.getSampleCountsAsync();
				o.progreso?.( Math.min( 1, n.min / o.muestras ) );
				if ( n.min >= o.muestras ) break;

			}

		}
		// el último resultado, presentado en el lienzo, a la imagen final
		trazador.renderSample();
		const final = document.createElement( 'canvas' );
		final.width = W;
		final.height = H;
		const ctx = final.getContext( '2d' )!;
		ctx.drawImage( renderer.domElement, 0, 0, W, H );
		if ( o.aviso ) dibujarAviso( ctx, W, H, o.aviso );
		return await new Promise<Blob>( ( ok, mal ) => final.toBlob( ( b ) => ( b ? ok( b ) : mal( new Error( 'No se pudo codificar la imagen' ) ) ), o.tipo ?? 'image/jpeg', 0.93 ) );

	} finally {

		trazador.dispose();
		fondo.dispose();
		renderer.setPixelRatio( antes.ratio );
		renderer.setSize( antes.tam.x, antes.tam.y, false );
		renderer.toneMappingExposure = antes.exposicion;
		pausar( false );

	}

}
