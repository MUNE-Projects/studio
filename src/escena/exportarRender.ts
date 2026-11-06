// Exportar la escena para el «Render foto» (cálculo de luz con trazado de
// rayos, como los programas de infografía): la misma vivienda, con sus
// medidas, materiales, muebles, cámara y sol, en un .glb que entiende Blender
// (herramientas/render_foto.py).
//
// Los materiales del visor se calculan en el shader (TSL) y no se pueden
// exportar tal cual: cada uno se cambia por un material estándar con su color
// y su rugosidad, y su nombre lleva el acabado para que el render ponga el
// material real (veta de roble, lino, microcemento…).

import * as THREE from 'three/webgpu';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { P } from './materiales';

type Valores = {
	acabado: number; c0: THREE.Color; c1: THREE.Color; v0: number; v1: number; v2: number; v3: number; v6: number;
	fuente: number; emision: number;
};

/** Nombres de los acabados (mismo orden que A en materiales.ts). */
const ACABADOS = [ 'liso', 'porcelanico', 'alicatado', 'pintura', 'sate', 'madera', 'cuarzo', 'laminado',
	'tarima', 'textil', 'boucle', 'marmol', 'hoja', 'lienzo', 'puerta', 'exterior' ];

const hex = ( c: THREE.Color ) => `#${ c.getHexString() }`;

/** Color base real de un material (con las opciones del catálogo elegidas). */
function colorBase( u: Valores ): THREE.Color {

	const a = ACABADOS[ u.acabado ];
	if ( a === 'tarima' ) return ( P.suelo.claro as any ).value.clone().lerp( ( P.suelo.oscuro as any ).value, 0.25 );
	if ( a === 'laminado' ) return ( P.cocina.claro as any ).value.clone();
	if ( a === 'cuarzo' ) return ( P.encimera.base as any ).value.clone();
	if ( u.fuente === 1 ) return ( P.banos.suelo as any ).value.clone();
	if ( u.fuente === 2 ) return ( P.banos.pared as any ).value.clone();
	return u.c0.clone();

}

const cache = new Map<THREE.Material, THREE.Material>();

function estandar( m: THREE.Material ): THREE.Material {

	const hecho = cache.get( m );
	if ( hecho ) return hecho;
	const u = m.userData.u as Valores | undefined;
	let r: THREE.Material;
	if ( ! u ) {

		// materiales que ya son estándar (modelos de la biblioteca) o especiales (vidrio)
		const s = m as THREE.MeshStandardMaterial;
		if ( s.isMeshStandardMaterial && ! ( s as any ).isNodeMaterial ) r = s;
		else {

			const transparente = m.transparent || m.opacity < 1;
			r = new THREE.MeshStandardMaterial( {
				color: ( s.color ?? new THREE.Color( '#cccccc' ) ).clone(), roughness: s.roughness ?? 0.5, metalness: s.metalness ?? 0,
				transparent: transparente, opacity: m.opacity,
			} );
			r.name = transparente ? 'mune:vidrio' : 'mune:liso';

		}

	} else {

		const a = m.userData.pantalla ? 'pantalla' : ACABADOS[ u.acabado ] ?? 'liso';
		const c = colorBase( u );
		const rug = a === 'liso' ? u.v0 : a === 'tarima' ? ( P.suelo.rugosidad as any ).value : a === 'porcelanico' || a === 'alicatado' ? u.v2 : 0.7;
		const s = new THREE.MeshStandardMaterial( { color: c, roughness: THREE.MathUtils.clamp( rug || 0.6, 0.02, 1 ), metalness: a === 'liso' ? u.v1 : 0 } );
		if ( u.emision > 0 ) {

			s.emissive = c.clone();
			s.emissiveIntensity = u.emision;

		}
		// el nombre lleva lo que el render necesita para poner el material real:
		// acabado, color, segundo color, rugosidad y medidas de la pieza (v0 ancho, v3 largo, v1 junta, v6 aspecto)
		// (laminado de cocina: v0 lleva cuánta veta tiene la opción elegida; 0 = lacado liso)
		const v0 = a === 'laminado' ? ( P.cocina.veta as any ).value : u.v0;
		// … y la intensidad de la luz que emite (bombillas, 0 = no emite)
		s.name = [ 'mune', a, hex( c ), hex( u.c1 ), s.roughness.toFixed( 3 ), Number( v0 ).toFixed( 4 ), u.v3.toFixed( 4 ), u.v1.toFixed( 4 ), u.v6.toFixed( 0 ), ( u.emision ?? 0 ).toFixed( 2 ) ].join( ':' );
		r = s;

	}
	cache.set( m, r );
	return r;

}

/** Visible de verdad: el objeto y todos sus padres. */
function visible( o: THREE.Object3D ) {

	for ( let x: THREE.Object3D | null = o; x; x = x.parent ) if ( ! x.visible ) return false;
	return true;

}

/**
 * La escena tal como se ve ahora, lista para el render: .glb con la geometría
 * visible (en coordenadas del mundo) y un JSON con la cámara y el sol.
 */
/** La escena tal como se ve ahora, con materiales estándar y la geometría en coordenadas del mundo. */
export function escenaEstandar( escena: THREE.Scene ): THREE.Scene {

	escena.updateMatrixWorld( true );
	const salida = new THREE.Scene();
	escena.traverse( ( o ) => {

		const malla = o as THREE.Mesh;
		if ( ! malla.isMesh || ! visible( malla ) || ( malla as any ).isLine ) return;
		const geo = malla.geometry.clone().applyMatrix4( malla.matrixWorld );
		const mats = Array.isArray( malla.material ) ? malla.material.map( estandar ) : estandar( malla.material );
		const copia = new THREE.Mesh( geo, mats );
		copia.name = malla.name || malla.parent?.name || '';
		salida.add( copia );

	} );
	return salida;

}

/**
 * La escena tal como se ve ahora, lista para el render: .glb con la geometría
 * visible (en coordenadas del mundo) y un JSON con la cámara y el sol.
 */
export async function exportarRender( escena: THREE.Scene, camara: THREE.PerspectiveCamera, sol: THREE.DirectionalLight ) {

	const salida = escenaEstandar( escena );
	const glb = await new GLTFExporter().parseAsync( salida, { binary: true } ) as ArrayBuffer;
	const dir = sol.position.clone().sub( sol.target.position ).normalize();
	const datos = {
		camara: { posicion: camara.position.toArray(), cuaternion: camara.quaternion.toArray(), fov: camara.fov, aspecto: camara.aspect },
		sol: { direccion: dir.toArray(), intensidad: sol.intensity },
	};
	return { glb, datos };

}
