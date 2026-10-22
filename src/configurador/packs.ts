// Packs de personalización: la promotora abre la personalización por fases.
//
// Cada pack agrupa categorías del catálogo y tiene un periodo de selección:
//  - disponible:   dentro del periodo; el comprador elige y genera su documento;
//  - próximamente: antes del periodo; se ve lo que llegará, bloqueado;
//  - finalizado:   después del periodo; queda como histórico (lo que se formalizó).
//
// La fecha de referencia es la de hoy. Para revisar la promoción en otro
// momento se puede simular con ?fecha=AAAA-MM-DD en la URL.

import type { Categoria, EstadoPack, Pack, Promocion, ViviendaPromocion } from '../modelo/tipos';

/** Fecha de referencia (hoy, o la simulada con ?fecha=). */
export function hoy(): string {

	const f = new URLSearchParams( location.search ).get( 'fecha' );
	if ( f && /^\d{4}-\d{2}-\d{2}$/.test( f ) ) return f;
	const d = new Date();
	return `${ d.getFullYear() }-${ String( d.getMonth() + 1 ).padStart( 2, '0' ) }-${ String( d.getDate() ).padStart( 2, '0' ) }`;

}

export function estadoPack( p: Pack, fecha = hoy() ): EstadoPack {

	if ( p.estado ) return p.estado;
	if ( fecha < p.desde ) return 'proximamente';
	if ( fecha > p.hasta ) return 'finalizado';
	return 'disponible';

}

export const fmtFecha = ( iso: string, larga = false ) => new Date( `${ iso }T12:00:00` ).toLocaleDateString( 'es-ES', larga ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: '2-digit', month: '2-digit', year: 'numeric' } );

export const ETIQUETA_ESTADO: Record<EstadoPack, string> = {
	disponible: 'Disponible',
	proximamente: 'Próximamente',
	finalizado: 'Periodo finalizado',
};

/** Texto del periodo según el estado. */
export function textoPeriodo( p: Pack, e = estadoPack( p ) ) {

	if ( e === 'disponible' ) return `Selección abierta hasta el ${ fmtFecha( p.hasta, true ) }`;
	if ( e === 'proximamente' ) return `Disponible a partir del ${ fmtFecha( p.desde, true ) }`;
	return `El periodo de selección finalizó el ${ fmtFecha( p.hasta, true ) }`;

}

export interface PackVivienda {
	pack: Pack;
	estado: EstadoPack;
	categorias: Categoria[];
	/** Selección cerrada (histórico), si la hay. */
	formalizada: { fecha: string; opciones: Record<string, string> } | null;
	/** Selección guardada en un pack aún abierto (se puede cambiar hasta que cierre). */
	guardada: { fecha: string; opciones: Record<string, string> } | null;
}

/** Lo guardado de un pack: cerrado (histórico) o seleccionado (aún se puede cambiar). Sin estado, es de antes: cerrado. */
function seleccionDe( v: ViviendaPromocion, pack: string ) {

	const s = v.selecciones?.[ pack ] ?? null;
	return { formalizada: s && s.estado !== 'seleccionada' ? s : null, guardada: s?.estado === 'seleccionada' ? s : null };

}

/**
 * Packs de una vivienda: solo con las categorías que esa vivienda puede
 * personalizar. Las categorías que no estén en ningún pack forman un pack
 * implícito siempre disponible (compatibilidad con catálogos sin packs).
 */
export function packsDeVivienda( promocion: Promocion, v: ViviendaPromocion, categorias: Categoria[] ): PackVivienda[] {

	const fecha = hoy();
	const out: PackVivienda[] = [];
	const usadas = new Set<string>();
	for ( const p of promocion.packs ?? [] ) {

		const cats = p.categorias.map( ( id ) => categorias.find( ( c ) => c.id === id ) ).filter( ( c ): c is Categoria => !! c );
		cats.forEach( ( c ) => usadas.add( c.id ) );
		if ( ! cats.length ) continue;
		out.push( { pack: p, estado: estadoPack( p, fecha ), categorias: cats, ...seleccionDe( v, p.id ) } );

	}

	const sueltas = categorias.filter( ( c ) => ! usadas.has( c.id ) );
	if ( sueltas.length ) out.push( {
		pack: { id: 'personalizacion', titulo: 'Personalización', descripcion: '', desde: '2000-01-01', hasta: '2100-12-31', categorias: sueltas.map( ( c ) => c.id ) },
		estado: 'disponible', categorias: sueltas, ...seleccionDe( v, 'personalizacion' ),
	} );
	return out;

}
