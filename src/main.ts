import * as THREE from 'three/webgpu';
import { add, diffuseColor, float, luminance, max, metalness, mix, mrt, normalView, output, packNormalToRGB, pass, pow, renderOutput, roughness, sample, smoothstep, unpackRGBToNormal, uv, vec2, vec3, vec4, velocity } from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { ssgi } from 'three/addons/tsl/display/SSGINode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import type { Rect, Vivienda, ViviendaPromocion } from './modelo/tipos';
import { colocarRotulo } from './escena/rotulos';
import { puntoEnPoligono } from './util/geo';
import * as M from './escena/materiales';
import { construirMuros } from './escena/muros';
import { construirCantoPorche, construirSuelos } from './escena/suelos';
import { construirCarpinterias } from './escena/carpinterias';
import { construirEquipamiento } from './escena/equipamiento';
import { obstaculos } from './biblioteca/biblioteca';
import { construirDownlights, construirMecanismos, construirRodapies } from './escena/detalles';
import { construirLucesVentana } from './escena/luzVentana';
import { construirPaisaje } from './escena/paisaje';
import { construirLineas } from './escena/lineas';
import { entorno, fondo, sol as crearSol } from './escena/luz';
import { Camarografo, fovPara, type Vista } from './escena/camaras';
import { Estados } from './escena/estados';
import { Navegacion } from './escena/navegacion';
import { construirPiscina, validarPiscina } from './escena/piscina';
import { aplicarAlternativa, fmtM2 } from './configurador/alternativas';
import { Configurador, fmtEuros, fmtPrecio, type Seleccion } from './configurador/configurador';
import { conectarSolicitar } from './promocion/solicitar';
import { Panel } from './configurador/panel';
import { fmtFecha, packsDeVivienda } from './configurador/packs';
import { conectarComentarios3D } from './promocion/comentarios3d';
import { conectarDescargaLotes, type UnidadLote } from './documento/descarga';
import { CATALOGO, PROMOCION, accesoProfesional, cargarModelo, claveUnidad, catalogoPara, estadoPublico, extraerCodigo, guardarSeleccion as guardarEnSupabase, paseInicial, resolverAcceso, resolverProfesional, salirProfesional, viviendaDeUnidad, viviendaPublica, type Modelo } from './promocion/promocion';
import { aplicarMarca } from './promocion/marca';
import { dePlanta, esMultiplanta, plantaCalle, plantasDe } from './modelo/plantas';
import { esCerrada, esGaraje, esUtil } from './modelo/estancias';
import { limites, marcoEntorno } from './modelo/exteriores';
import { ACABADOS } from './promocion/acabados';
import { generarPDF } from './documento/pdf';
import { planoPDF, planoPNG, type DatosPlano } from './documento/plano';
import { RenderHD } from './escena/renderHD';
import { cargarEntornoReal, construirEntornoReal, liberarEntornoReal, type Situacion } from './escena/entornoReal';
import './estilos.css';

const $ = <T extends HTMLElement>( s: string ) => document.querySelector( s ) as T;
const CLAVE_ACCESO = 'inmobiliarias:acceso';
const claveSeleccion = ( ref: string ) => `inmobiliarias:seleccion:${ PROMOCION.id }:${ ref }`;
const guardar = ( k: string, v: string | null ) => {

	try {

		if ( v === null ) localStorage.removeItem( k ); else localStorage.setItem( k, v );

	} catch { /* sin almacenamiento local: solo dura la sesión */ }

};

const leer = ( k: string ) => {

	try {

		return localStorage.getItem( k );

	} catch {

		return null;

	}

};

