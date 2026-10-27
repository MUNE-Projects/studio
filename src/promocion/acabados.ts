// Acabados de serie de cada promoción, sacados de su memoria de calidades:
// fachada, paredes, techos, carpintería exterior, puertas, suelos, rodapié y
// grifería. Lo que la memoria no dice toma el valor por defecto (el de la demo).
// Las opciones del comprador (suelo de madera, cocina, encimera, baños) siguen
// en el catálogo.
//
// Los suelos y alicatados no son solo un color: llevan formato (baldosa, lama
// o continuo), medidas, aparejo (recto, trabado, espiga), aspecto (liso,
// piedra, mármol, cemento, madera, terrazo), junta y brillo.

import datosPromocion from '@promocion/promocion.json';
import { erroresRevestimiento, type Revestimiento } from '../modelo/revestimientos';

export interface Suelo extends Revestimiento { color: string }
export interface Acabados {
	/** fachada: color y textura (lisa = SATE, monocapa o pintura; ladrillo = cara vista) */
	fachada: { color: string; textura: 'lisa' | 'ladrillo'; junta: string };
	paredes: { color: string };
	techos: { color: string };
	/** perfiles de ventanas y balconeras (y perfilería de las barandillas) */
	carpinteria_exterior: { color: string };
	/** hoja de las puertas interiores: color y ranuras horizontales (0 = lisa) */
	puertas: { color: string; ranuras: number };
	/** suelos de las estancias «porcelanico», de la cocina, «ceramico» y exteriores: color y especificación */
	suelo_general: Suelo;
	suelo_cocina: Suelo;
	suelo_ceramico: Suelo;
	suelo_exterior: Suelo;
	/** tarima de madera: el color es la opción del catálogo; aquí, las lamas y su colocación */
	suelo_madera: Revestimiento;
	/** suelo y alicatado de los baños: el color sale de la opción de baño del catálogo; aquí, el resto */
	suelo_bano: Revestimiento;
	alicatado: Revestimiento;
	rodapie: { color: string };
	/** grifería y accesorios de baño y cocina (cromo, negro mate, oro cepillado…) */
	griferia: { color: string };
}

export const ACABADOS_DEFECTO: Acabados = {
	fachada: { color: '#f1efea', textura: 'lisa', junta: '#d9d4cc' },
	paredes: { color: '#efede8' },
	techos: { color: '#f4f3f0' },
	carpinteria_exterior: { color: '#3a3d3f' },
	puertas: { color: '#f2f0eb', ranuras: 4 },
	suelo_general: { color: '#ddd5c8', formato: 'baldosa', medidas: [ 90, 90 ], junta: 2.5 },
	suelo_cocina: { color: '#ddd5c8', formato: 'baldosa', medidas: [ 90, 90 ], junta: 2.5 },
	suelo_ceramico: { color: '#cfcac1', formato: 'baldosa', medidas: [ 33, 33 ], junta: 3 },
	suelo_exterior: { color: '#b8b1a6', formato: 'baldosa', medidas: [ 60, 60 ], junta: 4 },
	suelo_madera: { formato: 'lama', medidas: [ 19, 145 ], junta: 1.5 },
	suelo_bano: { formato: 'baldosa', medidas: [ 60, 60 ], junta: 2 },
	alicatado: { formato: 'baldosa', medidas: [ 30, 60 ], junta: 2 },
	rodapie: { color: '#f3f1ec' },
	griferia: { color: '#c4c6c7' },
};

type Parcial = { [ K in keyof Acabados ]?: Partial<Acabados[ K ]> };

