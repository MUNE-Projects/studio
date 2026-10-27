// Equipamiento que la visita y el plano comercial saben representar. Lo que
// no esté aquí lo avisa la comprobación automática (nunca se aproxima en silencio).

export const TIPOS_EQUIPAMIENTO = [
	// cocina
	'encimera', 'isla', 'peninsula', 'columna-frigorifico', 'columna-hornos',
	// baños y lavadero
	'banera', 'banera-exenta', 'ducha', 'inodoro', 'bide', 'lavabo', 'lavabo-doble', 'lavadora', 'secadora',
	// armarios y mobiliario
	'armario', 'mesa-comedor', 'silla', 'sofa', 'mesa-centro', 'mesa-auxiliar', 'mueble-tv', 'cama', 'mesilla',
	// construcción
	'escalera', 'barandilla', 'plaza',
] as const;
