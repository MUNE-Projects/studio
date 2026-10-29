// Studio: modo de producción (solo para el equipo de la promotora).
//
// Separado de la experiencia pública y de la del comprador: se carga bajo
// demanda (chunk propio) tras un código de acceso. Edita los DATOS de la
// promoción —ambientación, cámaras, acabados y precios, marca, biblioteca—
// sobre la escena en vivo, y exporta un paquete JSON que se integra en
// trabajo/<id>/ (y se sube a Supabase) antes de publicar. La web publicada solo lee esos datos: la IA
// (si se usa) actúa aquí, durante la producción, nunca por visitante.

import * as THREE from 'three/webgpu';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Configuracion, Promocion, Vista } from '../modelo/tipos';
import type { Modelo } from '../promocion/promocion';
import { ejeSimetria, espejarAmbientacion, espejarTipologia } from '../promocion/espejo';
import { BIBLIOTECA, activo, alternativas, huella, type Activo, type Ambientacion, type Decoracion } from '../biblioteca/biblioteca';
import { GENERADORES } from '../biblioteca/generadores';
import { puntoEnPoligono } from '../util/geo';
import { revisarVistas } from '../escena/vistas';
import { cargarModelo, versionesDe } from '../promocion/promocion';
import { compararViviendas, revisarPromocion } from '../promocion/revision';
import { extraerPaleta, propuestaLocal, type Propuesta } from './interiorismo';
import './studio.css';

export interface ApiStudio {
	escena: THREE.Scene;
	camara: THREE.PerspectiveCamera;
	ctrl: OrbitControls;
	lienzo: HTMLCanvasElement;
	mobiliario: THREE.Group;
	modelo(): Modelo;
	espejo(): boolean;
	reconstruir(): void;
	despertar(): void;
	irVista( v: string | Vista ): void;
	construirBarraVistas(): void;
	refrescarCatalogo(): void;
	aplicarMarca(): void;
	promocion: Promocion;
	catalogo: Configuracion;
	descargar( nombre: string, blob: Blob ): Promise<void>;
	avisar( texto: string ): void;
}

type SampleFn = ( ( input: string, o?: object ) => Promise<{ text: string }> ) & {
	json<T>( input: string, o?: { images?: Blob[]; modelTier?: string; signal?: AbortSignal } ): Promise<T>;
	limits(): Promise<{ images?: { maxCount: number; mediaTypes: string[] } }>;
};

const h = <K extends keyof HTMLElementTagNameMap>( tag: K, attrs: Record<string, string> = {}, ...hijos: ( Node | string | null | false )[] ) => {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) el.setAttribute( k, v );
	for ( const x of hijos ) if ( x ) el.append( x );
	return el;

};

const boton = ( texto: string, accion: () => void, clase = '' ) => {

	const b = h( 'button', { type: 'button', class: clase } , texto );
	b.addEventListener( 'click', accion );
	return b;

};

const r3 = ( n: number ) => Math.round( n * 1000 ) / 1000;
const CLAVE_BORRADOR = 'inmobiliarias:studio:borrador';

const PESTANAS = [
	[ 'escena', 'Escena' ], [ 'camaras', 'Cámaras' ], [ 'acabados', 'Acabados y precios' ], [ 'marca', 'Marca' ],
	[ 'ia', 'Interiorismo IA' ], [ 'biblioteca', 'Biblioteca' ], [ 'documentacion', 'Documentación' ], [ 'actualizacion', 'Actualización' ], [ 'publicacion', 'Publicación' ],
] as const;
type Pestana = typeof PESTANAS[ number ][ 0 ];

