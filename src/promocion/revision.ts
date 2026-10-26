// Actualización de planos: comparar dos versiones de la geometría de una
// tipología y revisar qué partes de la promoción hay que repasar.
//
// Todo (visor, renders, plano comercial, personalizaciones y documentos)
// sale de los mismos datos; al sustituir vivienda.json por una versión nueva
// se regenera solo. Lo que NO es automático es lo que se compuso a mano sobre
// la geometría anterior: cámaras, decoración, parches de alternativas y
// referencias a ids. Esta revisión lo señala para repasarlo en el Studio.

import type { Ambientacion } from '../biblioteca/biblioteca';
import { activo, huella } from '../biblioteca/biblioteca';
import type { Configuracion, Rect, Tipologia, Alternativa, Vivienda } from '../modelo/tipos';
import { areaPoligono, puntoEnPoligono, puntoEnRect } from '../util/geo';
import { revisarVistas } from '../escena/vistas';
import { alturasHueco } from '../modelo/huecos';
import { alturaEn, alturasEstancia } from '../modelo/alturas';

const TIPOS_HUECO = [ 'entrada', 'puerta', 'paso', 'balconera', 'ventana' ];
const TIPOS_PUERTA = [ 'abatible', 'doble', 'corredera', 'corredera-empotrada' ];
const APERTURAS = [ 'corredera', 'oscilobatiente', 'abatible', 'fija', 'proyectante' ];

export type Nivel = 'error' | 'aviso' | 'ok';
export interface Hallazgo { nivel: Nivel; ambito: string; mensaje: string }

const r2 = ( n: number ) => Math.round( n * 100 ) / 100;
const distinto = ( a: Rect, b: Rect, tol = 0.01 ) => a.some( ( x, i ) => Math.abs( x - b[ i ] ) > tol );

/** Cambios entre dos versiones de la geometría (por id). */
export function compararViviendas( antes: Vivienda, ahora: Vivienda ) {

	const cambios: { ambito: string; tipo: 'nuevo' | 'eliminado' | 'modificado'; id: string; detalle: string }[] = [];
	const porId = <T extends { id: string }>( xs: T[] ) => new Map( xs.map( ( x ) => [ x.id, x ] ) );
	const comparar = <T extends { id: string }>( ambito: string, a: T[], b: T[], detalle: ( x: T, y: T ) => string | null ) => {

		const ma = porId( a ), mb = porId( b );
		for ( const [ id, x ] of ma ) {

			const y = mb.get( id );
			if ( ! y ) cambios.push( { ambito, tipo: 'eliminado', id, detalle: '' } );
			else {

				const d = detalle( x, y );
				if ( d ) cambios.push( { ambito, tipo: 'modificado', id, detalle: d } );

			}

		}

		for ( const id of mb.keys() ) if ( ! ma.has( id ) ) cambios.push( { ambito, tipo: 'nuevo', id, detalle: '' } );

	};

	comparar( 'Muros', antes.muros, ahora.muros, ( x, y ) => distinto( x.rect, y.rect ) ? `[${ x.rect.join( ', ' ) }] → [${ y.rect.join( ', ' ) }]` : null );
	comparar( 'Huecos', antes.huecos, ahora.huecos, ( x, y ) => {

		const d: string[] = [];
		if ( x.muro !== y.muro ) d.push( `muro ${ x.muro } → ${ y.muro }` );
		if ( Math.abs( x.desde - y.desde ) > 0.01 || Math.abs( x.hasta - y.hasta ) > 0.01 ) d.push( `${ x.desde }–${ x.hasta } → ${ y.desde }–${ y.hasta }` );
		if ( x.tipo !== y.tipo ) d.push( `${ x.tipo } → ${ y.tipo }` );
		if ( x.bisagra !== y.bisagra || x.abre !== y.abre ) d.push( 'cambia el sentido de apertura' );
		return d.length ? d.join( '; ' ) : null;

	} );
	comparar( 'Estancias', antes.estancias, ahora.estancias, ( x, y ) => {

		const d: string[] = [];
		if ( x.nombre !== y.nombre ) d.push( `«${ x.nombre }» → «${ y.nombre }»` );
		if ( Math.abs( x.superficie - y.superficie ) > 0.005 ) d.push( `${ x.superficie } → ${ y.superficie } m² (${ y.superficie > x.superficie ? '+' : '' }${ r2( y.superficie - x.superficie ) })` );
		if ( x.suelo !== y.suelo ) d.push( `suelo ${ x.suelo } → ${ y.suelo }` );
		if ( JSON.stringify( x.poligono ) !== JSON.stringify( y.poligono ) && ! d.length ) d.push( 'cambia el contorno' );
		return d.length ? d.join( '; ' ) : null;

	} );
	comparar( 'Equipamiento', antes.equipamiento, ahora.equipamiento, ( x, y ) => {

		const d: string[] = [];
		if ( x.tipo !== y.tipo ) d.push( `${ x.tipo } → ${ y.tipo }` );
		if ( distinto( x.rect, y.rect ) ) d.push( 'se mueve o cambia de medidas' );
		if ( x.frente !== y.frente ) d.push( `frente ${ x.frente } → ${ y.frente }` );
		return d.length ? d.join( '; ' ) : null;

	} );
	return cambios;

}

