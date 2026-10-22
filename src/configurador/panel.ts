// Panel "Personalizar": cajón lateral organizado por packs. Cada pack muestra
// su estado (disponible, próximamente, periodo finalizado) y sus categorías
// plegables (una abierta a la vez). Se genera a partir del catálogo.

import type { Configurador } from './configurador';
import { fmtEuros, fmtPrecio } from './configurador';
import { ETIQUETA_ESTADO, fmtFecha, textoPeriodo, type PackVivienda } from './packs';

const h = ( tag: string, attrs: Record<string, string> = {}, ...hijos: ( Node | string | null | false )[] ) => {

	const el = document.createElement( tag );
	for ( const [ k, v ] of Object.entries( attrs ) ) el.setAttribute( k, v );
	for ( const x of hijos ) if ( x ) el.append( x );
	return el;

};

const CHEVRON = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CANDADO = '<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.3" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5.5 7V5.2a2.5 2.5 0 0 1 5 0V7" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

export interface PanelCallbacks {
	elegir( categoria: string, opcion: string ): void;
	/** Se ha desplegado una categoría (para enseñar la estancia afectada). */
	abrir( categoria: string ): void;
	/** Quitar una mejora desde el resumen: vuelve a la opción incluida. */
	quitar( categoria: string ): void;
	/** Quitar todas las mejoras de los packs abiertos (tras confirmación). */
	restablecer(): void;
	cerrar(): void;
	/** Documento de selección de un pack. */
	generar( pack: string ): void;
}

const PAPELERA = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';

export class Panel {

	private raiz: HTMLElement;
	private informes = new Map<string, HTMLElement>();
	private elecciones = new Map<string, HTMLElement>();
	private secciones = new Map<string, HTMLElement>();
	private piesPack = new Map<string, HTMLElement>();

	constructor( private conf: Configurador, private cb: PanelCallbacks ) {

		this.raiz = document.querySelector( '#configurador' ) as HTMLElement;
		const cuerpo = this.raiz.querySelector( '.opciones' ) as HTMLElement;
		cuerpo.replaceChildren();
		for ( const pv of conf.packs ) cuerpo.append( this.seccionPack( pv ) );

		// los botones fijos del cajón se enlazan con onclick para poder recrear el panel
		const boton = ( sel: string ) => this.raiz.querySelector( sel ) as HTMLButtonElement;
		boton( '.cerrar' ).onclick = () => this.cb.cerrar();
		boton( '.generar' ).onclick = () => {

			const abierto = this.conf.packs.find( ( p ) => p.estado === 'disponible' );
			if ( abierto ) this.cb.generar( abierto.pack.id );

		};
		const confirmar = this.raiz.querySelector( '.confirmar-restablecer' ) as HTMLElement;
		boton( '.restablecer' ).onclick = () => {

			confirmar.hidden = false;
			( confirmar.querySelector( '.no' ) as HTMLButtonElement ).focus();

		};
		( confirmar.querySelector( '.no' ) as HTMLButtonElement ).onclick = () => ( confirmar.hidden = true );
		( confirmar.querySelector( '.si' ) as HTMLButtonElement ).onclick = () => {

			confirmar.hidden = true;
			this.cb.restablecer();

		};
		this.resumen();

	}

	private seccionPack( pv: PackVivienda ) {

		const { pack, estado } = pv;
		const chip = h( 'span', { class: `estado-pack ${ estado }` } );
		if ( estado !== 'disponible' ) chip.insertAdjacentHTML( 'afterbegin', CANDADO );
		chip.append( ETIQUETA_ESTADO[ estado ] );
		// próximamente: solo nombre, estado, un aviso neutro y la fecha de apertura
		// si existe (sin precios ni opciones, que todavía pueden cambiar)
		if ( estado === 'proximamente' ) return h( 'section', { class: 'pack', 'data-estado': estado, 'aria-label': `${ pack.titulo }: ${ ETIQUETA_ESTADO[ estado ] }` },
			h( 'header', { class: 'cabecera-pack' }, h( 'div', { class: 'titulo-pack' }, h( 'h3', {}, pack.titulo ), chip ) ),
			h( 'p', { class: 'nota-pack' }, 'Este pack se abrirá más adelante. La promotora te avisará cuando empiece su periodo de selección.' ),
			pack.desde ? h( 'p', { class: 'periodo-pack' }, textoPeriodo( pack, estado ) ) : null );
		const cabecera = h( 'header', { class: 'cabecera-pack' },
			h( 'div', { class: 'titulo-pack' }, h( 'h3', {}, pack.titulo ), chip ),
			h( 'p', { class: 'periodo-pack' }, textoPeriodo( pack, estado ) ),
			pack.descripcion ? h( 'p', { class: 'descripcion-pack' }, pack.descripcion ) : null );
		const seccion = h( 'section', { class: 'pack', 'data-estado': estado, 'aria-label': `${ pack.titulo }: ${ ETIQUETA_ESTADO[ estado ] }` }, cabecera );

		if ( estado === 'finalizado' ) {

			// histórico: lo que se formalizó, en solo lectura
			const lista = h( 'ul', { class: 'historico' } );
			for ( const c of pv.categorias ) {

				const o = this.conf.opcion( c.id );
				lista.append( h( 'li', {}, h( 'span', { class: 'cat' }, c.nombre ), h( 'span', { class: 'op' }, o.detalle ?? o.nombre ), h( 'span', { class: 'coste' }, fmtPrecio( o.precio ) ) ) );

			}

			seccion.append( lista, h( 'p', { class: 'nota-pack' }, pv.formalizada
				? `Selección cerrada (${ fmtFecha( pv.formalizada.fecha ) }). Ya no se puede cambiar.`
				: 'No se formalizó ninguna mejora en este pack. Se mantiene lo incluido en tu vivienda.' ) );
			return seccion;

		}

		for ( const c of pv.categorias ) seccion.append( this.seccionCategoria( c.id, true ) );
		if ( pv.guardada ) seccion.append( h( 'p', { class: 'nota-pack' },
			`Tu selección está guardada (${ fmtFecha( pv.guardada.fecha ) }).${ pack.hasta < '2100' ? ` Puedes cambiarla hasta el ${ fmtFecha( pack.hasta, true ) }` : ' Puedes cambiarla' }: vuelve a descargar el documento.` ) );
		const pie = h( 'div', { class: 'pie-pack' } );
		this.piesPack.set( pack.id, pie );
		seccion.append( pie );
		return seccion;

	}

