// Comentarios visuales en el 3D (038_comentarios.sql), solo en modo profesional:
// el equipo de la promotora pulsa «Comentar», toca el sitio y escribe. En modo
// Vivienda (o Plano) es un comentario de la Experiencia 3D; en modo Personalizar,
// de la personalización (van por separado). El comentario guarda el punto,
// desde dónde se miraba, la planta y la vista, para volver a ese mismo encuadre
// (MUNE Portal y MUNE Studio lo abren con ?comentario=<id>). Los comentarios
// abiertos se ven como marcas numeradas; al pulsar una se lee el hilo y se
// puede responder. Quedan pendientes hasta que se pide cambios en MUNE Portal.
// La administradora, desde MUNE Studio, deja aquí notas para Claude.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { conPase } from './promocion';

interface Mensaje { id: number; texto: string; autor: string; de_mune: boolean; creado_en: string }
interface Punto3D { p: number[]; cam: number[]; obj: number[]; planta?: number; vista?: string }
type Tipo = 'experiencia' | 'personalizacion';
interface Hilo extends Mensaje {
	version: string; tipo: Tipo; clave: string | null; punto: Punto3D | null; interno: boolean;
	enviado_en: string | null; resuelto_en: string | null; respuestas: Mensaje[];
}
export type Modo3D = 'plano' | 'vivienda' | 'personalizar';

export interface Contexto3D {
	escena: THREE.Scene;
	camara: THREE.PerspectiveCamera;
	ctrl: OrbitControls;
	lienzo: HTMLCanvasElement;
	/** Unidad (tipología o variante) que se está viendo: su clave. */
	clave: () => string;
	planta: () => number;
	vista: () => string;
	/** ¿Está la vivienda en 3D lista para tocarla? */
	lista: () => boolean;
	modo: () => Modo3D;
	ponerModo: ( m: Modo3D ) => void;
	/** Lleva la cámara al encuadre del comentario (en su planta; en Personalizar, sin salir de ese modo). */
	irA: ( p: Punto3D, personalizar: boolean ) => void;
	despertar: () => void;
	avisar: ( texto: string ) => void;
}

