// Biblioteca de activos: metadatos (biblioteca/biblioteca.json) + generadores.
//
// Un activo es un generador procedural con parámetros (materiales, forma) y
// medidas por defecto. El mobiliario de la vivienda (sofá, cama…) toma las
// medidas del rectángulo del plano; la decoración usa las del activo.

import * as THREE from 'three/webgpu';
import datos from '../../biblioteca/biblioteca.json';
import { Pieza } from '../escena/equipamiento';
import type { Rect } from '../modelo/tipos';
import { GENERADORES, type Params } from './generadores';
import { existeModelo, ponerModelo } from './modelos';

export interface Activo {
	id: string;
	categoria: string;
	nombre: string;
	estilo: string;
	materiales: string;
	color: string;
	gama: 'esencial' | 'media' | 'alta';
	/** Ancho, fondo y alto en metros. */
	dims: [ number, number, number ];
	generador: string;
	params: Params;
	/** Referencias internas de estilo (no se muestran al comprador). */
	inspiracion: string[];
	referencia: string;
	miniatura: string | null;
	/** Tipos de equipamiento del plano a los que puede sustituir. */
	sustituye?: string[];
	/** Activo creado en el Studio (no viene de la biblioteca base). */
	propio?: boolean;
	/** Modelo 3D real (biblioteca/modelos/<modelo>.glb) que sustituye al generador al cargarse. */
	modelo?: string;
	/** Deformar el modelo hasta llenar la huella (muebles); si no, misma escala en todo. */
	ajustar?: boolean;
	/** Giro del modelo (grados) para que su frente mire a +z. */
	giro?: number;
}

export interface Biblioteca {
	version: number;
	categorias: { id: string; nombre: string }[];
	predeterminados: Record<string, string>;
	activos: Activo[];
}

/** Decoración colocada en la vivienda (coordenadas de planta). */
export interface Decoracion {
	id: string;
	activo: string;
	/** Centro en planta [x este, y norte]. */
	pos: [ number, number ];
	/** Giro en grados: 0 = frente al sur, 90 = frente al este. */
	rot: number;
	/** Altura de apoyo (0 = suelo). */
	elev: number;
	estancia: string;
	/** Medidas propias [W, D, H] si difieren del activo. */
	dims?: [ number, number, number ];
	/** Si se puede caminar por encima (alfombras): no es obstáculo. */
	pisable?: boolean;
}

export interface Ambientacion {
	/** id de equipamiento -> id de activo. */
	sustituciones: Record<string, string>;
	decoracion: Decoracion[];
}

export const BIBLIOTECA = datos as unknown as Biblioteca;

export const activo = ( id: string ) => BIBLIOTECA.activos.find( ( a ) => a.id === id );

/** Activo para un elemento del plano: sustitución explícita o predeterminado del tipo. */
export function activoPara( idEquipo: string, tipo: string, amb?: Ambientacion | null ) {

	const id = amb?.sustituciones[ idEquipo ] ?? BIBLIOTECA.predeterminados[ tipo ];
	const a = id ? activo( id ) : undefined;
	return a && ( ! a.sustituye || a.sustituye.includes( tipo ) ) ? a : undefined;

}

/** Alternativas para un activo: misma categoría y, si sustituye equipamiento, mismo tipo. */
export function alternativas( a: Activo, tipo?: string ) {

	return BIBLIOTECA.activos.filter( ( b ) => b.categoria === a.categoria && ( ! tipo || ! b.sustituye || b.sustituye.includes( tipo ) ) );

}

/** Geometría de un activo en su marco canónico (frente +z, apoyado en y = 0). */
export function construirActivo( a: Activo, W: number, D: number, H: number, extra: { techo: number; elev: number; semilla: string } ) {

	const k = new Pieza();
	const gen = GENERADORES[ a.generador ];
	if ( ! gen ) {

		console.warn( 'Activo sin generador:', a.id, a.generador );
		k.caja( 'tela:#cccccc', - W / 2, 0, - D / 2, W / 2, H, D / 2 );

	} else gen( k, { W, D, H, ...extra, p: a.params } );
	const g = k.malla( a.id );
	// modelo real: se ve el generado hasta que llega el archivo
	if ( a.modelo && existeModelo( a.modelo ) ) ponerModelo( g, a.modelo, W, D, H, a.ajustar, THREE.MathUtils.degToRad( a.giro ?? 0 ) );
	return g;

}

/** Huella en planta de una decoración (para colisiones y selección). */
export function huella( d: Decoracion ): Rect {

	const a = activo( d.activo );
	const [ W, D ] = d.dims ?? a?.dims ?? [ 0.3, 0.3, 0.3 ];
	const t = THREE.MathUtils.degToRad( d.rot );
	const hx = ( Math.abs( Math.cos( t ) ) * W + Math.abs( Math.sin( t ) ) * D ) / 2;
	const hy = ( Math.abs( Math.sin( t ) ) * W + Math.abs( Math.cos( t ) ) * D ) / 2;
	return [ d.pos[ 0 ] - hx, d.pos[ 1 ] - hy, d.pos[ 0 ] + hx, d.pos[ 1 ] + hy ];

}

/** Decoración que ocupa suelo y bloquea el paso (plantas, lámparas de pie…). */
export const obstaculos = ( amb: Ambientacion | null | undefined ) =>
	( amb?.decoracion ?? [] ).filter( ( d ) => d.elev < 0.05 && ! d.pisable && activo( d.activo )?.categoria !== 'alfombras' ).map( huella );
