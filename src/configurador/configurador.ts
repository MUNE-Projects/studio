// Estado de la configuración comercial: opción elegida por categoría, precios
// y aplicación de los acabados a los uniforms de los materiales.
//
// Las categorías y opciones vienen del catálogo de la promoción
// (trabajo/<id>/catalogo.json), filtrado para cada vivienda.

import * as THREE from 'three/webgpu';
import type { Categoria, Configuracion, Opcion } from '../modelo/tipos';
import type { PackVivienda } from './packs';
import { P } from '../escena/materiales';

export type Seleccion = Record<string, string>;

/** Qué uniforms gobierna cada categoría de acabado (clave de parámetro -> uniform). */
const DESTINO: Record<string, Record<string, { value: unknown }>> = {
	suelo: P.suelo,
	cocina: P.cocina,
	encimera: P.encimera,
	banos: P.banos,
};

export const fmtEuros = ( n: number ) => `${ Math.round( n ).toString().replace( /\B(?=(\d{3})+(?!\d))/g, '.' ) } €`;
export const fmtPrecio = ( n: number ) => ( n === 0 ? 'Incluido' : `+${ fmtEuros( n ) }` );

export class Configurador {

	seleccion: Seleccion;
	private tweens: { u: { value: unknown }; desde: THREE.Color | number; hasta: THREE.Color | number; t0: number }[] = [];
	private readonly duracion = 450;

	constructor( readonly datos: Configuracion, readonly packs: PackVivienda[] = [] ) {

		this.seleccion = Object.fromEntries( datos.categorias.map( ( c ) => [ c.id, c.opciones[ 0 ].id ] ) );
		// packs cerrados: lo formalizado (finalizado) o lo incluido (próximamente)
		for ( const p of packs ) if ( p.estado === 'finalizado' && p.formalizada ) {

			for ( const [ cat, op ] of Object.entries( p.formalizada.opciones ) ) if ( this.tiene( cat ) && this.categoria( cat ).opciones.some( ( o ) => o.id === op ) ) this.seleccion[ cat ] = op;

		}

	}

	/** Pack al que pertenece una categoría. */
	packDe( categoria: string ) {

		return this.packs.find( ( p ) => p.categorias.some( ( c ) => c.id === categoria ) ) ?? null;

	}

	/** ¿Se puede cambiar la categoría ahora? (solo en packs disponibles) */
	editable( categoria: string ) {

		const p = this.packDe( categoria );
		return ! p || p.estado === 'disponible';

	}

	/** Mejoras con coste de un pack. */
	extrasDe( packId: string ) {

		return this.extras.filter( ( x ) => this.packDe( x.categoria.id )?.pack.id === packId );

	}

	totalPack( packId: string ) {

		return this.extrasDe( packId ).reduce( ( s, x ) => s + x.opcion.precio, 0 );

	}

	/** Opción incluida (la primera) de una categoría. */
	base( categoria: string ) {

		return this.categoria( categoria ).opciones[ 0 ];

	}

	categoria( id: string ): Categoria {

		return this.datos.categorias.find( ( c ) => c.id === id )!;

	}

	opcion( categoria: string, id = this.seleccion[ categoria ] ): Opcion {

		return this.categoria( categoria ).opciones.find( ( o ) => o.id === id ) ?? this.base( categoria );

	}

	/** Elige una opción. Devuelve la opción anterior para que quien llama decida qué reconstruir. */
	elegir( categoria: string, id: string, instantaneo = false ) {

		const anterior = this.opcion( categoria );
		if ( ! this.editable( categoria ) ) return anterior;
		this.seleccion[ categoria ] = id;
		this.aplicarParametros( categoria, instantaneo );
		return anterior;

	}

	/** Lleva los parámetros de la opción elegida a los uniforms (con fundido). */
	aplicarParametros( categoria: string, instantaneo = false ) {

		const destino = DESTINO[ categoria ];
		const params = this.opcion( categoria ).parametros;
		if ( ! destino || ! params ) return;
		const ahora = performance.now();
		for ( const [ k, valor ] of Object.entries( params ) ) {

			const u = destino[ k ];
			if ( ! u ) continue;
			const hasta = typeof valor === 'string' ? new THREE.Color( valor ) : valor;
			this.tweens = this.tweens.filter( ( t ) => t.u !== u );
			if ( instantaneo ) {

				if ( hasta instanceof THREE.Color ) ( u.value as THREE.Color ).copy( hasta );
				else u.value = hasta;
				continue;

			}

			const desde = u.value instanceof THREE.Color ? u.value.clone() : ( u.value as number );
			this.tweens.push( { u, desde, hasta, t0: ahora } );

		}

	}

	get animando() {

		return this.tweens.length > 0;

	}

	actualizar( ahora: number ) {

		this.tweens = this.tweens.filter( ( t ) => {

			const k = THREE.MathUtils.clamp( ( ahora - t.t0 ) / this.duracion, 0, 1 );
			const e = 1 - Math.pow( 1 - k, 3 );
			if ( t.desde instanceof THREE.Color ) ( t.u.value as THREE.Color ).copy( t.desde ).lerp( t.hasta as THREE.Color, e );
			else t.u.value = ( t.desde as number ) + ( ( t.hasta as number ) - ( t.desde as number ) ) * e;
			return k < 1;

		} );

	}

	/** Categorías que no existen en esta vivienda cuentan como su opción incluida. */
	tiene( id: string ) {

		return this.datos.categorias.some( ( c ) => c.id === id );

	}

	get alternativa() {

		return this.tiene( 'distribucion' ) ? this.opcion( 'distribucion' ).alternativa ?? null : null;

	}

	get piscina() {

		return this.tiene( 'exterior' ) && !! this.opcion( 'exterior' ).piscina;

	}

	/** Opciones con coste, en el orden de las categorías. */
	get extras() {

		return this.datos.categorias.map( ( c ) => ( { categoria: c, opcion: this.opcion( c.id ) } ) ).filter( ( x ) => x.opcion.precio > 0 );

	}

	get totalExtras() {

		return this.extras.reduce( ( s, x ) => s + x.opcion.precio, 0 );

	}

	/** Restaura una selección guardada, ignorando opciones que ya no existan. */
	restaurar( s: Seleccion ) {

		for ( const c of this.datos.categorias ) if ( this.editable( c.id ) && s[ c.id ] && c.opciones.some( ( o ) => o.id === s[ c.id ] ) ) this.elegir( c.id, s[ c.id ], true );

	}

}