export async function abrirStudio( api: ApiStudio ) {

	document.body.classList.add( 'en-studio' );
	const rt = ( window as unknown as { claude?: { use( n: string ): Promise<unknown> } } ).claude;
	let sample: SampleFn | null = null;
	let conImagenes = false;
	rt?.use?.( 'sample' ).then( async ( s ) => {

		sample = s as SampleFn | null;
		conImagenes = !! ( await sample?.limits().catch( () => null ) )?.images;
		if ( pestana === 'ia' || pestana === 'biblioteca' ) pintar();

	}, () => {} );

	const amb = (): Ambientacion => {

		const m = api.modelo();
		m.ambientacion ??= { sustituciones: {}, decoracion: [] };
		return m.ambientacion;

	};

	// ------------------------------------------------------------ panel
	const raiz = h( 'aside', { id: 'studio', 'aria-label': 'Studio de producción' } );
	const cabecera = h( 'header', { class: 'st-cabecera' },
		h( 'div', {}, h( 'strong', {}, 'Studio' ), h( 'span', { class: 'st-sub' }, ` · ${ api.promocion.promocion.nombre }` ) ),
		boton( 'Salir', () => {

			document.body.classList.remove( 'en-studio' );
			raiz.remove();
			seleccion = null;
			actualizarMarco();
			history.replaceState( null, '', location.pathname + location.search );

		}, 'st-salir' ) );
	const nav = h( 'nav', { class: 'st-pestanas', role: 'tablist' } );
	const cuerpo = h( 'div', { class: 'st-cuerpo' } );
	raiz.append( cabecera, nav, cuerpo );
	document.body.append( raiz );

	let pestana: Pestana = 'escena';
	for ( const [ id, nombre ] of PESTANAS ) {

		const b = boton( nombre, () => {

			pestana = id;
			pintar();

		} );
		b.dataset.p = id;
		b.setAttribute( 'role', 'tab' );
		nav.append( b );

	}

	// ------------------------------------------------------------ selección en la escena
	type Sel = { tipo: 'equipo'; id: string; equipoTipo: string } | { tipo: 'decoracion'; id: string };
	let seleccion: Sel | null = null;
	const marco = new THREE.Box3Helper( new THREE.Box3(), new THREE.Color( '#2f8f6f' ) );
	marco.visible = false;
	api.escena.add( marco );
	const objetoDe = ( s: Sel ) => api.mobiliario.children.find( ( o ) => s.tipo === 'equipo' ? o.userData.equipo === s.id : o.userData.decoracion === s.id );
	function actualizarMarco() {

		const o = seleccion && objetoDe( seleccion );
		marco.visible = !! o;
		if ( o ) marco.box.setFromObject( o );
		api.despertar();

	}

	const ray = new THREE.Raycaster();
	const puntero = new THREE.Vector2();
	let abajo: [ number, number ] | null = null;
	api.lienzo.addEventListener( 'pointerdown', ( e ) => ( abajo = [ e.clientX, e.clientY ] ) );
	api.lienzo.addEventListener( 'pointerup', ( e ) => {

		if ( ! document.body.classList.contains( 'en-studio' ) || ! abajo ) return;
		const arrastre = Math.hypot( e.clientX - abajo[ 0 ], e.clientY - abajo[ 1 ] );
		abajo = null;
		if ( arrastre > 4 ) return;
		const r = api.lienzo.getBoundingClientRect();
		puntero.set( ( ( e.clientX - r.left ) / r.width ) * 2 - 1, - ( ( e.clientY - r.top ) / r.height ) * 2 + 1 );
		ray.setFromCamera( puntero, api.camara );
		const candidatos = api.mobiliario.children.filter( ( o ) => o.visible && ( o.userData.equipo || o.userData.decoracion ) );
		const hit = ray.intersectObjects( candidatos, true )[ 0 ];
		let o: THREE.Object3D | null = hit?.object ?? null;
		while ( o && o.parent !== api.mobiliario ) o = o.parent;
		if ( ! o ) seleccion = null;
		else if ( o.userData.decoracion ) seleccion = { tipo: 'decoracion', id: o.userData.decoracion };
		else seleccion = { tipo: 'equipo', id: o.userData.equipo, equipoTipo: o.userData.tipo };
		if ( seleccion ) pestana = 'escena';
		actualizarMarco();
		pintar();

	} );
	addEventListener( 'keydown', ( e ) => {

		if ( ! document.body.classList.contains( 'en-studio' ) || ( e.target as HTMLElement ).closest( 'input, textarea, select' ) ) return;
		if ( e.key === 'Escape' ) {

			seleccion = null;
			actualizarMarco();
			pintar();

		} else if ( ( e.key === 'Delete' || e.key === 'Backspace' ) && seleccion?.tipo === 'decoracion' ) borrarDecoracion( seleccion.id );

	} );

	// ------------------------------------------------------------ cambios y borrador
	const cambio = ( reconstruir = true ) => {

		if ( reconstruir ) api.reconstruir();
		actualizarMarco();
		try {

			localStorage.setItem( CLAVE_BORRADOR, JSON.stringify( paquete() ) );

		} catch { /* sin almacenamiento: el borrador solo vive en esta sesión */ }

	};

	/** Punto de la escena en el centro de la pantalla: dónde se coloca lo nuevo. */
	const puntoCentral = () => {

		// primer apoyo horizontal en la estancia donde está la cámara (el vidrio
		// de las balconeras no cuenta: no se coloca nada al otro lado)
		const cp = api.camara.position;
		const sala = api.modelo().vivienda.estancias.find( ( e ) => puntoEnPoligono( cp.x, - cp.z, e.poligono ) );
		ray.setFromCamera( new THREE.Vector2( 0, - 0.15 ), api.camara );
		const hits = ray.intersectObjects( api.escena.children.filter( ( o ) => o !== marco && o.visible ), true );
		const hit = hits.find( ( i ) => {

			const m = ( i.object as THREE.Mesh ).material as THREE.Material;
			if ( m?.transparent ) return false;
			if ( ( i.face?.normal.y ?? 0 ) < 0.5 && i.point.y > 0.05 ) return false;
			return ! sala || puntoEnPoligono( i.point.x, - i.point.z, sala.poligono );

		} );
		let p: THREE.Vector3;
		if ( hit ) p = hit.point;
		else {

			// sin apoyo claro: 1,5 m por delante, en el suelo
			const dir = api.camara.getWorldDirection( new THREE.Vector3() ).setY( 0 ).normalize();
			p = cp.clone().addScaledVector( dir, 1.5 ).setY( 0 );

		}

		return { pos: [ r3( p.x ), r3( - p.z ) ] as [ number, number ], elev: p.y > 0.05 ? r3( p.y ) : 0 };

	};

	const estanciaEn = ( x: number, y: number ) => api.modelo().vivienda.estancias.find( ( e ) => puntoEnPoligono( x, y, e.poligono ) )?.id ?? 'exterior';

	const colocar = ( a: Activo ) => {

		const { pos, elev } = puntoCentral();
		const d: Decoracion = { id: `${ a.id }-${ Date.now().toString( 36 ) }`, activo: a.id, pos, rot: 0, elev, estancia: estanciaEn( pos[ 0 ], pos[ 1 ] ) };
		if ( a.categoria === 'alfombras' ) d.pisable = true;
		amb().decoracion.push( d );
		seleccion = { tipo: 'decoracion', id: d.id };
		pestana = 'escena';
		cambio();
		pintar();

	};

	const borrarDecoracion = ( id: string ) => {

		const a = amb();
		a.decoracion = a.decoracion.filter( ( d ) => d.id !== id );
		seleccion = null;
		cambio();
		pintar();

	};

	// ------------------------------------------------------------ pestañas
	function pintar() {

		for ( const b of nav.querySelectorAll<HTMLButtonElement>( 'button' ) ) b.setAttribute( 'aria-selected', String( b.dataset.p === pestana ) );
		cuerpo.replaceChildren( ...( {
			escena: pintarEscena, camaras: pintarCamaras, acabados: pintarAcabados, marca: pintarMarca,
			ia: pintarIA, biblioteca: pintarBiblioteca, documentacion: pintarDocumentacion, actualizacion: pintarActualizacion, publicacion: pintarPublicacion,
		}[ pestana ] )() );

	}

	const tarjetaActivo = ( a: Activo, accion: { texto: string; hacer: () => void } | null, actual = false ) => h( 'div', { class: `st-activo${ actual ? ' actual' : '' }` },
		h( 'span', { class: 'st-muestra', style: `background:${ a.color }` } ),
		h( 'span', { class: 'st-texto' }, h( 'strong', {}, a.nombre ), h( 'small', {}, `${ a.estilo } · gama ${ a.gama } · ${ a.dims.map( ( d ) => d.toFixed( 2 ) ).join( '×' ) } m` ),
			h( 'small', { class: 'st-insp' }, a.inspiracion.filter( ( x ) => x !== '—' ).length ? `Universo: ${ a.inspiracion.join( ', ' ) }` : '' ) ),
		accion && ! actual ? boton( accion.texto, accion.hacer, 'st-mini' ) : actual ? h( 'span', { class: 'st-chip' }, 'Actual' ) : null );

	function pintarEscena(): Node[] {

		const out: Node[] = [];
		if ( ! seleccion ) {

			out.push( h( 'p', { class: 'st-ayuda' }, 'Haz clic sobre un mueble o un objeto de decoración para seleccionarlo. Podrás sustituirlo por una alternativa de la biblioteca, moverlo, girarlo o eliminarlo sin rehacer la estancia.' ) );
			const lista = amb().decoracion;
			const porEstancia = new Map<string, Decoracion[]>();
			for ( const d of lista ) porEstancia.set( d.estancia, [ ...( porEstancia.get( d.estancia ) ?? [] ), d ] );
			out.push( h( 'h3', {}, `Decoración colocada (${ lista.length })` ) );
			for ( const [ e, ds ] of porEstancia ) {

				const nombre = api.modelo().vivienda.estancias.find( ( x ) => x.id === e )?.nombre ?? e;
				out.push( h( 'details', {}, h( 'summary', {}, `${ nombre } · ${ ds.length }` ), ...ds.map( ( d ) => boton( activo( d.activo )?.nombre ?? d.activo, () => {

					seleccion = { tipo: 'decoracion', id: d.id };
					actualizarMarco();
					pintar();

				}, 'st-fila' ) ) ) );

			}

			out.push( h( 'p', { class: 'st-ayuda' }, 'Para añadir un objeto, colócate en la estancia y pulsa «Colocar» en la pestaña Biblioteca: aparece en el centro de la vista.' ) );
			return out;

		}

		const s = seleccion;
		if ( s.tipo === 'equipo' ) {

			const e = api.modelo().vivienda.equipamiento.find( ( x ) => x.id === s.id );
			const idActivo = objetoDe( s )?.userData.activo as string | null;
			const a = idActivo ? activo( idActivo ) : undefined;
			out.push( h( 'h3', {}, a?.nombre ?? s.equipoTipo ), h( 'p', { class: 'st-ayuda' }, `Elemento del plano «${ s.id }» (${ s.equipoTipo }). Su posición y medidas vienen del plano; aquí se elige qué pieza lo representa.` ) );
			if ( ! a || e?.fijo ) {

				out.push( h( 'p', { class: 'st-ayuda' }, 'Equipamiento fijo de proyecto (cocina, baños, armarios): se configura desde Acabados y precios.' ) );
				return out;

			}

			out.push( h( 'h4', {}, 'Alternativas' ) );
			for ( const b of alternativas( a, s.equipoTipo ) ) out.push( tarjetaActivo( b, { texto: 'Sustituir', hacer: () => {

				amb().sustituciones[ s.id ] = b.id;
				cambio();
				pintar();

			} }, b.id === a.id ) );
			return out;

		}

		const d = amb().decoracion.find( ( x ) => x.id === s.id );
		if ( ! d ) {

			seleccion = null;
			return pintarEscena();

		}

		const a = activo( d.activo );
		out.push( h( 'h3', {}, a?.nombre ?? d.activo ), h( 'p', { class: 'st-ayuda' }, `Decoración en ${ d.estancia } · x ${ d.pos[ 0 ].toFixed( 2 ) } · y ${ d.pos[ 1 ].toFixed( 2 ) } · giro ${ d.rot }° · altura ${ d.elev.toFixed( 2 ) } m` ) );
		const mover = ( dx: number, dy: number ) => () => {

			d.pos = [ r3( d.pos[ 0 ] + dx ), r3( d.pos[ 1 ] + dy ) ];
			d.estancia = estanciaEn( d.pos[ 0 ], d.pos[ 1 ] );
			cambio();
			pintar();

		};
		const paso = 0.05;
		out.push( h( 'div', { class: 'st-rejilla' },
			boton( '← Oeste', mover( - paso, 0 ) ), boton( 'Norte ↑', mover( 0, paso ) ), boton( 'Sur ↓', mover( 0, - paso ) ), boton( 'Este →', mover( paso, 0 ) ),
			boton( '⟲ 15°', () => {

				d.rot = ( d.rot + 15 ) % 360;
				cambio();
				pintar();

			} ), boton( '⟳ 15°', () => {

				d.rot = ( d.rot - 15 ) % 360;
				cambio();
				pintar();

			} ), boton( 'Subir 5 cm', () => {

				d.elev = r3( d.elev + 0.05 );
				cambio();
				pintar();

			} ), boton( 'Bajar 5 cm', () => {

				d.elev = r3( Math.max( 0, d.elev - 0.05 ) );
				cambio();
				pintar();

			} ) ) );
		out.push( h( 'div', { class: 'st-acciones' },
			boton( 'Duplicar', () => {

				const c: Decoracion = { ...d, id: `${ d.activo }-${ Date.now().toString( 36 ) }`, pos: [ r3( d.pos[ 0 ] + 0.3 ), d.pos[ 1 ] ] };
				amb().decoracion.push( c );
				seleccion = { tipo: 'decoracion', id: c.id };
				cambio();
				pintar();

			} ),
			boton( 'Eliminar', () => borrarDecoracion( d.id ), 'st-peligro' ) ) );
		if ( a ) {

			out.push( h( 'h4', {}, 'Sustituir por' ) );
			for ( const b of alternativas( a ) ) out.push( tarjetaActivo( b, { texto: 'Sustituir', hacer: () => {

				d.activo = b.id;
				delete d.dims;
				cambio();
				pintar();

			} }, b.id === a.id ) );

		}

		return out;

	}

	function pintarCamaras(): Node[] {

		const t = api.modelo().tipologia;
		const out: Node[] = [ h( 'p', { class: 'st-ayuda' }, 'Cámaras maestras de la tipología. Encuadra con el ratón y pulsa «Guardar encuadre actual». Las marcadas como guiadas aparecen en la barra de vistas del comprador.' ) ];
		for ( const [ k, v ] of Object.entries( t.vistas ) ) {

			const guiada = h( 'input', { type: 'checkbox', 'aria-label': `Vista guiada ${ v.nombre }` } ) as HTMLInputElement;
			guiada.checked = t.guiadas.includes( k );
			guiada.disabled = k === 'planta';
			guiada.addEventListener( 'change', () => {

				t.guiadas = guiada.checked ? [ ...t.guiadas, k ] : t.guiadas.filter( ( x ) => x !== k );
				api.construirBarraVistas();
				cambio( false );

			} );
			const nombre = h( 'input', { type: 'text', value: v.nombre, 'aria-label': 'Nombre de la vista' } ) as HTMLInputElement;
			nombre.addEventListener( 'change', () => {

				v.nombre = nombre.value;
				api.construirBarraVistas();
				cambio( false );

			} );
			out.push( h( 'div', { class: 'st-camara' }, guiada, nombre,
				h( 'small', {}, `fov ${ v.fov }° · ojo ${ v.pos[ 1 ].toFixed( 2 ) } m` ),
				boton( 'Ir', () => api.irVista( k ), 'st-mini' ),
				boton( 'Guardar encuadre actual', () => {

					Object.assign( v, encuadreActual(), { nombre: v.nombre } );
					api.avisar( `Vista «${ v.nombre }» actualizada.` );
					cambio( false );
					pintar();

				}, 'st-mini' ) ) );

		}

		out.push( boton( 'Nueva vista desde el encuadre actual', () => {

			const n = prompt( 'Nombre de la vista (p. ej. «Comedor»):' );
			if ( ! n ) return;
			const k = n.toLowerCase().normalize( 'NFD' ).replace( /[^a-z0-9]+/g, '-' ).replace( /^-|-$/g, '' ) || `vista-${ Date.now() }`;
			t.vistas[ k ] = { ...encuadreActual(), nombre: n };
			t.guiadas.push( k );
			api.construirBarraVistas();
			cambio( false );
			pintar();

		}, 'st-principal' ) );
		return out;

	}

	const encuadreActual = (): Vista => {

		const p = api.camara.position, o = api.ctrl.target;
		return {
			nombre: '', pos: [ r3( p.x ), r3( p.y ), r3( p.z ) ], obj: [ r3( o.x ), r3( o.y ), r3( o.z ) ],
			fov: Math.round( api.camara.fov ), interior: p.y < 2.6, estancia: estanciaEn( p.x, - p.z ), automatica: false,
		};

	};

	function pintarAcabados(): Node[] {

		const out: Node[] = [ h( 'p', { class: 'st-ayuda' }, 'Catálogo de personalización de la promoción. La primera opción de cada categoría es la incluida. Los cambios se aplican al configurador del comprador al exportar.' ) ];
		for ( const c of api.catalogo.categorias ) {

			const filas = c.opciones.map( ( o, i ) => {

				const precio = h( 'input', { type: 'number', min: '0', step: '50', value: String( o.precio ), 'aria-label': `Precio ${ o.nombre }` } ) as HTMLInputElement;
				precio.disabled = i === 0;
				precio.addEventListener( 'change', () => {

					o.precio = Math.max( 0, Number( precio.value ) || 0 );
					api.refrescarCatalogo();
					cambio( false );

				} );
				const nombre = h( 'input', { type: 'text', value: o.nombre, 'aria-label': 'Nombre de la opción' } ) as HTMLInputElement;
				nombre.addEventListener( 'change', () => {

					o.nombre = nombre.value;
					api.refrescarCatalogo();
					cambio( false );

				} );
				const colores = Object.entries( o.parametros ?? {} ).filter( ( [ , v ] ) => typeof v === 'string' && v.startsWith( '#' ) ).map( ( [ k, v ] ) => {

					const col = h( 'input', { type: 'color', value: String( v ), title: k, 'aria-label': `${ o.nombre }: ${ k }` } ) as HTMLInputElement;
					col.addEventListener( 'change', () => {

						o.parametros![ k ] = col.value;
						api.refrescarCatalogo();
						cambio( false );

					} );
					return col;

				} );
				return h( 'div', { class: 'st-opcion' }, nombre, h( 'span', { class: 'st-colores' }, ...colores ), precio );

			} );
			out.push( h( 'details', { open: '' }, h( 'summary', {}, c.nombre ), ...filas ) );

		}

		// packs: periodos y estado (el estado se deduce de las fechas salvo que se fuerce)
		out.push( h( 'h3', {}, 'Packs de personalización' ), h( 'p', { class: 'st-ayuda' }, 'Cada pack agrupa categorías y se abre durante su periodo. Antes: «Próximamente» (visible y bloqueado); después: «Periodo finalizado» (histórico en gris).' ) );
		for ( const pk of api.promocion.packs ?? [] ) {

			const campo = ( etiqueta: string, valor: string, poner: ( v: string ) => void, tipo = 'text' ) => {

				const i = h( 'input', { type: tipo, value: valor, 'aria-label': etiqueta } ) as HTMLInputElement;
				i.addEventListener( 'change', () => {

					poner( i.value );
					api.refrescarCatalogo();
					cambio( false );

				} );
				return h( 'label', { class: 'st-campo' }, h( 'span', {}, etiqueta ), i );

			};
			const estado = h( 'select', { 'aria-label': 'Estado del pack' } ) as HTMLSelectElement;
			for ( const [ v, t ] of [ [ '', 'Según fechas' ], [ 'disponible', 'Forzar disponible' ], [ 'proximamente', 'Forzar próximamente' ], [ 'finalizado', 'Forzar finalizado' ] ] ) estado.append( h( 'option', { value: v }, t ) );
			estado.value = pk.estado ?? '';
			estado.addEventListener( 'change', () => {

				if ( estado.value ) pk.estado = estado.value as NonNullable<typeof pk.estado>;
				else delete pk.estado;
				api.refrescarCatalogo();
				cambio( false );

			} );
			out.push( h( 'details', {}, h( 'summary', {}, `${ pk.titulo } · ${ pk.categorias.join( ', ' ) }` ),
				campo( 'Título', pk.titulo, ( v ) => ( pk.titulo = v ) ),
				campo( 'Descripción', pk.descripcion, ( v ) => ( pk.descripcion = v ) ),
				h( 'div', { class: 'st-tres' }, campo( 'Desde', pk.desde, ( v ) => ( pk.desde = v ), 'date' ), campo( 'Hasta', pk.hasta, ( v ) => ( pk.hasta = v ), 'date' ), h( 'label', { class: 'st-campo' }, h( 'span', {}, 'Estado' ), estado ) ),
				campo( 'Categorías (ids separados por comas)', pk.categorias.join( ', ' ), ( v ) => ( pk.categorias = v.split( ',' ).map( ( x ) => x.trim() ).filter( Boolean ) ) ) ) );

		}

		// el contacto y los datos de pago de la formalización ya no van aquí: los
		// configura la promotora en MUNE Portal (Ficha y datos) y viven en Supabase
		return out;

	}

	function pintarMarca(): Node[] {

		const p = api.promocion, m = p.marca;
		const campo = ( etiqueta: string, valor: string, poner: ( v: string ) => void, tipo = 'text' ) => {

			const i = h( tipo === 'textarea' ? 'textarea' : 'input', tipo === 'textarea' ? { rows: '4' } : { type: tipo } ) as HTMLInputElement;
			i.value = valor;
			i.addEventListener( 'change', () => {

				poner( i.value );
				api.aplicarMarca();
				cambio( false );

			} );
			return h( 'label', { class: 'st-campo' }, h( 'span', {}, etiqueta ), i );

		};
		return [
			h( 'p', { class: 'st-ayuda' }, 'Marca blanca: todo lo visible por el comprador (ficha, colores, logo, PDF) sale de estos datos.' ),
			campo( 'Promotora', m.promotora, ( v ) => ( m.promotora = v ) ),
			campo( 'Promoción', p.promocion.nombre, ( v ) => ( p.promocion.nombre = v ) ),
			campo( 'Ubicación', p.promocion.ubicacion, ( v ) => ( p.promocion.ubicacion = v ) ),
			campo( 'Color principal', m.colorPrincipal, ( v ) => ( m.colorPrincipal = v ), 'color' ),
			campo( 'Color secundario', m.colorSecundario, ( v ) => ( m.colorSecundario = v ), 'color' ),
			campo( 'Tipografía (Google Fonts)', m.tipografia.familia, ( v ) => {

				m.tipografia.familia = v;
				m.tipografia.googleFonts = `${ v.replace( / /g, '+' ) }:wght@400;500;600;700`;

			} ),
			campo( 'Logo (SVG)', m.logoSvg, ( v ) => ( m.logoSvg = v ), 'textarea' ),
			campo( 'Teléfono comercial', m.contacto.telefono, ( v ) => ( m.contacto.telefono = v ) ),
			campo( 'Email comercial', m.contacto.email, ( v ) => ( m.contacto.email = v ) ),
			campo( 'Aviso legal de imágenes', m.legal.imagenes, ( v ) => ( m.legal.imagenes = v ), 'textarea' ),
		];

	}

	// ------------------------------------------------------------ interiorismo
	let referencias: File[] = [];
	let paleta: string[] = [];
	let propuesta: Propuesta | null = null;
	let anterior: string | null = null;
	let estadoIA = '';
	let ctlIA: AbortController | null = null;

	const catalogoParaIA = () => BIBLIOTECA.activos.map( ( a ) => `${ a.id } | ${ a.categoria } | ${ a.nombre } | ${ a.estilo } | ${ a.color }${ a.sustituye ? ` | sustituye: ${ a.sustituye.join( ',' ) }` : '' }` ).join( '\n' );

	async function proponer() {

		propuesta = null;
		estadoIA = 'Analizando referencias…';
		pintar();
		paleta = referencias.length ? await extraerPaleta( referencias ) : paleta;
		const local = propuestaLocal( paleta, amb(), api.modelo().vivienda );
		if ( ! sample ) {

			propuesta = local;
			estadoIA = 'Propuesta generada en local a partir de la paleta de las referencias (sin IA disponible en esta vista).';
			pintar();
			return;

		}

		estadoIA = 'Pensando la propuesta con Claude… (puede tardar un minuto)';
		pintar();
		ctlIA = new AbortController();
		const m = api.modelo();
		const muebles = m.vivienda.equipamiento.filter( ( e ) => ! e.fijo ).map( ( e ) => `${ e.id } (${ e.tipo })` ).join( ', ' );
		const decor = amb().decoracion.map( ( d ) => `${ d.id }: ${ d.activo } en ${ d.estancia }` ).join( '\n' );
		const prompt = `Eres interiorista de obra nueva residencial. Te paso imágenes de referencia de ambiente (si hay) y una paleta extraída de ellas: ${ paleta.join( ', ' ) || 'sin paleta' }.
Propón una ambientación coherente para la vivienda usando SOLO activos de esta biblioteca (id | categoría | nombre | estilo | color):
${ catalogoParaIA() }

Muebles del plano sustituibles (id y tipo): ${ muebles }
Decoración actual (id: activo en estancia):
${ decor }

Puedes además crear alternativas de color de activos textiles (sofás, camas, alfombras, cojines): cambia solo valores de color hexadecimales de sus parámetros "tela", "cojines", "manta", "plaid", "material" o "base". No reproduzcas productos concretos de ninguna marca.
Responde SOLO con JSON con esta forma:
{"estilo": "texto corto", "resumen": "2 frases para el promotor", "paleta": ["#hex", ...],
 "sustituciones": {"<id de mueble>": "<id de activo>"},
 "decoracion": {"<id de decoración>": "<id de activo de la misma categoría>"},
 "alternativas": [{"base": "<id de activo>", "nombre": "texto", "colores": {"tela": "#hex", "cojines": ["#hex", "#hex"], "manta": "#hex", "plaid": "#hex", "material": "#hex", "base": "#hex"}}],
 "aplicar_alternativas_a": {"<id de mueble o decoración>": <índice en alternativas>}}`;
		try {

			const r = await sample.json<Propuesta>( prompt, { images: conImagenes ? referencias.slice( 0, 4 ) : undefined, signal: ctlIA.signal } );
			propuesta = { ...local, ...r, origen: 'ia' };
			estadoIA = 'Propuesta de Claude lista para revisar.';

		} catch ( e ) {

			const code = ( e as { code?: string } ).code;
			propuesta = local;
			estadoIA = code === 'cancelled' ? 'Cancelado. Se muestra la propuesta local.' : `No se pudo consultar a Claude (${ code ?? 'error' }). Se muestra la propuesta local, igualmente editable.`;

		}

		ctlIA = null;
		pintar();

	}

	function aplicarPropuesta( p: Propuesta ) {

		const a = amb();
		anterior = JSON.stringify( a );
		const creados: string[] = [];
		( p.alternativas ?? [] ).forEach( ( v, i ) => {

			const base = activo( v.base );
			if ( ! base ) return creados.push( '' );
			const params = { ...base.params };
			for ( const [ k, val ] of Object.entries( v.colores ?? {} ) ) {

				const actual = params[ k ];
				const tipo = typeof actual === 'string' && actual.includes( ':' ) ? actual.split( ':' )[ 0 ] : 'tela';
				if ( Array.isArray( val ) ) params[ k ] = val.map( ( c ) => `${ tipo }:${ c }` ).join( '|' );
				else if ( typeof val === 'string' && /^#[0-9a-f]{6}$/i.test( val ) ) params[ k ] = `${ tipo }:${ val }`;

			}

			const id = `${ base.id }-p${ Date.now().toString( 36 ) }${ i }`;
			BIBLIOTECA.activos.push( { ...base, id, nombre: v.nombre || `${ base.nombre } (propuesta)`, params, color: Object.values( v.colores ?? {} ).flat()[ 0 ] as string ?? base.color, propio: true, miniatura: null } );
			creados.push( id );

		} );
		const valido = ( id: string, categoria?: string ) => {

			const x = activo( id );
			return x && ( ! categoria || x.categoria === categoria ) ? x : undefined;

		};
		for ( const [ eq, id ] of Object.entries( p.sustituciones ?? {} ) ) if ( valido( id ) ) a.sustituciones[ eq ] = id;
		for ( const [ did, id ] of Object.entries( p.decoracion ?? {} ) ) {

			const d = a.decoracion.find( ( x ) => x.id === did );
			if ( d && valido( id, activo( d.activo )?.categoria ) ) {

				d.activo = id;
				delete d.dims;

			}

		}

		for ( const [ objetivo, i ] of Object.entries( p.aplicar_alternativas_a ?? {} ) ) {

			const id = creados[ Number( i ) ];
			if ( ! id ) continue;
			const d = a.decoracion.find( ( x ) => x.id === objetivo );
			if ( d ) d.activo = id;
			else if ( api.modelo().vivienda.equipamiento.some( ( e ) => e.id === objetivo ) ) a.sustituciones[ objetivo ] = id;

		}

		cambio();
		api.avisar( 'Propuesta aplicada: todo sigue siendo editable desde la pestaña Escena.' );

	}

	function pintarIA(): Node[] {

		const entrada = h( 'input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', multiple: '' } ) as HTMLInputElement;
		entrada.addEventListener( 'change', async () => {

			referencias = [ ...( entrada.files ?? [] ) ].slice( 0, 6 );
			paleta = await extraerPaleta( referencias );
			pintar();

		} );
		const miniaturas = h( 'div', { class: 'st-miniaturas' }, ...referencias.map( ( f ) => {

			const img = h( 'img', { alt: f.name } ) as HTMLImageElement;
			img.src = URL.createObjectURL( f );
			return img;

		} ) );
		const out: Node[] = [
			h( 'p', { class: 'st-ayuda' }, 'Sube imágenes de referencia de interiorismo (moodboard, fotos de ambientes, un estilo de marca). Se extrae la paleta y se propone una ambientación con los activos de la biblioteca: el resultado es una escena 3D editable, no una imagen.' ),
			h( 'label', { class: 'st-campo' }, h( 'span', {}, 'Referencias (hasta 6)' ), entrada ),
			miniaturas,
			paleta.length ? h( 'div', { class: 'st-paleta' }, ...paleta.map( ( c ) => h( 'span', { style: `background:${ c }`, title: c } ) ) ) : null,
			h( 'p', { class: 'st-nota' }, sample ? `IA disponible (Claude, cuenta de quien usa el Studio${ conImagenes ? ', con imágenes' : ', solo texto' }). Solo se usa aquí, en producción.` : 'IA no disponible en esta vista: la propuesta se calcula en local a partir de la paleta.' ),
			h( 'div', { class: 'st-acciones' },
				boton( 'Proponer ambientación', () => void proponer(), 'st-principal' ),
				ctlIA ? boton( 'Detener', () => ctlIA?.abort() ) : null ),
		].filter( Boolean ) as Node[];
		if ( estadoIA ) out.push( h( 'p', { class: 'st-estado', role: 'status' }, estadoIA ) );
		if ( propuesta ) {

			const p = propuesta;
			out.push( h( 'div', { class: 'st-propuesta' },
				h( 'h4', {}, `Propuesta · ${ p.estilo ?? 'estilo' }` ),
				h( 'p', {}, p.resumen ?? '' ),
				p.paleta?.length ? h( 'div', { class: 'st-paleta' }, ...p.paleta.map( ( c ) => h( 'span', { style: `background:${ c }`, title: c } ) ) ) : null,
				h( 'ul', {}, ...Object.entries( p.sustituciones ?? {} ).map( ( [ k, v ] ) => h( 'li', {}, `${ k } → ${ activo( v )?.nombre ?? v }` ) ),
					...Object.entries( p.decoracion ?? {} ).map( ( [ k, v ] ) => h( 'li', {}, `${ k } → ${ activo( v )?.nombre ?? v }` ) ),
					...( p.alternativas ?? [] ).map( ( v ) => h( 'li', {}, `Alternativa de color: ${ v.nombre } (sobre ${ activo( v.base )?.nombre ?? v.base })` ) ) ),
				h( 'div', { class: 'st-acciones' }, boton( 'Aplicar a la escena', () => aplicarPropuesta( p ), 'st-principal' ),
					anterior ? boton( 'Deshacer última', () => {

						api.modelo().ambientacion = JSON.parse( anterior! );
						anterior = null;
						cambio();
						pintar();

					} ) : null ) ) );

		}

		return out;

	}

	// ------------------------------------------------------------ biblioteca
	let filtro = 'sofas';
	let estadoGen = '';
	function pintarBiblioteca(): Node[] {

		const sel = h( 'select', { 'aria-label': 'Categoría' } ) as HTMLSelectElement;
		for ( const c of BIBLIOTECA.categorias ) sel.append( h( 'option', { value: c.id }, `${ c.nombre } (${ BIBLIOTECA.activos.filter( ( a ) => a.categoria === c.id ).length })` ) );
		sel.value = filtro;
		sel.addEventListener( 'change', () => {

			filtro = sel.value;
			pintar();

		} );
		const out: Node[] = [ h( 'p', { class: 'st-ayuda' }, 'Activos procedurales editables. «Inspiración» es una referencia interna de estilo: no se muestra al comprador ni reproduce productos concretos.' ), sel ];
		for ( const a of BIBLIOTECA.activos.filter( ( x ) => x.categoria === filtro ) ) out.push( tarjetaActivo( a, a.sustituye ? null : { texto: 'Colocar', hacer: () => colocar( a ) } ) );

		// nuevo activo a partir de una referencia
		const f = h( 'form', { class: 'st-nuevo' } ) as HTMLFormElement;
		const campo = ( n: string, etiqueta: string, el: HTMLElement ) => {

			el.setAttribute( 'name', n );
			return h( 'label', { class: 'st-campo' }, h( 'span', {}, etiqueta ), el );

		};
		const selCat = h( 'select' ) as HTMLSelectElement;
		for ( const c of BIBLIOTECA.categorias ) selCat.append( h( 'option', { value: c.id }, c.nombre ) );
		selCat.value = filtro;
		const selGen = h( 'select' ) as HTMLSelectElement;
		for ( const g of Object.keys( GENERADORES ) ) selGen.append( h( 'option', { value: g }, g ) );
		selGen.value = BIBLIOTECA.activos.find( ( a ) => a.categoria === filtro )?.generador ?? 'sofa';
		const selMat = h( 'select' ) as HTMLSelectElement;
		for ( const m of [ 'tela', 'boucle', 'madera', 'metal', 'marmol', 'ceramica', 'terracota' ] ) selMat.append( h( 'option', { value: m }, m ) );
		f.append(
			h( 'h3', {}, 'Nuevo activo desde una referencia' ),
			campo( 'nombre', 'Nombre', h( 'input', { type: 'text', required: '', placeholder: 'Sofá tres plazas lino tostado' } ) ),
			campo( 'categoria', 'Categoría', selCat ),
			campo( 'generador', 'Forma base', selGen ),
			h( 'div', { class: 'st-tres' },
				campo( 'ancho', 'Ancho (m)', h( 'input', { type: 'number', step: '0.01', value: '2.0', required: '' } ) ),
				campo( 'fondo', 'Fondo (m)', h( 'input', { type: 'number', step: '0.01', value: '0.9', required: '' } ) ),
				campo( 'alto', 'Alto (m)', h( 'input', { type: 'number', step: '0.01', value: '0.8', required: '' } ) ) ),
			h( 'div', { class: 'st-tres' }, campo( 'material', 'Material', selMat ), campo( 'color', 'Color', h( 'input', { type: 'color', value: '#c9b8a0' } ) ),
				campo( 'gama', 'Gama', ( () => {

					const s = h( 'select' );
					for ( const g of [ 'esencial', 'media', 'alta' ] ) s.append( h( 'option', { value: g }, g ) );
					return s;

				} )() ) ),
			campo( 'estilo', 'Estilo', h( 'input', { type: 'text', placeholder: 'mediterráneo contemporáneo' } ) ),
			campo( 'inspiracion', 'Universo de referencia (interno)', h( 'input', { type: 'text', placeholder: 'Kave Home, Maison du Monde…' } ) ),
			campo( 'imagen', 'Imagen de referencia (opcional)', h( 'input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' } ) ),
			h( 'div', { class: 'st-acciones' },
				h( 'button', { type: 'submit', value: 'manual' }, 'Crear con estos datos' ),
				sample ? h( 'button', { type: 'submit', value: 'ia', class: 'st-principal' }, 'Interpretar con IA' ) : null ),
			estadoGen ? h( 'p', { class: 'st-estado', role: 'status' }, estadoGen ) : '',
		);
		f.addEventListener( 'submit', async ( ev ) => {

			ev.preventDefault();
			const modo = ( ( ev as SubmitEvent ).submitter as HTMLButtonElement | null )?.value;
			const d = new FormData( f );
			const color = String( d.get( 'color' ) );
			const mat = `${ d.get( 'material' ) }:${ color }`;
			const gen = String( d.get( 'generador' ) );
			const dims: [ number, number, number ] = [ Number( d.get( 'ancho' ) ), Number( d.get( 'fondo' ) ), Number( d.get( 'alto' ) ) ];
			let params: Record<string, string | number | boolean> = { tela: mat, material: mat, tapa: mat, base: mat };
			let nombre = String( d.get( 'nombre' ) );
			const imagen = d.get( 'imagen' ) as File | null;
			if ( modo === 'ia' && sample ) {

				estadoGen = 'Interpretando la referencia con Claude…';
				pintar();
				try {

					const r = await sample.json<{ generador?: string; params?: Record<string, string | number | boolean>; nombre?: string }>(
						`Traduce esta pieza de mobiliario a un generador procedural. Generadores disponibles: ${ Object.keys( GENERADORES ).join( ', ' ) }.
Medidas: ${ dims.join( ' x ' ) } m (ancho x fondo x alto). Material principal: ${ mat }. Nombre: ${ nombre }. Estilo: ${ d.get( 'estilo' ) }.
Parámetros conocidos (valores de material con forma "tipo:#hex", tipos: tela, boucle, madera, metal, marmol, ceramica, terracota; listas separadas por |):
sofa: tela, patas, patas_alto, forma (recto|curvo), cojines, manta · cama: base, cabecero, cabecero_tipo (liso|capitone|listones), cabecero_alto, ropa, cojines, plaid · mesa-centro/mesa-comedor/mesa-auxiliar: tapa, pie, forma (redonda|pedestal) · mueble-bajo: material, acanalado, patas, alto · lampara-*: base, pantalla, metal · planta: maceta, hoja, tipo (arbol|hojas) · alfombra: material, borde, forma (redonda) · cuadro: marco, lienzo ("lienzo:#a,#b,#c").
Es una aproximación ligera; no reproduzcas un producto concreto. Responde SOLO JSON: {"generador": "...", "nombre": "...", "params": {...}}`,
						{ images: imagen && imagen.size && conImagenes ? [ imagen ] : undefined, modelTier: 'quick' } );
					if ( r.generador && GENERADORES[ r.generador ] ) params = r.params ?? params;
					if ( r.nombre ) nombre = r.nombre;
					estadoGen = 'Activo generado. Revísalo en la escena.';
					if ( r.generador && GENERADORES[ r.generador ] ) selGen.value = r.generador;

				} catch ( e ) {

					estadoGen = `No se pudo interpretar con IA (${ ( e as { code?: string } ).code ?? 'error' }): se crea con los datos del formulario.`;

				}

			}

			const a: Activo = {
				id: `propio-${ Date.now().toString( 36 ) }`, categoria: String( d.get( 'categoria' ) ), nombre, estilo: String( d.get( 'estilo' ) || 'propio' ),
				materiales: String( d.get( 'material' ) ), color, gama: String( d.get( 'gama' ) ) as Activo[ 'gama' ], dims, generador: GENERADORES[ selGen.value ] ? selGen.value : gen, params,
				inspiracion: String( d.get( 'inspiracion' ) || '' ).split( ',' ).map( ( s ) => s.trim() ).filter( Boolean ), referencia: `PROPIO-${ BIBLIOTECA.activos.length + 1 }`, miniatura: null, propio: true,
			};
			const tipoEquipo = { sofas: 'sofa', camas: 'cama', mesillas: 'mesilla', sillas: 'silla' }[ a.categoria ];
			if ( tipoEquipo ) a.sustituye = [ tipoEquipo ];
			BIBLIOTECA.activos.push( a );
			filtro = a.categoria;
			if ( ! a.sustituye ) colocar( a );
			else {

				estadoGen ||= 'Activo creado. Selecciona el mueble en la escena para sustituirlo.';
				cambio( false );
				pintar();

			}

		} );
		out.push( f );
		return out;

	}

	// ------------------------------------------------------------ documentación
	type Doc = { id: string; nombre: string; ficheros: { nombre: string; tamano: number; fecha: string }[] };
	const docs = ( ( api.promocion as unknown as { documentacion?: Doc[] } ).documentacion ??= [
		{ id: 'urbanizacion', nombre: 'Plano de urbanización', ficheros: [] },
		{ id: 'tipologias', nombre: 'Planos acotados de tipologías', ficheros: [] },
		{ id: 'superficies', nombre: 'Cuadro de superficies', ficheros: [] },
		{ id: 'viviendas', nombre: 'Número y distribución de viviendas', ficheros: [] },
		{ id: 'memoria-tecnica', nombre: 'Memoria técnica', ficheros: [] },
		{ id: 'memoria-calidades', nombre: 'Memoria de calidades', ficheros: [] },
		{ id: 'comercial', nombre: 'Información comercial', ficheros: [] },
		{ id: 'branding', nombre: 'Branding de la promotora', ficheros: [] },
		{ id: 'acabados', nombre: 'Acabados y opciones', ficheros: [] },
		{ id: 'precios', nombre: 'Precios y condiciones', ficheros: [] },
	] );
	function pintarDocumentacion(): Node[] {

		const p = api.promocion;
		const m = api.modelo();
		// lo que ya está integrado en los datos
		const integrado: Record<string, string> = {
			tipologias: `${ p.tipologias.length } ${ p.tipologias.length === 1 ? 'tipología modelada' : 'tipologías modeladas' }`,
			superficies: `Útil ${ m.vivienda.meta.superficies_oficiales.interior } m² · exterior ${ m.vivienda.meta.superficies_oficiales.exterior } m²`,
			viviendas: `${ p.viviendas.length } ${ p.viviendas.length === 1 ? 'vivienda' : 'viviendas' }: ${ p.viviendas.map( ( v ) => v.ref ).join( ', ' ) }`,
			'memoria-calidades': 'Acabados de la memoria aplicados al catálogo',
			branding: `Marca «${ p.marca.promotora }» aplicada`,
			acabados: `${ api.catalogo.categorias.length } categorías de personalización`,
			precios: `${ api.catalogo.categorias.reduce( ( s, c ) => s + c.opciones.length, 0 ) } opciones con precio`,
		};
		const out: Node[] = [ h( 'p', { class: 'st-ayuda' }, 'Documentación de la promoción: la base de todo el Studio. Se registra qué se ha recibido y qué está ya integrado en los datos. Los ficheros no se suben a ningún servidor: solo se anota su referencia.' ) ];
		for ( const d of docs ) {

			const ok = integrado[ d.id ];
			const entrada = h( 'input', { type: 'file', multiple: '', 'aria-label': `Adjuntar ${ d.nombre }` } ) as HTMLInputElement;
			entrada.addEventListener( 'change', () => {

				for ( const f of entrada.files ?? [] ) d.ficheros.push( { nombre: f.name, tamano: f.size, fecha: new Date().toISOString().slice( 0, 10 ) } );
				cambio( false );
				pintar();

			} );
			const estado = ok ? 'integrado' : d.ficheros.length ? 'recibido' : 'pendiente';
			out.push( h( 'div', { class: `st-doc ${ estado }` },
				h( 'span', { class: 'st-estado-doc' }, { integrado: 'Integrado', recibido: 'Recibido', pendiente: 'Pendiente' }[ estado ] ),
				h( 'span', { class: 'st-texto' }, h( 'strong', {}, d.nombre ), h( 'small', {}, [ ok, ...d.ficheros.map( ( f ) => `${ f.nombre } (${ Math.round( f.tamano / 1024 ) } KB, ${ f.fecha })` ) ].filter( Boolean ).join( ' · ' ) || 'Sin recibir' ) ),
				h( 'label', { class: 'st-mini st-adjuntar' }, 'Adjuntar', entrada ) ) );

		}

		return out;

	}

	// ------------------------------------------------------------ actualización de planos
	let versionElegida = '';
	function pintarActualizacion(): Node[] {

		const t = api.modelo().tipologia;
		const base = cargarModelo( t.id, false ); // siempre sobre la orientación de la tipología
		const vs = versionesDe( t.id );
		const rev = t.revision;
		const out: Node[] = [
			h( 'p', { class: 'st-ayuda' }, 'Cuando llega una nueva versión del plano (p. ej. del anteproyecto al proyecto de ejecución) se sustituye la geometría de la tipología. Visor, renders, plano comercial, superficies y documentos se regeneran solos; aquí se ve qué ha cambiado y qué hay que repasar a mano.' ),
			h( 'p', { class: 'st-nota' }, rev ? `Versión actual: ${ rev.fase } · v${ rev.version } · ${ rev.fecha }${ rev.fuente ? ` · ${ rev.fuente }` : '' }` : 'Versión actual sin datos de revisión.' ),
		];
		// comparación con una versión guardada
		out.push( h( 'h3', {}, 'Cambios respecto a una versión anterior' ) );
		if ( ! vs.length ) out.push( h( 'p', { class: 'st-ayuda' }, 'No hay versiones anteriores guardadas en versiones/.' ) );
		else {

			versionElegida ||= vs[ vs.length - 1 ].nombre;
			const sel = h( 'select', { 'aria-label': 'Versión con la que comparar' } ) as HTMLSelectElement;
			for ( const x of vs ) sel.append( h( 'option', { value: x.nombre }, x.nombre ) );
			sel.value = versionElegida;
			sel.addEventListener( 'change', () => {

				versionElegida = sel.value;
				pintar();

			} );
			out.push( sel );
			const anterior = vs.find( ( x ) => x.nombre === versionElegida )!.vivienda;
			const cambios = compararViviendas( anterior, base.vivienda );
			if ( ! cambios.length ) out.push( h( 'p', { class: 'st-ok' }, 'La geometría actual es idéntica a esa versión.' ) );
			else {

				const porAmbito = new Map<string, typeof cambios>();
				for ( const c of cambios ) porAmbito.set( c.ambito, [ ...( porAmbito.get( c.ambito ) ?? [] ), c ] );
				for ( const [ ambito, cs ] of porAmbito ) out.push( h( 'details', { open: '' }, h( 'summary', {}, `${ ambito } · ${ cs.length } ${ cs.length === 1 ? 'cambio' : 'cambios' }` ),
					h( 'ul', { class: 'st-cambios' }, ...cs.map( ( c ) => h( 'li', { class: c.tipo }, h( 'strong', {}, `${ { nuevo: 'Nuevo', eliminado: 'Eliminado', modificado: 'Modificado' }[ c.tipo ] }: ` ), c.id, c.detalle ? ` — ${ c.detalle }` : '' ) ) ) ) );

			}

		}

		// revisión de impactos
		out.push( h( 'h3', {}, 'Revisión de lo que depende de la geometría' ) );
		const hallazgos = revisarPromocion( base.vivienda, base.tipologia, base.alternativas, base.ambientacion, api.catalogo );
		const orden = { error: 0, aviso: 1, ok: 2 };
		out.push( h( 'ul', { class: 'st-hallazgos' }, ...hallazgos.sort( ( a, b ) => orden[ a.nivel ] - orden[ b.nivel ] ).map( ( x ) => h( 'li', { class: x.nivel }, h( 'span', { class: 'st-nivel' }, { error: 'Corregir', aviso: 'Revisar', ok: 'Correcto' }[ x.nivel ] ), h( 'span', {}, h( 'strong', {}, `${ x.ambito }. ` ), x.mensaje ) ) ) ) );
		out.push( h( 'h3', {}, 'Qué se regenera solo' ), h( 'ul', { class: 'st-lista' },
			h( 'li', {}, 'Muros, carpinterías, suelos, techos, rodapiés, luces de ventana y paisaje' ),
			h( 'li', {}, 'Superficies de la ficha, del plano comercial y de los documentos' ),
			h( 'li', {}, 'Plano comercial (rótulos recolocados sin solapes) y renders HD' ),
			h( 'li', {}, 'Vistas automáticas de las estancias nuevas que no tengan vista' ),
			h( 'li', {}, 'Viviendas simétricas (se espejan de la misma geometría)' ) ),
		h( 'h3', {}, 'Qué hay que repasar' ), h( 'ul', { class: 'st-lista' },
			h( 'li', {}, 'Cámaras compuestas a mano (pestaña Cámaras) si la estancia cambia' ),
			h( 'li', {}, 'Decoración colocada (pestaña Escena)' ),
			h( 'li', {}, 'Parches de las distribuciones alternativas (alternativas.json)' ),
			h( 'li', {}, 'Opciones y precios afectados (pestaña Acabados y precios)' ) ) );
		return out;

	}

	// ------------------------------------------------------------ publicación
	/** Paquete de datos editables (sin espejar: siempre en la orientación de la tipología). */
	function paquete() {

		const m = api.modelo();
		const S = ejeSimetria( m.vivienda );
		const t0 = api.espejo() ? espejarTipologia( m.tipologia, S ) : m.tipologia;
		// las vistas automáticas no se exportan: se regeneran al cargar si siguen faltando
		const auto = Object.keys( t0.vistas ).filter( ( k ) => t0.vistas[ k ].automatica );
		const tipologia = { ...t0, vistas: Object.fromEntries( Object.entries( t0.vistas ).filter( ( [ k ] ) => ! auto.includes( k ) ) ), guiadas: t0.guiadas.filter( ( k ) => ! auto.includes( k ) ) };
		const ambientacion = m.ambientacion && ( api.espejo() ? espejarAmbientacion( m.ambientacion, S ) : m.ambientacion );
		return {
			version: 1, generado: new Date().toISOString(),
			'promocion.json': api.promocion,
			'catalogo.json': api.catalogo,
			'biblioteca.propios.json': BIBLIOTECA.activos.filter( ( a ) => a.propio ),
			tipologias: { [ tipologia.id ]: { 'tipologia.json': tipologia, 'ambientacion.json': ambientacion } },
		};

	}

	function validar() {

		const avisos: string[] = [];
		const m = api.modelo();
		for ( const d of amb().decoracion ) {

			if ( ! activo( d.activo ) ) avisos.push( `La decoración «${ d.id }» usa un activo que no existe.` );
			const r = huella( d );
			if ( d.elev < 0.05 && m.vivienda.muros.some( ( w ) => r[ 0 ] < w.rect[ 2 ] - 0.02 && r[ 2 ] > w.rect[ 0 ] + 0.02 && r[ 1 ] < w.rect[ 3 ] - 0.02 && r[ 3 ] > w.rect[ 1 ] + 0.02 ) ) avisos.push( `«${ activo( d.activo )?.nombre ?? d.id }» invade un muro.` );

		}

		avisos.push( ...revisarVistas( m.tipologia, m.vivienda ) );
		for ( const c of api.catalogo.categorias ) if ( c.opciones[ 0 ]?.precio ) avisos.push( `La opción incluida de «${ c.nombre }» tiene precio.` );
		return avisos;

	}

	function pintarPublicacion(): Node[] {

		const avisos = validar();
		let borrador: string | null = null;
		try {

			borrador = localStorage.getItem( CLAVE_BORRADOR );

		} catch { /* sin almacenamiento */ }

		return [
			h( 'p', { class: 'st-ayuda' }, 'La web publicada no ejecuta IA ni edita nada: carga datos preparados. Exporta el paquete, sustituye los ficheros en trabajo/<id>/ (y trabajo/<id>/tipologias/<tipología>/), súbelos a Supabase (herramientas/promociones.mjs subir) y vuelve a publicar.' ),
			h( 'h3', {}, 'Revisión' ),
			avisos.length ? h( 'ul', { class: 'st-avisos' }, ...avisos.map( ( a ) => h( 'li', {}, a ) ) ) : h( 'p', { class: 'st-ok' }, 'Sin incidencias.' ),
			h( 'div', { class: 'st-acciones' },
				boton( 'Exportar paquete de datos (JSON)', () => {

					const blob = new Blob( [ JSON.stringify( paquete(), null, 1 ) ], { type: 'application/json' } );
					void api.descargar( `${ api.promocion.id }-studio-${ new Date().toISOString().slice( 0, 10 ) }.json`, blob );

				}, 'st-principal' ),
				borrador ? boton( 'Recuperar borrador guardado', () => {

					try {

						const b = JSON.parse( borrador! );
						const t = Object.values( b.tipologias ?? {} )[ 0 ] as { 'ambientacion.json'?: Ambientacion } | undefined;
						const S = ejeSimetria( api.modelo().vivienda );
						for ( const a of b[ 'biblioteca.propios.json' ] ?? [] ) if ( ! activo( a.id ) ) BIBLIOTECA.activos.push( a );
						if ( t?.[ 'ambientacion.json' ] ) api.modelo().ambientacion = api.espejo() ? espejarAmbientacion( t[ 'ambientacion.json' ], S ) : t[ 'ambientacion.json' ];
						cambio();
						api.avisar( 'Borrador de ambientación recuperado.' );

					} catch {

						api.avisar( 'El borrador guardado no se puede leer.' );

					}

				} ) : null ),
			h( 'p', { class: 'st-nota' }, 'El borrador se guarda solo en este navegador a cada cambio, como red de seguridad.' ),
		];

	}

	pintar();

}
