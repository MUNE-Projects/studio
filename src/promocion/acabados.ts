// Acabados de serie de cada promoción, sacados de su memoria de calidades:
// fachada, paredes, techos, carpintería exterior, puertas, suelos, rodapié y
// grifería. Lo que la memoria no dice toma el valor por defecto (el de la demo).
// Las opciones del comprador (suelo de madera, cocina, encimera, baños) siguen
// en el catálogo.

import datosPromocion from '@promocion/promocion.json';

export interface Pieza { color: string; pieza: number }
export interface Acabados {
	/** fachada: color y textura (lisa = SATE, monocapa o pintura; ladrillo = cara vista) */
	fachada: { color: string; textura: 'lisa' | 'ladrillo'; junta: string };
	paredes: { color: string };
	techos: { color: string };
	/** perfiles de ventanas y balconeras (y perfilería de las barandillas) */
	carpinteria_exterior: { color: string };
	/** hoja de las puertas interiores: color y ranuras horizontales (0 = lisa) */
	puertas: { color: string; ranuras: number };
	/** porcelánico de las estancias con suelo «porcelanico», de la cocina, cerámico y exterior: color y lado de la pieza (m) */
	suelo_general: Pieza;
	suelo_cocina: Pieza;
	suelo_ceramico: Pieza;
	suelo_exterior: Pieza;
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
	suelo_general: { color: '#ddd5c8', pieza: 0.9 },
	suelo_cocina: { color: '#ddd5c8', pieza: 0.9 },
	suelo_ceramico: { color: '#cfcac1', pieza: 0.33 },
	suelo_exterior: { color: '#b8b1a6', pieza: 0.6 },
	rodapie: { color: '#f3f1ec' },
	griferia: { color: '#c4c6c7' },
};

type Parcial = { [ K in keyof Acabados ]?: Partial<Acabados[ K ]> };

/** Une los acabados de la promoción con los de por defecto, apartado a apartado. */
export function resolverAcabados( propios: Parcial = {} ): Acabados {

	const r = { ...ACABADOS_DEFECTO } as Record<string, object>;
	for ( const k of Object.keys( ACABADOS_DEFECTO ) as ( keyof Acabados )[] ) r[ k ] = { ...ACABADOS_DEFECTO[ k ], ...( propios[ k ] ?? {} ) };
	return r as unknown as Acabados;

}

export const ACABADOS = resolverAcabados( ( datosPromocion as { acabados?: Parcial } ).acabados );

/** Color liso para cantos de forjado, losas y petos (con fachada de ladrillo, mortero claro). */
export const colorLiso = () => ACABADOS.fachada.textura === 'ladrillo' ? ACABADOS_DEFECTO.fachada.color : ACABADOS.fachada.color;
