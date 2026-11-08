// Descarga de una exportación de MUNE (decisión 70): la clave llega en el
// enlace del email (#…), nunca se envía en la dirección a ningún servidor salvo
// a la función «exportacion», que devuelve botones de descarga de 10 minutos.
( async () => {

	const SUPABASE = 'https://iowtdenlkxjqzlpwizgb.supabase.co';
	const CLAVE = 'sb_publishable_LLvwP-xexV-Hlz2R585IQQ_H2NfJebR';
	const estado = document.getElementById( 'estado' );
	const caja = document.getElementById( 'partes' );
	const fallo = ( texto ) => { estado.textContent = texto; estado.classList.add( 'error' ); };
	const token = location.hash.slice( 1 );
	if ( ! token ) return fallo( 'Este enlace está incompleto. Ábrelo desde el email que te ha enviado MUNE.' );
	const tamano = ( b ) => b >= 1048576 ? `${ ( b / 1048576 ).toFixed( 1 ).replace( '.', ',' ) } MB` : `${ Math.max( 1, Math.round( b / 1024 ) ) } KB`;
	try {

		const r = await fetch( `${ SUPABASE }/functions/v1/exportacion`, {
			method: 'POST',
			headers: { apikey: CLAVE, 'Content-Type': 'application/json' },
			body: JSON.stringify( { accion: 'descargar', token } ),
		} );
		const datos = await r.json().catch( () => ( {} ) );
		if ( ! r.ok ) return fallo( datos.error || 'No se ha podido abrir la exportación. Vuelve a probar en unos minutos.' );
		const hasta = new Date( datos.caduca_en ).toLocaleDateString( 'es-ES', { day: 'numeric', month: 'long', year: 'numeric' } );
		estado.textContent = `«${ datos.titulo }»: ${ datos.archivos ?? '' } archivos en ${ datos.partes.length === 1 ? 'un ZIP' : `${ datos.partes.length } ZIP` }. Disponible hasta el ${ hasta }.`;
		for ( const p of datos.partes ) {

			const fila = document.createElement( 'div' );
			fila.className = 'parte';
			const texto = document.createElement( 'div' );
			texto.textContent = p.nombre;
			const detalle = document.createElement( 'small' );
			detalle.textContent = `${ tamano( p.tamano ) } · huella SHA-256 ${ p.huella.slice( 0, 16 ) }…`;
			texto.append( detalle );
			const boton = Object.assign( document.createElement( 'a' ), { href: p.url, textContent: 'Descargar' } );
			fila.append( texto, boton );
			caja.append( fila );

		}
		caja.hidden = false;
		document.getElementById( 'ayuda' ).hidden = false;

	} catch {

		fallo( 'No se ha podido conectar. Revisa tu conexión y vuelve a probar.' );

	}

} )();
