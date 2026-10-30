// Descarga por lotes (30/10/2026), solo para el equipo de la promotora y MUNE
// Studio (modo profesional): los planos comerciales y los renders de las vistas
// guiadas de las tipologías elegidas, en un ZIP con una carpeta por tipología.
//
// · Planos: los mismos que se validan (mismos datos y dibujo), en PDF A3, en
//   PNG de alta resolución o en los dos. Desde la versión publicada son los
//   vigentes.
// · Renders: de la tipología base (acabados incluidos), con el tamaño y la
//   proporción elegidos. Se generan en este ordenador: es gratis, pero tarda,
//   y la pestaña tiene que quedarse abierta.

import { planosParaDescargar } from './lote';
import { Zip } from '../util/zip';

export interface UnidadLote { clave: string; titulo: string; vistas: { id: string; nombre: string }[] }

export interface ContextoLote {
	promocion: string;
	unidades: () => UnidadLote[];
	/** Prepara la unidad (tipología base, modo Vivienda) para sacar sus renders. */
	ponerUnidad: ( clave: string ) => Promise<void>;
	render: ( vista: string, ancho: number, alto: number, muestras: number, progreso: ( t: string ) => void ) => Promise<Blob>;
	/** Vuelve a dejar el 3D como estaba. */
	restaurar: () => void;
	descargar: ( nombre: string, blob: Blob ) => Promise<void>;
}

const TAMANOS: [ string, string, number, number, number ][] = [
	// título, detalle, ancho, muestras, segundos aproximados por render
	[ 'Web', 'Web, redes sociales y portales inmobiliarios', 1920, 16, 20 ],
	[ 'Alta resolución', 'Presentaciones, pantallas grandes y campañas', 3840, 12, 60 ],
	[ 'Impresión', 'Folletos y lonas (aprox. A3 a 300 ppp)', 6000, 10, 150 ],
];

