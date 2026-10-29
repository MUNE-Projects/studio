// «Solicitar información» de la experiencia pública (033_solicitar_informacion.sql).
//
// · Enlace: a la web o al formulario de la promotora, con las UTM (de dónde viene
//   el interesado); un email, con la tipología en el asunto. Si la experiencia
//   está insertada en la web de la promotora, abre la página en la misma ventana;
//   si no, en otra pestaña, para no perder el 3D.
// · Formulario: el código de inserción del formulario de su CRM, en una ventana
//   encima del 3D al pulsar el botón. Va dentro de formulario.html, en un marco
//   aislado (sandbox sin «allow-same-origin»): funciona, pero no puede leer nada de
//   la experiencia (por ejemplo, lo de un comprador con código). Su dirección
//   lleva las UTM, que es donde las buscan los CRM. MUNE no ve ni guarda nada.

import type { SolicitarInfo } from './promocion';

/** Las UTM de esta visita: de MUNE, en la experiencia 3D, de esta promoción y tipología. */
export function utm( promocion: string, tipologia: string ): Record<string, string> {

	return { utm_source: 'mune', utm_medium: 'experiencia-3d', utm_campaign: promocion, utm_content: `tipologia-${ tipologia }` };

}

/** El enlace con las UTM (sin quitar las que ya tenga) o, un email, con el asunto. */
export function enlaceConOrigen( enlace: string, promocion: { id: string; nombre: string }, tipologia: { id: string; nombre: string } ): string {

	if ( enlace.startsWith( 'mailto:' ) ) {

		if ( /[?&]subject=/i.test( enlace ) ) return enlace;
		const asunto = `Información sobre ${ tipologia.nombre } · ${ promocion.nombre }`;
		return `${ enlace }${ enlace.includes( '?' ) ? '&' : '?' }subject=${ encodeURIComponent( asunto ) }`;

	}
	try {

		const u = new URL( enlace );
		for ( const [ k, v ] of Object.entries( utm( promocion.id, tipologia.id ) ) ) if ( ! u.searchParams.has( k ) ) u.searchParams.set( k, v );
		return u.toString();

	} catch {

		return enlace;

	}

}

/** ¿Está la experiencia insertada en otra web (la de la promotora)? */
const insertada = () => {

	try {

		return window.top !== window.self;

	} catch {

		return true;

	}

};

/** Prepara el botón «Solicitar información» con lo que haya puesto la promotora. */
export function conectarSolicitar( boton: HTMLAnchorElement, dialogo: HTMLDialogElement, s: SolicitarInfo,
	promocion: { id: string; nombre: string }, tipologia: () => { id: string; nombre: string } ): void {

	if ( s.modo === 'enlace' ) {

		const actualizar = () => {

			boton.href = enlaceConOrigen( s.enlace, promocion, tipologia() );
			// insertada en la web de la promotora: su página de contacto, en la misma ventana
			boton.target = insertada() && ! s.enlace.startsWith( 'mailto:' ) ? '_top' : '_blank';

		};
		actualizar();
		// la tipología puede cambiar (modo profesional): el enlace se calcula al pulsar
		boton.addEventListener( 'pointerdown', actualizar );
		boton.addEventListener( 'focus', actualizar );
		return;

	}

	const marco = dialogo.querySelector<HTMLElement>( '.marco-formulario' )!;
	boton.removeAttribute( 'target' );
	boton.addEventListener( 'click', ( ev ) => {

		ev.preventDefault();
		const t = tipologia();
		const iframe = document.createElement( 'iframe' );
		iframe.title = 'Formulario de solicitud de información';
		// aislado: sus scripts funcionan, pero con un origen propio (no puede leer nada de aquí)
		iframe.setAttribute( 'sandbox', 'allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox' );
		iframe.src = `formulario.html?${ new URLSearchParams( utm( promocion.id, t.id ) ) }`;
		const alListo = ( e: MessageEvent ) => {

			if ( e.source !== iframe.contentWindow || e.data !== 'formulario-listo' ) return;
			iframe.contentWindow!.postMessage( { codigoFormulario: s.codigo }, '*' );
			removeEventListener( 'message', alListo );

		};
		addEventListener( 'message', alListo );
		marco.replaceChildren( iframe );
		dialogo.showModal();

	} );
	dialogo.querySelector( '.cerrar-dialogo' )!.addEventListener( 'click', () => dialogo.close() );
	dialogo.addEventListener( 'close', () => marco.replaceChildren() );

}
