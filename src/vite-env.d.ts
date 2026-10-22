/// <reference types="vite/client" />

/** true solo en la construcción interna con Studio (vite --mode studio). */
declare const __STUDIO__: boolean;

/** Versión de la web (la pone «publicacion.mjs preparar»); null en desarrollo. */
declare const __VERSION__: string | null;
