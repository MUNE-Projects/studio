// Luz de ventana: cada balconera aporta la luz difusa del cielo hacia el
// interior, con sombras. Es la luz dominante en una fotografía de interiores:
// crea el degradado desde la ventana, el modelado de los volúmenes y las
// sombras suaves de muebles y carpinterías. Al proyectar sombras, los muros
// cortan la luz y no se "cuela" en las estancias vecinas.

import * as THREE from 'three/webgpu';
import type { Vivienda } from '../modelo/tipos';
import { puntoEnPoligono } from '../util/geo';
import { esCarpinteriaExterior } from '../modelo/huecos';

export const INTENSIDAD_VENTANA = 20;

export function construirLucesVentana( v: Vivienda, calidadSombra = 1024 ) {

	const g = new THREE.Group();
	g.name = 'luces-ventana';
	const interiores = v.estancias.filter( ( e ) => e.uso !== 'exterior' );
	for ( const h of v.huecos.filter( esCarpinteriaExterior ) ) {

		const [ x0, y0, x1, y1 ] = v.muros.find( ( m ) => m.id === h.muro )!.rect;
		const u = ( h.desde + h.hasta ) / 2;
		const enX = h.eje === 'x';
		// hacia dentro: el lado del muro con una estancia interior
		const lados = enX ? [ [ u, y1 + 0.3, 1 ], [ u, y0 - 0.3, - 1 ] ] : [ [ x1 + 0.3, u, 1 ], [ x0 - 0.3, u, - 1 ] ];
		const dentro = lados.find( ( [ px, py ] ) => interiores.some( ( e ) => puntoEnPoligono( px, py, e.poligono ) ) );
		if ( ! dentro ) continue;
		const s = dentro[ 2 ];
		const cara = enX ? ( s > 0 ? y1 : y0 ) : ( s > 0 ? x1 : x0 );
		const plano = ( a: number, b: number, alto: number ) => enX ? new THREE.Vector3( a, alto, - b ) : new THREE.Vector3( b, alto, - a );
		const ancho = h.hasta - h.desde;
		const luz = new THREE.SpotLight( '#eef2f7', INTENSIDAD_VENTANA * Math.min( 1.3, ancho / 1.8 ), 0, 1.1, 0.95, 2 );
		// fuera, bajo el porche, apuntando hacia el fondo de la estancia
		luz.position.copy( plano( u, cara - s * 1.6, 2.2 ) );
		luz.target.position.copy( plano( u, cara + s * 3.2, 0.2 ) );
		luz.castShadow = true;
		luz.shadow.mapSize.set( calidadSombra, calidadSombra );
		luz.shadow.bias = - 0.0004;
		luz.shadow.normalBias = 0.02;
		luz.shadow.radius = 5;
		luz.shadow.camera.near = 0.3;
		luz.shadow.camera.far = 14;
		luz.userData.base = luz.intensity;
		g.add( luz, luz.target );

	}

	return g;

}
