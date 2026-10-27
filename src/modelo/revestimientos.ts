// Revestimientos de suelos y paredes tal como los da la memoria de calidades:
// formato, medidas, aparejo, aspecto, junta y brillo. Los valores de cada
// palabra son los que usa el shader (src/escena/materiales.ts).

/** Código de cada aparejo, de cada aspecto y rugosidad de cada brillo. */
export const APAREJOS = { recto: 0, trabado: 1, aleatorio: 2, espiga: 3 } as const;
export const ASPECTOS = { liso: 0, piedra: 1, marmol: 2, cemento: 3, madera: 4, terrazo: 5 } as const;
export const BRILLOS = { pulido: 0.1, brillo: 0.16, satinado: 0.3, mate: 0.5, antideslizante: 0.72 } as const;
export const FORMATOS = [ 'baldosa', 'lama', 'continuo' ] as const;

export interface Revestimiento {
	formato?: typeof FORMATOS[ number ];
	/** medidas de la pieza en cm, en cualquier orden (60 × 120, 20 × 120…) */
	medidas?: [ number, number ];
	aparejo?: keyof typeof APAREJOS;
	/** trabado: parte de la pieza que se desplaza cada fila (0,5 a medias, 0,33 a tercios) */
	desfase?: number;
	aspecto?: keyof typeof ASPECTOS;
	/** ancho de la junta en mm */
	junta?: number;
	color_junta?: string;
	brillo?: keyof typeof BRILLOS;
	/** giro del despiece en grados (por defecto 0; en espiga, 45) */
	giro?: number;
}

/** Datos de un revestimiento que no se entienden (para la revisión al preparar). */
export function erroresRevestimiento( r: Revestimiento ): string[] {

	const e: string[] = [];
	const vale = ( campo: keyof Revestimiento, lista: readonly string[] ) => {

		const x = r[ campo ];
		if ( x !== undefined && ! lista.includes( x as string ) ) e.push( `${ campo } «${ x }» no es ninguno de: ${ lista.join( ', ' ) }` );

	};
	vale( 'formato', FORMATOS );
	vale( 'aparejo', Object.keys( APAREJOS ) );
	vale( 'aspecto', Object.keys( ASPECTOS ) );
	vale( 'brillo', Object.keys( BRILLOS ) );
	if ( r.medidas !== undefined && ! ( Array.isArray( r.medidas ) && r.medidas.length === 2 && r.medidas.every( ( n ) => typeof n === 'number' && n > 0 && n <= 400 ) ) )
		e.push( 'medidas: tienen que ser dos números en cm, por ejemplo [ 60, 120 ]' );
	if ( r.junta !== undefined && ! ( typeof r.junta === 'number' && r.junta >= 0 && r.junta <= 20 ) ) e.push( 'junta: en mm, entre 0 y 20' );
	if ( r.desfase !== undefined && ! ( typeof r.desfase === 'number' && r.desfase >= 0 && r.desfase < 1 ) ) e.push( 'desfase: fracción de pieza, entre 0 y 1 (0,5 a medias)' );
	return e;

}