	private seccionCategoria( id: string, editable: boolean ) {

		const c = this.conf.categoria( id );
		const idCuerpo = `cat-${ c.id }`;
		const eleccion = h( 'span', { class: 'eleccion' } );
		this.elecciones.set( c.id, eleccion );
		const cabecera = h( 'button', { type: 'button', class: 'cabecera-cat', 'aria-expanded': 'false', 'aria-controls': idCuerpo },
			h( 'span', { class: 'nombre-cat' }, c.nombre ), eleccion );
		cabecera.insertAdjacentHTML( 'beforeend', CHEVRON );
		cabecera.addEventListener( 'click', () => this.desplegar( c.id ) );

		const lista = h( 'div', { class: 'lista', role: 'radiogroup', 'aria-label': c.nombre, ...( editable ? {} : { 'aria-disabled': 'true' } ) } );
		for ( const o of c.opciones ) {

			const idOp = `opcion-${ c.id }-${ o.id }`;
			const input = h( 'input', { type: 'radio', name: `radio-${ c.id }`, id: idOp, value: o.id } ) as HTMLInputElement;
			input.checked = this.conf.seleccion[ c.id ] === o.id;
			input.disabled = ! editable;
			input.addEventListener( 'change', () => input.checked && this.cb.elegir( c.id, o.id ) );
			const p = o.parametros;
			const muestra = p ? h( 'span', { class: 'muestra', style: `--a:${ p.claro ?? p.base ?? p.pared ?? '#ddd' };--b:${ p.oscuro ?? p.mota ?? p.suelo ?? '#ccc' }` } ) : h( 'span', { class: 'muestra vacia' } );
			const texto = h( 'span', { class: 'texto' }, h( 'span', { class: 'nombre' }, o.nombre ), o.detalle ? h( 'span', { class: 'detalle' }, o.detalle ) : null );
			lista.append( h( 'label', { class: 'opcion', for: idOp }, input, muestra, texto, h( 'span', { class: 'coste' }, fmtPrecio( o.precio ) ) ) );

		}

		const informe = h( 'ul', { class: 'informe', hidden: '' } );
		this.informes.set( c.id, informe );
		const contenido = h( 'div', { class: 'cuerpo-cat', id: idCuerpo, hidden: '' } );
		if ( c.detalle ) contenido.append( h( 'p', { class: 'detalle-cat' }, c.detalle ) );
		contenido.append( lista, informe );
		const seccion = h( 'section', { class: 'categoria' }, cabecera, contenido );
		this.secciones.set( c.id, seccion );
		return seccion;

	}

	/** Vacía el panel antes de crear otro (al cargar otra vivienda). */
	destruir() {

		( this.raiz.querySelector( '.opciones' ) as HTMLElement ).replaceChildren();

	}

	/** Despliega una categoría y pliega las demás (o la pliega si ya estaba abierta). */
	desplegar( id: string | null, avisar = true ) {

		if ( id && ! this.secciones.has( id ) ) {

			// categoría de un pack cerrado: se abre la primera de un pack disponible
			id = this.conf.packs.find( ( p ) => p.estado === 'disponible' )?.categorias[ 0 ]?.id ?? null;
			avisar = false;

		}

		for ( const [ k, s ] of this.secciones ) {

			const abrir = k === id && s.querySelector( '.cabecera-cat' )!.getAttribute( 'aria-expanded' ) !== 'true';
			s.querySelector( '.cabecera-cat' )!.setAttribute( 'aria-expanded', String( abrir ) );
			( s.querySelector( '.cuerpo-cat' ) as HTMLElement ).hidden = ! abrir;
			s.classList.toggle( 'abierta', abrir );
			if ( abrir && avisar ) this.cb.abrir( k );

		}

	}

