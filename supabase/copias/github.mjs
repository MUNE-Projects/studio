// Almacén de copias en GitHub (receta 18, decisión 56).
//
// Cada copia es una «release» en borrador del almacén privado
// MUNE-Projects/copias, con sus archivos adjuntos. No va al historial de git:
// al borrar la release, sus archivos desaparecen. Solo la ven quienes tienen
// acceso al almacén (los borradores no son públicos ni siquiera dentro de él).
//
//  · bd-AAAA-MM-DD-HHMMSS: la base de datos (datos.tar.gz.gpg) y el índice
//    de archivos (indice.json.gpg). Una por noche; se borran a los 31 días.
//  · archivos-AAAA-MM-DD-HHMMSS: los archivos nuevos de esa noche
//    (archivos.tar.gpg). Si un archivo se borra en Supabase, 31 días después
//    se rehace el paquete sin él.
//
// Variables: COPIAS_REPO (MUNE-Projects/copias), COPIAS_TOKEN (llave B).
// GITHUB_API y GITHUB_UPLOADS solo cambian en las pruebas.

const API = process.env.GITHUB_API || 'https://api.github.com';
const SUBIDAS = process.env.GITHUB_UPLOADS || 'https://uploads.github.com';

export function almacenCopias( repo, token ) {

	async function pedir( url, opciones = {} ) {

		const r = await fetch( url, {
			...opciones,
			headers: { Authorization: `Bearer ${ token }`, 'X-GitHub-Api-Version': '2022-11-28', Accept: 'application/vnd.github+json', ...opciones.headers },
		} );
		if ( ! r.ok ) throw new Error( `GitHub ${ opciones.method ?? 'GET' } ${ url.replace( /\?.*/, '' ).split( '/' ).slice( -2 ).join( '/' ) }: ${ r.status } ${ ( await r.text() ).slice( 0, 200 ) }` );
		return r;

	}

	return {

		/** Todas las copias (releases), ordenadas por nombre. */
		async lista() {

			const todas = [];
			for ( let pagina = 1; ; pagina ++ ) {

				const lote = await ( await pedir( `${ API }/repos/${ repo }/releases?per_page=100&page=${ pagina }` ) ).json();
				todas.push( ...lote );
				if ( lote.length < 100 ) break;

			}
			return todas.sort( ( a, b ) => a.name.localeCompare( b.name ) );

		},

		async crear( nombre, descripcion ) {

			return ( await pedir( `${ API }/repos/${ repo }/releases`, {
				method: 'POST', body: JSON.stringify( { tag_name: nombre, name: nombre, body: descripcion, draft: true } ),
			} ) ).json();

		},

		async subir( release, nombre, datos ) {

			return ( await pedir( `${ SUBIDAS }/repos/${ repo }/releases/${ release.id }/assets?name=${ encodeURIComponent( nombre ) }`, {
				method: 'POST', body: datos, headers: { 'Content-Type': 'application/octet-stream' },
			} ) ).json();

		},

		/** Contenido de un adjunto de una release, por su nombre. */
		async bajar( release, nombre ) {

			const adjunto = release.assets.find( ( a ) => a.name === nombre );
			if ( ! adjunto ) throw new Error( `La copia ${ release.name } no tiene ${ nombre }` );
			const r = await pedir( `${ API }/repos/${ repo }/releases/assets/${ adjunto.id }`, { headers: { Accept: 'application/octet-stream' } } );
			return Buffer.from( await r.arrayBuffer() );

		},

		async borrar( release ) {

			await pedir( `${ API }/repos/${ repo }/releases/${ release.id }`, { method: 'DELETE' } );

		},

	};

}

/** Fecha (AAAA-MM-DD) de una copia por su nombre, o null. */
export const fechaDe = ( nombre ) => /^(?:bd|archivos)-(\d{4}-\d{2}-\d{2})-\d{6}$/.exec( nombre )?.[ 1 ] ?? null;

/** Días que han pasado entre dos fechas AAAA-MM-DD. */
export const diasEntre = ( desde, hasta ) => ( Date.parse( `${ hasta }T00:00:00Z` ) - Date.parse( `${ desde }T00:00:00Z` ) ) / 86_400_000;

/** Lo que se conserva: 31 días. */
export const DIAS = 31;
