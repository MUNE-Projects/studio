// Modelos 3D reales de la biblioteca (biblioteca/modelos/*.glb): muebles y
// objetos modelados de verdad, de Poly Haven (CC0: dominio público, uso
// comercial y redistribución permitidos; registro en biblioteca/licencias.md).
// Preparados con herramientas/modelos.py (un solo .glb, texturas a 512 px).
//
// Un activo con `modelo` se dibuja primero con su generador (si lo tiene) y,
// en cuanto llega el archivo, se cambia por el modelo real, ajustado a sus
// medidas: sin deformarlo (misma escala en los tres ejes) los objetos, y
// ajustado a la huella del plano los muebles que ocupan un sitio concreto.

import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const ARCHIVOS = import.meta.glob( '../../biblioteca/modelos/*.glb', { query: '?url', import: 'default', eager: true } ) as Record<string, string>;
const url = ( nombre: string ) => ARCHIVOS[ `../../biblioteca/modelos/${ nombre }.glb` ];

const cargador = new GLTFLoader();
const cargados = new Map<string, Promise<THREE.Object3D | null>>();

function cargar( nombre: string ): Promise<THREE.Object3D | null> {

	let p = cargados.get( nombre );
	if ( ! p ) {

		const u = url( nombre );
		p = u ? cargador.loadAsync( u ).then( ( g ) => g.scene, ( e ) => {

			console.warn( 'No se ha podido cargar el modelo', nombre, e );
			return null;

		} ) : Promise.resolve( null );
		cargados.set( nombre, p );

	}
	return p;

}

export const existeModelo = ( nombre: string ) => !! url( nombre );

/**
 * Sustituye el contenido de `g` por el modelo `nombre`, con su frente hacia +z,
 * apoyado en y = 0, centrado y ajustado a W × D × H (m). `ajustar`: deformarlo
 * hasta llenar la huella (muebles); si no, misma escala en todo (objetos).
 */
export function ponerModelo( g: THREE.Group, nombre: string, W: number, D: number, H: number, ajustar = false, giro = 0 ) {

	void cargar( nombre ).then( ( original ) => {

		if ( ! original ) return;
		const m = original.clone( true );
		m.rotation.y = giro;
		m.updateMatrixWorld( true );
		const caja = new THREE.Box3().setFromObject( m );
		const t = caja.getSize( new THREE.Vector3() );
		const s = ajustar
			? new THREE.Vector3( W / t.x, H / t.y, D / t.z )
			: new THREE.Vector3().setScalar( Math.min( W / t.x, H / t.y, D / t.z ) );
		const centro = caja.getCenter( new THREE.Vector3() );
		const envoltorio = new THREE.Group();
		envoltorio.add( m );
		m.position.set( - centro.x, - caja.min.y, - centro.z );
		envoltorio.scale.copy( s );
		m.traverse( ( o ) => {

			if ( ( o as THREE.Mesh ).isMesh ) {

				o.castShadow = true;
				o.receiveShadow = true;

			}

		} );
		g.clear();
		g.add( envoltorio );

	} );

}
