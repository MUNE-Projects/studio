// Formato de datos de una vivienda. Todo en metros, en planta:
// x hacia el este, y hacia el norte. Cada dato lleva su `origen`
// (plano | usuario | memoria | supuesto) para saber qué es fiable.

export type Rect = [ number, number, number, number ]; // xmin, ymin, xmax, ymax
export type Punto = [ number, number ];
export type Orientacion = 'n' | 's' | 'e' | 'o';

export interface Valor<T> {
	valor: T;
	origen: string;
}

export interface Muro {
	id: string;
	tipo: 'envolvente' | 'tabique' | 'pilar';
	rect: Rect;
	origen: string;
}

/**
 * Hueco en un muro. Lo que dice el proyecto de cada uno (planos y memoria de
 * calidades); lo que no se indica toma el valor general de la vivienda.
 *  · entrada: puerta de la vivienda.
 *  · puerta: puerta interior (abatible de una o dos hojas, corredera vista o
 *    corredera empotrada en el tabique).
 *  · paso: hueco sin puerta.
 *  · balconera: puerta-ventana hasta el suelo (acceso a terraza, balcón…).
 *  · ventana: ventana con antepecho (alféizar a media altura).
 */
export interface Hueco {
	id: string;
	muro: string;
	tipo: 'entrada' | 'puerta' | 'paso' | 'balconera' | 'ventana';
	eje: 'x' | 'y';
	desde: number;
	hasta: number;
	/** puertas abatibles: lado de la bisagra y hacia dónde abre */
	bisagra?: 'inicio' | 'fin';
	abre?: Orientacion;
	/** puertas interiores: cómo es la hoja (por defecto, abatible) */
	puerta?: 'abatible' | 'doble' | 'corredera' | 'corredera-empotrada';
	/** ventanas y balconeras: cómo abre la carpintería (por defecto, oscilobatiente) */
	apertura?: 'corredera' | 'oscilobatiente' | 'abatible' | 'fija' | 'proyectante';
	/** ventanas y balconeras: número de hojas (por defecto, 2; 1 si mide menos de 0,9 m) */
	hojas?: number;
	/** ventanas: altura del alféizar sobre el suelo, en metros */
	antepecho?: number;
	/** altura del dintel sobre el suelo, si no es la general de la vivienda */
	alto?: number;
	/** ventanas y balconeras: persiana enrollable (por defecto, sí) */
	persiana?: boolean;
	origen: string;
}

export type Uso = 'dia' | 'noche' | 'humedo' | 'servicio' | 'circulacion' | 'exterior';

export interface Estancia {
	id: string;
	nombre: string;
	superficie: number;
	uso: Uso;
	suelo: string;
	poligono: Punto[];
	origen: string;
}

export interface Equipamiento {
	id: string;
	tipo: string;
	rect: Rect;
	frente: Orientacion;
	fijo: boolean;
	origen: string;
	placa?: [ number, number ];
	fregadero?: [ number, number ];
	lavavajillas?: [ number, number ];
}

export interface Vivienda {
	meta: {
		nombre: string;
		fuente: string;
		superficies_oficiales: { interior: number; exterior: number; construida: number };
	};
	alturas: {
		libre: Valor<number>;
		forjado: Valor<number>;
		puerta_interior: Valor<number>;
		puerta_entrada: Valor<number>;
		balconera: Valor<number>;
		/** dintel de las ventanas (por defecto, el de las balconeras) */
		ventana?: Valor<number>;
		/** altura del alféizar de las ventanas (por defecto, 0,9 m) */
		antepecho?: Valor<number>;
		barandilla: Valor<number>;
	};
	muros: Muro[];
	huecos: Hueco[];
	estancias: Estancia[];
	equipamiento: Equipamiento[];
	exterior: {
		barandilla: { recorrido: Punto[]; postes_x: number[] };
	};
}

// ------------------------------------------------------------ configurador

/** Parche de distribución: solo describe lo que cambia respecto a la vivienda base. */
export interface Alternativa {
	id: string;
	nombre: string;
	descripcion: string;
	/** Frase corta para el aviso al comprador. */
	resumen: string;
	/** Vista que explica el efecto espacial de la alternativa. */
	vista: { nombre: string; pos: [ number, number, number ]; obj: [ number, number, number ]; fov: number; interior?: boolean } | null;
	origen: string;
	muros: { quitar: string[]; anadir: Muro[]; modificar: Record<string, Partial<Muro>> };
	huecos: { quitar: string[]; anadir: Hueco[]; modificar: Record<string, Partial<Hueco>> };
	estancias: { modificar: Record<string, Partial<Estancia>> };
	equipamiento: { quitar: string[]; anadir: Equipamiento[]; modificar: Record<string, Partial<Equipamiento>> };
}

export interface Opcion {
	id: string;
	nombre: string;
	detalle?: string;
	precio: number;
	alternativa?: string | null;
	piscina?: boolean;
	parametros?: Record<string, string | number>;
}

export interface Categoria {
	id: string;
	nombre: string;
	detalle?: string;
	/** Vista maestra a la que llevar al cambiar la opción, o "mantener". */
	vista: string;
	/** Solo lleva a la vista al activar una mejora, no al volver a la opción incluida. */
	soloAlActivar?: boolean;
	opciones: Opcion[];
}