const slug = ( s: string ) => s.normalize( 'NFD' ).replace( /[̀-ͯ]/g, '' ).toLowerCase().replace( /[^a-z0-9]+/g, '-' ).replace( /^-+|-+$/g, '' );
const carpeta = ( s: string ) => s.replace( /[\\/:*?"<>|]+/g, '-' ).trim();
const minutos = ( seg: number ) => seg < 90 ? 'menos de 2 minutos' : `unos ${ Math.round( seg / 60 ) } minutos`;

export function conectarDescargaLotes( c: ContextoLote ) {

	const dialogo = document.querySelector<HTMLDialogElement>( '#lotes' )!;
	const boton = document.querySelector<HTMLButtonElement>( '#descargar-lotes' )!;
	boton.hidden = false;
	let detener = false;
	let trabajando = false;

	const pintar = () => {

		const unidades = c.unidades();
		dialogo.innerHTML = `
			<h2>Descargar por lotes</h2>
			<p class="texto">Los planos comerciales y los renders de las tipologías que elijas, en un ZIP con una carpeta por tipología. Se generan en este ordenador: no cierres esta pestaña hasta que termine.</p>
			<form class="lotes" novalidate>
				<fieldset><legend>Planos comerciales</legend>
					<label><input type="radio" name="planos" value="pdf" checked> PDF A3 <small>para imprimir</small></label>
					<label><input type="radio" name="planos" value="png"> Imagen PNG en alta resolución <small>para la web</small></label>
					<label><input type="radio" name="planos" value="ambos"> Los dos</label>
					<label><input type="radio" name="planos" value=""> Sin planos</label>
				</fieldset>
				<fieldset><legend>Renders de las vistas</legend>
					<label><input type="checkbox" name="renders" checked> Incluir los renders</label>
					<div class="lotes-opciones">
						${ TAMANOS.map( ( [ t, d ], i ) => `<label><input type="radio" name="tamano" value="${ i }"${ i === 0 ? ' checked' : '' }> ${ t } <small>${ d }</small></label>` ).join( '' ) }
						<div class="formatos-render" role="group" aria-label="Proporción de la imagen">
							<label><input type="radio" name="proporcion" value="16:9" checked> 16:9</label>
							<label><input type="radio" name="proporcion" value="3:2"> 3:2</label>
						</div>
					</div>
				</fieldset>
				<fieldset><legend>Tipologías y vistas</legend>
					${ unidades.map( ( u ) => `<details class="lote-unidad" open>
						<summary><label><input type="checkbox" data-unidad="${ u.clave }" checked> ${ u.titulo }</label></summary>
						<div class="lote-vistas">${ u.vistas.map( ( v ) => `<label><input type="checkbox" data-vista="${ u.clave }:${ v.id }" checked> ${ v.nombre }</label>` ).join( '' ) }</div>
					</details>` ).join( '' ) }
				</fieldset>
				<p class="resumen-lote" data-resumen></p>
				<p class="progreso" role="status" aria-live="polite" hidden></p>
				<div class="acciones">
					<button type="submit" class="boton-info">Descargar</button>
					<button type="button" class="cancelar">Cerrar</button>
				</div>
			</form>`;
		const form = dialogo.querySelector( 'form' )!;
		const progreso = dialogo.querySelector<HTMLElement>( '.progreso' )!;
		const enviar = form.querySelector<HTMLButtonElement>( 'button[type=submit]' )!;
		const cerrar = form.querySelector<HTMLButtonElement>( '.cancelar' )!;

		const eleccion = () => {

			const d = new FormData( form );
			const conRenders = d.get( 'renders' ) === 'on';
			const [ , , ancho, muestras, segundos ] = TAMANOS[ Number( d.get( 'tamano' ) ) ];
			const [ a, b ] = String( d.get( 'proporcion' ) ).split( ':' ).map( Number );
			const elegidas = unidades.filter( ( u ) => form.querySelector<HTMLInputElement>( `[data-unidad="${ u.clave }"]` )!.checked );
			const vistas = elegidas.map( ( u ) => ( { u, vistas: u.vistas.filter( ( v ) => form.querySelector<HTMLInputElement>( `[data-vista="${ u.clave }:${ v.id }"]` )!.checked ) } ) );
			return { planos: String( d.get( 'planos' ) ), conRenders, ancho, alto: Math.round( ancho * b / a ), muestras, segundos, elegidas, vistas };

		};
		const resumir = () => {

			const e = eleccion();
			form.querySelector<HTMLElement>( '.lotes-opciones' )!.hidden = ! e.conRenders;
			const renders = e.conRenders ? e.vistas.reduce( ( t, x ) => t + x.vistas.length, 0 ) : 0;
			const conPlanos = !! e.planos && e.elegidas.length > 0;
			form.querySelector<HTMLElement>( '[data-resumen]' )!.textContent = ! renders && ! conPlanos
				? 'Elige algo que descargar.'
				: `${ e.elegidas.length } tipología${ e.elegidas.length === 1 ? '' : 's' }${ conPlanos ? ', con sus planos' : '' }${ renders ? ` y ${ renders } render${ renders === 1 ? '' : 's' } de ${ e.ancho } × ${ e.alto }` : '' }. Tiempo aproximado: ${ minutos( renders * e.segundos + ( conPlanos ? e.elegidas.length * 5 : 0 ) ) }.`;
			enviar.disabled = trabajando || ( ! renders && ! conPlanos );

		};
		// marcar o desmarcar una tipología marca o desmarca sus vistas
		form.querySelectorAll<HTMLInputElement>( '[data-unidad]' ).forEach( ( x ) => x.addEventListener( 'change', () => {

			form.querySelectorAll<HTMLInputElement>( `[data-vista^="${ x.dataset.unidad }:"]` ).forEach( ( v ) => ( v.checked = x.checked ) );

		} ) );
		form.querySelectorAll<HTMLInputElement>( '[data-vista]' ).forEach( ( v ) => v.addEventListener( 'change', () => {

			const [ u ] = v.dataset.vista!.split( ':' );
			if ( v.checked ) form.querySelector<HTMLInputElement>( `[data-unidad="${ u }"]` )!.checked = true;

		} ) );
		form.addEventListener( 'change', resumir );
		resumir();

		cerrar.addEventListener( 'click', () => {

			if ( trabajando ) {

				detener = true;
				cerrar.textContent = 'Deteniendo…';
				return;

			}
			dialogo.close();

		} );

		form.addEventListener( 'submit', async ( ev ) => {

			ev.preventDefault();
			const e = eleccion();
			const zip = new Zip();
			const nombre = ( u: UnidadLote ) => carpeta( u.titulo );
			trabajando = true;
			detener = false;
			enviar.disabled = true;
			cerrar.textContent = 'Detener';
			form.querySelectorAll( 'fieldset' ).forEach( ( f ) => ( f.disabled = true ) );
			progreso.hidden = false;
			const inicio = performance.now();
			try {

				if ( e.planos ) {

					const porClave = new Map( e.elegidas.map( ( u ) => [ u.clave, u ] ) );
					for await ( const p of planosParaDescargar( new Set( porClave.keys() ), e.planos !== 'png', e.planos !== 'pdf' ) ) {

						if ( detener ) break;
						progreso.textContent = `Planos: ${ p.titulo }…`;
						const dir = nombre( porClave.get( p.unidad )! );
						if ( p.pdf ) zip.anadir( `${ dir }/Plano comercial - ${ carpeta( p.titulo ) }.pdf`, new Uint8Array( await p.pdf.arrayBuffer() ) );
						if ( p.png ) zip.anadir( `${ dir }/Plano comercial - ${ carpeta( p.titulo ) }.png`, new Uint8Array( await p.png.arrayBuffer() ) );

					}

				}
				if ( e.conRenders ) {

					const total = e.vistas.reduce( ( t, x ) => t + x.vistas.length, 0 );
					let hechos = 0;
					const tRenders = performance.now();
					for ( const { u, vistas } of e.vistas ) {

						if ( detener || ! vistas.length ) continue;
						progreso.textContent = `Preparando ${ u.titulo }…`;
						await c.ponerUnidad( u.clave );
						for ( const v of vistas ) {

							if ( detener ) break;
							const quedan = hechos ? ( performance.now() - tRenders ) / hechos * ( total - hechos ) / 1000 : ( total - hechos ) * e.segundos;
							const blob = await c.render( v.id, e.ancho, e.alto, e.muestras, ( t ) => {

								progreso.textContent = `Render ${ hechos + 1 } de ${ total } · ${ u.titulo } · ${ v.nombre }. ${ t } Queda: ${ minutos( quedan ) }.`;

							} );
							zip.anadir( `${ nombre( u ) }/Render - ${ carpeta( v.nombre ) } - ${ e.ancho }x${ e.alto }.jpg`, new Uint8Array( await blob.arrayBuffer() ) );
							hechos++;

						}

					}

				}
				if ( zip.cuantos ) {

					progreso.textContent = 'Preparando el ZIP…';
					await c.descargar( `${ slug( `${ c.promocion }-descarga` ) }.zip`, zip.cerrar() );
					progreso.textContent = detener
						? `Detenido: se ha descargado lo que ya estaba hecho (${ zip.cuantos } archivo${ zip.cuantos === 1 ? '' : 's' }).`
						: `Listo: ${ zip.cuantos } archivo${ zip.cuantos === 1 ? '' : 's' } en ${ minutos( ( performance.now() - inicio ) / 1000 ) }. La descarga ha empezado.`;

				} else progreso.textContent = 'Detenido antes de terminar el primer archivo: no hay nada que descargar.';

			} catch ( err ) {

				console.error( 'Descarga por lotes:', err );
				progreso.textContent = 'No se ha podido terminar la descarga. Vuelve a probar; si sigue pasando, prueba con menos vistas o un tamaño menor.';

			} finally {

				c.restaurar();
				trabajando = false;
				cerrar.textContent = 'Cerrar';
				form.querySelectorAll( 'fieldset' ).forEach( ( f ) => ( f.disabled = false ) );
				resumir();

			}

		} );

	};

	const abrir = () => {

		if ( ! trabajando ) pintar();
		dialogo.showModal();

	};
	boton.addEventListener( 'click', abrir );
	// mientras trabaja, el diálogo no se cierra con Escape (se detiene con «Detener»)
	dialogo.addEventListener( 'cancel', ( ev ) => trabajando && ev.preventDefault() );
	return { abrir };

}