	/** Marca la selección actual (p. ej. tras restaurar una configuración). */
	sincronizar() {

		for ( const c of this.conf.datos.categorias ) {

			const el = this.raiz.querySelector<HTMLInputElement>( `#opcion-${ c.id }-${ this.conf.seleccion[ c.id ] }` );
			if ( el ) el.checked = true;

		}

		this.resumen();

	}

	/** Notas bajo una categoría (p. ej. qué cambia con una distribución). */
	informe( categoria: string, lineas: string[] ) {

		const ul = this.informes.get( categoria );
		if ( ! ul ) return;
		ul.replaceChildren( ...lineas.map( ( l ) => h( 'li', {}, l ) ) );
		ul.hidden = lineas.length === 0;

	}

	resumen() {

		const c = this.conf;
		for ( const l of this.raiz.querySelectorAll<HTMLLabelElement>( '.opcion' ) ) l.classList.toggle( 'elegida', ( l.querySelector( 'input' ) as HTMLInputElement ).checked );
		for ( const [ id, el ] of this.elecciones ) {

			const o = c.opcion( id );
			el.textContent = o.precio ? `${ o.nombre } · ${ fmtPrecio( o.precio ) }` : o.nombre;
			this.secciones.get( id )!.classList.toggle( 'mejorada', o.precio > 0 );

		}

		// pie de cada pack abierto: sus mejoras y su documento
		for ( const [ id, pie ] of this.piesPack ) {

			const n = c.extrasDe( id ).length;
			const doc = h( 'button', { type: 'button', class: 'documento-pack' }, 'Preparar documento' ) as HTMLButtonElement;
			doc.onclick = () => this.cb.generar( id );
			pie.replaceChildren( h( 'span', {}, n ? `${ n } ${ n === 1 ? 'mejora' : 'mejoras' } · ` : 'Sin mejoras · ', h( 'strong', {}, `+${ fmtEuros( c.totalPack( id ) ) }` ) ), doc );

		}

		// resumen tipo carrito: mejoras de los packs abiertos (se pueden quitar) y formalizadas
		const carrito = this.raiz.querySelector( '.carrito' ) as HTMLElement;
		carrito.replaceChildren( ...c.extras.map( ( x ) => {

			const editable = c.editable( x.categoria.id );
			let quitar: HTMLElement;
			if ( editable ) {

				quitar = h( 'button', { type: 'button', class: 'quitar', 'aria-label': `Quitar ${ x.categoria.nombre.toLowerCase() }: ${ x.opcion.nombre }`, title: 'Quitar esta mejora' } );
				quitar.innerHTML = PAPELERA;
				quitar.onclick = () => this.cb.quitar( x.categoria.id );

			} else {

				quitar = h( 'span', { class: 'cerrada', title: 'Mejora de un pack cerrado' } );
				quitar.innerHTML = CANDADO;

			}

			return h( 'li', { class: editable ? '' : 'formalizada' }, h( 'span', { class: 'nombre-extra' }, h( 'span', { class: 'cat' }, x.categoria.nombre ), ` ${ x.opcion.detalle ?? x.opcion.nombre }` ),
				h( 'span', { class: 'coste' }, `+${ fmtEuros( x.opcion.precio ) }` ), quitar );

		} ) );
		carrito.hidden = c.extras.length === 0;
		const n = c.extras.length;
		( this.raiz.querySelector( '.n-mejoras' ) as HTMLElement ).textContent = n === 0 ? 'sin mejoras' : `${ n } ${ n === 1 ? 'mejora' : 'mejoras' }`;
		( this.raiz.querySelector( '[data-precio="extras"]' ) as HTMLElement ).textContent = `+${ fmtEuros( c.totalExtras ) }`;
		// Solo el coste de la personalización: el precio de la vivienda no está en la plataforma (decisión 37)
		( this.raiz.querySelector( '[data-precio="total"]' ) as HTMLElement ).textContent = c.totalExtras ? `+${ fmtEuros( c.totalExtras ) }` : '0 €';
		const editables = c.extras.filter( ( x ) => c.editable( x.categoria.id ) ).length;
		( this.raiz.querySelector( '.restablecer' ) as HTMLElement ).hidden = editables === 0;
		if ( editables === 0 ) ( this.raiz.querySelector( '.confirmar-restablecer' ) as HTMLElement ).hidden = true;
		const abierto = c.packs.find( ( p ) => p.estado === 'disponible' );
		const generar = this.raiz.querySelector( '.generar' ) as HTMLButtonElement;
		generar.hidden = ! abierto;
		if ( abierto ) generar.textContent = `Preparar documento · ${ abierto.pack.titulo.replace( /^Pack \d+ · /, '' ) }`;
		const chip = document.querySelector( '#total-ficha' ) as HTMLElement | null;
		if ( chip ) {

			chip.hidden = c.totalExtras === 0;
			chip.textContent = `Tu personalización: +${ fmtEuros( c.totalExtras ) }`;

		}

	}

}