export interface Configuracion {
	moneda: string;
	categorias: Categoria[];
}

export interface Piscina {
	rect: Rect; alturaVaso: number; alturaAgua: number; espesor: number; albardilla: number; pasoMinimoFachada: number;
}

// ------------------------------------------------------------ promoción

export interface Vista {
	nombre: string;
	pos: [ number, number, number ];
	obj: [ number, number, number ];
	fov: number;
	interior?: boolean;
	/** Estancia que enseña (para la regla de vistas obligatorias). */
	estancia?: string;
	/** Generada automáticamente porque faltaba una vista de la estancia. */
	automatica?: boolean;
}

/** Tipología: geometría, cámaras maestras y extras que dependen de la geometría. */
export interface Tipologia {
	id: string;
	nombre: string;
	resumen: string;
	dormitorios: number;
	banos: number;
	vistas: Record<string, Vista>;
	guiadas: string[];
	piscina?: Piscina;
	/** Orientación: ángulo (grados, sentido horario) del norte respecto al eje y+ del plano. */
	norte?: { angulo: number; origen: string; nota?: string };
	/** Revisión del proyecto de la que sale la geometría (para planos y documentos). */
	revision?: { fase: string; version: string; fecha: string; fuente?: string };
}

export interface ViviendaPromocion {
	ref: string;
	portal?: string;
	planta: string;
	tipologia: string;
	/** Vivienda simétrica de su tipología (se espeja la geometría al cargar). */
	espejo: boolean;
	orientacion: string;
	superficies: { util: number; exterior: number; construida: number };
	/** Restricciones de opciones para esta vivienda (por categoría). */
	opciones?: Record<string, string[]>;
	nota?: string;
	/**
	 * (Ya no se usa: los códigos de comprador se comprueban en Supabase,
	 * 014_codigos_comprador.sql, y no van en la web pública.)
	 */
	acceso?: string;
	/**
	 * Selecciones ya formalizadas por el comprador (las registra la promotora al
	 * recibir el documento firmado y el pago). Se muestran como histórico en los
	 * packs cuyo periodo ha finalizado. Viven en Supabase (selecciones_comprador)
	 * y solo llegan al navegador al entrar con el código de la vivienda.
	 */
	selecciones?: Record<string, { fecha: string; opciones: Record<string, string>; estado?: 'seleccionada' | 'cerrada'; importe?: number }>;
	/** Contacto y datos de pago de la formalización: solo llegan con el código de la vivienda. */
	formalizacion?: Formalizacion;
}

export type EstadoPack = 'disponible' | 'proximamente' | 'finalizado';

/** Pack de personalización: un conjunto de categorías que se abre durante un periodo. */
export interface Pack {
	id: string;
	titulo: string;
	descripcion: string;
	/** Periodo de selección (fechas ISO, ambas incluidas). */
	desde: string;
	hasta: string;
	categorias: string[];
	/** Fuerza el estado (si no, se deduce de las fechas). */
	estado?: EstadoPack;
}

/** Datos para el pago por transferencia de las mejoras. */
export interface Pagos {
	titular?: string;
	banco?: string;
	iban?: string;
	bic?: string;
	/** Concepto de la transferencia; admite {ref}, {pack}, {promocion}. */
	concepto?: string;
	/** Días para realizar la transferencia desde la firma. */
	plazoDias?: number;
	instrucciones?: string;
}

/**
 * Formalización de la personalización: a quién envía el comprador el documento
 * firmado y los datos para la transferencia. La configura la promotora en
 * MUNE Portal; vive en Supabase y solo llega al navegador con un código de
 * comprador válido (016_formalizacion.sql).
 */
export interface Formalizacion {
	contacto?: { nombre?: string; email?: string; telefono?: string };
	pago?: Pagos;
}

export interface Marca {
	promotora: string;
	logoSvg: string;
	colorPrincipal: string;
	colorSecundario: string;
	tipografia: { familia: string; googleFonts?: string };
	favicon: string | null;
	contacto: { telefono: string; email: string; web: string; direccion: string };
	/**
	 * Avisos legales. La promotora puede escribirlos en MUNE Portal y se aplican al
	 * construir cada versión (vite.config.ts): plano → planos, imagenes → Render HD,
	 * precios → personalización, experiencia → visita 3D (si no hay, no se muestra).
	 */
	legal: { precios: string; imagenes: string; pie: string; plano?: string; experiencia?: string };
}

export interface Promocion {
	id: string;
	urlBase: string;
	marca: Marca;
	/** tipo: «unifamiliar» = un plano por vivienda (por defecto, plurifamiliar: por tipología y variante). */
	promocion: { nombre: string; ubicacion: string; logoSvg?: string; tipo?: 'plurifamiliar' | 'unifamiliar' };
	tipologias: { id: string; opciones: Record<string, string[]> }[];
	viviendas: ViviendaPromocion[];
	/** Acceso al Studio de producción (hash del código). */
	studio?: { acceso: string };
	/** Acceso del perfil Promotora: solo entregables comerciales (hash del código). */
	promotora?: { acceso: string };
	/** Packs de personalización, en el orden en que se ofrecen. */
	packs?: Pack[];
}