const r3 = ( v: THREE.Vector3 ) => [ v.x, v.y, v.z ].map( ( n ) => Math.round( n * 1000 ) / 1000 );
const cuando = ( iso: string ) => new Date( iso ).toLocaleString( 'es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } );

export function conectarComentarios3D( c: Contexto3D ) {

	const boton = document.querySelector<HTMLButtonElement>( '#comentar-3d' )!;
	const panel = document.querySelector<HTMLElement>( '#panel-comentario' )!;
	boton.hidden = false;

	const grupo = new THREE.Group();
	grupo.name = 'comentarios';
	c.escena.add( grupo );
	let hilos: Hilo[] = [];
	let marcando = false;
	let nuevo: Punto3D | null = null;
	const marcaNueva = new CSS2DObject( Object.assign( document.createElement( 'span' ), { className: 'marca-comentario nueva', textContent: '+' } ) );

	const tipo = (): Tipo => ( c.modo() === 'personalizar' ? 'personalizacion' : 'experiencia' );
	const abiertos = () => hilos.filter( ( h ) => h.punto && ! h.resuelto_en && h.clave === c.clave() && h.tipo === tipo() );

	const pintarMarcas = () => {

		for ( const o of [ ...grupo.children ] ) {

			grupo.remove( o );
			( o as CSS2DObject ).element?.remove();

		}
		abiertos().forEach( ( h, i ) => {

			const el = document.createElement( 'button' );
			el.type = 'button';
			el.className = `marca-comentario${ h.interno ? ' interna' : '' }`;
			el.textContent = String( i + 1 );
			el.title = h.texto.slice( 0, 80 );
			el.addEventListener( 'pointerdown', ( ev ) => ev.stopPropagation() );
			el.addEventListener( 'click', () => abrirHilo( h, i + 1 ) );
			const o = new CSS2DObject( el );
			o.position.fromArray( h.punto!.p );
			grupo.add( o );

		} );
		c.despertar();

	};

	const cargar = async () => {

		try {

			hilos = ( ( await conPase<Hilo[] | null>( 'comentarios_profesional', {} ) ) ?? [] ).sort( ( a, b ) => a.creado_en.localeCompare( b.creado_en ) );

		} catch {

			hilos = [];

		}
		pintarMarcas();

	};

	const cerrarPanel = () => {

		panel.hidden = true;
		panel.innerHTML = '';
		grupo.remove( marcaNueva );
		marcaNueva.element.remove();
		nuevo = null;
		c.despertar();

	};

	const estado = ( h: Hilo ) => h.interno ? ( h.enviado_en ? 'nota enviada a Claude' : 'nota sin enviar' )
		: h.enviado_en ? 'enviado a MUNE' : 'pendiente de enviar';

	const mensaje = ( m: Mensaje ) => {

		const div = document.createElement( 'div' );
		div.className = 'mensaje';
		const autor = document.createElement( 'p' );
		autor.className = 'autor';
		autor.textContent = `${ m.de_mune ? 'Equipo de MUNE' : m.autor } · ${ cuando( m.creado_en ) }${ 'enviado_en' in m ? ` · ${ estado( m as Hilo ) }` : '' }`;
		const texto = document.createElement( 'p' );
		texto.className = 'texto';
		texto.textContent = m.texto;
		div.append( autor, texto );
		return div;

	};

	/** Formulario de texto del panel (comentario nuevo o respuesta). */
	const formulario = ( etiqueta: string, enviar: ( texto: string ) => Promise<void> ) => {

		const form = document.createElement( 'form' );
		form.noValidate = true;
		form.innerHTML = `<label>${ etiqueta }<textarea name="texto" rows="3" maxlength="2000"></textarea></label>
			<p class="error" role="alert"></p>
			<div class="acciones"><button type="submit" class="boton-info">Guardar</button><button type="button" class="cancelar">Cancelar</button></div>`;
		const error = form.querySelector<HTMLElement>( '.error' )!;
		const guardar = form.querySelector<HTMLButtonElement>( 'button[type=submit]' )!;
		form.querySelector( '.cancelar' )!.addEventListener( 'click', cerrarPanel );
		form.addEventListener( 'submit', async ( ev ) => {

			ev.preventDefault();
			const texto = String( new FormData( form ).get( 'texto' ) ?? '' ).trim();
			error.textContent = '';
			if ( ! texto ) {

				error.textContent = 'Escribe el comentario.';
				return;

			}
			guardar.disabled = true;
			try {

				await enviar( texto );

			} catch ( e ) {

				error.textContent = ( e as Error ).message;
				guardar.disabled = false;

			}

		} );
		// en el 3D, las teclas no deben mover la cámara mientras se escribe
		form.addEventListener( 'keydown', ( ev ) => ev.stopPropagation() );
		return form;

	};

	const abrirPanel = ( titulo: string, ...hijos: HTMLElement[] ) => {

		panel.innerHTML = '';
		const cab = document.createElement( 'header' );
		const h = document.createElement( 'h2' );
		h.textContent = titulo;
		const cerrar = Object.assign( document.createElement( 'button' ), { type: 'button', className: 'cerrar', textContent: '✕', title: 'Cerrar' } );
		cerrar.setAttribute( 'aria-label', 'Cerrar' );
		cerrar.addEventListener( 'click', cerrarPanel );
		cab.append( h, cerrar );
		panel.append( cab, ...hijos );
		panel.hidden = false;
		panel.querySelector<HTMLTextAreaElement>( 'textarea' )?.focus( { preventScroll: true } );

	};

	const abrirHilo = ( h: Hilo, n: number ) => {

		grupo.remove( marcaNueva );
		const lista = document.createElement( 'div' );
		lista.className = 'hilo';
		lista.append( mensaje( h ), ...h.respuestas.map( ( r ) => Object.assign( mensaje( r ), { className: 'mensaje respuesta' } ) ) );
		if ( h.interno ) {

			abrirPanel( `Nota para Claude ${ n }`, lista );
			return;

		}
		const responder = formulario( 'Responder', async ( texto ) => {

			await conPase( 'comentar_profesional', { p_version: __VERSION__, p_tipo: h.tipo, p_clave: h.clave, p_punto: null, p_texto: texto, p_padre: h.id } );
			await cargar();
			const actual = hilos.find( ( x ) => x.id === h.id );
			if ( actual ) abrirHilo( actual, n ); else cerrarPanel();
			c.avisar( 'Respuesta guardada.' );

		} );
		abrirPanel( `Comentario ${ n }${ h.version !== __VERSION__ ? ` · ${ h.version }` : '' }`, lista, responder );

	};

	const empezarNuevo = ( p: Punto3D ) => {

		nuevo = p;
		marcaNueva.position.fromArray( p.p );
		grupo.add( marcaNueva );
		c.despertar();
		const ayuda = document.createElement( 'p' );
		ayuda.className = 'ayuda';
		const t = tipo();
		ayuda.textContent = t === 'personalizacion'
			? 'Comentario sobre la personalización: escribe qué hay que cambiar en el punto marcado.'
			: 'Comentario sobre la Experiencia 3D: escribe qué hay que cambiar en el punto marcado.';
		abrirPanel( 'Comentario nuevo', ayuda, formulario( 'Comentario', async ( texto ) => {

			await conPase( 'comentar_profesional', { p_version: __VERSION__, p_tipo: t, p_clave: c.clave(), p_punto: nuevo, p_texto: texto } );
			cerrarPanel();
			await cargar();
			c.avisar( t === 'personalizacion'
				? 'Comentario guardado. Cuando termines, envíalo con «Pedir cambios» en MUNE Portal → Personalización.'
				: 'Comentario guardado. Cuando termines, envíalo con «Pedir cambios» al validar esta tipología en MUNE Portal.' );

		} ) );

	};

	const modoMarcar = ( si: boolean ) => {

		marcando = si;
		document.body.classList.toggle( 'marcando-comentario', si );
		boton.setAttribute( 'aria-pressed', String( si ) );
		if ( si ) {

			cerrarPanel();
			c.avisar( 'Toca el sitio que quieres comentar. Para cancelar, vuelve a pulsar «Comentar».' );

		}

	};

	boton.addEventListener( 'click', () => {

		if ( ! c.lista() ) {

			c.avisar( 'Espera a que termine de cargar la vivienda en 3D.' );
			return;

		}
		modoMarcar( ! marcando );

	} );

	// un toque (sin arrastrar) sobre la vivienda marca el punto
	const rayo = new THREE.Raycaster();
	let inicio: { x: number; y: number } | null = null;
	c.lienzo.addEventListener( 'pointerdown', ( ev ) => {

		inicio = marcando ? { x: ev.clientX, y: ev.clientY } : null;

	} );
	c.lienzo.addEventListener( 'pointerup', ( ev ) => {

		if ( ! marcando || ! inicio || Math.hypot( ev.clientX - inicio.x, ev.clientY - inicio.y ) > 6 ) return;
		const r = c.lienzo.getBoundingClientRect();
		rayo.setFromCamera( new THREE.Vector2( ( ev.clientX - r.left ) / r.width * 2 - 1, - ( ev.clientY - r.top ) / r.height * 2 + 1 ), c.camara );
		const tocado = rayo.intersectObjects( c.escena.children, true )
			.find( ( x ) => ( x.object as THREE.Mesh ).isMesh && x.object.visible && ! x.object.name.startsWith( 'cielo' ) );
		if ( ! tocado ) {

			c.avisar( 'Toca una parte de la vivienda (una pared, el suelo, un mueble…).' );
			return;

		}
		modoMarcar( false );
		empezarNuevo( {
			p: r3( tocado.point ), cam: r3( c.camara.position ), obj: r3( c.ctrl.target ),
			planta: c.planta(), ...( c.vista() ? { vista: c.vista().slice( 0, 120 ) } : {} ),
		} );

	} );

	/** Al cambiar de vivienda, de tipología o de modo, sus marcas. */
	const alCambiarUnidad = () => {

		cerrarPanel();
		pintarMarcas();

	};

	/** Al abrir desde MUNE Portal o MUNE Studio: ?comentario=<id> (ir a él) o ?comentar=1 (empezar a marcar). */
	const alEstarLista = async () => {

		await cargar();
		const q = new URLSearchParams( location.search );
		const id = Number( q.get( 'comentario' ) );
		const h = id ? hilos.find( ( x ) => x.id === id ) : null;
		if ( q.get( 'modo' ) === 'personalizar' || h?.tipo === 'personalizacion' ) c.ponerModo( 'personalizar' );
		if ( h?.punto ) {

			c.irA( h.punto, h.tipo === 'personalizacion' );
			const n = abiertos().indexOf( h ) + 1;
			setTimeout( () => abrirHilo( h, n || 1 ), 400 );

		} else if ( q.has( 'comentar' ) ) modoMarcar( true );

	};

	return { alCambiarUnidad, alEstarLista };

}
