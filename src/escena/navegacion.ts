// Navegación libre pensada para compradores (sin conocimientos de 3D).
//
// Tres modos, según dónde está la cámara:
//  - planta:   solo desplazar y acercar (sin girar): se lee como un plano.
//  - exterior: órbita alrededor de la vivienda con límites de distancia,
//              ángulo y altura; no se puede "bucear" dentro de la maqueta.
//  - interior: se mira alrededor arrastrando (la cámara gira SOBRE SÍ MISMA:
//              girar nunca la desplaza, así que se puede mirar en cualquier
//              dirección aunque esté junto a una pared) y se camina con la rueda
//              o las flechas; al caminar contra un muro se desliza a lo largo de
//              él. Nunca atraviesa muros, puertas cerradas, armarios ni muebles.
//
// Todo en coordenadas de planta (x este, y norte = -z de mundo).

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Rect, Vivienda } from '../modelo/tipos';
import { puntoEnPoligono } from '../util/geo';
import { sePuedeCruzar } from '../modelo/huecos';

export type ModoNavegacion = 'planta' | 'exterior' | 'interior';

const MARGEN_MURO = 0.26;
const MARGEN_MUEBLE = 0.18;
const OJOS = { min: 1.2, max: 2.0 };

/** Distancia de un punto a un rectángulo (0 si está dentro). */
function distancia( x: number, y: number, r: Rect ) {

	const dx = Math.max( r[ 0 ] - x, 0, x - r[ 2 ] ), dy = Math.max( r[ 1 ] - y, 0, y - r[ 3 ] );
	return Math.hypot( dx, dy );

}

/** ¿Corta el segmento (a→b) al rectángulo? (Liang-Barsky) */
function cruza( ax: number, ay: number, bx: number, by: number, r: Rect ) {

	let t0 = 0, t1 = 1;
	const dx = bx - ax, dy = by - ay;
	for ( const [ p, q ] of [ [ - dx, ax - r[ 0 ] ], [ dx, r[ 2 ] - ax ], [ - dy, ay - r[ 1 ] ], [ dy, r[ 3 ] - ay ] ] ) {

		if ( p === 0 ) {

			if ( q < 0 ) return false;
			continue;

		}

		const t = q / p;
		if ( p < 0 ) t0 = Math.max( t0, t ); else t1 = Math.min( t1, t );
		if ( t0 > t1 ) return false;

	}

	return true;

}

export class Navegacion {

	/** Distancia máxima de la órbita exterior (más en la maqueta de la promoción completa). */
	alcance = 40;

	modo: ModoNavegacion = 'exterior';
	/** cuánto puede salirse el pivote de la vivienda desde fuera (m) */
	margen = 3;
	private muros: Rect[] = [];
	private muebles: Rect[] = [];
	private interiores: [ number, number ][][] = [];
	private caja: Rect = [ 0, 0, 13, 10 ];
	private altura = 2.5;
	private cota = 0;
	private paso = 0; // metros pendientes de caminar (rueda)
	private anterior = { pos: new THREE.Vector3(), obj: new THREE.Vector3() };
	// mirada en interior: rumbo (alrededor de la vertical) e inclinación
	private rumbo = 0;
	private inclinacion = 0;
	private rumboObj = 0;
	private inclinacionObj = 0;
	private giro = 0; // giro pendiente con teclado (rad/fotograma)
	private arrastre: { id: number; x: number; y: number } | null = null;