/** ¿Está el punto dentro de la vivienda (estancias interiores o el paso de una puerta)? */
function dentroInterior( v: Vivienda, x: number, y: number ) {

	return v.estancias.some( ( e ) => e.uso !== 'exterior' && puntoEnPoligono( x, y, e.poligono ) );

}

/** Revisión completa de lo que depende de la geometría. */
export function revisarPromocion( v: Vivienda, t: Tipologia, alternativas: Alternativa[], amb: Ambientacion | null, catalogo: Configuracion ): Hallazgo[] {

	const h: Hallazgo[] = [];
	const add = ( nivel: Nivel, ambito: string, mensaje: string ) => h.push( { nivel, ambito, mensaje } );
	const muros = new Set( v.muros.map( ( m ) => m.id ) );
	const huecos = new Set( v.huecos.map( ( x ) => x.id ) );
	const estancias = new Set( v.estancias.map( ( e ) => e.id ) );
	const equipos = new Set( v.equipamiento.map( ( e ) => e.id ) );

	// superficies: polígono frente a la cifra declarada y total frente a la oficial
	for ( const e of v.estancias ) {

		const a = areaPoligono( e.poligono );
		// el contorno de planta suele medir un 3-4 % más que la superficie útil oficial
		if ( Math.abs( a - e.superficie ) / e.superficie > 0.05 ) add( 'aviso', 'Superficies', `«${ e.nombre }»: el contorno mide ${ r2( a ) } m² y la superficie declarada es ${ e.superficie } m².` );

	}

	const util = v.estancias.filter( ( e ) => e.uso !== 'exterior' ).reduce( ( s, e ) => s + e.superficie, 0 );
	const oficial = v.meta.superficies_oficiales.interior;
	if ( Math.abs( util - oficial ) > 0.05 ) add( 'aviso', 'Superficies', `La suma de estancias (${ r2( util ) } m²) no coincide con la superficie útil oficial (${ oficial } m²).` );
	else add( 'ok', 'Superficies', `Superficie útil coherente: ${ r2( util ) } m².` );

	// techos propios (falsos techos e inclinados): dentro de la altura general
	for ( const e of v.estancias.filter( ( s ) => s.techo ) ) {

		const [ lo, hi ] = alturasEstancia( e, v );
		if ( hi > v.alturas.libre.valor + 0.01 ) add( 'error', 'Alturas', `«${ e.nombre }»: el techo llega a ${ hi } m y la altura libre general es ${ v.alturas.libre.valor } m; sube la general hasta el punto más alto.` );
		if ( lo < 1.0 ) add( 'aviso', 'Alturas', `«${ e.nombre }»: el techo baja hasta ${ lo } m. Compruébalo en las secciones.` );

	}

	// huecos anclados a muros existentes y dentro de su tramo
	for ( const x of v.huecos ) {

		const m = v.muros.find( ( w ) => w.id === x.muro );
		if ( ! m ) {

			add( 'error', 'Huecos', `«${ x.id }» está en el muro «${ x.muro }», que no existe.` );
			continue;

		}

		const [ a, b ] = x.eje === 'x' ? [ m.rect[ 0 ], m.rect[ 2 ] ] : [ m.rect[ 1 ], m.rect[ 3 ] ];
		if ( x.desde < a - 0.01 || x.hasta > b + 0.01 ) add( 'error', 'Huecos', `«${ x.id }» se sale del muro «${ x.muro }».` );
		// lo que la visita todavía no sabe representar se dice, no se aproxima
		if ( ! TIPOS_HUECO.includes( x.tipo ) ) add( 'error', 'Huecos', `«${ x.id }» es de tipo «${ x.tipo }», que la visita aún no sabe representar.` );
		if ( x.puerta && ! TIPOS_PUERTA.includes( x.puerta ) ) add( 'error', 'Huecos', `«${ x.id }»: puerta «${ x.puerta }» que la visita aún no sabe representar.` );
		if ( x.apertura && ! APERTURAS.includes( x.apertura ) ) add( 'error', 'Huecos', `«${ x.id }»: apertura «${ x.apertura }» que la visita aún no sabe representar.` );
		const [ z0, z1 ] = alturasHueco( x, v );
		if ( z0 >= z1 || z1 > v.alturas.libre.valor + 0.01 ) add( 'error', 'Huecos', `«${ x.id }»: alturas imposibles (de ${ z0 } a ${ z1 } m, con ${ v.alturas.libre.valor } m de altura libre).` );
		if ( x.tipo === 'ventana' && x.antepecho === undefined && ! v.alturas.antepecho ) add( 'aviso', 'Huecos', `«${ x.id }»: ventana sin altura de alféizar; se supone 0,9 m. Compruébala en alzados o secciones.` );
		if ( ( x.hojas ?? 1 ) > 4 ) add( 'aviso', 'Huecos', `«${ x.id }»: ${ x.hojas } hojas; se dibujan como máximo 4.` );
		// el dintel no puede quedar por encima del techo de las estancias a las que da
		const [ mx0, my0, mx1, my1 ] = m.rect, u = ( x.desde + x.hasta ) / 2;
		const lados = x.eje === 'x' ? [ [ u, my0 - 0.2 ], [ u, my1 + 0.2 ] ] : [ [ mx0 - 0.2, u ], [ mx1 + 0.2, u ] ];
		for ( const [ px, py ] of lados ) {

			const e = v.estancias.find( ( s ) => s.uso !== 'exterior' && s.techo && puntoEnPoligono( px, py, s.poligono ) );
			if ( e && z1 > alturaEn( e, v, px, py ) + 0.01 ) add( 'error', 'Alturas', `«${ x.id }» (dintel a ${ z1 } m) queda por encima del techo de «${ e.nombre }» (${ r2( alturaEn( e, v, px, py ) ) } m).` );

		}

	}

	// equipamiento dentro de alguna estancia
	for ( const e of v.equipamiento ) {

		const cx = ( e.rect[ 0 ] + e.rect[ 2 ] ) / 2, cy = ( e.rect[ 1 ] + e.rect[ 3 ] ) / 2;
		if ( ! v.estancias.some( ( s ) => puntoEnPoligono( cx, cy, s.poligono ) ) ) add( 'aviso', 'Equipamiento', `«${ e.id }» (${ e.tipo }) queda fuera de las estancias.` );
		if ( v.muros.some( ( m ) => puntoEnRect( cx, cy, m.rect ) ) ) add( 'error', 'Equipamiento', `«${ e.id }» (${ e.tipo }) cae dentro de un muro.` );

	}

	// cámaras maestras: dentro de la vivienda las interiores y lejos de muros
	for ( const [ k, vista ] of Object.entries( t.vistas ) ) {

		if ( k === 'planta' || ! vista.interior ) continue;
		const [ x, , z ] = vista.pos, y = - z;
		if ( ! dentroInterior( v, x, y ) && ! v.huecos.some( ( hh ) => {

			const m = v.muros.find( ( w ) => w.id === hh.muro );
			return m && puntoEnRect( x, y, m.rect, 0.05 );

		} ) ) add( 'error', 'Cámaras', `La vista «${ vista.nombre }» queda fuera de la vivienda o dentro de un muro: hay que recolocarla.` );
		else if ( v.muros.some( ( m ) => puntoEnRect( x, y, m.rect, 0.08 ) ) ) add( 'aviso', 'Cámaras', `La vista «${ vista.nombre }» está pegada a un muro (menos de 8 cm).` );
		if ( vista.estancia && ! estancias.has( vista.estancia ) ) add( 'aviso', 'Cámaras', `La vista «${ vista.nombre }» se refiere a la estancia «${ vista.estancia }», que ya no existe.` );

	}

	for ( const a of revisarVistas( t, v ) ) add( 'aviso', 'Vistas guiadas', a );

	// ambientación
	if ( amb ) {

		for ( const id of Object.keys( amb.sustituciones ) ) if ( ! equipos.has( id ) ) add( 'aviso', 'Ambientación', `Sustitución para «${ id }», que ya no está en el plano.` );
		for ( const d of amb.decoracion ) {

			const r = huella( d );
			const [ cx, cy ] = d.pos;
			if ( ! v.estancias.some( ( e ) => puntoEnPoligono( cx, cy, e.poligono ) ) ) add( 'aviso', 'Ambientación', `La decoración «${ d.id }» queda fuera de las estancias.` );
			else if ( d.elev < 0.05 && v.muros.some( ( m ) => r[ 0 ] < m.rect[ 2 ] - 0.02 && r[ 2 ] > m.rect[ 0 ] + 0.02 && r[ 1 ] < m.rect[ 3 ] - 0.02 && r[ 3 ] > m.rect[ 1 ] + 0.02 ) ) add( 'aviso', 'Ambientación', `La decoración «${ d.id }» invade un muro.` );
			// objetos apoyados (no colgados en la pared ni del techo): debe haber algo debajo
			const a = activo( d.activo );
			const colgado = a?.categoria === 'cuadros' || a?.generador === 'toallero' || a?.generador === 'lampara-colgante';
			if ( d.elev > 0.05 && ! colgado && ! v.equipamiento.some( ( e ) => puntoEnRect( cx, cy, e.rect, 0.05 ) ) && ! amb.decoracion.some( ( o ) => o !== d && o.elev < 0.05 && puntoEnRect( cx, cy, huella( o ), 0.02 ) && activo( o.activo )?.categoria !== 'alfombras' ) ) add( 'aviso', 'Ambientación', `«${ a?.nombre ?? d.id }» (${ d.id }) está apoyado a ${ d.elev } m y ya no hay ningún mueble debajo.` );
			if ( ! estancias.has( d.estancia ) && d.estancia !== 'exterior' ) add( 'aviso', 'Ambientación', `La decoración «${ d.id }» se asignó a la estancia «${ d.estancia }», que ya no existe.` );

		}

	}

	// alternativas: el parche debe referirse a ids que existan
	for ( const va of alternativas ) {

		const faltan = [
			...[ ...va.muros.quitar, ...Object.keys( va.muros.modificar ) ].filter( ( id ) => ! muros.has( id ) ).map( ( id ) => `muro ${ id }` ),
			...[ ...va.huecos.quitar, ...Object.keys( va.huecos.modificar ) ].filter( ( id ) => ! huecos.has( id ) ).map( ( id ) => `hueco ${ id }` ),
			...Object.keys( va.estancias.modificar ).filter( ( id ) => ! estancias.has( id ) ).map( ( id ) => `estancia ${ id }` ),
			...[ ...va.equipamiento.quitar, ...Object.keys( va.equipamiento.modificar ) ].filter( ( id ) => ! equipos.has( id ) ).map( ( id ) => `equipamiento ${ id }` ),
		];
		if ( faltan.length ) add( 'error', 'Alternativas', `La alternativa «${ va.nombre }» modifica elementos que ya no existen: ${ faltan.join( ', ' ) }. Hay que rehacer su parche.` );
		else add( 'ok', 'Alternativas', `La alternativa «${ va.nombre }» sigue siendo aplicable (revisar visualmente su resultado).` );
		// geometría modificada por la alternativa: ¿sigue dentro de su muro original?
		for ( const [ id, cambio ] of Object.entries( va.muros.modificar ) ) {

			const m = v.muros.find( ( w ) => w.id === id );
			const rr = cambio.rect as Rect | undefined;
			if ( m && rr && ( rr[ 0 ] < m.rect[ 0 ] - 0.3 || rr[ 2 ] > m.rect[ 2 ] + 0.3 || rr[ 1 ] < m.rect[ 1 ] - 0.3 || rr[ 3 ] > m.rect[ 3 ] + 0.3 ) ) add( 'aviso', 'Alternativas', `La alternativa «${ va.nombre }» mueve el muro «${ id }» fuera de su posición actual: comprobar.` );

		}

	}

	// catálogo: opciones que activan alternativas existentes
	const idsAlternativas = new Set( alternativas.map( ( x ) => x.id ) );
	for ( const c of catalogo.categorias ) for ( const o of c.opciones ) if ( o.alternativa && ! idsAlternativas.has( o.alternativa ) ) add( 'error', 'Personalización', `La opción «${ o.nombre }» activa la alternativa «${ o.alternativa }», que no existe en esta tipología.` );

	if ( ! h.some( ( x ) => x.nivel !== 'ok' ) ) add( 'ok', 'General', 'Sin incidencias: la promoción está al día con esta versión del plano.' );
	return h;

}
