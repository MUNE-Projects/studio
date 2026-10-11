// MUNE Portal · quién puede hacer qué en cada promoción (020_equipos_y_validaciones.sql).
//
// Cada persona tiene uno o varios accesos en su promotora: uno para «todas las
// promociones» (promocion_id vacío) y/o uno por promoción. Quien administra
// tiene todas las capacidades dentro de su alcance. Lo que se calcula aquí
// solo decide qué se enseña: lo que de verdad manda son las reglas de la base
// de datos.

export const CAPACIDADES: [string, string][] = [
	['documentacion', 'Documentación'],
	['planos', 'Planos comerciales'],
	['compradores', 'Compradores'],
	['personalizacion', 'Personalización'],
	['materiales', 'Materiales'],
	['datos', 'Datos de la promoción'],
];
export const NOMBRE_CAPACIDAD: Record<string, string> = Object.fromEntries(CAPACIDADES);

export interface Miembro {
	id: number; promotora_id: string; promocion_id: string | null; nombre: string; cargo: string;
	administra: boolean; capacidades: string[];
}

export interface Permisos {
	/** Administra la promotora entera (todas sus promociones, también las futuras). */
	esAdminPromotora: boolean;
	/** Administra esta promoción (como administradora de la promotora o de la promoción). */
	administraPromocion: boolean;
	capacidades: Set<string>;
	puede: (capacidad: string) => boolean;
}

/** Permisos de la sesión en una promoción (o en general, sin promoción). */
export function permisosDe(filas: Miembro[], promotora: string, promocion: string | null): Permisos {
	const mias = filas.filter((m) => m.promotora_id === promotora && (m.promocion_id === null || m.promocion_id === promocion));
	const esAdminPromotora = mias.some((m) => m.promocion_id === null && m.administra);
	const administraPromocion = promocion !== null && mias.some((m) => m.administra);
	const capacidades = new Set<string>(administraPromocion || esAdminPromotora
		? CAPACIDADES.map(([k]) => k)
		: mias.flatMap((m) => m.capacidades ?? []));
	return { esAdminPromotora, administraPromocion: administraPromocion || esAdminPromotora, capacidades, puede: (c) => capacidades.has(c) };
}