/** Une los acabados de la promoción con los de por defecto, apartado a apartado. */
export function resolverAcabados( propios: Parcial = {} ): Acabados {

	const r = { ...ACABADOS_DEFECTO } as Record<string, object>;
	for ( const k of Object.keys( ACABADOS_DEFECTO ) as ( keyof Acabados )[] ) {

		const propio = ( propios[ k ] ?? {} ) as Revestimiento;
		const unido = { ...ACABADOS_DEFECTO[ k ], ...propio } as Revestimiento;
		// otro formato sin medidas: las suyas por defecto (lama 20 × 120), no las del de por defecto
		if ( propio.formato && propio.formato !== ( ACABADOS_DEFECTO[ k ] as Revestimiento ).formato && ! propio.medidas ) delete unido.medidas;
		r[ k ] = unido;

	}
	return r as unknown as Acabados;

}

export const ACABADOS = resolverAcabados( ( datosPromocion as { acabados?: Parcial } ).acabados );

/** Color liso para cantos de forjado, losas y petos (con fachada de ladrillo, mortero claro). */
export const colorLiso = () => ACABADOS.fachada.textura === 'ladrillo' ? ACABADOS_DEFECTO.fachada.color : ACABADOS.fachada.color;

/** Formato, medidas y aparejo en palabras («baldosa de 90 × 90 cm a junta recta»). */
export function describirDespiece( r: Revestimiento ): string {

	if ( r.formato === 'continuo' ) return 'continuo, sin juntas';
	const [ a, b ] = [ ...( r.medidas ?? ( r.formato === 'lama' ? [ 20, 120 ] : [ 60, 60 ] ) ) ].sort( ( x, y ) => x - y );
	const aparejo = r.aparejo ?? ( r.formato === 'lama' ? 'aleatorio' : 'recto' );
	const lamas = r.formato === 'lama';
	const como = { recto: 'a junta recta', trabado: lamas ? 'trabadas' : 'trabada', aleatorio: lamas ? 'trabadas al azar' : 'trabada al azar', espiga: 'en espiga' }[ aparejo ];
	return `${ lamas ? 'lamas' : 'baldosa' } de ${ a } × ${ b } cm ${ como }`;

}

const DESPIECE = ( k: 'suelo_general' | 'suelo_cocina' | 'suelo_ceramico' | 'suelo_exterior' | 'suelo_madera' | 'suelo_bano' | 'alicatado' ): [ string, string ] =>
	[ 'formato, medidas y colocación', describirDespiece( ACABADOS_DEFECTO[ k ] ) ];

/** Qué es cada apartado y cómo se describe en palabras lo que se pone por defecto. */
const APARTADOS: { [ K in keyof Acabados ]: { nombre: string; campos: { [ C in keyof Acabados[ K ] ]?: [ string, string ] } } } = {
	fachada: { nombre: 'Fachada', campos: { textura: [ 'acabado', 'lisa (SATE, monocapa o pintura)' ], color: [ 'color', 'blanco roto' ] } },
	paredes: { nombre: 'Paredes interiores', campos: { color: [ 'color', 'pintura blanca' ] } },
	techos: { nombre: 'Techos', campos: { color: [ 'color', 'pintura blanca' ] } },
	carpinteria_exterior: { nombre: 'Carpintería exterior (ventanas y balconeras)', campos: { color: [ 'color', 'gris antracita' ] } },
	puertas: { nombre: 'Puertas interiores', campos: { color: [ 'acabado', 'lacadas en blanco' ], ranuras: [ 'diseño', 'con 4 ranuras horizontales' ] } },
	suelo_general: { nombre: 'Suelo de porcelánico', campos: { color: [ 'color', 'beige claro' ], medidas: DESPIECE( 'suelo_general' ), aspecto: [ 'aspecto', 'liso' ], brillo: [ 'brillo', 'satinado' ] } },
	suelo_cocina: { nombre: 'Suelo de la cocina', campos: { color: [ 'color', 'beige claro' ], medidas: DESPIECE( 'suelo_cocina' ), aspecto: [ 'aspecto', 'liso' ], brillo: [ 'brillo', 'satinado' ] } },
	suelo_ceramico: { nombre: 'Suelo cerámico', campos: { color: [ 'color', 'beige' ], medidas: DESPIECE( 'suelo_ceramico' ), aspecto: [ 'aspecto', 'liso' ], brillo: [ 'brillo', 'mate' ] } },
	suelo_exterior: { nombre: 'Suelo de terrazas y exteriores', campos: { color: [ 'color', 'gris piedra' ], medidas: DESPIECE( 'suelo_exterior' ), aspecto: [ 'aspecto', 'liso' ], brillo: [ 'brillo', 'antideslizante' ] } },
	suelo_madera: { nombre: 'Suelo de madera (tarima o laminado)', campos: { medidas: DESPIECE( 'suelo_madera' ) } },
	suelo_bano: { nombre: 'Suelo de los baños', campos: { medidas: DESPIECE( 'suelo_bano' ), aspecto: [ 'aspecto', 'liso' ], brillo: [ 'brillo', 'satinado' ] } },
	alicatado: { nombre: 'Alicatado de baños y cocina', campos: { medidas: DESPIECE( 'alicatado' ), aspecto: [ 'aspecto', 'liso' ], brillo: [ 'brillo', 'con brillo' ] } },
	rodapie: { nombre: 'Rodapié', campos: { color: [ 'acabado', 'lacado en blanco' ] } },
	griferia: { nombre: 'Grifería', campos: { color: [ 'acabado', 'cromada' ] } },
};

