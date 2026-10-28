// Marca blanca: todo lo visual que depende de la promotora sale de
// promociones/<id>/promocion.json (logo, colores, tipografía, favicon, textos).

import type { Marca, Promocion } from '../modelo/tipos';

const rgba = ( hex: string, a: number ) => {

	const n = parseInt( hex.replace( '#', '' ), 16 );
	return `rgb(${ ( n >> 16 ) & 255 } ${ ( n >> 8 ) & 255 } ${ n & 255 } / ${ a })`;

};

export const logoDataUrl = ( m: Marca ) => `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( m.logoSvg ) }`;

export function aplicarMarca( p: Promocion ) {

	const m = p.marca;
	const raiz = document.documentElement.style;
	raiz.setProperty( '--acento', m.colorPrincipal );
	raiz.setProperty( '--acento-suave', rgba( m.colorPrincipal, 0.09 ) );
	raiz.setProperty( '--secundario', m.colorSecundario );

	// tipografía de la promotora, con alternativas del sistema: en cada versión va dentro de la
	// propia web (fuentes/marca.css, de «preparar»); Google Fonts solo al desarrollar
	const css = m.tipografia.css ?? ( m.tipografia.googleFonts ? `https://fonts.googleapis.com/css2?family=${ m.tipografia.googleFonts }&display=swap` : null );
	if ( css ) {

		const link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = css;
		document.head.append( link );

	}

	raiz.setProperty( '--fuente', `"${ m.tipografia.familia }", "Helvetica Neue", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` );

	// favicon: el de la promotora o, si no hay, su logo
	let icono = document.querySelector<HTMLLinkElement>( 'link[rel="icon"]' );
	if ( ! icono ) {

		icono = document.createElement( 'link' );
		icono.rel = 'icon';
		document.head.append( icono );

	}

	icono.href = m.favicon ?? logoDataUrl( m );
	document.title = `${ p.promocion.nombre } · ${ m.promotora }`;

	// textos de la interfaz
	// como imagen: un SVG dentro de <img> no ejecuta nada
	for ( const logo of document.querySelectorAll( '#ficha-logo, #carga-logo' ) ) {

		const img = document.createElement( 'img' );
		img.src = logoDataUrl( m );
		img.alt = '';
		logo.replaceChildren( img );

	}
	const nombre = document.querySelector( '#ficha-promocion' );
	if ( nombre ) nombre.textContent = `${ p.promocion.nombre } · ${ p.promocion.ubicacion }`;

	// avisos legales de la promotora: en la visita (si lo ha escrito) y en la personalización
	const legales: [ string, string | undefined ][] = [ [ '#legal-experiencia', m.legal.experiencia ], [ '#legal-precios', m.legal.precios ] ];
	for ( const [ selector, texto ] of legales ) {

		const el = document.querySelector<HTMLElement>( selector );
		if ( ! el ) continue;
		el.textContent = texto?.trim() ?? '';
		el.title = el.textContent;
		el.hidden = ! el.textContent;

	}

}

/** Logo rasterizado (PNG) para el PDF. */
export const logoPNG = ( m: Marca, alto = 96 ) => svgPNG( m.logoSvg, alto );

/** Cualquier SVG rasterizado a PNG con la altura dada. */
export function svgPNG( svg: string, alto = 96 ): Promise<{ url: string; ancho: number; alto: number }> {

	return new Promise( ( ok, mal ) => {

		const img = new Image();
		img.onload = () => {

			const escala = alto / ( img.naturalHeight || 32 );
			const c = document.createElement( 'canvas' );
			c.width = Math.round( ( img.naturalWidth || 120 ) * escala );
			c.height = alto;
			c.getContext( '2d' )!.drawImage( img, 0, 0, c.width, c.height );
			ok( { url: c.toDataURL( 'image/png' ), ancho: c.width, alto: c.height } );

		};

		img.onerror = mal;
		img.src = `data:image/svg+xml;charset=utf-8,${ encodeURIComponent( svg ) }`;

	} );

}