	constructor( private cam: THREE.PerspectiveCamera, private ctrl: OrbitControls, dom: HTMLElement ) {

		ctrl.enableDamping = true;
		ctrl.dampingFactor = 0.1;
		ctrl.zoomToCursor = true;
		dom.addEventListener( 'wheel', ( e ) => {

			if ( this.modo !== 'interior' ) return;
			e.preventDefault();
			this.paso += - Math.sign( e.deltaY ) * Math.min( 0.45, Math.abs( e.deltaY ) * 0.003 );

		}, { passive: false } );

		// mirar alrededor (ratón y un dedo); dos dedos: caminar con el pellizco
		const toques = new Map<number, [ number, number ]>();
		let distanciaPellizco = 0;
		dom.addEventListener( 'pointerdown', ( e ) => {

			if ( this.modo !== 'interior' ) return;
			toques.set( e.pointerId, [ e.clientX, e.clientY ] );
			if ( toques.size === 1 ) this.arrastre = { id: e.pointerId, x: e.clientX, y: e.clientY };
			else {

				this.arrastre = null;
				const [ a, b ] = [ ...toques.values() ];
				distanciaPellizco = Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] );

			}

		} );
		dom.addEventListener( 'pointermove', ( e ) => {

			if ( this.modo !== 'interior' || ! toques.has( e.pointerId ) ) return;
			toques.set( e.pointerId, [ e.clientX, e.clientY ] );
			if ( toques.size >= 2 ) {

				const [ a, b ] = [ ...toques.values() ];
				const d = Math.hypot( a[ 0 ] - b[ 0 ], a[ 1 ] - b[ 1 ] );
				this.paso += ( d - distanciaPellizco ) * 0.01;
				distanciaPellizco = d;
				return;

			}

			if ( ! this.arrastre || this.arrastre.id !== e.pointerId ) return;
			const k = ( this.cam.fov / 60 ) * 0.0042;
			this.rumboObj += ( e.clientX - this.arrastre.x ) * k;
			this.inclinacionObj = THREE.MathUtils.clamp( this.inclinacionObj + ( e.clientY - this.arrastre.y ) * k, - 0.62, 0.5 );
			this.arrastre.x = e.clientX;
			this.arrastre.y = e.clientY;

		} );
		const soltar = ( e: PointerEvent ) => {

			toques.delete( e.pointerId );
			if ( this.arrastre?.id === e.pointerId ) this.arrastre = null;

		};
		dom.addEventListener( 'pointerup', soltar );
		dom.addEventListener( 'pointercancel', soltar );

		// teclado: flechas para girar y caminar (accesible sin ratón)
		addEventListener( 'keydown', ( e ) => {

			if ( this.modo !== 'interior' || ( e.target as HTMLElement ).closest?.( 'input, textarea, select, [contenteditable]' ) ) return;
			if ( e.key === 'ArrowLeft' ) this.giro = 0.035;
			else if ( e.key === 'ArrowRight' ) this.giro = - 0.035;
			else if ( e.key === 'ArrowUp' ) this.paso += 0.35;
			else if ( e.key === 'ArrowDown' ) this.paso -= 0.35;
			else return;
			e.preventDefault();

		} );
		addEventListener( 'keyup', ( e ) => {

			if ( e.key === 'ArrowLeft' || e.key === 'ArrowRight' ) this.giro = 0;

		} );

	}

	/** Rumbo e inclinación actuales de la cámara (para continuar la mirada sin saltos). */
	private leerMirada() {

		const d = this.cam.getWorldDirection( new THREE.Vector3() );
		this.rumbo = this.rumboObj = Math.atan2( - d.x, - d.z );
		this.inclinacion = this.inclinacionObj = Math.asin( THREE.MathUtils.clamp( d.y, - 1, 1 ) );

	}

	/** ¿Hay un gesto de mirada o de marcha en curso? (para el render bajo demanda) */
	get activo() {

		return this.modo === 'interior' && ( Math.abs( this.paso ) > 0.002 || this.giro !== 0
			|| Math.abs( this.rumboObj - this.rumbo ) > 1e-4 || Math.abs( this.inclinacionObj - this.inclinacion ) > 1e-4 );

	}

	/** Obstáculos de la vivienda actual (muros, pilares, mobiliario y decoración). */
	actualizarObstaculos( v: Vivienda, extra: Rect[] = [], cota = 0 ) {

		// planta en la que se camina (viviendas en varias plantas)
		this.cota = cota;

		// las puertas interiores (abiertas) se pueden cruzar: el muro se trocea en
		// sus huecos (también los pasos sin puerta); la entrada, las ventanas y las balconeras siguen siendo muro
		this.muros = [];
		const pasos: [ number, number ][][] = [];
		for ( const m of v.muros ) {

			const [ x0, y0, x1, y1 ] = m.rect;
			const puertas = v.huecos.filter( ( h ) => h.muro === m.id && sePuedeCruzar( h ) ).sort( ( a, b ) => a.desde - b.desde );
			if ( ! puertas.length ) {

				this.muros.push( m.rect );
				continue;

			}

			let cursor = puertas[ 0 ].eje === 'x' ? x0 : y0;
			for ( const h of puertas ) {

				if ( h.eje === 'x' ) {

					if ( h.desde > cursor ) this.muros.push( [ cursor, y0, h.desde, y1 ] );
					pasos.push( [ [ h.desde, y0 - 0.02 ], [ h.hasta, y0 - 0.02 ], [ h.hasta, y1 + 0.02 ], [ h.desde, y1 + 0.02 ] ] );

				} else {

					if ( h.desde > cursor ) this.muros.push( [ x0, cursor, x1, h.desde ] );
					pasos.push( [ [ x0 - 0.02, h.desde ], [ x1 + 0.02, h.desde ], [ x1 + 0.02, h.hasta ], [ x0 - 0.02, h.hasta ] ] );

				}

				cursor = h.hasta;

			}

			const fin = puertas[ 0 ].eje === 'x' ? x1 : y1;
			if ( fin > cursor ) this.muros.push( puertas[ 0 ].eje === 'x' ? [ cursor, y0, fin, y1 ] : [ x0, cursor, x1, fin ] );

		}

		this.muebles = [ ...v.equipamiento.map( ( e ) => e.rect ), ...extra ];
		this.interiores = [ ...v.estancias.filter( ( e ) => e.uso !== 'exterior' ).map( ( e ) => e.poligono ), ...pasos ];
		const xs = this.muros.flatMap( ( r ) => [ r[ 0 ], r[ 2 ] ] ), ys = this.muros.flatMap( ( r ) => [ r[ 1 ], r[ 3 ] ] );
		this.caja = [ Math.min( ...xs ), Math.min( ...ys ), Math.max( ...xs ), Math.max( ...ys ) ];
		this.altura = cota + v.alturas.libre.valor;

	}

	/** Con el entorno real se puede alejar la cámara y mover el pivote mucho más. */
	ampliar( si: boolean ) {

		this.alcance = si ? 320 : 40;
		this.margen = si ? 150 : 3;
		if ( this.modo === 'exterior' ) this.ctrl.maxDistance = this.alcance;

	}

	/** Configura los controles para un modo. En interior el pivote se pone justo delante de la cámara. */
	configurar( modo: ModoNavegacion ) {

		this.modo = modo;
		const c = this.ctrl;
		const { MOUSE, TOUCH } = THREE;
		// en interior la mirada la gestiona esta clase (giro sobre el sitio)
		c.enableRotate = modo === 'exterior';
		c.enableZoom = modo !== 'interior';
		c.enablePan = modo !== 'interior';
		c.screenSpacePanning = modo === 'planta';
		c.rotateSpeed = modo === 'interior' ? 0.35 : 0.55;
		c.zoomSpeed = 0.8;
		c.panSpeed = 0.7;
		c.mouseButtons = modo === 'planta'
			? { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN }
			: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };
		c.touches = modo === 'planta' ? { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_PAN } : { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN };
		if ( modo === 'planta' ) {

			c.minDistance = 10; c.maxDistance = 45;
			c.minPolarAngle = 0; c.maxPolarAngle = 0.02;

		} else if ( modo === 'exterior' ) {

			c.minDistance = 5; c.maxDistance = this.alcance;
			c.minPolarAngle = Math.PI * 0.12; c.maxPolarAngle = Math.PI * 0.46;

		} else {

			// pivote a 0,3 m delante; la mirada gira la cámara sobre su posición
			const dir = this.cam.getWorldDirection( new THREE.Vector3() );
			c.target.copy( this.cam.position ).addScaledVector( dir, 0.3 );
			c.minDistance = c.maxDistance = 0.3;
			c.minPolarAngle = 0.05; c.maxPolarAngle = Math.PI - 0.05;
			this.leerMirada();

		}

		c.update();
		this.guardar();

	}

	private guardar() {

		this.anterior.pos.copy( this.cam.position );
		this.anterior.obj.copy( this.ctrl.target );

	}

	private holgura( x: number, y: number ) {

		let d = Infinity;
		for ( const r of this.muros ) d = Math.min( d, distancia( x, y, r ) - MARGEN_MURO );
		for ( const r of this.muebles ) d = Math.min( d, distancia( x, y, r ) - MARGEN_MUEBLE );
		return d;

	}

	/** ¿Es aceptable pasar de `a` a `b` (mundo)? */
	private valido( a: THREE.Vector3, b: THREE.Vector3 ) {

		const H = this.altura;
		if ( b.y < this.cota + 0.9 ) return false;
		const bx = b.x, by = - b.z, ax = a.x, ay = - a.z;
		const dentroCaja = bx > this.caja[ 0 ] - 0.2 && bx < this.caja[ 2 ] + 0.2 && by > this.caja[ 1 ] - 0.2 && by < this.caja[ 3 ] + 0.2;
		if ( this.modo === 'exterior' ) {

			// desde fuera no se entra en la maqueta por debajo del techo
			return ! ( dentroCaja && b.y < H + 0.6 );

		}

		if ( this.modo !== 'interior' ) return true;
		if ( b.y < this.cota + OJOS.min || b.y > this.cota + OJOS.max ) return false;
		if ( ! this.interiores.some( ( p ) => puntoEnPoligono( bx, by, p ) ) && dentroCaja ) return false;
		// no atravesar muros
		if ( this.muros.some( ( r ) => cruza( ax, ay, bx, by, r ) ) ) return false;
		// mantener distancia a muros y muebles; si ya se estaba demasiado cerca (vista
		// maestra pegada a una pared), se permite moverse siempre que no se acerque más
		const hb = this.holgura( bx, by );
		return hb >= 0 || hb >= this.holgura( ax, ay ) - 1e-4;

	}

	/** Tras actualizar los controles: aplica el paso pendiente y deshace movimientos no válidos. */
	restringir( animando: boolean ) {

		if ( animando ) {

			this.paso = 0;
			this.giro = 0;
			this.guardar();
			return;

		}

		if ( this.modo === 'interior' ) {

			// mirada: giro sobre el sitio con un leve suavizado (nunca desplaza la cámara)
			this.rumboObj += this.giro;
			this.rumbo += ( this.rumboObj - this.rumbo ) * 0.35;
			this.inclinacion += ( this.inclinacionObj - this.inclinacion ) * 0.35;
			if ( Math.abs( this.rumboObj - this.rumbo ) < 1e-4 ) this.rumbo = this.rumboObj;
			if ( Math.abs( this.inclinacionObj - this.inclinacion ) < 1e-4 ) this.inclinacion = this.inclinacionObj;
			const ch = Math.cos( this.inclinacion );
			const mirada = new THREE.Vector3( - Math.sin( this.rumbo ) * ch, Math.sin( this.inclinacion ), - Math.cos( this.rumbo ) * ch );
			this.ctrl.target.copy( this.cam.position ).addScaledVector( mirada, 0.3 );
			this.cam.lookAt( this.ctrl.target );

			// caminar con suavizado; contra un muro se desliza a lo largo de él
			if ( Math.abs( this.paso ) > 0.002 ) {

				const d = this.paso * 0.2;
				this.paso -= d;
				const avance = new THREE.Vector3( mirada.x, 0, mirada.z ).normalize().multiplyScalar( d );
				const desde = this.cam.position.clone();
				for ( const intento of [ avance, new THREE.Vector3( avance.x, 0, 0 ), new THREE.Vector3( 0, 0, avance.z ) ] ) {

					const hasta = desde.clone().add( intento );
					if ( intento.lengthSq() > 1e-8 && this.valido( desde, hasta ) ) {

						this.cam.position.copy( hasta );
						this.ctrl.target.add( intento );
						break;

					}

				}

			} else this.paso = 0;

			this.guardar();
			return;

		}

		// en exterior y planta el pivote no se aleja de la vivienda
		{

			const t = this.ctrl.target;
			const lim = new THREE.Vector3(
				THREE.MathUtils.clamp( t.x, this.caja[ 0 ] - this.margen, this.caja[ 2 ] + this.margen ),
				THREE.MathUtils.clamp( t.y, 0, 2 ),
				THREE.MathUtils.clamp( t.z, - this.caja[ 3 ] - this.margen, - this.caja[ 1 ] + this.margen + 1 ),
			);
			if ( ! lim.equals( t ) ) {

				this.cam.position.add( lim.clone().sub( t ) );
				t.copy( lim );

			}

		}

		if ( ! this.valido( this.anterior.pos, this.cam.position ) ) {

			this.cam.position.copy( this.anterior.pos );
			this.ctrl.target.copy( this.anterior.obj );
			this.paso = 0;
			this.cam.lookAt( this.ctrl.target );

		}

		this.guardar();

	}

}