/** Lo que la memoria no dice y se pondrá por defecto. */
export interface Supuesto { apartado: string; dato: string; porDefecto: string }

/**
 * Acabados que la promoción no indica (y usa), con lo que se pondrá por
 * defecto. `usados`: tipos de suelo que aparecen en sus viviendas y si tiene
 * ventanas, puertas o exteriores, para no pedir lo que no lleva.
 */
export function acabadosSupuestos( usados: { suelos: Set<string>; ventanas: boolean; puertas: boolean; humedos: boolean } ): Supuesto[] {

	const propios = ( datosPromocion as { acabados?: Parcial } ).acabados ?? {};
	const aplica: Record<keyof Acabados, boolean> = {
		fachada: true, paredes: true, techos: true, rodapie: true, griferia: true,
		carpinteria_exterior: usados.ventanas, puertas: usados.puertas,
		suelo_general: usados.suelos.has( 'porcelanico' ), suelo_cocina: usados.suelos.has( 'porcelanico-cocina' ),
		suelo_ceramico: usados.suelos.has( 'ceramico' ), suelo_exterior: usados.suelos.has( 'exterior' ),
		suelo_madera: usados.suelos.has( 'madera' ), suelo_bano: usados.suelos.has( 'porcelanico-bano' ), alicatado: usados.humedos,
	};
	const salida: Supuesto[] = [];
	for ( const k of Object.keys( APARTADOS ) as ( keyof Acabados )[] ) {

		if ( ! aplica[ k ] ) continue;
		const dado = ( propios[ k ] ?? {} ) as Record<string, unknown>;
		for ( const [ campo, [ dato, porDefecto ] ] of Object.entries( APARTADOS[ k ].campos ) as [ string, [ string, string ] ][] ) {

			if ( dado[ campo ] === undefined ) salida.push( { apartado: APARTADOS[ k ].nombre, dato, porDefecto } );

		}

	}
	return salida;

}

/** Datos de acabados de la promoción que no se entienden (apartado: problema). */
export function erroresAcabados(): string[] {

	const propios = ( datosPromocion as { acabados?: Record<string, unknown> } ).acabados ?? {};
	const e: string[] = [];
	for ( const [ k, valor ] of Object.entries( propios ) ) {

		if ( ! ( k in ACABADOS_DEFECTO ) ) e.push( `«${ k }» no es un apartado de acabados conocido` );
		else if ( k.startsWith( 'suelo_' ) || k === 'alicatado' ) for ( const x of erroresRevestimiento( valor as Revestimiento ) ) e.push( `${ APARTADOS[ k as keyof Acabados ].nombre }: ${ x }` );

	}
	return e;

}
