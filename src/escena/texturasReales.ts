// Texturas de materiales reales (fotografías de Poly Haven, CC0: dominio
// público, uso comercial y redistribución permitidos; registro en
// biblioteca/licencias.md).
//
// No llevan color: los colores siguen saliendo de la memoria de calidades y de
// las opciones del catálogo (uniforms de materiales.ts). Cada textura aporta lo
// que una foto tiene y un cálculo no: la veta, el poro, las nubes y el relieve
// de un material real. Empaquetadas por herramientas/texturas.py:
//   R  variación de claridad de la foto
//   G  variación de rugosidad (dónde brilla más o menos)
//   B  altura (relieve)
// las tres normalizadas: 0,5 = la media y ±0,15 = una desviación típica.
// Se cargan en segundo plano: hasta que llegan, la superficie se ve sin variación.

import * as THREE from 'three/webgpu';
import { texture, uniform, vec2 } from 'three/tsl';

import roble from '../texturas/roble.webp?url';
import microcemento from '../texturas/microcemento.webp?url';
import terrazo from '../texturas/terrazo.webp?url';
import lino from '../texturas/lino.webp?url';

type N = any;

/** Cada textura con el tamaño real que cubre (m). */
const FUENTES = {
	// chapa de roble, veta a lo largo de la imagen (Oak Veneer 01)
	roble: { url: roble, tam: 1.83 },
	// enlucido gris con nubes de llana (Plaster Grey 04): microcemento y relieve de la pintura
	microcemento: { url: microcemento, tam: 1.5 },
	// pavimento de árido visto (Concrete Floor 01): terrazo
	terrazo: { url: terrazo, tam: 2.0 },
	// lino de trama gruesa (Rough Linen): tapicerías y textiles
	lino: { url: lino, tam: 0.27 },
} as const;
export type Real = keyof typeof FUENTES;

const cargador = new THREE.TextureLoader();
const cache = new Map<Real, { t: THREE.Texture; lista: N }>();

/** La textura y un interruptor que pasa a 1 cuando ha llegado (antes: sin variación). */
function textura( n: Real ): { t: THREE.Texture; lista: N } {

	let x = cache.get( n );
	if ( ! x ) {

		const lista: N = uniform( 0 );
		const t = cargador.load( FUENTES[ n ].url, () => { lista.value = 1; } );
		t.wrapS = t.wrapT = THREE.RepeatWrapping;
		t.colorSpace = THREE.NoColorSpace;
		t.anisotropy = 8;
		x = { t, lista };
		cache.set( n, x );

	}
	return x;

}

/**
 * Lee la textura real `n` en el punto `p` (metros sobre la superficie). Devuelve
 * tres desviaciones (≈ −1…1, 0 = la media): claridad, rugosidad y altura.
 */
export function real( n: Real, p: N ): { claro: N; rug: N; alto: N } {

	const { t, lista } = textura( n );
	const s: N = texture( t, vec2( p ).div( FUENTES[ n ].tam ) );
	const z = ( c: N ) => c.sub( 0.5 ).div( 0.15 ).mul( lista );
	return { claro: z( s.r ), rug: z( s.g ), alto: z( s.b ) };

}