/** Nombre de archivo sin tildes ni espacios: «Tipología A» → «tipologia-a». */
const slug = ( s: string ) => s.normalize( 'NFD' ).replace( /[\u0300-\u036f]/g, '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );

/**
 * Progreso del render HD en lenguaje llano: el render informa por mosaicos y
 * muestras; aquí se convierte en un porcentaje.
 */
const progresoRender = ( pr: ( t: string ) => void ) => ( t: string ) => {

	const m = t.match( /(?:mosaico (\d+) de (\d+), )?muestra (\d+) de (\d+)/ );
	if ( ! m ) return pr( 'Terminando la imagen…' );
	const [ n, total, s, muestras ] = [ m[ 1 ] ?? 1, m[ 2 ] ?? 1, m[ 3 ], m[ 4 ] ].map( Number );
	pr( `Generando la imagen… ${ Math.floor( ( ( n - 1 ) * muestras + s - 1 ) / ( total * muestras ) * 100 ) }\u00a0%` );

};

async function iniciar() {

	aplicarMarca( PROMOCION );

	const lienzo = $( '#lienzo' );
	const forzarWebGL = new URLSearchParams( location.search ).has( 'webgl' );
	const renderer = new THREE.WebGPURenderer( { antialias: false, forceWebGL: forzarWebGL } );
	renderer.setPixelRatio( Math.min( devicePixelRatio, 1.5 ) );
	renderer.setSize( innerWidth, innerHeight );
	// Neutral (Khronos PBR): conserva los colores de los acabados. AgX se probó
	// (?tono=agx) y apagaba el contraste y el color de los interiores.
	renderer.toneMapping = new URLSearchParams( location.search ).get( 'tono' ) === 'agx' ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
	renderer.toneMappingExposure = 0.95;
	renderer.shadowMap.enabled = true;
	renderer.shadowMap.type = THREE.PCFShadowMap;
	lienzo.appendChild( renderer.domElement );
	await renderer.init();
	const backend = ( renderer.backend as unknown as { isWebGPUBackend?: boolean } ).isWebGPUBackend ? 'WebGPU' : 'WebGL 2';
	// Red de seguridad: si WebGPU da un error de validación o pierde el
	// dispositivo, se recarga en WebGL 2 (una sola vez) en vez de quedar en negro.
	const aWebGL = ( motivo: string ) => {

		console.warn( 'WebGPU no disponible, se pasa a WebGL 2:', motivo );
		const u = new URL( location.href );
		if ( u.searchParams.has( 'webgl' ) ) return;
		u.searchParams.set( 'webgl', '' );
		location.replace( u.toString() );

	};
	const dispositivo = ( renderer.backend as unknown as { device?: GPUDevice } ).device;
	if ( backend === 'WebGPU' && dispositivo ) {

		dispositivo.addEventListener( 'uncapturederror', ( e ) => aWebGL( ( e as GPUUncapturedErrorEvent ).error.message ) );
		void dispositivo.lost.then( ( i ) => i.reason !== 'destroyed' && aWebGL( i.message ) );

	}
	console.info( 'Motor de dibujo:', backend );

	const escena = new THREE.Scene();
	escena.backgroundNode = fondo();
	escena.environment = entorno( renderer );

	const camara = new THREE.PerspectiveCamera( 28, innerWidth / innerHeight, 0.05, 200 );
	const ctrl = new OrbitControls( camara, renderer.domElement );
	const nav = new Navegacion( camara, ctrl, renderer.domElement );

	// ---------------------------------------------------------------- acceso
	// Parte pública: plano, vivienda y vistas. Con el enlace privado de una
	// vivienda (#código) se carga esa vivienda y se habilita la personalización.
	// Modo profesional (paso 6a): el equipo de la promotora llega desde MUNE Portal
	// con un pase (#p-…) y ve todas las viviendas, con su personalización y lo
	// que ha elegido cada comprador. No usa códigos de comprador.
	// Experience pública (paso 6b): ¿activa?, ¿con acceso de compradores?, «Solicitar información»
	const estadoPublicoP = __STUDIO__ ? Promise.resolve( null ) : estadoPublico();
	const pase = paseInicial();
	const accesoProfesionalInicial = pase ? await resolverProfesional( pase ) : null;
	const profesional = typeof accesoProfesionalInicial === 'object' ? accesoProfesionalInicial : null;
	document.body.classList.toggle( 'profesional', !! profesional );
	document.body.classList.toggle( 'perfil-promotora', !! profesional );
	const pideProfesional = /^#(studio|promotora)/.test( location.hash );
	const codigoInicial = profesional ? '' : ( pideProfesional ? '' : extraerCodigo( location.hash ) ) || leer( CLAVE_ACCESO ) || '';
	const accesoInicial = profesional ? null : await resolverAcceso( codigoInicial );
	let comprador: ViviendaPromocion | null = profesional
		? viviendaDeUnidad( new URLSearchParams( location.search ).get( 'ver' ) ) ?? PROMOCION.viviendas[ 0 ]
		: typeof accesoInicial === 'object' ? accesoInicial : null;
	// código que ya no vale: se olvida (si no se pudo comprobar, se conserva para la próxima vez)
	if ( accesoInicial === null && codigoInicial ) guardar( CLAVE_ACCESO, null );
	// ?ver=<unidad> (p. ej. «a-espejo»): el equipo de la promotora revisa desde MUNE
	// Portal una tipología y variante concreta. Solo cambia la vivienda que se
	// enseña: no abre la personalización ni nada más. Con código, manda el comprador.
	const viviendaSinCodigo = () => viviendaDeUnidad( new URLSearchParams( location.search ).get( 'ver' ) ) ?? viviendaPublica();
	let fichaVivienda: ViviendaPromocion = comprador ?? viviendaSinCodigo();

	// ---------------------------------------------------------------- modelo
	// Contenedores persistentes: cambiar de distribución o de vivienda solo
	// sustituye su contenido; estados, cámaras y render apuntan a lo mismo.
	let modelo: Modelo = cargarModelo( fichaVivienda.tipologia, fichaVivienda.espejo );
	/** Configurador de una vivienda con sus packs (el histórico formalizado solo lo ve su comprador). */
	const crearConfigurador = ( v: ViviendaPromocion ) => {

		const catalogo = catalogoPara( v );
		const propia = comprador?.ref === v.ref;
		return new Configurador( catalogo, packsDeVivienda( PROMOCION, propia ? v : { ...v, selecciones: undefined }, catalogo.categorias ) );

	};
	let conf = crearConfigurador( fichaVivienda );
	let vivienda: Vivienda = modelo.vivienda;
	const H = modelo.vivienda.alturas.libre.valor;
	M.U.altura.value = H;
	const matMuros = {
		pintura: M.conPoche( M.pintura( ACABADOS.paredes.color, true, true ) ),
		alicatado: M.conPoche( M.alicatado( M.P.banos.pared, true, ACABADOS.alicatado ) ),
		fachada: M.conPoche( M.sate( ACABADOS.fachada.color, true, ACABADOS.fachada.textura === 'ladrillo', ACABADOS.fachada.junta ) ),
	};
	const grupo = ( nombre: string ) => Object.assign( new THREE.Group(), { name: nombre } );
	const c = {
		muros: grupo( 'muros' ), suelos: grupo( 'suelos' ), techos: grupo( 'techos' ), volumenes: grupo( 'volumenes' ),
		carpinterias: grupo( 'carpinterias' ), barandilla: grupo( 'barandilla' ), fijo: grupo( 'equipamiento-fijo' ),
		mobiliario: grupo( 'mobiliario' ), lineas: grupo( 'lineas' ), canto: grupo( 'canto-porche' ), piscina: grupo( 'piscina' ),
	};
	const volcar = ( destino: THREE.Group, origen: THREE.Object3D, liberarMateriales = false ) => {

		for ( const hijo of [ ...destino.children ] ) {

			hijo.traverse( ( o ) => {

				const m = o as THREE.Mesh;
				m.geometry?.dispose();
				( o as THREE.SpotLight ).shadow?.dispose?.();
				if ( liberarMateriales ) ( Array.isArray( m.material ) ? m.material : [ m.material ] ).forEach( ( x ) => x?.dispose() );

			} );
			destino.remove( hijo );

		}

		for ( const hijo of [ ...origen.children ] ) destino.add( hijo );

	};

	const { entorno: suelo } = construirSuelos( modelo.vivienda );
	// el sol apunta al centro de la vivienda (sus sombras la cubren entera)
	const mc = marcoEntorno( dePlanta( modelo.vivienda, plantaCalle( modelo.vivienda ) ) );
	const luzSol = crearSol( new THREE.Vector3( mc.cx, 0, mc.cz ) );
	escena.add( ...Object.values( c ), suelo!, luzSol, luzSol.target );
	const lucesVentana = new THREE.Group();
	escena.add( lucesVentana );
	// entorno real (decisiones 64 y 66): se ve desde dentro de la vivienda, por las
	// ventanas; se descarga la primera vez
	let entornoActivo = false;
	let enLaVivienda = false;
	let entornoGrupo: THREE.Group | null = null;

	// ---------------------------------------------------------------- plantas
	// Viviendas en varias plantas: en el plano se ve solo la planta elegida; en
	// 3D, esa y las de debajo (las de encima se levantan, como en una maqueta),
	// y se recorre la elegida.
	let plantaActiva = plantaCalle( modelo.vivienda );
	// a pie (dentro, en el jardín, en la rampa…) se ven también las plantas de encima
	let aPie = false;
	const cotaActiva = () => plantasDe( vivienda )[ plantaActiva ]?.cota ?? 0;
	const mostrarPlantas = () => {

		const multi = esMultiplanta( vivienda );
		const enPlano = document.body.dataset.modo === 'plano';
		// en un sótano, el terreno de alrededor se aparta para verlo (desde dentro, se queda)
		// con el entorno real (desde dentro), su suelo y sus árboles sustituyen a los de la vivienda
		const conEntorno = entornoActivo && !! entornoGrupo && ! enPlano;
		suelo!.visible = ! conEntorno && ( cotaActiva() >= 0 || ( aPie && ! enPlano ) );
		if ( entornoGrupo ) entornoGrupo.visible = conEntorno;
		for ( const g of [ c.muros, c.suelos, c.techos, c.volumenes, c.carpinterias, c.barandilla, c.fijo, c.mobiliario, lucesVentana ] ) {

			for ( const h of g.children ) {

				const p = h.userData.planta ?? 0;
				const oculta = multi && ( enPlano ? p !== plantaActiva : p > plantaActiva && ! aPie );
				// oculta: no se enseña (otra planta, o el paisaje inventado cuando está el real)
				h.userData.oculta = oculta || ( conEntorno && !! h.userData.paisaje );
				h.visible = ! h.userData.oculta;

			}

		}

	};

	const botonesPlanta = $( '.plantas' );
	/** Elige la planta activa (y, si se pide, encuadra: el plano o la vista general). */
	const cambiarPlanta = ( i: number, encuadrar = true ) => {

		plantaActiva = i;
		interioresPlanta = dePlanta( vivienda, i ).estancias.filter( esCerrada );
		botonesPlanta.querySelectorAll( 'button' ).forEach( ( b, k ) => b.setAttribute( 'aria-current', String( k === i ) ) );
		mostrarPlantas();
		construirLineasActuales();
		construirEtiquetas();
		nav.actualizarObstaculos( dePlanta( vivienda, i ), obstaculos( modelo.ambientacion ), cotaActiva() );
		if ( ! encuadrar ) return;
		if ( document.body.dataset.modo === 'plano' ) {

			( modelo.tipologia.vistas as Record<string, Vista> ).planta = encajePlanta();
			cam.ir( 'planta' );

		} else cam.ir( 'aerea' );
		despertar();

	};
	const pintarBotonesPlanta = () => {

		const ps = plantasDe( vivienda );
		botonesPlanta.hidden = ps.length < 2;
		botonesPlanta.replaceChildren( ...ps.map( ( p, k ) => {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.textContent = p.nombre;
			b.setAttribute( 'aria-current', String( k === plantaActiva ) );
			b.addEventListener( 'click', () => cambiarPlanta( k ) );
			return b;

		} ) );

	};

	// etiquetas de estancias (modo Plano)
	const etiquetas = new CSS2DRenderer( { element: $( '#etiquetas' ) } );
	etiquetas.setSize( innerWidth, innerHeight );
	const grupoEtiquetas = new THREE.Group();
	escena.add( grupoEtiquetas );
	// escala del plano en pantalla (px por metro): la fija el encuadre de la planta
	let pxPorMetro = 40;
	const construirEtiquetas = () => {

		for ( const o of [ ...grupoEtiquetas.children ] ) grupoEtiquetas.remove( o );
		const extra: Rect[] = conf?.piscina && modelo.tipologia.piscina ? [ modelo.tipologia.piscina.rect ] : [];
		const ocupados: Rect[] = [];
		// primero las estancias pequeñas: son las que menos sitio tienen
		const pv = dePlanta( vivienda, plantaActiva );
		for ( const e of [ ...pv.estancias ].sort( ( a, b ) => a.superficie - b.superficie ) ) {

			const sup = `${ e.superficie.toLocaleString( 'es-ES', { minimumFractionDigits: 2 } ) } m²`;
			const r = colocarRotulo( e, pv, pxPorMetro, sup, extra, ocupados );
			ocupados.push( r.caja );
			const div = document.createElement( 'div' );
			div.className = `etiqueta ${ r.formato === 'solo-nombre-2' ? 'solo-nombre' : r.formato }`;
			const nombre = document.createElement( 'span' );
			nombre.className = 'nombre';
			r.lineas.forEach( ( l, i ) => {

				if ( i ) nombre.append( document.createElement( 'br' ) );
				nombre.append( l );

			} );
			div.title = `${ e.nombre } · ${ sup }`;
			div.append( nombre );
			if ( ! r.formato.startsWith( 'solo' ) ) {

				const s = document.createElement( 'span' );
				s.className = 'sup';
				s.textContent = sup;
				div.append( s );

			}
			const o = new CSS2DObject( div );
			o.position.set( r.x, cotaActiva() + 0.05, - r.y );
			grupoEtiquetas.add( o );

		}

	};

	/**
	 * Encuadre de la planta: el plano completo (con terraza) en el hueco libre de
	 * la pantalla, sin quedar debajo de la ficha ni de la barra inferior.
	 */
	const encajePlanta = (): Vista => {

		const v = dePlanta( vivienda, plantaActiva );
		const [ lx0, ly0, lx1, ly1 ] = limites( v );
		const b = [ lx0 - 0.3, ly0 - 0.3, lx1 + 0.3, ly1 + 0.3 ];
		const bw = b[ 2 ] - b[ 0 ], bh = b[ 3 ] - b[ 1 ];
		const W = innerWidth, H = innerHeight, margen = 24;
		const ficha = $( '.ficha' ).getBoundingClientRect(), dock = $( '.dock' ).getBoundingClientRect();
		const abajo = ( dock.height ? dock.top : H ) - margen;
		const huecos = [ { l: margen, t: margen, r: W - margen, b: abajo } ];
		if ( ficha.width ) huecos.push( { l: ficha.right + margen, t: margen, r: W - margen, b: abajo }, { l: margen, t: ficha.bottom + margen, r: W - margen, b: abajo } );
		// sin ficha visible vale toda la pantalla; con ficha, el mejor de los dos huecos libres
		const candidatos = ficha.width ? huecos.slice( 1 ) : huecos;
		let mejor = candidatos[ 0 ], s = 0;
		for ( const h of candidatos ) {

			const e = Math.min( ( h.r - h.l ) / bw, ( h.b - h.t ) / bh );
			if ( e > s ) {

				s = e; mejor = h;

			}

		}

		const base: Vista = { nombre: 'Planta', pos: [ 0, 0, 0 ], obj: [ 0, 0, 0 ], fov: 28 };
		const f = THREE.MathUtils.degToRad( fovPara( base, W / H ) );
		const alto = H / ( s * 2 * Math.tan( f / 2 ) );
		const dx = ( mejor.l + mejor.r ) / 2 - W / 2, dy = ( mejor.t + mejor.b ) / 2 - H / 2;
		const cx = ( b[ 0 ] + b[ 2 ] ) / 2 - dx / s, cz = - ( b[ 1 ] + b[ 3 ] ) / 2 - dy / s;
		pxPorMetro = s;
		return { ...base, pos: [ cx, cotaActiva() + alto, cz ], obj: [ cx, cotaActiva(), cz - 0.02 ] };

	};

	let interiores = vivienda.estancias.filter( esUtil );
	// las de la planta que se recorre (para saber si la cámara está dentro)
	let interioresPlanta = vivienda.estancias.filter( esCerrada );
	const utilInterior = () => interiores.reduce( ( t, x ) => t + x.superficie, 0 );
	const construirLineasActuales = () => {

		const g = construirLineas( dePlanta( vivienda, plantaActiva ), { piscina: conf.piscina && plantaActiva === 0 ? modelo.tipologia.piscina?.rect : undefined } );
		for ( const h of g.children ) h.position.y += cotaActiva();
		volcar( c.lineas, g, true );

	};

	/** Reconstruye la vivienda según la distribución elegida. Devuelve el informe de cambios. */
	let estados: Estados | undefined;
	const reconstruir = () => {

		const alternativa = modelo.alternativas.find( ( v ) => v.id === conf.alternativa ) ?? null;
		const r = aplicarAlternativa( modelo.vivienda, alternativa );
		vivienda = r.vivienda;
		// cada planta se construye por separado y se sube a su cota (dúplex,
		// unifamiliares); con una sola planta, todo queda como siempre
		const capas = { muros: grupo( 'muros' ), suelos: grupo( 's' ), techos: grupo( 't' ), volumenes: grupo( 'v' ), carpinterias: grupo( 'c' ),
			barandilla: grupo( 'b' ), fijo: grupo( 'f' ), mobiliario: grupo( 'm' ), luces: grupo( 'l' ) };
		const subir = ( destino: THREE.Group, origen: THREE.Object3D, i: number, cota: number ) => {

			for ( const hijo of [ ...origen.children ] ) {

				hijo.position.y += cota;
				hijo.userData.planta = i;
				destino.add( hijo );

			}

		};
		plantasDe( vivienda ).forEach( ( planta, i ) => {

			const pv = dePlanta( vivienda, i );
			const { geos } = construirMuros( pv );
			const muros = new THREE.Group();
			for ( const k of Object.keys( geos ) as ( keyof typeof geos )[] ) {

				const m = new THREE.Mesh( geos[ k ], matMuros[ k ] );
				m.castShadow = m.receiveShadow = true;
				muros.add( m );

			}
			subir( capas.muros, muros, i, planta.cota );
			const s = construirSuelos( pv, false );
			s.techos.add( construirDownlights( pv ) );
			subir( capas.suelos, s.suelos, i, planta.cota );
			subir( capas.techos, s.techos, i, planta.cota );
			subir( capas.volumenes, s.volumenes, i, planta.cota );
			const k = construirCarpinterias( pv );
			subir( capas.carpinterias, k.carpinterias, i, planta.cota );
			subir( capas.barandilla, k.barandilla, i, planta.cota );
			// la decoración, en la planta de su estancia
			const ids = new Set( pv.estancias.map( ( x ) => x.id ) );
			const amb = modelo.ambientacion && esMultiplanta( vivienda )
				? { ...modelo.ambientacion, decoracion: modelo.ambientacion.decoracion.filter( ( d ) => ids.has( d.estancia ) || ( i === plantaCalle( vivienda ) && ! vivienda.estancias.some( ( x ) => x.id === d.estancia ) ) ) }
				: modelo.ambientacion;
			const e = construirEquipamiento( pv, amb );
			if ( e.decoracion.children.length ) e.mobiliario.add( ...e.decoracion.children );
			e.fijo.add( Object.assign( construirRodapies( pv ), { userData: { x: 6 } } ) );
			e.fijo.add( Object.assign( construirMecanismos( pv ), { userData: { x: 6 } } ) );
			subir( capas.luces, construirLucesVentana( pv ), i, planta.cota );
			// paisaje de zonas comunes: va con el mobiliario para que no aparezca en el plano
			if ( i === plantaCalle( vivienda ) ) e.mobiliario.add( Object.assign( construirPaisaje( pv ), { userData: { x: 13, paisaje: true } } ) );
			subir( capas.fijo, e.fijo, i, planta.cota );
			subir( capas.mobiliario, e.mobiliario, i, planta.cota );

		} );
		volcar( c.muros, capas.muros );
		volcar( c.suelos, capas.suelos );
		volcar( c.techos, capas.techos );
		volcar( c.volumenes, capas.volumenes );
		volcar( c.carpinterias, capas.carpinterias );
		volcar( c.barandilla, capas.barandilla );
		volcar( lucesVentana, capas.luces );
		volcar( c.fijo, capas.fijo );
		volcar( c.mobiliario, capas.mobiliario );
		if ( plantaActiva >= plantasDe( vivienda ).length ) plantaActiva = plantaCalle( vivienda );
		pintarBotonesPlanta();
		mostrarPlantas();
		construirLineasActuales();
		construirEtiquetas();
		interiores = vivienda.estancias.filter( esUtil );
		interioresPlanta = dePlanta( vivienda, plantaActiva ).estancias.filter( esCerrada );
		nav.actualizarObstaculos( dePlanta( vivienda, plantaActiva ), obstaculos( modelo.ambientacion ), plantasDe( vivienda )[ plantaActiva ]?.cota ?? 0 );
		actualizarFicha();
		estados?.refrescar();
		despertar();
		return r.informe;

	};

	/** Carga (o recarga) la tipología de la vivienda: canto del porche y piscina dependen de la geometría. */
	const cargarGeometriaTipologia = () => {

		volcar( c.canto, construirCantoPorche( modelo.vivienda ) );
		const g = new THREE.Group();
		// no todas las tipologías prevén piscina (la opción del catálogo solo se ofrece si la hay)
		const piscina = modelo.tipologia.piscina;
		if ( piscina ) {

			g.add( construirPiscina( piscina ) );
			const fallos = validarPiscina( piscina, modelo.vivienda );
			if ( fallos.length ) console.warn( 'La piscina no cumple:', fallos.join( '; ' ) );

		}
		volcar( c.piscina, g );

	};

	// ---------------------------------------------------------------- posproceso
	const pipeline = new THREE.RenderPipeline( renderer );
	const escenaPass = pass( escena, camara );
	// WebGPU admite como máximo 32 bytes por píxel entre todas las salidas (color,
	// difuso, normal y velocidad ya los ocupan): metalicidad y rugosidad viajan en
	// los canales alfa libres del difuso y de la normal, sin añadir otra salida.
	escenaPass.setMRT( mrt( { output, diffuseColor: vec4( diffuseColor.rgb, metalness ), normal: vec4( packNormalToRGB( normalView ), roughness ), velocity } ) );
	const color = escenaPass.getTextureNode( 'output' );
	const difuso = escenaPass.getTextureNode( 'diffuseColor' );
	const profundidad = escenaPass.getTextureNode( 'depth' );
	const normal = escenaPass.getTextureNode( 'normal' );
	const vel = escenaPass.getTextureNode( 'velocity' );
	escenaPass.getTexture( 'diffuseColor' ).type = THREE.UnsignedByteType;
	escenaPass.getTexture( 'normal' ).type = THREE.UnsignedByteType;
	const normalEscena = sample( ( uv ) => unpackRGBToNormal( normal.sample( uv ) ) );
	const gi = ssgi( color, profundidad, normalEscena, camara );
	gi.sliceCount.value = 2;
	gi.stepCount.value = 8;
	gi.radius.value = 4;
	gi.giIntensity.value = 1.6;
	gi.aoIntensity.value = 1.15;
	gi.thickness.value = 0.5;
	// en planta no hay oclusión: el papel queda limpio y sin ruido temporal
	const ao = mix( gi.getAONode(), float( 1 ), M.U.plano );
	const compuesto = vec4( add( color.rgb.mul( ao ), difuso.rgb.mul( gi.getGINode().rgb ) ), color.a );
	// reflejos en espacio de pantalla: suelos, encimeras, sanitarios, cromados.
	// La intensidad sale del brillo de cada material (metales enteros; los
	// dieléctricos, según lo pulidos que estén), con fresnel de ángulo rasante.
	const reflectancia = max( difuso.a, pow( float( 1 ).sub( normal.a ), 3 ).mul( 0.6 ) );
	const reflejos = ssr( color, profundidad, normalEscena, { metalnessNode: reflectancia, roughnessNode: normal.a, reflectNonMetals: true, camera: camara } );
	reflejos.resolutionScale = 0.5;
	reflejos.maxDistance.value = 5;
	reflejos.thickness.value = 0.04;
	reflejos.quality.value = 0.45;
	reflejos.intensity.value = 0.85;
	const conReflejos = vec4( compuesto.rgb.add( reflejos.rgb.mul( M.U.plano.oneMinus() ) ), compuesto.a );
	const antialias = traa( conReflejos, profundidad, vel, camara );
	// resplandor suave de ventanas y luminarias, y gradación fotográfica
	const halo = bloom( antialias, 0.09, 0.35, 1.0 );
	const conHalo = antialias.rgb.add( halo.rgb );
	const lum = luminance( conHalo );
	const graduado = mix( vec3( lum ), conHalo, 1.05 ).mul( vec3( 1.004, 1.0, 0.99 ) );
	const r = uv().sub( 0.5 ).mul( vec2( 1.0, 0.8 ) ).length();
	const vineta = float( 1 ).sub( smoothstep( 0.38, 0.85, r ).mul( 0.16 ) );
	pipeline.outputNode = vec4( graduado.mul( vineta ), 1 );

	// Plano: cadena propia sin antialiasing temporal ni iluminación global. Ambos
	// son temporales (varían de un fotograma a otro) y hacían "temblar" los bordes
	// finos del plano; FXAA es espacial y determinista: la imagen queda fija.
	const pipelinePlano = new THREE.RenderPipeline( renderer );
	pipelinePlano.outputColorTransform = false;
	const escenaPlano = pass( escena, camara );
	pipelinePlano.outputNode = fxaa( renderOutput( escenaPlano ) );
	// Mientras se compilan shaders en segundo plano, el renderer conserva el
	// destino y las salidas de esa compilación: cada fotograma los aparta y los
	// devuelve, para que la compilación y el dibujo no se pisen.
	let precalentarEfectos = false;
	let enCompilacion: { destino: THREE.RenderTarget | null; mrt: ReturnType<typeof renderer.getMRT> | null } | null = null;
	const renderizar = () => {

		if ( enCompilacion ) {

			renderer.setRenderTarget( null );
			renderer.setMRT( null );

		}

		if ( precalentarEfectos && modo === 'plano' ) {

			// primer fotograma de la cadena completa con todo visible (compila sus
			// efectos y las sombras de todos los objetos), tapado en el mismo
			// fotograma por el plano: así la animación de la vivienda no se atasca
			precalentarEfectos = false;
			const ocultos: THREE.Object3D[] = [];
			escena.traverse( ( o ) => {

				if ( ! o.visible && o !== lucesVentana ) {

					ocultos.push( o );
					o.visible = true;

				}

			} );
			// el antialiasing temporal desplaza la cámara (setViewOffset cambia su
			// proporción) y en este fotograma suelto no la deja como estaba
			const aspecto = camara.aspect;
			pipeline.render();
			camara.clearViewOffset();
			camara.aspect = aspecto;
			camara.updateProjectionMatrix();
			for ( const o of ocultos ) o.visible = false;

		}

		( modo === 'plano' ? pipelinePlano : pipeline ).render();
		if ( enCompilacion ) {

			renderer.setRenderTarget( enCompilacion.destino );
			renderer.setMRT( enCompilacion.mrt );

		}

	};

	// ---------------------------------------------------------------- estados y cámara
	// Internamente se conservan los estados de construcción (la vivienda "se
	// construye" al pasar del plano a la vivienda); la interfaz ofrece tres
	// modos: Plano, Vivienda y Personalizar (este último, solo con acceso).
	estados = new Estados( { volumenes: c.volumenes, lineas: c.lineas, carpinterias: [ c.carpinterias, c.barandilla ], fijo: c.fijo, mobiliario: c.mobiliario, sol: luzSol, escena } );
	const est = estados;
	const cam = new Camarografo( camara, ctrl, $( '#velo' ) );
	cam.reducido = est.reducido;
	// al terminar cada transición se ajusta la navegación a la vista
	cam.alLlegar = ( v ) => {

		nav.configurar( modo === 'plano' ? 'planta' : v.interior ? 'interior' : 'exterior' );
		// desde dentro, por las ventanas, el entorno real; en la terraza, el jardín o la vista
		// general, no: ahí hace falta el edificio, que llega con la promoción completa (decisión 66)
		enLaVivienda = !! v.interior;
		void actualizarEntorno();

	};
	type Modo = 'plano' | 'vivienda' | 'personalizar';
	let modo: Modo = 'vivienda';
	// comentarios visuales y descarga por lotes, en modo profesional (se conectan más abajo)
	let comentarios3D: ReturnType<typeof conectarComentarios3D> | null = null;
	let lotes: ReturnType<typeof conectarDescargaLotes> | null = null;
	// La visita se abre en el plano (rápido de preparar); la vivienda 3D se
	// prepara mientras tanto. Si se pide antes de estar lista, se recuerda y se
	// abre en cuanto lo esté.
	let viviendaLista = false;
	let modoPendiente: Modo | null = null;
	// barra de la pantalla de carga: se mueve sola hasta que hay un porcentaje real
	let progreso3D = 0;
	const ponerBarra = ( f: number ) => {

		$( '.carga-barra' ).classList.toggle( 'indeterminada', f <= 0 );
		( $( '.carga-barra span' ) as HTMLElement ).style.width = `${ Math.round( f * 100 ) }%`;

	};

	const botonesModo = [ ...document.querySelectorAll<HTMLButtonElement>( '.modos [data-modo]' ) ];
	const barraVistas = $( '.vistas' );
	let botonesVista: HTMLButtonElement[] = [];
	const actualizarEtiquetas = () => document.body.classList.toggle( 'con-etiquetas', modo === 'plano' );
	const marcarVista = ( k: string ) => {

		for ( const b of botonesVista ) {

			b.setAttribute( 'aria-pressed', String( b.dataset.vista === k ) );
			b.setAttribute( 'aria-checked', String( b.dataset.vista === k ) );

		}

		// el grupo muestra la vista elegida dentro de él
		const t = modelo.tipologia;
		for ( const g of barraVistas.querySelectorAll<HTMLButtonElement>( '.grupo-vistas' ) ) {

			const activo = botonesVista.some( ( b ) => b.dataset.vista === k && b.classList.contains( 'item-vista' ) && GRUPOS[ vivienda.estancias.find( ( e ) => e.id === t.vistas[ k ]?.estancia )?.uso ?? '' ] === g.dataset.grupo );
			g.setAttribute( 'aria-pressed', String( activo ) );

		}

		// con muchas vistas la barra se desplaza: la elegida queda a la vista
		const visible = barraVistas.querySelector<HTMLElement>( `[data-vista="${ k }"], .grupo-vistas[aria-pressed="true"]` );
		visible?.scrollIntoView( { block: 'nearest', inline: 'nearest', behavior: est.reducido ? 'auto' : 'smooth' } );

	};

	/** Mueve la cámara a una vista (una sola vez; si ya está allí no hace nada). */
	const irVista = ( v: string | Vista ) => {

		// la vista de una estancia de otra planta lleva a esa planta
		const vista = typeof v === 'string' ? ( modelo.tipologia.vistas as Record<string, Vista> )[ v ] : v;
		const est = vista?.estancia && vivienda.estancias.find( ( e ) => e.id === vista.estancia );
		if ( est && ( est.planta ?? 0 ) !== plantaActiva ) cambiarPlanta( est.planta ?? 0, false );
		cam.ir( v );
		marcarVista( typeof v === 'string' ? v : '' );

	};

	/** Barra de vistas guiadas de la tipología cargada. */
	/**
	 * Barra de vistas guiadas, agrupada para que escale a viviendas grandes:
	 * vista general y zonas de día como botones directos; dormitorios, baños,
	 * exteriores y otras estancias en menús desplegables (un grupo con una
	 * sola vista se muestra como botón directo).
	 */
	const GRUPOS: Record<string, string> = { noche: 'Dormitorios', humedo: 'Baños', exterior: 'Exteriores', circulacion: 'Otros', servicio: 'Otros' };
	let menuAbierto: HTMLElement | null = null;
	const cerrarMenu = () => {

		menuAbierto?.remove();
		menuAbierto = null;
		barraVistas.querySelectorAll( '.grupo-vistas[aria-expanded="true"]' ).forEach( ( g ) => g.setAttribute( 'aria-expanded', 'false' ) );

	};
	addEventListener( 'pointerdown', ( e ) => {

		if ( menuAbierto && ! ( e.target as HTMLElement ).closest( '.menu-vistas, .grupo-vistas' ) ) cerrarMenu();

	} );
	addEventListener( 'keydown', ( e ) => e.key === 'Escape' && cerrarMenu() );
	addEventListener( 'resize', cerrarMenu );
	barraVistas.addEventListener( 'scroll', cerrarMenu, { passive: true } );

	const construirBarraVistas = () => {

		cerrarMenu();
		barraVistas.querySelectorAll( '[data-vista], .grupo-vistas' ).forEach( ( b ) => b.remove() );
		const antes = barraVistas.querySelector( '.separador' );
		const t = modelo.tipologia;
		const usoDe = ( k: string ) => vivienda.estancias.find( ( e ) => e.id === t.vistas[ k ]?.estancia )?.uso;
		const grupos = new Map<string, string[]>();
		for ( const k of t.guiadas ) {

			const g = GRUPOS[ usoDe( k ) ?? '' ];
			if ( g ) grupos.set( g, [ ...( grupos.get( g ) ?? [] ), k ] );

		}

		const boton = ( k: string, clase = '' ) => {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.dataset.vista = k;
			if ( clase ) b.className = clase;
			b.textContent = t.vistas[ k ].nombre;
			b.setAttribute( 'aria-pressed', 'false' );
			b.addEventListener( 'click', () => {

				irVista( k );
				cerrarMenu();

			} );
			return b;

		};

		botonesVista = [];
		const puestos = new Set<string>();
		for ( const k of t.guiadas ) {

			const g = GRUPOS[ usoDe( k ) ?? '' ];
			const miembros = g ? grupos.get( g )! : [ k ];
			if ( ! g || miembros.length === 1 ) {

				const b = boton( k );
				botonesVista.push( b );
				barraVistas.insertBefore( b, antes );
				continue;

			}

			if ( puestos.has( g ) ) continue;
			puestos.add( g );
			const items = miembros.map( ( m ) => boton( m, 'item-vista' ) );
			botonesVista.push( ...items );
			const gb = document.createElement( 'button' );
			gb.type = 'button';
			gb.className = 'grupo-vistas';
			gb.dataset.grupo = g;
			gb.setAttribute( 'aria-haspopup', 'menu' );
			gb.setAttribute( 'aria-expanded', 'false' );
			gb.innerHTML = `<span></span><svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M4 10l4-4 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
			gb.querySelector( 'span' )!.textContent = g;
			gb.addEventListener( 'click', () => {

				const abierto = gb.getAttribute( 'aria-expanded' ) === 'true';
				cerrarMenu();
				if ( abierto ) return;
				// el menú se cuelga del body (la barra recorta su contenido) y se abre hacia arriba
				const menu = document.createElement( 'div' );
				menu.className = 'menu-vistas';
				menu.setAttribute( 'role', 'menu' );
				menu.setAttribute( 'aria-label', g );
				for ( const it of items ) {

					it.setAttribute( 'role', 'menuitemradio' );
					it.setAttribute( 'aria-checked', it.getAttribute( 'aria-pressed' ) ?? 'false' );
					menu.append( it );

				}

				document.body.append( menu );
				const r = gb.getBoundingClientRect();
				menu.style.left = `${ Math.max( 8, Math.min( r.left, innerWidth - menu.offsetWidth - 8 ) ) }px`;
				menu.style.bottom = `${ innerHeight - r.top + 8 }px`;
				menuAbierto = menu;
				gb.setAttribute( 'aria-expanded', 'true' );
				( items.find( ( x ) => x.getAttribute( 'aria-pressed' ) === 'true' ) ?? items[ 0 ] ).focus();

			} );
			barraVistas.insertBefore( gb, antes );

		}

	};

	const irModo = ( m: Modo ) => {

		if ( m === 'personalizar' && ! comprador ) {

			abrirAcceso();
			return;

		}

		if ( m !== 'plano' && ! viviendaLista ) {

			modoPendiente = m;
			// pantalla de carga con su barra hasta que la vivienda esté lista
			$( '.carga-texto' ).textContent = 'Preparando la vivienda en 3D…';
			ponerBarra( progreso3D );
			document.body.classList.add( 'cargando-3d' );
			return;

		}

		const anterior = modo;
		modo = m;
		document.body.dataset.modo = m;
		comentarios3D?.alCambiarUnidad();
		botonesModo.forEach( ( b ) => b.setAttribute( 'aria-current', String( b.dataset.modo === m ) ) );
		const n = m === 'plano' ? 1 : 4;
		if ( est.actual !== n ) est.ir( n );
		document.body.dataset.estado = String( n );
		$( '#configurador' ).hidden = m !== 'personalizar';
		actualizarEtiquetas();
		mostrarPlantas();
		void actualizarEntorno();
		if ( m === 'plano' ) {

			( modelo.tipologia.vistas as Record<string, Vista> ).planta = encajePlanta();
			construirEtiquetas();
			irVista( 'planta' );
			return;

		}

		// al salir del plano se vuelve a la vista general; entre Vivienda y
		// Personalizar la cámara no se mueve
		if ( anterior === 'plano' ) irVista( 'aerea' );

	};

	botonesModo.forEach( ( b ) => b.addEventListener( 'click', () => irModo( b.dataset.modo as Modo ) ) );
	addEventListener( 'keydown', ( ev ) => {

		const t = ev.target as HTMLElement | null;
		if ( t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t?.closest?.( '#configurador, dialog' ) ) return;
		const modos: Record<string, Modo> = { 1: 'plano', 2: 'vivienda', 3: 'personalizar' };
		if ( modos[ ev.key ] ) irModo( modos[ ev.key ] );

	} );
	$( '#recentrar' ).addEventListener( 'click', () => {

		cam.ir( modo === 'plano' ? 'planta' : cam.ultima );
		marcarVista( modo === 'plano' ? '' : cam.ultima );

	} );
	ctrl.addEventListener( 'start', () => {

		cam.soltar();
		marcarVista( '' );

	} );

	// ---------------------------------------------------------------- ficha
	// El comprador ve su vivienda («Portal 3 · Bajo A»), no la tipología de la que sale.
	function nombreVivienda( v: ViviendaPromocion ) {

		return v.portal && ! v.ref.toLowerCase().includes( 'portal' ) ? `Portal ${ v.portal } · ${ v.ref }` : v.ref;

	}
	function actualizarFicha() {

		const t = modelo.tipologia;
		const v = fichaVivienda;
		$( '#ficha-vivienda' ).textContent = comprador ? nombreVivienda( v ) : t.nombre;
		// elegir vivienda: solo en modo profesional (el público ve la tipología de su enlace)
		$( '.elegir-vivienda' ).hidden = ! profesional;
		$<HTMLSelectElement>( '#elegir-vivienda' ).value = v.ref;
		const plural = ( n: number, uno: string, varios: string ) => `${ n } ${ n === 1 ? uno : varios }`;
		// los exteriores por su nombre: «terraza y porche», «jardín, porche y balcón»…
		const nombres = [ ...new Set( vivienda.estancias.filter( ( e ) => e.uso === 'exterior' && ! e.rampa ).map( ( e ) => e.nombre.toLowerCase() ) ) ];
		const exterior = nombres.join( ', ' ).replace( /, ([^,]*)$/, ' y $1' );
		const garaje = vivienda.estancias.filter( esGaraje ).reduce( ( a, e ) => a + e.superficie, 0 );
		$( '#ficha-datos' ).textContent = `${ plural( t.dormitorios, 'dormitorio', 'dormitorios' ) } · ${ plural( t.banos, 'baño', 'baños' ) } · ${ fmtM2( utilInterior() ) } útiles${ garaje ? ` · garaje de ${ fmtM2( garaje ) }` : '' }${ exterior && v.superficies.exterior ? ` · ${ exterior } de ${ fmtM2( v.superficies.exterior ) }` : '' }`;
		document.body.classList.toggle( 'comprador', !! comprador );

	}

	// ---------------------------------------------------------------- personalizar
	const guardarSeleccion = () => comprador && ! profesional && guardar( claveSeleccion( comprador.ref ), JSON.stringify( Object.fromEntries( Object.entries( conf.seleccion ).filter( ( [ k ] ) => conf.editable( k ) ) ) ) );

	const vistaDeAlternativa = () => ( modelo.alternativas.find( ( v ) => v.id === conf.alternativa ) ?? modelo.alternativas[ 0 ] )?.vista ?? null;
	/** Vista que corresponde a una categoría ("mantener" = ninguna). */
	const vistaDeCategoria = ( id: string ): string | Vista | null => {

		const v = conf.categoria( id ).vista;
		if ( v === 'mantener' ) return null;
		if ( v === 'alternativa' ) return vistaDeAlternativa() ?? 'aerea';
		return v;

	};

	// aviso breve tras un cambio, con una acción opcional
	const aviso = $( '#aviso' );
	let temporizadorAviso = 0;
	const avisar = ( texto: string, accion?: { etiqueta: string; hacer: () => void } ) => {

		( aviso.querySelector( '.texto' ) as HTMLElement ).textContent = texto;
		const boton = aviso.querySelector( '.accion' ) as HTMLButtonElement;
		boton.hidden = ! accion;
		boton.textContent = accion?.etiqueta ?? '';
		boton.onclick = accion ? () => {

			aviso.hidden = true;
			accion.hacer();

		} : null;
		aviso.hidden = false;
		clearTimeout( temporizadorAviso );
		temporizadorAviso = window.setTimeout( () => ( aviso.hidden = true ), 12000 );

	};

	aviso.addEventListener( 'pointerenter', () => clearTimeout( temporizadorAviso ) );
	aviso.addEventListener( 'pointerleave', () => ( temporizadorAviso = window.setTimeout( () => ( aviso.hidden = true ), 4000 ) ) );

	/**
	 * Aplica una opción: modelo 3D, precio y vista. `moverCamara` = false cuando
	 * la opción se quita desde el resumen (el cambio no debe arrastrar la cámara).
	 */
	const aplicarOpcion = ( categoria: string, opcion: string, moverCamara = true ) => {

		const cat = conf.categoria( categoria );
		const anterior = conf.elegir( categoria, opcion );
		const nueva = conf.opcion( categoria );
		if ( categoria === 'distribucion' && anterior.alternativa !== nueva.alternativa ) {

			const informe = reconstruir();
			const alternativa = modelo.alternativas.find( ( v ) => v.id === nueva.alternativa );
			panel.informe( 'distribucion', alternativa ? [ alternativa.descripcion, ...informe ] : [] );
			avisar( alternativa ? alternativa.resumen : 'Has vuelto a la distribución base.', {
				etiqueta: 'Ver en el plano', hacer: () => irModo( 'plano' ),
			} );

		}

		if ( categoria === 'exterior' ) construirLineasActuales();
		const activa = nueva.precio > 0 || !! nueva.piscina;
		const v = vistaDeCategoria( categoria );
		if ( moverCamara && v && ( ! cat.soloAlActivar || activa ) ) irVista( v );
		panel.resumen();
		guardarSeleccion();
		despertar();

	};

	let panel = crearPanel();
	function crearPanel() {

		return new Panel( conf, {
			abrir( categoria ) {

				// al desplegar una categoría se enseña la estancia a la que afecta
				const v = vistaDeCategoria( categoria );
				if ( v ) irVista( v );

			},
			elegir: ( categoria, opcion ) => aplicarOpcion( categoria, opcion ),
			quitar: ( categoria ) => aplicarOpcion( categoria, conf.base( categoria ).id, false ),
			restablecer: () => {

				for ( const x of conf.extras ) if ( conf.editable( x.categoria.id ) ) aplicarOpcion( x.categoria.id, conf.base( x.categoria.id ).id, false );
				panel.sincronizar();

			},
			cerrar: () => irModo( 'vivienda' ),
			generar: ( pack ) => mostrarResumen( pack ),
		} );

	}

	/** Carga una vivienda (y su tipología) sin recargar la página. */
	const cargarVivienda = ( v: ViviendaPromocion ) => {

		const cambiaGeometria = v.tipologia !== fichaVivienda.tipologia || v.espejo !== fichaVivienda.espejo;
		fichaVivienda = v;
		if ( cambiaGeometria ) {

			modelo = cargarModelo( v.tipologia, v.espejo );
			cargarGeometriaTipologia();

		}

		cam.vistas = modelo.tipologia.vistas;
		construirBarraVistas();
		conf = crearConfigurador( v );
		for ( const k of conf.datos.categorias ) conf.aplicarParametros( k.id, true );
		// selección anterior de esta vivienda en este navegador (comodidad, no se envía a ningún sitio)
		if ( comprador ) {

			if ( ! profesional ) try {

				const s = JSON.parse( leer( claveSeleccion( v.ref ) ) ?? 'null' ) as Seleccion | null;
				if ( s ) conf.restaurar( s );

			} catch { /* selección ilegible: se empieza desde lo incluido */ }
			// lo guardado en Supabase (desde cualquier dispositivo) manda sobre lo de este navegador
			for ( const pv of conf.packs ) if ( pv.estado === 'disponible' && pv.guardada ) conf.restaurar( pv.guardada.opciones );

		}

		panel.destruir();
		panel = crearPanel();
		panel.desplegar( 'distribucion', false );
		const alternativa = modelo.alternativas.find( ( x ) => x.id === conf.alternativa );
		const informe = reconstruir();
		if ( alternativa ) panel.informe( 'distribucion', [ alternativa.descripcion, ...informe ] );
		panel.resumen();
		// el entorno, alrededor de esta vivienda (cada unidad tiene su sitio en la parcela)
		void actualizarEntorno();

	};

	// ---------------------------------------------------------------- entorno real
	// Decisión 66: en la tipología, desde fuera la vivienda sigue aislada; desde
	// dentro, por las ventanas se ve lo que hay alrededor de su vivienda de
	// referencia (la elige la promotora; su sitio va en promocion.json →
	// situacion). El entorno se descarga la primera vez que se entra.
	const atribucionEntorno = $( '#atribucion-entorno' );
	let datosEntorno: Awaited<ReturnType<typeof cargarEntornoReal>> | null = null;
	let cargaEntorno: Promise<void> | null = null;
	/** unidad para la que está construido el entorno */
	let entornoDe = '';
	/** Dónde va la vivienda que se enseña (su vivienda de referencia); null si no se sabe. */
	function situacionActual(): Situacion | null {

		const s = PROMOCION.situacion?.[ claveUnidad( fichaVivienda ) ];
		// sin giro propio, el del norte de la tipología (plano de situación)
		return s ? { pos: s.pos, giro: s.giro ?? modelo.tipologia.norte?.angulo ?? 0, cota: s.cota ?? 0 } : null;

	}
	/** Pone o quita el entorno según la vista (en la vivienda, sí; en la vista general o en el plano, no). */
	async function actualizarEntorno() {

		const sitio = __ENTORNO__ ? situacionActual() : null;
		const dentro = !! sitio && modo !== 'plano' && enLaVivienda;
		if ( dentro && ! datosEntorno ) {

			cargaEntorno ??= cargarEntornoReal().then( ( d ) => {

				datosEntorno = d;

			} ).catch( () => {

				cargaEntorno = null; // se reintenta la próxima vez que se entre

			} );
			await cargaEntorno;

		}
		const clave = claveUnidad( fichaVivienda );
		if ( entornoGrupo && entornoDe !== clave ) {

			escena.remove( entornoGrupo );
			liberarEntornoReal( entornoGrupo );
			entornoGrupo = null;

		}
		if ( sitio && datosEntorno && ! entornoGrupo ) {

			// la foto aérea se comparte: cada colocación usa su copia
			const foto = datosEntorno.foto?.clone() ?? null;
			if ( foto ) foto.needsUpdate = true;
			entornoGrupo = construirEntornoReal( datosEntorno.datos, foto, sitio );
			entornoDe = clave;
			escena.add( entornoGrupo );

		}
		const antes = entornoActivo;
		// sigue valiendo lo de ahora (la cámara pudo moverse mientras se descargaba)
		entornoActivo = !! entornoGrupo && modo !== 'plano' && enLaVivienda;
		camara.far = entornoActivo ? 3000 : 200;
		camara.updateProjectionMatrix();
		atribucionEntorno.hidden = ! entornoActivo;
		atribucionEntorno.textContent = entornoActivo ? 'Entorno: © Catastro · © OpenStreetMap · IGN (CC BY 4.0)' : '';
		// la atribución completa de cada fuente, al pasar por encima
		atribucionEntorno.title = entornoActivo && datosEntorno ? `${ datosEntorno.datos.atribucion.join( ' · ' ) }. Edificios de alrededor en maqueta, con su altura aproximada.` : '';
		if ( antes !== entornoActivo || entornoGrupo?.visible !== entornoActivo ) {

			mostrarPlantas();
			despertar();

		}

	}

	// ---------------------------------------------------------------- acceso de comprador
	const dialogoAcceso = $<HTMLDialogElement>( '#acceso' );
	const campoAcceso = $<HTMLInputElement>( '#codigo-acceso' );
	function abrirAcceso() {

		$( '#acceso .error' ).hidden = true;
		campoAcceso.value = '';
		dialogoAcceso.showModal();

	}

	$( '#abrir-acceso' ).addEventListener( 'click', abrirAcceso );
	$( '#acceso .cancelar' ).addEventListener( 'click', () => dialogoAcceso.close() );
	$( '#acceso form' ).addEventListener( 'submit', async ( ev ) => {

		ev.preventDefault();
		const boton = $<HTMLButtonElement>( '#acceso button[type=submit]' );
		boton.disabled = true;
		const v = await resolverAcceso( campoAcceso.value );
		boton.disabled = false;
		if ( ! v || typeof v === 'string' ) {

			const error = $( '#acceso .error' );
			error.textContent = v === 'bloqueado' ? 'Demasiados intentos. Espera unos minutos y vuelve a probar.'
				: v === 'sin-conexion' ? 'No se ha podido comprobar el código ahora mismo. Revisa tu conexión y vuelve a probar en unos minutos.'
				: 'Ese código no corresponde a ninguna vivienda de esta promoción. Comprueba que esté completo.';
			error.hidden = false;
			campoAcceso.focus();
			return;

		}

		comprador = v;
		guardar( CLAVE_ACCESO, extraerCodigo( campoAcceso.value ) );
		dialogoAcceso.close();
		$( '#no-disponible' ).hidden = true;
		cargarVivienda( v );
		irModo( 'personalizar' );

	} );
	$( '#salir-comprador' ).addEventListener( 'click', () => {

		if ( profesional ) {

			salirProfesional();
			location.reload();
			return;

		}
		comprador = null;
		guardar( CLAVE_ACCESO, null );
		if ( location.hash ) history.replaceState( null, '', location.pathname + location.search );
		cargarVivienda( viviendaSinCodigo() );
		irModo( 'vivienda' );

	} );

	// ---------------------------------------------------------------- modo profesional: elegir vivienda
	// Solo el equipo de la promotora pasa de una vivienda a otra. El público ve
	// únicamente la tipología de su enlace (…/?ver=<tipología>, decisión 47).
	// Comentarios visuales (038_comentarios.sql): marcar un sitio y escribir.
	if ( profesional ) {

		$( '#salir-comprador' ).textContent = 'Salir del modo profesional';
		// el equipo de la promotora ve la personalización del comprador, no «la suya»
		$( '#configurador .cabecera h2' ).textContent = 'Personalización de la vivienda';
		$( '#configurador' ).setAttribute( 'aria-label', 'Personalización de la vivienda' );
		$( '#configurador .resumen-seleccion strong' ).textContent = 'Selección del comprador';
		$( '#configurador [data-texto-total]' ).textContent = 'Total de la personalización';
		const lista = $<HTMLSelectElement>( '#elegir-vivienda' );
		for ( const v of PROMOCION.viviendas ) lista.add( new Option( nombreVivienda( v ), v.ref, false, v.ref === fichaVivienda.ref ) );
		lista.addEventListener( 'change', () => {

			const v = PROMOCION.viviendas.find( ( x ) => x.ref === lista.value );
			if ( ! v ) return;
			comprador = v;
			cargarVivienda( v );
			actualizarFicha();
			comentarios3D?.alCambiarUnidad();

		} );
		comentarios3D = conectarComentarios3D( {
			escena, camara, ctrl, lienzo: renderer.domElement,
			clave: () => claveUnidad( fichaVivienda ),
			planta: () => plantaActiva,
			vista: () => ( modo === 'plano' ? 'Plano' : cam.vistas[ cam.actual ]?.nombre ?? '' ),
			lista: () => viviendaLista,
			modo: () => modo,
			ponerModo: ( m ) => irModo( m ),
			irA: ( p, personalizar ) => {

				// marcado en el modo Plano: se vuelve al plano de su planta
				const enPlano = p.vista === 'Plano';
				const destino: Modo = enPlano ? 'plano' : personalizar ? 'personalizar' : 'vivienda';
				if ( modo !== destino ) irModo( destino );
				if ( p.planta !== undefined && p.planta !== plantaActiva && p.planta < plantasDe( vivienda ).length ) cambiarPlanta( p.planta, enPlano );
				if ( enPlano ) return;
				const interior = interioresPlanta.some( ( e ) => puntoEnPoligono( p.cam[ 0 ], - p.cam[ 2 ], e.poligono ) );
				cam.ir( { nombre: p.vista ?? 'Comentario', pos: p.cam as Vista[ 'pos' ], obj: p.obj as Vista[ 'obj' ], fov: interior ? 62 : 45, interior } );
				marcarVista( '' );

			},
			despertar: () => despertar(),
			avisar: ( t ) => avisar( t ),
		} );

		// Descarga por lotes (descarga.ts): planos y renders de la tipología base de cada unidad.
		let antesLote: { comprador: ViviendaPromocion | null; ficha: ViviendaPromocion; modo: Modo } | null = null;
		lotes = conectarDescargaLotes( {
			promocion: PROMOCION.promocion.nombre,
			unidades: () => {

				const unidades = new Map<string, UnidadLote>();
				for ( const v of PROMOCION.viviendas ) {

					const k = claveUnidad( v );
					if ( unidades.has( k ) ) continue;
					const t = cargarModelo( v.tipologia, v.espejo ).tipologia;
					unidades.set( k, {
						clave: k, titulo: PROMOCION.promocion.tipo === 'unifamiliar' ? `Vivienda ${ v.ref }` : `${ t.nombre }${ v.espejo ? ' · espejo' : '' }`,
						vistas: t.guiadas.filter( ( x ) => t.vistas[ x ] ).map( ( x ) => ( { id: x, nombre: t.vistas[ x ].nombre } ) ),
					} );

				}
				return [ ...unidades.values() ];

			},
			ponerUnidad: async ( clave ) => {

				antesLote ??= { comprador, ficha: fichaVivienda, modo };
				const v = PROMOCION.viviendas.find( ( x ) => claveUnidad( x ) === clave );
				if ( ! v ) return;
				// la tipología base: sin la personalización de ningún comprador
				comprador = null;
				cargarVivienda( v );
				if ( modo !== 'vivienda' ) irModo( 'vivienda' );
				await esperarQuieto();

			},
			render: async ( vista, ancho, alto, muestras, progreso ) => {

				const v = ( modelo.tipologia.vistas as Record<string, Vista> )[ vista ];
				const est = v?.estancia && vivienda.estancias.find( ( e ) => e.id === v.estancia );
				if ( est && ( est.planta ?? 0 ) !== plantaActiva ) cambiarPlanta( est.planta ?? 0, false );
				cam.ir( vista, true );
				// las vistas de dentro llevan el entorno: que esté descargado antes de la imagen
				await actualizarEntorno();
				await esperarQuieto();
				capturando = true;
				try {

					return await hd.generar( { ancho, alto, muestras: muestrasHD || muestras, progreso: progresoRender( progreso ), aviso: PROMOCION.marca.legal.imagenes } );

				} finally {

					capturando = false;
					despertar();

				}

			},
			restaurar: () => {

				if ( ! antesLote ) return;
				comprador = antesLote.comprador;
				cargarVivienda( antesLote.ficha );
				if ( modo !== antesLote.modo ) irModo( antesLote.modo );
				antesLote = null;
				despertar();

			},
			descargar: ( nombre, blob ) => descargar( nombre, blob ),
		} );

	}

	// ---------------------------------------------------------------- documento de selección
	const dialogo = $<HTMLDialogElement>( '#resumen-configuracion' );
	let packResumen = '';
	// versiones anteriores recordaban el nombre y el DNI en el navegador: se borran
	guardar( 'inmobiliarias:comprador', null );
	const escapar = ( t: string ) => t.replace( /[&<>"]/g, ( c ) => ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' } )[ c ]! );
	const formalizacion = () => fichaVivienda.formalizacion ?? {};
	const conceptoPago = ( pack: string ) => ( formalizacion().pago?.concepto ?? '{promocion} · {ref} · {pack}' )
		.replace( '{ref}', fichaVivienda.ref ).replace( '{pack}', pack ).replace( '{promocion}', PROMOCION.promocion.nombre );
	const mostrarResumen = ( packId: string ) => {

		const pv = conf.packs.find( ( p ) => p.pack.id === packId );
		if ( ! pv ) return;
		packResumen = packId;
		const filas = pv.categorias.map( ( k ) => {

			const o = conf.opcion( k.id );
			return `<tr><th scope="row">${ k.nombre }</th><td>${ o.nombre }${ o.detalle ? ` <span class="detalle">(${ o.detalle })</span>` : '' }</td><td>${ fmtPrecio( o.precio ) }</td></tr>`;

		} ).join( '' );
		const total = conf.totalPack( packId );
		const { pago: pg, contacto } = formalizacion();
		// a quién se envía el documento firmado (lo configura la promotora en MUNE Portal)
		const destino = contacto?.email
			? `${ contacto.nombre ? `${ escapar( contacto.nombre ) }, ` : '' }<a href="mailto:${ escapar( contacto.email ) }">${ escapar( contacto.email ) }</a>${ contacto.telefono ? ` (${ escapar( contacto.telefono ) })` : '' }`
			: 'tu comercial';

		$( '#titulo-resumen' ).textContent = pv.pack.titulo;
		dialogo.querySelector( '.contenido' )!.innerHTML = `
			<p class="fecha">${ PROMOCION.promocion.nombre } · ${ nombreVivienda( fichaVivienda ) }</p>
			<table>
				<tbody>${ filas }</tbody>
				<tfoot><tr class="total"><th scope="row">Total de las mejoras del pack</th><td></td><td>${ total ? `+${ fmtEuros( total ) }` : '0 €' }</td></tr></tfoot>
			</table>
			<fieldset class="datos-comprador">
				<legend>Tus datos <span>(opcional: también puedes escribirlos a mano en el documento)</span></legend>
				<label>Nombre y apellidos<input name="nombre" autocomplete="name" value=""></label>
				<label>DNI / NIE<input name="dni" autocomplete="off" value=""></label>
			</fieldset>
			${ total && pg?.iban ? `<div class="pago">
				<p><strong>Importe de la transferencia: ${ fmtEuros( total ) }</strong></p>
				<p>${ escapar( pg.titular ?? '' ) } · ${ escapar( pg.iban ) }<br>Concepto: ${ escapar( conceptoPago( pv.pack.titulo ) ) }</p>
			</div>` : '' }
			<ol class="pasos"><li>Descarga el documento. Tu selección queda guardada${ comprador && pv.pack.hasta < '2100' ? ` y puedes cambiarla hasta el ${ fmtFecha( pv.pack.hasta, true ) }` : '' }.</li><li>Fírmalo.</li>${ total ? '<li>Haz la transferencia.</li>' : '' }<li>Envía el documento firmado${ total ? ' y el justificante' : '' } a ${ destino }.</li></ol>`;
		dialogo.showModal();

	};

	/** Datos del comprador escritos en el diálogo: solo van al PDF, no se guardan en ningún sitio. */
	const datosComprador = () => {

		const f = ( n: string ) => ( dialogo.querySelector( `input[name="${ n }"]` ) as HTMLInputElement | null )?.value.trim() ?? '';
		const d = { nombre: f( 'nombre' ), dni: f( 'dni' ).toUpperCase() };
		return d;

	};

	dialogo.querySelector( '.seguir' )!.addEventListener( 'click', () => dialogo.close() );
	dialogo.querySelector( '.cerrar-dialogo' )!.addEventListener( 'click', () => {

		dialogo.close();
		irModo( 'vivienda' );

	} );

	// Publicado en claude.ai, las descargas pasan por el capability `downloads`
	// (el visor bloquea los enlaces de descarga normales). En local, enlace normal.
	type Descargas = { save( r: { filename: string; data: Blob } ): Promise<unknown> } | null;
	const rt = ( window as unknown as { claude?: { use( n: string ): Promise<unknown> } } ).claude;
	let descargas: Descargas = null;
	rt?.use?.( 'downloads' ).then( ( d ) => ( descargas = d as Descargas ), () => {} );
	const descargar = async ( nombre: string, blob: Blob ) => {

		if ( descargas ) {

			await descargas.save( { filename: nombre, data: blob } ).catch( () => {} );
			return;

		}

		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( blob );
		a.download = nombre;
		a.click();
		setTimeout( () => URL.revokeObjectURL( a.href ), 5000 );

	};

	dialogo.querySelector( '.descargar-pdf' )!.addEventListener( 'click', async ( ev ) => {

		const b = ev.currentTarget as HTMLButtonElement;
		b.disabled = true;
		b.textContent = 'Preparando el documento…';
		try {

			const pv = conf.packs.find( ( p ) => p.pack.id === packResumen )!;
			// al descargar el documento, la selección queda guardada como «Seleccionada» (025_selecciones.sql)
			// en modo profesional, solo con «Gestionar personalizaciones» (si no, es una vista previa)
			const guardada = profesional && ! profesional.puedePersonalizar
				? 'Es una vista previa: la selección no se guarda. Para guardarla en nombre del comprador necesitas «Gestionar personalizaciones».'
				: await guardarEnSupabase( pv.pack.id, Object.fromEntries( pv.categorias.map( ( c ) => [ c.id, conf.seleccion[ c.id ] ] ) ), fichaVivienda.ref );
			if ( typeof guardada === 'string' ) avisar( guardada );
			else {

				const s = { fecha: guardada.fecha, opciones: guardada.opciones, estado: guardada.estado, importe: guardada.importe };
				fichaVivienda.selecciones = { ...fichaVivienda.selecciones, [ pv.pack.id ]: s };
				pv.guardada = s;
				if ( profesional ) avisar( `Selección guardada en nombre del comprador de ${ nombreVivienda( fichaVivienda ) }.` );
				else avisar( pv.pack.hasta < '2100' ? `Tu selección queda guardada. Puedes cambiarla hasta el ${ fmtFecha( pv.pack.hasta, true ) }.` : 'Tu selección queda guardada.' );

			}
			const comprador = datosComprador();
			// imagen: la vista de la primera categoría del pack (o la general)
			const vistaPack = pv.categorias.map( ( c ) => vistaDeCategoria( c.id ) ).find( ( x ) => x ) ?? 'aerea';
			const imagen = await renderizarVista( vistaPack, 1800, 40 );
			const blob = await generarPDF( {
				promocion: PROMOCION, vivienda: fichaVivienda, tipologia: modelo.tipologia, conf, pack: pv,
				superficieUtil: utilInterior(), imagen, comprador, concepto: conceptoPago( pv.pack.titulo ),
			} );
			const fecha = new Date().toISOString().slice( 0, 10 );
			await descargar( `${ slug( `seleccion-${ fichaVivienda.ref }-${ packResumen }-${ fecha }` ) }.pdf`, blob );

		} catch ( e ) {

			console.error( e );
			avisar( 'No se ha podido generar el documento. Inténtalo de nuevo.' );

		} finally {

			b.disabled = false;
			b.textContent = 'Descargar PDF';

		}

	} );

	// ---------------------------------------------------------------- imágenes con encuadre maestro
	/**
	 * Renderiza una vista maestra a alta resolución y devuelve un JPEG/PNG.
	 * La cámara vuelve después exactamente a donde estaba.
	 */
	let capturando = false;
	async function renderizarVista( vista: string | Vista | null, ancho: number, fotogramas: number, tipo = 'image/jpeg' ) {

		capturando = true;
		const velo = $( '#preparando' );
		velo.hidden = false;
		const antes = { pos: camara.position.clone(), obj: ctrl.target.clone(), fov: camara.fov, actual: cam.actual };
		const ratio = renderer.getPixelRatio();
		try {

			if ( vista ) cam.ir( vista, true );
			camara.filmOffset = 0;
			camara.zoom = 1;
			camara.updateProjectionMatrix();
			renderer.setPixelRatio( Math.min( 3, ancho / innerWidth ) );
			gi.sliceCount.value = 3;
			gi.stepCount.value = 16;
			for ( let i = 0; i < fotogramas; i ++ ) {

				renderizar();
				if ( i % 8 === 0 ) await new Promise( requestAnimationFrame );

			}

			renderizar();
			return renderer.domElement.toDataURL( tipo, 0.9 );

		} finally {

			renderer.setPixelRatio( ratio );
			gi.sliceCount.value = 2;
			gi.stepCount.value = 8;
			camara.position.copy( antes.pos );
			ctrl.target.copy( antes.obj );
			camara.fov = antes.fov;
			camara.updateProjectionMatrix();
			ctrl.update();
			cam.actual = antes.actual;
			velo.hidden = true;
			capturando = false;
			despertar();

		}

	}

	// ---------------------------------------------------------------- descargas: diálogo común
	/** Entregables comerciales (renders, plano PNG): solo promotora y Studio. */
	const puedeEntregables = () => document.body.classList.contains( 'perfil-promotora' ) || document.body.classList.contains( 'en-studio' );
	const dialogoDescarga = $<HTMLDialogElement>( '#descarga' );
	dialogoDescarga.querySelector( '.cerrar-descarga' )!.addEventListener( 'click', () => dialogoDescarga.close() );
	interface OpcionDescarga { titulo: string; detalle: string; formato: string; hacer: ( progreso: ( t: string ) => void ) => Promise<void> }
	const abrirDescarga = ( titulo: string, texto: string, opciones: OpcionDescarga[], antes?: HTMLElement ) => {

		$( '#titulo-descarga' ).textContent = titulo;
		( dialogoDescarga.querySelector( '.texto' ) as HTMLElement ).textContent = texto;
		const progreso = dialogoDescarga.querySelector( '.progreso' ) as HTMLElement;
		progreso.hidden = true;
		const lista = dialogoDescarga.querySelector( '.opciones-descarga' ) as HTMLElement;
		lista.replaceChildren( ...( antes ? [ antes ] : [] ), ...opciones.map( ( o ) => {

			const b = document.createElement( 'button' );
			b.type = 'button';
			b.className = 'opcion-descarga';
			b.innerHTML = `<strong></strong><span class="formato"></span><small></small>`;
			b.querySelector( 'strong' )!.textContent = o.titulo;
			b.querySelector( 'small' )!.textContent = o.detalle;
			b.querySelector( '.formato' )!.textContent = o.formato;
			b.addEventListener( 'click', async () => {

				const botones = [ ...lista.querySelectorAll<HTMLButtonElement>( 'button' ) ];
				botones.forEach( ( x ) => ( x.disabled = true ) );
				progreso.hidden = false;
				try {

					await o.hacer( ( t ) => ( progreso.textContent = t ) );
					progreso.textContent = 'Listo. La descarga ha empezado.';

				} catch ( e ) {

					console.error( e );
					progreso.textContent = 'No se ha podido generar el archivo. Vuelve a probar o elige una opción más pequeña.';

				} finally {

					botones.forEach( ( x ) => ( x.disabled = false ) );

				}

			} );
			return b;

		} ) );
		dialogoDescarga.showModal();

	};

	// ---------------------------------------------------------------- plano comercial
	const datosPlano = (): DatosPlano => ( {
		promocion: PROMOCION, tipologia: modelo.tipologia, vivienda, ficha: comprador ? fichaVivienda : null,
		distribucion: conf.alternativa ? ( modelo.alternativas.find( ( x ) => x.id === conf.alternativa )?.nombre ?? 'alternativa' ) : 'base',
	} );
	const nombreArchivo = ( base: string ) => slug( `${ base }-${ PROMOCION.promocion.nombre }-${ comprador ? nombreVivienda( fichaVivienda ) : modelo.tipologia.nombre }` );
	const opcionesPlano = () => abrirDescarga( 'Plano comercial', 'Plano a escala de la vivienda, con superficies, leyenda, orientación y la marca de la promoción.', [
		{ titulo: 'PDF A3', detalle: 'Para imprimir o adjuntar a la documentación comercial. Se ve nítido a cualquier tamaño.', formato: 'PDF', hacer: async ( pr ) => {

			pr( 'Generando el plano…' );
			await descargar( `${ nombreArchivo( 'plano-comercial' ) }.pdf`, await planoPDF( datosPlano() ) );

		} },
		{ titulo: 'Imagen en alta resolución', detalle: 'Tamaño A3 a 300 ppp (4961 × 3508 px). Para la web, portales inmobiliarios y presentaciones.', formato: 'PNG', hacer: async ( pr ) => {

			pr( 'Generando el plano…' );
			await descargar( `${ nombreArchivo( 'plano-comercial' ) }.png`, await planoPNG( datosPlano() ) );

		} },
	] );
	// Público y comprador: descarga directa del PDF comercial (sin selector).
	// Promotora y Studio: selector PDF vectorial / PNG de alta resolución.
	$( '#plano-comercial' ).addEventListener( 'click', async () => {

		if ( puedeEntregables() ) return opcionesPlano();
		const b = $<HTMLButtonElement>( '#plano-comercial' );
		b.disabled = true;
		try {

			await descargar( `${ nombreArchivo( 'plano-comercial' ) }.pdf`, await planoPDF( datosPlano() ) );

		} catch ( e ) {

			console.error( e );
			avisar( 'No se ha podido generar el plano. Inténtalo de nuevo.' );

		} finally {

			b.disabled = false;

		}

	} );

	// ---------------------------------------------------------------- render HD (imagen comercial)
	const hd = new RenderHD( renderer, escena, camara, luzSol, () => lucesVentana.children.filter( ( l ): l is THREE.SpotLight => ( l as THREE.SpotLight ).isSpotLight ) );
	const muestrasHD = Number( new URLSearchParams( location.search ).get( 'hdmuestras' ) ) || 0;
	let proporcion: [ number, number ] = [ 16, 9 ];
	$( '#foto' ).addEventListener( 'click', () => {

		if ( ! puedeEntregables() ) return; // renders comerciales: solo promotora y Studio
		const formatos = document.createElement( 'div' );
		formatos.className = 'formatos-render';
		formatos.setAttribute( 'role', 'group' );
		formatos.setAttribute( 'aria-label', 'Proporción de la imagen' );
		for ( const [ a, b ] of [ [ 16, 9 ], [ 3, 2 ] ] as [ number, number ][] ) {

			const x = document.createElement( 'button' );
			x.type = 'button';
			x.textContent = `${ a }:${ b }`;
			x.setAttribute( 'aria-pressed', String( proporcion[ 0 ] === a ) );
			x.onclick = () => {

				proporcion = [ a, b ];
				formatos.querySelectorAll( 'button' ).forEach( ( y ) => y.setAttribute( 'aria-pressed', String( y === x ) ) );
				actualizar();

			};
			formatos.append( x );

		}

		const resoluciones: [ string, string, number, number ][] = [
			[ 'Web', 'Para la web, redes sociales y portales inmobiliarios.', 1920, 16 ],
			[ 'Alta resolución', 'Para presentaciones, pantallas grandes y campañas digitales.', 3840, 12 ],
			[ 'Impresión', 'Para folletos y lonas (aprox. A3 a 300 ppp). Es la que más tarda.', 6000, 10 ],
		];
		const opciones = resoluciones.map( ( [ titulo, detalle, ancho, muestras ] ) => ( {
			titulo, detalle, formato: '',
			hacer: async ( pr: ( t: string ) => void ) => {

				const alto = Math.round( ancho * proporcion[ 1 ] / proporcion[ 0 ] );
				capturando = true;
				try {

					pr( 'Generando la imagen…' );
					const blob = await hd.generar( { ancho, alto, muestras: muestrasHD || muestras, progreso: progresoRender( pr ), aviso: PROMOCION.marca.legal.imagenes } );
					await descargar( `render-${ nombreArchivo( cam.actual || 'vista' ) }-${ ancho }x${ alto }.jpg`, blob );

				} finally {

					capturando = false;
					despertar();

				}

			},
		} ) );
		abrirDescarga( 'Render HD', 'Descarga una imagen de la vista actual, sin interfaz y con más calidad que el visor. Elige el tamaño según dónde la vayas a usar. Puede tardar desde unos segundos hasta un par de minutos.', opciones, formatos );
		const actualizar = () => dialogoDescarga.querySelectorAll<HTMLElement>( '.opcion-descarga' ).forEach( ( el, i ) => {

			const ancho = resoluciones[ i ][ 2 ];
			el.querySelector( '.formato' )!.textContent = `${ ancho } × ${ Math.round( ancho * proporcion[ 1 ] / proporcion[ 0 ] ) }`;

		} );
		actualizar();

	} );

	// ---------------------------------------------------------------- bucle
	addEventListener( 'resize', () => {

		camara.aspect = innerWidth / innerHeight;
		camara.updateProjectionMatrix();
		if ( modo === 'plano' ) {

			( modelo.tipologia.vistas as Record<string, Vista> ).planta = encajePlanta();
			construirEtiquetas();
			cam.ir( 'planta', true );

		} else cam.reencuadrar();
		renderer.setSize( innerWidth, innerHeight );
		etiquetas.setSize( innerWidth, innerHeight );

	} );

	// Con el cajón abierto, la composición maestra se encaja entera en el hueco
	// libre: se reduce la imagen (zoom) y se desplaza su centro (filmOffset). La
	// cámara no cambia: misma posición, objetivo y fov. (No se usa setViewOffset
	// porque el antialiasing temporal lo reescribe en cada fotograma.)
	let desplazamiento = 0;
	const encuadrar = ( d: number ) => {

		const W = innerWidth;
		const zoom = d < 0.5 ? 1 : ( W - d ) / W;
		const tan = Math.tan( THREE.MathUtils.degToRad( camara.fov / 2 ) );
		const film = d < 0.5 ? 0 : camara.getFilmWidth() * ( d / W ) * tan * camara.aspect / zoom;
		if ( camara.zoom !== zoom || camara.filmOffset !== film ) {

			camara.zoom = zoom;
			camara.filmOffset = film;
			camara.updateProjectionMatrix();

		}

	};

	// Render bajo demanda: con todo quieto se acumulan unos fotogramas (el
	// antialiasing temporal converge) y la imagen se congela. Sin esto, el
	// vaivén de subpíxel del antialiasing hace "temblar" los bordes finos del
	// plano. Cualquier interacción o animación vuelve a activar el render.
	const FOTOGRAMAS_ESTABLES = Number( new URLSearchParams( location.search ).get( 'estables' ) ) || 48;
	let quietos = 0;
	const despertar = () => ( quietos = 0 );
	/** Espera a que la imagen se asiente (cámara y exposición quietas): para los renders por lotes. */
	const esperarQuieto = async () => {

		despertar();
		const hasta = performance.now() + 5000;
		while ( quietos < 24 && performance.now() < hasta ) await new Promise( requestAnimationFrame );

	};
	for ( const ev of [ 'pointerdown', 'wheel', 'keydown', 'click', 'resize' ] ) addEventListener( ev, despertar, { passive: true } );
	addEventListener( 'pointermove', ( e ) => e.buttons && despertar(), { passive: true } );
	const matAnterior = new THREE.Matrix4(), proyAnterior = new THREE.Matrix4();

	let diagnostico: Record<string, unknown> = {};
	let pausado = false;
	let exposicion = renderer.toneMappingExposure;
	let interiorT = 0;
	let piscinaT = conf.piscina ? 1 : 0;
	// no se pinta nada hasta que los shaders de la vista inicial estén compilados
	let preparado = false;
	// luces de ventana: se activan cuando sus shaders están compilados (segunda fase)
	let ventanasListas = false;
	renderer.setAnimationLoop( ( t ) => {

		if ( ! preparado || pausado || capturando ) return;
		est.actualizar( t );
		cam.actualizar( performance.now() );
		const orbitando = ctrl.update();
		nav.restringir( cam.animando || capturando );
		// plano cercano según la altura: más precisión de profundidad en vistas lejanas
		const near = THREE.MathUtils.clamp( ( camara.position.y - 2.5 ) * 0.04, 0.05, 1.2 );
		if ( Math.abs( camara.near - near ) > 1e-3 ) {

			camara.near = near;
			camara.updateProjectionMatrix();

		}

		// dentro de la vivienda los techos proyectan sombra; en la maqueta no
		const bajo = camara.position.y < cotaActiva() + H + 0.2;
		for ( const tc of c.techos.children ) tc.castShadow = bajo || tc.userData.porche;
		c.techos.visible = est.valores.muros > 0.98;
		// luz de ventana: con el sol (no en el plano, donde no aporta y cuesta sombras)
		lucesVentana.visible = ventanasListas && modo !== 'plano' && est.valores.sol > 0.05;
		for ( const l of lucesVentana.children ) if ( ( l as THREE.SpotLight ).isSpotLight ) ( l as THREE.SpotLight ).intensity = l.userData.base * est.valores.sol / 3.4;
		c.canto.visible = bajo && c.techos.visible;
		conf.actualizar( performance.now() );
		const objetivo = modo === 'personalizar' && innerWidth > 760 ? innerWidth - $( '#configurador' ).getBoundingClientRect().left : 0;
		desplazamiento += ( objetivo - desplazamiento ) * ( est.reducido ? 1 : 0.2 );
		if ( Math.abs( objetivo - desplazamiento ) < 0.5 ) desplazamiento = objetivo;
		encuadrar( desplazamiento );
		// piscina: aparece con el equipamiento (vivienda terminada) si está elegida
		piscinaT += ( ( conf.piscina ? 1 : 0 ) - piscinaT ) * ( est.reducido ? 1 : 0.08 );
		if ( Math.abs( piscinaT - ( conf.piscina ? 1 : 0 ) ) < 0.002 ) piscinaT = conf.piscina ? 1 : 0;
		const ep = piscinaT * est.valores.fijo;
		c.piscina.visible = ep > 0.003;
		c.piscina.scale.y = Math.max( 0.001, ep );
		// exposición automática: dentro de la vivienda se abre el "diafragma"
		const dentro = bajo && interioresPlanta.some( ( e ) => puntoEnPoligono( camara.position.x, - camara.position.z, e.poligono ) );
		// a pie (dentro, en el jardín, en la rampa…) se ve la casa entera; desde
		// encima del tejado, la maqueta se levanta hasta la planta elegida
		const ps = plantasDe( vivienda );
		const pie = camara.position.y < ps[ ps.length - 1 ].cota + H + 1;
		if ( pie !== aPie ) {

			aPie = pie;
			if ( esMultiplanta( vivienda ) ) mostrarPlantas();

		}
		const expObjetivo = dentro ? 1.5 : 0.95;
		exposicion = Math.abs( expObjetivo - exposicion ) < 0.001 ? expObjetivo : exposicion + ( expObjetivo - exposicion ) * 0.06;
		renderer.toneMappingExposure = exposicion;
		// dentro, la luz del cielo solo entra por las ventanas: el entorno (que no
		// sabe de muros) baja y domina la luz de ventana, con su degradado natural
		interiorT += ( ( dentro ? 1 : 0 ) - interiorT ) * ( est.reducido ? 1 : 0.08 );
		if ( Math.abs( interiorT - ( dentro ? 1 : 0 ) ) < 0.002 ) interiorT = dentro ? 1 : 0;
		escena.environmentIntensity = est.valores.ibl * ( 1 - 0.2 * interiorT );

		camara.updateMatrixWorld();
		const cambia = orbitando || nav.activo || cam.animando || est.animando || conf.animando
			|| ! matAnterior.equals( camara.matrixWorld ) || ! proyAnterior.equals( camara.projectionMatrix )
			|| exposicion !== expObjetivo || ( interiorT !== 0 && interiorT !== 1 ) || desplazamiento !== objetivo || ( piscinaT !== 0 && piscinaT !== 1 );
		matAnterior.copy( camara.matrixWorld );
		proyAnterior.copy( camara.projectionMatrix );
		quietos = cambia ? 0 : quietos + 1;
		diagnostico = { orbitando, cam: cam.animando, est: est.animando, conf: conf.animando, mat: ! matAnterior.equals( camara.matrixWorld ), exposicion, expObjetivo, desplazamiento, objetivo, piscinaT, quietos };
		// imagen estable: no se vuelve a pintar (en el plano no hay efectos que se asienten: bastan 3 fotogramas)
		if ( quietos > ( modo === 'plano' && ! precalentarEfectos ? 3 : FOTOGRAMAS_ESTABLES ) ) return;
		renderizar();
		etiquetas.render( escena, camara );

	} );

	// ---------------------------------------------------------------- arranque
	cargarGeometriaTipologia();
	cargarVivienda( fichaVivienda );
	// se abre en el plano: es lo más rápido de preparar y da tiempo a la vivienda 3D
	irModo( 'plano' );
	cam.ir( 'planta', true );

	// ---------------------------------------------------------------- compilación de shaders
	// El navegador necesita un programa de dibujo por tipo de material y por
	// combinación de luces. Compilarlos al pintar el primer fotograma congelaba
	// la página (hasta 2 minutos en un portátil normal). Aquí se compilan antes,
	// cediendo el control al navegador entre objeto y objeto:
	//  1. vista inicial sin luces de ventana (pantalla de carga con progreso);
	//  2. con la vivienda ya navegable: luces de ventana y modo Plano, en segundo plano.
	const TANDAS = Math.max( 2, Math.min( 8, navigator.hardwareConcurrency || 4 ) );
	// Inactividad: la segunda fase solo trabaja cuando el visitante no está
	// moviéndose, para que la navegación nunca se interrumpa.
	let ultimaInteraccion = performance.now();
	const interactuar = () => ( ultimaInteraccion = performance.now() );
	for ( const ev of [ 'pointerdown', 'wheel', 'keydown', 'touchstart' ] ) addEventListener( ev, interactuar, { passive: true } );
	addEventListener( 'pointermove', ( e ) => e.buttons && interactuar(), { passive: true } );
	const esperarInactividad = async ( ms = 2500 ) => {

		while ( performance.now() - ultimaInteraccion < ms || cam.animando || nav.activo ) await new Promise( ( r ) => setTimeout( r, 250 ) );

	};
	const compilar = async ( paso: { destino: THREE.RenderTarget; mrt: ReturnType<typeof renderer.getMRT> | null }, conVentanas: boolean, progreso?: ( f: number ) => void, paciente = false, soloVisibles = false ) => {

		// La librería prepara los objetos de uno en uno, esperando a cada programa.
		// Repartirlos en varias tandas simultáneas permite al navegador compilar
		// varios programas a la vez (en paralelo en los núcleos del procesador).
		const tandas: THREE.Object3D[][] = Array.from( { length: TANDAS }, () => [] );
		let n = 0;
		// solo lo visible: la escena se recorre respetando la visibilidad de los grupos
		const recorrer = soloVisibles ? escena.traverseVisible.bind( escena ) : escena.traverse.bind( escena );
		recorrer( ( o ) => {

			if ( ( o as THREE.Mesh ).isMesh ) tandas[ n ++ % TANDAS ].push( o );

		} );
		const llenas = tandas.filter( ( t ) => t.length );
		const hechos = new Array( llenas.length ).fill( 0 ), totales = new Array( llenas.length ).fill( 1 );

		/** Compila unas tandas: prepara el estado del renderer, lanza la compilación y lo restaura al terminar. */
		const compilarTandas = async ( indices: number[] ) => {

			// todo visible durante la parte síncrona (lista de objetos y luces): los
			// estados de construcción ocultan partes que se verán más tarde
			const ocultos: THREE.Object3D[] = [];
			if ( ! soloVisibles ) escena.traverse( ( o ) => {

				if ( ! o.visible && o !== lucesVentana ) {

					ocultos.push( o );
					o.visible = true;

				}

			} );
			const ventanasAntes = lucesVentana.visible;
			lucesVentana.visible = conVentanas;
			const previo = { destino: renderer.getRenderTarget(), mrt: renderer.getMRT() };
			renderer.setRenderTarget( paso.destino );
			renderer.setMRT( paso.mrt );
			enCompilacion = paso;
		const trabajos = indices.map( ( i ) => {

				const grupo = new THREE.Group();
				// grupo de compilación: referencia a los objetos sin sacarlos de la escena
				( grupo as unknown as { children: THREE.Object3D[] } ).children = llenas[ i ];
				grupo.matrixWorldAutoUpdate = false;
				return renderer.compileAsync( grupo, camara, escena, ( e ) => {

					hechos[ i ] = e.loaded;
					totales[ i ] = Math.max( 1, e.total );
					progreso?.( hechos.reduce( ( x, y ) => x + y, 0 ) / totales.reduce( ( x, y ) => x + y, 0 ) );

				} );

			} );
			for ( const o of ocultos ) o.visible = false;
			lucesVentana.visible = ventanasAntes;
			try {

				await Promise.all( trabajos );

			} finally {

				enCompilacion = null;
				renderer.setRenderTarget( previo.destino );
				renderer.setMRT( previo.mrt );

			}

		};

		if ( ! paciente ) return compilarTandas( llenas.map( ( _, i ) => i ) );
		// segunda fase: de una tanda en una y solo cuando el visitante no interactúa
		for ( let i = 0; i < llenas.length; i ++ ) {

			await esperarInactividad();
			await compilarTandas( [ i ] );

		}

	};
	// 1. plano: solo lo visible en planta (pocos programas, sin efectos de imagen)
	await compilar( { destino: escenaPlano.renderTarget, mrt: null }, false, ponerBarra, false, true );
	preparado = true;
	despertar();
	await new Promise( requestAnimationFrame );
	await new Promise( requestAnimationFrame );
	document.body.classList.add( 'listo' );
	void ( async () => {

		const aviso = $( '#calidad' );
		try {

			// 2. vivienda 3D, mientras se mira el plano
			await compilar( { destino: escenaPass.renderTarget, mrt: escenaPass.getMRT() }, false, ( f ) => {

				progreso3D = f;
				if ( modoPendiente ) ponerBarra( f );

			} );
			precalentarEfectos = true;
			despertar();
			await new Promise( requestAnimationFrame );
			await new Promise( requestAnimationFrame );
			viviendaLista = true;
			// la visita se queda en el plano: la vivienda se abre cuando el visitante
			// la pide (si la pidió antes de estar lista, se abre ahora)
			const destino = modoPendiente;
			modoPendiente = null;
			document.body.classList.remove( 'cargando-3d' );
			if ( destino && ( modo as Modo ) === 'plano' ) irModo( destino );
			void comentarios3D?.alEstarLista();
			if ( new URLSearchParams( location.search ).has( 'lotes' ) ) lotes?.abrir();

			// 3. luces de ventana y plano completo, solo en los momentos sin interacción
			await esperarInactividad();
			aviso.hidden = false;
			await compilar( { destino: escenaPass.renderTarget, mrt: escenaPass.getMRT() }, true, undefined, true );
			ventanasListas = true;
			despertar();
			await compilar( { destino: escenaPlano.renderTarget, mrt: null }, false, undefined, true );

		} catch ( e ) {

			console.warn( 'Compilación en segundo plano:', e );
			viviendaLista = true;
			ventanasListas = true;
			document.body.classList.remove( 'cargando-3d' );
			const pendiente = modoPendiente;
			modoPendiente = null;
			if ( pendiente ) irModo( pendiente );
			void comentarios3D?.alEstarLista();
			if ( new URLSearchParams( location.search ).has( 'lotes' ) ) lotes?.abrir();

		} finally {

			aviso.hidden = true;

		}

	} )();
	// Experience pública: «Solicitar información» y, si está apagada, solo compradores y equipo
	void estadoPublicoP.then( ( e ) => {

		if ( ! e ) return;
		if ( e.solicitarInfo ) {

			conectarSolicitar( $<HTMLAnchorElement>( '#solicitar-info' ), $<HTMLDialogElement>( '#formulario-info' ), e.solicitarInfo,
				{ id: PROMOCION.id, nombre: PROMOCION.promocion.nombre },
				() => ( { id: fichaVivienda.tipologia, nombre: modelo.tipologia.nombre } ), PROMOCION.marca );
			$( '.solicitar-info' ).hidden = false;

		}
		if ( ! e.accesoComprador ) $( '.acceso-comprador.solo-publico' ).hidden = true;
		if ( e.activa || comprador ) return;
		if ( location.hostname.startsWith( 'revision-' ) ) {

			avisar( 'Vista previa: la Experience pública de esta promoción está apagada. En la web publicada solo entran los compradores con su código y el equipo de la promotora desde MUNE Portal.' );
			return;

		}
		$( '#no-disponible-promocion' ).textContent = PROMOCION.promocion.nombre;
		for ( const x of $( '#no-disponible' ).querySelectorAll<HTMLElement>( 'p:not(.antetitulo), button' ) ) x.hidden = ! e.accesoComprador;
		$( '#no-disponible' ).hidden = false;

	} );
	$( '#no-disponible-acceso' ).addEventListener( 'click', () => abrirAcceso() );
	if ( profesional ) avisar( profesional.puedePersonalizar
		? 'Modo profesional: elige una vivienda arriba para ver su personalización y lo elegido. Puedes elegir en nombre del comprador, sacar renders y descargar el plano comercial.'
		: 'Modo profesional: elige una vivienda arriba para ver su personalización y lo elegido. Puedes sacar renders y descargar el plano comercial.' );
	else if ( accesoProfesionalInicial === null && pase ) avisar( 'Tu acceso al 3D ha caducado. Vuelve a abrirlo desde MUNE Portal.' );
	else if ( accesoProfesionalInicial === 'sin-conexion' ) avisar( 'No se ha podido abrir el modo profesional ahora mismo. Revisa tu conexión y vuelve a abrirlo desde MUNE Portal.' );
	else if ( comprador ) avisar( `Te damos la bienvenida. Estás viendo tu vivienda ${ comprador.ref }. Pulsa Personalizar para ver las opciones disponibles para tu vivienda.` );
	else if ( accesoInicial === 'sin-conexion' ) avisar( 'No se ha podido comprobar tu código ahora mismo. Puedes ver la promoción y volver a entrar en unos minutos.' );

	// ---------------------------------------------------------------- studio (producción)
	// Solo existe en la construcción interna (--mode studio). En la web pública
	// __STUDIO__ es false y el Studio no se incluye: ni código ni acceso.
	const dialogoStudio = $<HTMLDialogElement>( '#acceso-studio' );
	const abrirStudio = ! __STUDIO__ ? async () => {} : async () => {

		const { abrirStudio: abrir } = await import( './studio/studio' );
		await abrir( {
			escena, camara, ctrl, lienzo: renderer.domElement, mobiliario: c.mobiliario,
			modelo: () => modelo, espejo: () => !! fichaVivienda.espejo,
			reconstruir: () => void reconstruir(), despertar, irVista, construirBarraVistas,
			refrescarCatalogo: () => cargarVivienda( fichaVivienda ),
			aplicarMarca: () => {

				aplicarMarca( PROMOCION );
				actualizarFicha();

			},
			promocion: PROMOCION, catalogo: CATALOGO, descargar, avisar: ( t ) => avisar( t ),
		} );

	};
	// ---------------------------------------------------------------- perfiles profesionales
	// Público → Comprador (código de vivienda) → Promotora (entregables comerciales)
	// → Studio (producción). La promotora entra desde MUNE Portal (modo profesional);
	// en la construcción interna, Studio (y la promotora, con su código) entra por
	// «Acceso profesional» y el navegador recuerda el último código válido.
	const CLAVE_PROFESIONAL = 'inmobiliarias:profesional';
	const entrarPromotora = ( codigo: string ) => {

		guardar( CLAVE_PROFESIONAL, codigo );
		document.body.classList.add( 'perfil-promotora' );
		$( '#perfil-promotora' ).hidden = false;

	};
	const pedirAcceso = async ( codigo?: string ) => {

		if ( document.body.classList.contains( 'en-studio' ) ) return;
		codigo ||= leer( CLAVE_PROFESIONAL ) ?? leer( 'inmobiliarias:studio' ) ?? '';
		const perfil = codigo ? await accesoProfesional( codigo ) : null;
		if ( perfil === 'studio' ) {

			guardar( CLAVE_PROFESIONAL, codigo );
			return abrirStudio();

		}

		if ( perfil === 'promotora' ) return entrarPromotora( codigo );
		$( '#acceso-studio .error' ).hidden = true;
		$<HTMLInputElement>( '#codigo-studio' ).value = '';
		dialogoStudio.showModal();

	};
	dialogoStudio.querySelector( '.cancelar' )!.addEventListener( 'click', () => dialogoStudio.close() );
	dialogoStudio.querySelector( 'form' )!.addEventListener( 'submit', async ( ev ) => {

		ev.preventDefault();
		const codigo = $<HTMLInputElement>( '#codigo-studio' ).value.trim();
		const perfil = await accesoProfesional( codigo );
		if ( ! perfil ) {

			$( '#acceso-studio .error' ).hidden = false;
			return;

		}

		dialogoStudio.close();
		if ( perfil === 'studio' ) {

			guardar( CLAVE_PROFESIONAL, codigo );
			void abrirStudio();

		} else {

			entrarPromotora( codigo );
			avisar( 'Has entrado como promotora. Ya puedes descargar imágenes en alta calidad con «Render HD» y, desde Plano, el plano comercial en PDF o PNG.' );

		}

	} );
	// en la web pública, el equipo de la promotora entra desde MUNE Portal (modo profesional)
	if ( ! __STUDIO__ ) $( '#abrir-studio' ).hidden = true;
	$( '#abrir-studio' ).addEventListener( 'click', () => void pedirAcceso() );
	$( '#salir-promotora' ).addEventListener( 'click', () => {

		guardar( CLAVE_PROFESIONAL, null );
		document.body.classList.remove( 'perfil-promotora' );
		$( '#perfil-promotora' ).hidden = true;

	} );
	// la sesión de promotora recordada se recupera sin pedir nada
	void ( async () => {

		const guardado = leer( CLAVE_PROFESIONAL );
		if ( __STUDIO__ && guardado && ! pideProfesional && ( await accesoProfesional( guardado ) ) === 'promotora' ) entrarPromotora( guardado );

	} )();
	const codigoHash = () => location.hash.replace( /^#(studio|promotora)-?/, '' );
	if ( __STUDIO__ && pideProfesional ) void pedirAcceso( codigoHash() );
	if ( __STUDIO__ ) addEventListener( 'hashchange', () => /^#(studio|promotora)/.test( location.hash ) && void pedirAcceso( codigoHash() ) );

	Object.assign( window, { __vivienda: { nav, irModo, irVista, irEstado: ( n: number ) => irModo( n === 1 ? 'plano' : 'vivienda' ), cam, estados: est, renderer, camara, ctrl, pausar: ( p: boolean ) => ( pausado = p ), diagnostico: () => diagnostico } } );

}

iniciar().catch( ( err ) => {

	console.error( err );
	$( '#carga' ).textContent = 'No se ha podido abrir la visita 3D en este navegador. Prueba con otro navegador o actualiza el que usas.';

} );

