/// <reference types="vite/client" />

/** true solo en la construcción interna con Studio (vite --mode studio). */
declare const __STUDIO__: boolean;

/** Versión de la web (la pone «publicacion.mjs preparar»); null en desarrollo. */
declare const __VERSION__: string | null;

// Datos de la promoción que se construye (alias @promocion → trabajo/<id>/, vite.config.ts).
// No están en GitHub (se bajan de Supabase), así que su forma la da el código que los usa.
declare module '@promocion/*.json' {
	const datos: unknown;
	export default datos;
}
