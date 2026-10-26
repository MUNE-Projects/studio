// Los cuatro estados de la visualización y la animación entre ellos.
// Cada estado es un conjunto de valores objetivo; al cambiar de estado se
// interpolan desde el valor actual, así cualquier salto (1 -> 4, 4 -> 2...)
// funciona igual en ambos sentidos.

import * as THREE from 'three/webgpu';
import { U } from './materiales';
import { uLineas } from './lineas';
import { uFondo } from './luz';

export interface Objetivo {
	plano: number; muros: number; masa: number; acabado: number; lineas: number;
	sol: number; ibl: number; papel: number; estudio: number;
	carpinterias: number; fijo: number; mobiliario: number;
	etiquetas: boolean; vista: string;
}

export const ESTADOS: Record<number, Objetivo & { nombre: string; lema: string }> = {
	1: { nombre: 'Plano', lema: 'Distribución en planta', plano: 1, muros: 0, masa: 0, acabado: 0, lineas: 1, sol: 0, ibl: 0, papel: 1, estudio: 0, carpinterias: 0, fijo: 0, mobiliario: 0, etiquetas: true, vista: 'planta' },
	2: { nombre: 'Volúmenes', lema: 'Estancias por uso', plano: 0, muros: 0, masa: 1, acabado: 0, lineas: 0.3, sol: 2.6, ibl: 0.85, papel: 0, estudio: 1, carpinterias: 0, fijo: 0, mobiliario: 0, etiquetas: true, vista: 'aerea' },
	3: { nombre: 'Modelo', lema: 'Arquitectura en maqueta blanca', plano: 0, muros: 1, masa: 0, acabado: 0, lineas: 0, sol: 3.0, ibl: 0.8, papel: 0, estudio: 1, carpinterias: 1, fijo: 1, mobiliario: 0, etiquetas: false, vista: 'aerea' },
	4: { nombre: 'Vivienda', lema: 'Acabados de la memoria de calidades', plano: 0, muros: 1, masa: 0, acabado: 1, lineas: 0, sol: 3.4, ibl: 0.9, papel: 0, estudio: 0, carpinterias: 1, fijo: 1, mobiliario: 1, etiquetas: false, vista: 'aerea' },
};

type Canal = Exclude<keyof Objetivo, 'etiquetas' | 'vista'>;

interface Tween { desde: number; hasta: number; t0: number; dur: number; }

const easeInOut = ( t: number ) => ( t < 0.5 ? 4 * t * t * t : 1 - Math.pow( - 2 * t + 2, 3 ) / 2 );
const easeOut = ( t: number ) => 1 - Math.pow( 1 - t, 4 );

export interface Grupos {
	volumenes: THREE.Object3D;
	lineas: THREE.Object3D;
	carpinterias: THREE.Object3D[];
	fijo: THREE.Object3D;
	mobiliario: THREE.Object3D;
	sol: THREE.DirectionalLight;
	escena: THREE.Scene;
}

export class Estados {

	valores: Record<Canal, number>;
	private tweens = new Map<Canal, Tween>();
	actual = 1;
	reducido = matchMedia( '(prefers-reduced-motion: reduce)' ).matches;

	constructor( private g: Grupos ) {

		const o = ESTADOS[ 1 ];
		this.valores = { plano: o.plano, muros: o.muros, masa: o.masa, acabado: o.acabado, lineas: o.lineas, sol: o.sol, ibl: o.ibl, papel: o.papel, estudio: o.estudio, carpinterias: o.carpinterias, fijo: o.fijo, mobiliario: o.mobiliario };
		this.aplicar( performance.now() );

	}

	ir( n: number ) {

		const desde = this.actual;
		this.actual = n;
		const o = ESTADOS[ n ];
		const ahora = performance.now();
		const subiendo = n > desde;
		// duraciones (ms) y retardos por canal; el orden cambia según el sentido
		const plan: Partial<Record<Canal, [ number, number ]>> = {
			plano: [ 700, subiendo ? 0 : 900 ],
			papel: [ 900, subiendo ? 0 : 700 ],
			estudio: [ 900, 0 ],
			lineas: [ 500, subiendo ? 0 : 1000 ],
			masa: [ 1300, subiendo ? 250 : 0 ],
			muros: [ 1600, subiendo ? 200 : 0 ],
			acabado: [ 1900, subiendo ? 150 : 0 ],
			sol: [ 900, 0 ],
			ibl: [ 900, 0 ],
			carpinterias: [ 700, subiendo ? 1100 : 0 ],
			fijo: [ 900, subiendo ? 900 : 0 ],
			mobiliario: [ 1400, subiendo ? 900 : 0 ],
		};
		for ( const k of Object.keys( plan ) as Canal[] ) {

			const [ dur, ret ] = plan[ k ]!;
			const hasta = o[ k ];
			if ( Math.abs( this.valores[ k ] - hasta ) < 1e-4 ) continue;
			this.tweens.set( k, {
				desde: this.valores[ k ], hasta,
				t0: ahora + ( this.reducido ? 0 : ret ),
				dur: this.reducido ? 200 : dur,
			} );

		}

	}

	get animando() {

		return this.tweens.size > 0;

	}

	actualizar( ahora: number ) {

		for ( const [ k, tw ] of this.tweens ) {

			const t = THREE.MathUtils.clamp( ( ahora - tw.t0 ) / tw.dur, 0, 1 );
			this.valores[ k ] = tw.desde + ( tw.hasta - tw.desde ) * easeInOut( t );
			if ( t >= 1 ) this.tweens.delete( k );

		}

		this.aplicar( ahora );

	}

	/** Reaplica escalas y visibilidad (p. ej. tras reconstruir grupos por una alternativa). */
	refrescar() {

		this.aplicar( performance.now() );

	}

	private aplicar( _ahora: number ) {

		const v = this.valores;
		U.plano.value = v.plano;
		U.muros.value = v.muros;
		U.masa.value = v.masa;
		U.acabado.value = v.acabado;
		uLineas.value = v.lineas;
		uFondo.papel.value = v.papel;
		uFondo.estudio.value = v.estudio;
		this.g.sol.intensity = v.sol;
		this.g.escena.environmentIntensity = v.ibl;

		this.g.volumenes.visible = v.masa > 0.002;
		this.g.lineas.visible = v.lineas > 0.002;

		for ( const c of this.g.carpinterias ) {

			c.visible = v.carpinterias > 0.002;
			c.scale.y = Math.max( 0.001, easeOut( v.carpinterias ) );

		}

		// equipamiento y mobiliario: aparecen escalonados de oeste a este
		const escalonar = ( grupo: THREE.Object3D, p: number ) => {

			grupo.visible = p > 0.002;
			for ( const hijo of grupo.children ) {

				const x = ( hijo.userData.x ?? 0 ) / 13;
				const q = THREE.MathUtils.clamp( ( p * 1.45 - x * 0.45 ) , 0, 1 );
				hijo.scale.y = Math.max( 0.001, easeOut( q ) );
				hijo.visible = q > 0.002 && ! hijo.userData.oculta; // oculta: de una planta que no se enseña

			}

		};

		escalonar( this.g.fijo, v.fijo );
		escalonar( this.g.mobiliario, v.mobiliario );

	}

}
