// Qué estancias cuentan en la superficie útil de la vivienda: las cerradas,
// salvo el garaje, que se da aparte (como en la documentación oficial).

import type { Estancia } from './tipos';

export const esUtil = ( e: Estancia ) => e.uso !== 'exterior' && e.uso !== 'garaje';
export const esGaraje = ( e: Estancia ) => e.uso === 'garaje';
/** Cerrada (interior de la vivienda, garaje incluido): se recorre por dentro. */
export const esCerrada = ( e: Estancia ) => e.uso !== 'exterior';
